// #134 AC-1（1-3 AC-1・AC-2・AC-4・AC-5・AC-6）: メッセージの削除（EP-1-04 DELETE /api/messages/:messageId）を、
// 実際のアプリ入口（index.ts の app）と隔離 D1 で確かめる。
// 判定の順（計画「計画で決めた点」2・改訂1 指摘4）：
//   ① メッセージがあり部屋が見えるか（404）→ ② 本人の投稿か（403。logger.audit に記録）→ ③ perm.message.delete.own
//   → ④ 削除済みなら 409 → ⑤ 部屋の状態（未参加 403、部署が無効 409、DM の相手が無効 409）
//   → ⑥ 再認証（なし・5分を超えたら 403 REAUTH_REQUIRED。断られる操作でパスワードを入力させないよう最後）→ ⑦ 条件付きの UPDATE と監査の batch。
// 応答（計画 1・4・7）：成功は 204（本文なし）。削除は非表示の方式で、本文は DB に残し（EP-1-04「実体は消さない」）、
//   一覧（EP-1-01）では deleted: true・body: null・editedAt: null（投稿者と日時は残す。after の有無にかかわらず同じ）。
//   監査 message.delete を1行（actor_id は本人、target_id はメッセージ、detail は { roomId } だけで本文を入れない）。
// データは架空（testuser_del_、[UNIT_TEST]、@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { companyGeneralRoomId } from "../../test/company-general-fixtures";
import {
  TEST_TAG,
  insertChannel,
  insertDepartmentWithChannels,
  insertMember,
  makeGlobalAdmin,
  makeOwner,
  type SeededDepartment,
} from "../../test/department-fixtures";
import { deactivateUser, insertDm } from "../../test/dm-fixtures";
import { ZERO_ID, insertMessage } from "../../test/message-fixtures";
import {
  REAUTH_WINDOW_MS,
  archiveChannel,
  cleanupMessageModifyScenario,
  deactivateDepartment,
  deleteAuditRows,
  deleteMessage,
  editMessage,
  failureAuditLines,
  insertModifyUser,
  leaveChannel,
  listedItem,
  markDeleted,
  markEdited,
  messageRow,
  newSessionFor,
  type ModifyUser,
} from "../../test/message-modify-fixtures";
import { testId } from "../../test/role-fixtures";

let deptA: SeededDepartment;
/** 再認証済み（1分前）のセッションを持つ投稿者 */
let author: ModifyUser;
/** 同じ投稿者の、再認証していないセッション */
let authorPlain: string;
let other: ModifyUser;
let ownerA: ModifyUser;
let admin: ModifyUser;
let stranger: ModifyUser;
let logLines: string[];

const ORIGINAL = `${TEST_TAG}消す本文`;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ONE_MINUTE = 60_000;

const seed = (roomId: string, senderId = author.userId) =>
  insertMessage({ roomId, senderId, body: ORIGINAL });

/** 削除されていない（列がすべて NULL で、本文が元のまま） */
async function expectUntouched(id: string) {
  expect(await messageRow(id)).toMatchObject({
    body: ORIGINAL,
    deleted_at: null,
    deleted_by: null,
  });
  expect(await deleteAuditRows(id)).toEqual([]);
}

beforeEach(async () => {
  logLines = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    logLines.push(String(line));
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  deptA = await insertDepartmentWithChannels("削除A");
  author = await insertModifyUser("testuser_del_author", deptA.id, ONE_MINUTE);
  authorPlain = await newSessionFor(author.userId, null);
  other = await insertModifyUser("testuser_del_other", deptA.id, ONE_MINUTE);
  ownerA = await insertModifyUser("testuser_del_ownera", deptA.id, ONE_MINUTE);
  admin = await insertModifyUser("testuser_del_admin", deptA.id, ONE_MINUTE);
  stranger = await insertModifyUser(
    "testuser_del_stranger",
    deptA.id,
    ONE_MINUTE,
  );
  await makeOwner(ownerA.userId, deptA.id);
  await makeGlobalAdmin(admin.userId);
  for (const user of [author, other, ownerA, admin]) {
    await insertMember(deptA.dedicatedChannelId, user.userId);
    await insertMember(deptA.announcementChannelId, user.userId);
  }
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupMessageModifyScenario();
});

describe("#134 AC-1（1-3 AC-1・AC-4）本人の削除", () => {
  it("#134 AC-1（1-3 AC-1・AC-4）: 本人は再認証の後にチャンネルの自分の投稿を削除でき、204 で本文を返さない。DB は deleted_at・deleted_by が入り、本文は残る", async () => {
    const id = await seed(deptA.dedicatedChannelId);
    const response = await deleteMessage(id, author.token);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    const row = await messageRow(id);
    expect(row).toMatchObject({ body: ORIGINAL, deleted_by: author.userId });
    expect(row?.deleted_at).toMatch(ISO);
  });

  it("#134 AC-1（1-3 AC-4・C-57）: 削除の後の一覧（after なし・あり）では deleted: true・body: null・editedAt: null で、投稿者と日時は残る", async () => {
    const id = await seed(deptA.dedicatedChannelId);
    const before = await listedItem(deptA.dedicatedChannelId, id, other.token);
    expect((await deleteMessage(id, author.token)).status).toBe(204);
    for (const after of [undefined, ZERO_ID]) {
      const item = await listedItem(
        deptA.dedicatedChannelId,
        id,
        other.token,
        after,
      );
      expect(item, `after=${after}`).toEqual({
        id,
        roomId: deptA.dedicatedChannelId,
        author: before?.author,
        body: null,
        createdAt: before?.createdAt,
        editedAt: null,
        deleted: true,
      });
    }
  });

  it("#134 AC-1（1-3 AC-3・AC-4）: 編集した後に削除した投稿も、一覧では editedAt: null で、編集後の本文も出ない", async () => {
    const id = await seed(deptA.dedicatedChannelId);
    await markEdited(id, "2026-11-13T00:00:00.000Z");
    expect((await deleteMessage(id, author.token)).status).toBe(204);
    const item = await listedItem(deptA.dedicatedChannelId, id, author.token);
    expect(item).toMatchObject({ body: null, editedAt: null, deleted: true });
    expect(JSON.stringify(item)).not.toContain(ORIGINAL);
  });

  it("#134 AC-1（1-3 AC-1）: DM の当事者は自分の投稿を削除でき、相手の一覧で deleted: true・body: null になる", async () => {
    const roomId = await insertDm(author.userId, other.userId);
    const id = await seed(roomId);
    expect((await deleteMessage(id, author.token)).status).toBe(204);
    expect(await listedItem(roomId, id, other.token)).toMatchObject({
      body: null,
      editedAt: null,
      deleted: true,
    });
    expect((await messageRow(id))?.body).toBe(ORIGINAL);
  });

  it("#134 AC-1（計画 4・project-rules）: 削除で監査 message.delete が1行でき、detail は { roomId } だけで本文を含まない", async () => {
    const id = await seed(deptA.dedicatedChannelId);
    expect((await deleteMessage(id, author.token)).status).toBe(204);
    const audits = await deleteAuditRows(id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_id: author.userId,
      action: "message.delete",
      target_type: "message",
      target_id: id,
      result: "success",
    });
    expect(JSON.parse(audits[0]?.detail ?? "null")).toEqual({
      roomId: deptA.dedicatedChannelId,
    });
    expect(audits[0]?.detail ?? "").not.toContain(ORIGINAL);
  });
});

describe("#134 AC-1（1-3 AC-4）削除の再認証（0-5）", () => {
  it("#134 AC-1（1-3 AC-4）: 再認証していないセッションの削除は 403 REAUTH_REQUIRED で、DB も監査も変わらない", async () => {
    const id = await seed(deptA.dedicatedChannelId);
    const response = await deleteMessage(id, authorPlain);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "REAUTH_REQUIRED" });
    await expectUntouched(id);
  });

  it("#134 AC-1（1-3 AC-4）: 再認証から5分を超えたセッションの削除は 403 REAUTH_REQUIRED で、DB は変わらない", async () => {
    const id = await seed(deptA.dedicatedChannelId);
    const stale = await newSessionFor(
      author.userId,
      REAUTH_WINDOW_MS + ONE_MINUTE,
    );
    const response = await deleteMessage(id, stale);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "REAUTH_REQUIRED" });
    await expectUntouched(id);
  });

  it("#134 AC-1（1-3 AC-4）: 再認証から5分以内（4分前）のセッションなら 204", async () => {
    const id = await seed(deptA.dedicatedChannelId);
    const recent = await newSessionFor(author.userId, 4 * ONE_MINUTE);
    expect((await deleteMessage(id, recent)).status).toBe(204);
  });

  it("#134 AC-1（判定の順 ②→⑥）: 他人の投稿の削除は、再認証していなくても REAUTH_REQUIRED ではなく 403 FORBIDDEN（断られる操作でパスワードを求めない）", async () => {
    const id = await seed(deptA.dedicatedChannelId, other.userId);
    const response = await deleteMessage(id, authorPlain);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "FORBIDDEN" });
  });

  it("#134 AC-1（判定の順 ①→⑥）: 存在しないメッセージの削除は、再認証していなくても 404", async () => {
    expect((await deleteMessage(testId("NOMSG"), authorPlain)).status).toBe(
      404,
    );
  });

  it("#134 AC-1（判定の順 ④→⑥）: 削除済みの自分の投稿は、再認証していなくても 409", async () => {
    const id = await seed(deptA.dedicatedChannelId);
    await markDeleted(id, author.userId);
    expect((await deleteMessage(id, authorPlain)).status).toBe(409);
  });

  it("#134 AC-1（判定の順 ⑤→⑥）: 部署が無効のチャンネルでは、再認証していなくても 409。公開チャンネルを抜けていれば 403 FORBIDDEN", async () => {
    const id = await seed(deptA.dedicatedChannelId);
    await deactivateDepartment(deptA.id);
    expect((await deleteMessage(id, authorPlain)).status).toBe(409);
    await env.DB.prepare("UPDATE departments SET is_active = 1 WHERE id = ?")
      .bind(deptA.id)
      .run();
    await leaveChannel(deptA.dedicatedChannelId, author.userId);
    const response = await deleteMessage(id, authorPlain);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("#134 AC-1（1-3 AC-2・AC-4）他人の投稿は削除できない", () => {
  it.each([
    ["一般の参加者", "dedicated", () => other],
    ["部署のオーナー", "dedicated", () => ownerA],
    ["全体管理者", "dedicated", () => admin],
    ["一般の参加者", "announcement", () => other],
    ["部署のオーナー", "announcement", () => ownerA],
    // お知らせ専用での全体管理者の直接削除（C-112）は #142。#134 では R-29 の付与の経路がなく、全ロール 403
    ["全体管理者", "announcement", () => admin],
  ] as const)(
    "#134 AC-1（1-3 AC-4・R-29）: 再認証済みの%sでも、%s チャンネルの他人の投稿は削除できず 403 FORBIDDEN。DB・監査は変わらず、拒否の監査（logger.audit）が残る",
    async (_label, channel, who) => {
      const roomId =
        channel === "dedicated"
          ? deptA.dedicatedChannelId
          : deptA.announcementChannelId;
      const id = await seed(roomId);
      const response = await deleteMessage(id, who().token);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "FORBIDDEN" });
      await expectUntouched(id);
      const denied = failureAuditLines(logLines);
      expect(denied.length).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(denied)).not.toContain(ORIGINAL);
    },
  );

  it("#134 AC-1（1-3 AC-4）: DM の相手の投稿は、当事者でも削除できず 403", async () => {
    const roomId = await insertDm(author.userId, other.userId);
    const id = await seed(roomId, other.userId);
    expect((await deleteMessage(id, author.token)).status).toBe(403);
    await expectUntouched(id);
  });

  it("#134 AC-1（判定の順 ②→④）: 他人の削除済みの投稿の削除は、409 ではなく 403", async () => {
    const id = await seed(deptA.dedicatedChannelId, other.userId);
    await markDeleted(id, other.userId);
    expect((await deleteMessage(id, author.token)).status).toBe(403);
  });
});

describe("#134 AC-1（1-3 AC-5・AC-6）チャンネルの種類と読み取り専用", () => {
  it("#134 AC-1（1-3 AC-5）: 通常のチャンネル（normal）でも、本人は自分の投稿を削除できる", async () => {
    const roomId = await insertChannel({
      name: `${TEST_TAG}通常の削除`,
      purpose: "normal",
      departmentId: deptA.id,
    });
    await insertMember(roomId, author.userId);
    const id = await seed(roomId);
    expect((await deleteMessage(id, author.token)).status).toBe(204);
  });

  it("#134 AC-1（1-3 AC-5・U-3）: お知らせ専用の投稿権限を失った元オーナーでも、参加中なら自分の投稿を削除できる", async () => {
    const id = await seed(deptA.announcementChannelId, ownerA.userId);
    await env.DB.prepare(
      "DELETE FROM user_role_assignments WHERE user_id = ? AND department_id = ?",
    )
      .bind(ownerA.userId, deptA.id)
      .run();
    expect((await deleteMessage(id, ownerA.token)).status).toBe(204);
    expect((await messageRow(id))?.deleted_by).toBe(ownerA.userId);
  });

  it("#134 AC-1（U-9）: 部署のない会社直属のチャンネル（全社連絡）では、参加中の本人は削除できる", async () => {
    const general = (await companyGeneralRoomId()) ?? "";
    expect(general).not.toBe("");
    await insertMember(general, author.userId);
    const id = await seed(general);
    expect((await deleteMessage(id, author.token)).status).toBe(204);
  });

  it.each(["dedicated", "announcement"] as const)(
    "#134 AC-1（1-3 AC-6・U-9）: 部署が無効のチャンネル（%s）では、再認証済みの本人の削除も 409 CONFLICT で、DB・監査は変わらない",
    async (channel) => {
      const roomId =
        channel === "dedicated"
          ? deptA.dedicatedChannelId
          : deptA.announcementChannelId;
      const id = await seed(roomId);
      await deactivateDepartment(deptA.id);
      const response = await deleteMessage(id, author.token);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "CONFLICT" });
      await expectUntouched(id);
    },
  );
});

describe("#134 共通：見えない・存在しない・状態による拒否（削除）", () => {
  it.each(["missing", "private", "archived", "direct"] as const)(
    "#134 AC-1（改訂1 指摘4）: 見えないメッセージ（%s）の削除は、存在しないメッセージと同じ 404 NOT_FOUND",
    async (kind) => {
      const missingResponse = await deleteMessage(
        testId("NOMSG"),
        stranger.token,
      );
      let id: string;
      if (kind === "missing") id = testId("NOMSG");
      else if (kind === "private") {
        const roomId = await insertChannel({
          name: `${TEST_TAG}隠れた非公開`,
          purpose: "normal",
          departmentId: deptA.id,
          visibility: "private",
        });
        await insertMember(roomId, author.userId);
        id = await seed(roomId);
      } else if (kind === "archived") {
        const roomId = await insertChannel({
          name: `${TEST_TAG}アーカイブ済み`,
          purpose: "normal",
          departmentId: deptA.id,
        });
        await insertMember(roomId, stranger.userId);
        id = await insertMessage({
          roomId,
          senderId: stranger.userId,
          body: ORIGINAL,
        });
        await archiveChannel(roomId);
      } else {
        const roomId = await insertDm(author.userId, other.userId);
        id = await seed(roomId);
      }
      const response = await deleteMessage(id, stranger.token);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual(await missingResponse.json());
      if (kind !== "missing") await expectUntouched(id);
    },
  );

  it("#134 AC-1（計画 5）: 削除済みの自分の投稿をもう一度削除すると 409 CONFLICT で、deleted_at・監査は変わらない", async () => {
    const id = await seed(deptA.dedicatedChannelId);
    await markDeleted(id, author.userId);
    const before = await messageRow(id);
    const response = await deleteMessage(id, author.token);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "CONFLICT" });
    expect(await messageRow(id)).toEqual(before);
    expect(await deleteAuditRows(id)).toEqual([]);
  });

  it("#134 AC-1（U-3）: 公開チャンネルを抜けた本人は、自分の投稿を削除できず 403 FORBIDDEN", async () => {
    const id = await seed(deptA.dedicatedChannelId);
    await leaveChannel(deptA.dedicatedChannelId, author.userId);
    const response = await deleteMessage(id, author.token);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "FORBIDDEN" });
    await expectUntouched(id);
  });

  it("#134 AC-1（U-3・判定⑤）: 公開チャンネルを抜けた本人の削除の拒否（403）は、logger.audit に記録が残る（操作・利用者・対象・理由。本文は出さない）", async () => {
    const id = await seed(deptA.dedicatedChannelId);
    await leaveChannel(deptA.dedicatedChannelId, author.userId);
    const response = await deleteMessage(id, author.token);
    expect(response.status).toBe(403);
    const denied = failureAuditLines(logLines).filter(
      (line) => line.attributes?.target === id,
    );
    expect(denied, JSON.stringify(failureAuditLines(logLines))).toHaveLength(1);
    const [line] = denied;
    expect(line?.body).toBe("message.delete");
    expect((line as { user_id?: string } | undefined)?.user_id).toBe(
      author.userId,
    );
    expect(line?.attributes).toMatchObject({
      log_type: "audit",
      result: "failure",
      target: id,
      reason: "not_member",
    });
    expect(JSON.stringify(denied)).not.toContain(ORIGINAL);
    // 拒否は監査ログの表（削除の成功の記録）には入れない
    await expectUntouched(id);
  });

  it("#134 AC-1（U-3・C-168(2)）: DM の相手が無効なら、本人の投稿の削除も 409 CONFLICT", async () => {
    const roomId = await insertDm(author.userId, other.userId);
    const id = await seed(roomId);
    await deactivateUser(other.userId);
    const response = await deleteMessage(id, author.token);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "CONFLICT" });
    await expectUntouched(id);
  });

  it("#134 AC-1（認可）: 未認証は 401 で、DB は変わらない", async () => {
    const id = await seed(deptA.dedicatedChannelId);
    expect((await deleteMessage(id, null)).status).toBe(401);
    await expectUntouched(id);
  });

  it("#134 AC-1（認可・C-28）: 許可されていない Origin からの削除は 403 FORBIDDEN_ORIGIN で、DB は変わらない", async () => {
    const id = await seed(deptA.dedicatedChannelId);
    const response = await deleteMessage(
      id,
      author.token,
      "https://origin.invalid",
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "FORBIDDEN_ORIGIN" });
    await expectUntouched(id);
  });
});

describe("#134 共通（壊すテスト）：同時の操作", () => {
  it("#134 AC-1（計画 5）: 同じ削除を同時に2回送ると、204 と 409 が1つずつで、監査 message.delete は1行", async () => {
    const id = await seed(deptA.dedicatedChannelId);
    const second = await newSessionFor(author.userId, ONE_MINUTE);
    const responses = await Promise.all([
      deleteMessage(id, author.token),
      deleteMessage(id, second),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([204, 409]);
    expect(await deleteAuditRows(id)).toHaveLength(1);
    expect((await messageRow(id))?.deleted_by).toBe(author.userId);
  });

  it("#134 AC-1（計画 5）: 削除と編集を同時に送っても、削除済みの行の本文は書き換わらない（編集が 200 なら、削除より前に確定している）", async () => {
    const id = await seed(deptA.dedicatedChannelId);
    const edited = `${TEST_TAG}同時の編集`;
    const [deleted, edit] = await Promise.all([
      deleteMessage(id, author.token),
      editMessage(id, { body: edited }, authorPlain),
    ]);
    expect(deleted.status).toBe(204);
    expect([200, 409]).toContain(edit.status);
    const row = await messageRow(id);
    expect(row?.deleted_by).toBe(author.userId);
    if (edit.status === 409) {
      expect(row).toMatchObject({ body: ORIGINAL, edited_at: null });
    }
    // 削除の後に編集を送っても、本文・edited_at は変わらない
    const after = await editMessage(
      id,
      { body: `${TEST_TAG}後から` },
      authorPlain,
    );
    expect(after.status).toBe(409);
    expect(await messageRow(id)).toEqual(row);
    expect(await deleteAuditRows(id)).toHaveLength(1);
  });

  it("#134 AC-1: 同時に5回の編集を送ると、すべて 200 で、最後に確定した本文が残る（版の列は持たない。計画 5）", async () => {
    const id = await seed(deptA.dedicatedChannelId);
    const texts = Array.from({ length: 5 }, (_, i) => `${TEST_TAG}同時${i}`);
    const responses = await Promise.all(
      texts.map((text) => editMessage(id, { body: text }, author.token)),
    );
    expect(responses.map((r) => r.status)).toEqual(Array(5).fill(200));
    expect(texts).toContain((await messageRow(id))?.body);
  });
});
