// #134 AC-1（1-3 AC-1・AC-2・AC-3・AC-5・AC-6）: メッセージの編集（EP-1-03 PATCH /api/messages/:messageId）を、
// 実際のアプリ入口（index.ts の app）と隔離 D1 で確かめる。
// 判定の順（計画「計画で決めた点」2・改訂1 指摘4）：Controller が本文の形を先に確かめる（422）→
//   ① メッセージがあり部屋が見えるか（見えなければ 404。存在しない・非公開で未参加・当事者でない DM・アーカイブ済みを区別しない）
//   → ② 本人の投稿か（違えば 403。logger.audit に拒否を記録）→ ③ perm.message.edit.own → ④ 削除済みなら 409
//   → ⑤ 部屋の状態（未参加は 403、部署が無効のチャンネルは 409、DM の相手が無効なら 409）→ ⑦ 条件付きの UPDATE。
// 応答の形（計画 1・7）：成功は 200 { id, body, editedAt }。一覧（EP-1-01）の items[] は { id, roomId, author, body, createdAt, editedAt, deleted }。
// 編集は再認証を求めない（要件 0-5 の対象は削除だけ）。同じ内容でも送られた編集は edited_at を更新する（計画 6）。
// データは架空（testuser_edit_、[UNIT_TEST]、@example.com）。
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
import {
  ZERO_ID,
  insertMessage,
  messageCount,
} from "../../test/message-fixtures";
import {
  archiveChannel,
  cleanupMessageModifyScenario,
  deactivateDepartment,
  editMessage,
  failureAuditLines,
  insertModifyUser,
  leaveChannel,
  listedItem,
  markDeleted,
  messageRow,
  type ModifyUser,
} from "../../test/message-modify-fixtures";
import { testId } from "../../test/role-fixtures";

let deptA: SeededDepartment;
let author: ModifyUser;
let other: ModifyUser;
let ownerA: ModifyUser;
let admin: ModifyUser;
let stranger: ModifyUser;
let logLines: string[];

const ORIGINAL = `${TEST_TAG}元の本文`;
const EDITED = `${TEST_TAG}直した本文`;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** 本人（author）の投稿を、指定した部屋に入れる */
const seed = (roomId: string, senderId = author.userId) =>
  insertMessage({ roomId, senderId, body: ORIGINAL });

beforeEach(async () => {
  logLines = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    logLines.push(String(line));
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  deptA = await insertDepartmentWithChannels("編集A");
  author = await insertModifyUser("testuser_edit_author", deptA.id);
  other = await insertModifyUser("testuser_edit_other", deptA.id);
  ownerA = await insertModifyUser("testuser_edit_ownera", deptA.id);
  admin = await insertModifyUser("testuser_edit_admin", deptA.id);
  stranger = await insertModifyUser("testuser_edit_stranger", deptA.id);
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

describe("#134 AC-1（1-3 AC-1・AC-3）本人の編集", () => {
  it("#134 AC-1（1-3 AC-1）: 本人はチャンネルの自分の投稿を編集でき、200 で { id, body, editedAt } だけを返す", async () => {
    const id = await seed(deptA.dedicatedChannelId);
    const response = await editMessage(id, { body: EDITED }, author.token);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({
      id,
      body: EDITED,
      editedAt: expect.stringMatching(ISO),
    });
    const row = await messageRow(id);
    expect(row?.body).toBe(EDITED);
    expect(row?.edited_at).toBe(body.editedAt);
    expect(row?.deleted_at).toBeNull();
  });

  it("#134 AC-1（1-3 AC-1・AC-3）: 編集の後の一覧（after なし・あり）に、新しい本文と editedAt が出て、deleted は false", async () => {
    const id = await seed(deptA.dedicatedChannelId);
    const response = await editMessage(id, { body: EDITED }, author.token);
    const { editedAt } = (await response.json()) as { editedAt: string };
    for (const after of [undefined, ZERO_ID]) {
      const item = await listedItem(
        deptA.dedicatedChannelId,
        id,
        other.token,
        after,
      );
      expect(item, `after=${after}`).toMatchObject({
        id,
        body: EDITED,
        editedAt,
        deleted: false,
        author: { id: author.userId },
      });
    }
  });

  it("#134 AC-1（1-3 AC-3・C-57）: 一覧の項目に過去の本文を返す項目がない（項目は決めたものだけ）", async () => {
    const id = await seed(deptA.dedicatedChannelId);
    await editMessage(id, { body: EDITED }, author.token);
    const item = await listedItem(deptA.dedicatedChannelId, id, other.token);
    expect(Object.keys(item ?? {}).sort()).toEqual(
      [
        "author",
        "body",
        "createdAt",
        "deleted",
        "editedAt",
        "id",
        "roomId",
      ].sort(),
    );
    expect(JSON.stringify(item)).not.toContain(ORIGINAL);
  });

  it("#134 AC-1（1-3 AC-3）: 編集していない投稿の一覧の editedAt は null、deleted は false", async () => {
    const id = await seed(deptA.dedicatedChannelId);
    expect(
      await listedItem(deptA.dedicatedChannelId, id, other.token),
    ).toMatchObject({ body: ORIGINAL, editedAt: null, deleted: false });
  });

  it("#134 AC-1（計画 6）: 同じ内容の編集も 200 で、edited_at が付く", async () => {
    const id = await seed(deptA.dedicatedChannelId);
    const response = await editMessage(id, { body: ORIGINAL }, author.token);
    expect(response.status).toBe(200);
    const row = await messageRow(id);
    expect(row?.body).toBe(ORIGINAL);
    expect(row?.edited_at).toMatch(ISO);
  });

  it("#134 AC-1（1-3 AC-1）: 2回編集すると、後の本文になり、editedAt は前の編集より前にならない（後勝ち。計画 5）", async () => {
    const id = await seed(deptA.dedicatedChannelId);
    const first = (await (
      await editMessage(id, { body: `${TEST_TAG}一回目` }, author.token)
    ).json()) as { editedAt: string };
    const second = (await (
      await editMessage(id, { body: `${TEST_TAG}二回目` }, author.token)
    ).json()) as { editedAt: string };
    expect(second.editedAt >= first.editedAt).toBe(true);
    expect((await messageRow(id))?.body).toBe(`${TEST_TAG}二回目`);
  });

  it("#134 AC-1（1-3 AC-1）: 編集は再認証を求めない（再認証していないセッションで 200）", async () => {
    const id = await seed(deptA.dedicatedChannelId);
    expect((await editMessage(id, { body: EDITED }, author.token)).status).toBe(
      200,
    );
  });

  it("#134 AC-1（1-3 AC-1）: DM の当事者は自分の投稿を編集でき、相手の一覧に新しい本文と editedAt が出る", async () => {
    const roomId = await insertDm(author.userId, other.userId);
    const id = await seed(roomId);
    const response = await editMessage(id, { body: EDITED }, author.token);
    expect(response.status).toBe(200);
    const { editedAt } = (await response.json()) as { editedAt: string };
    expect(await listedItem(roomId, id, other.token)).toMatchObject({
      body: EDITED,
      editedAt,
      deleted: false,
    });
  });

  it("#134 AC-1（1-2 AC-2・計画 1）: SQLの特殊文字・HTML・前後の空白を含む本文は、そのまま保存され、そのまま返る", async () => {
    const id = await seed(deptA.dedicatedChannelId);
    const text = " ' ; -- OR 1=1 --\n<script>x</script> ";
    const response = await editMessage(id, { body: text }, author.token);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { body: string }).body).toBe(text);
    expect((await messageRow(id))?.body).toBe(text);
  });

  it("#134 AC-1: 編集しても行は増えない（ID は変わらない）", async () => {
    const id = await seed(deptA.dedicatedChannelId);
    await editMessage(id, { body: EDITED }, author.token);
    expect(await messageCount(deptA.dedicatedChannelId)).toBe(1);
  });
});

describe("#134 AC-1（1-3 AC-2）他人の投稿は編集できない", () => {
  it.each([
    ["一般の参加者", "dedicated", () => other],
    ["部署のオーナー", "dedicated", () => ownerA],
    ["全体管理者", "dedicated", () => admin],
    ["一般の参加者", "announcement", () => other],
    ["部署のオーナー", "announcement", () => ownerA],
    ["全体管理者", "announcement", () => admin],
  ] as const)(
    "#134 AC-1（1-3 AC-2・C-112）: %s は、%s チャンネルの他人の投稿を編集できず 403 FORBIDDEN。本文は変わらず、拒否の監査（logger.audit）が残る",
    async (_label, channel, who) => {
      const roomId =
        channel === "dedicated"
          ? deptA.dedicatedChannelId
          : deptA.announcementChannelId;
      const id = await seed(roomId);
      const response = await editMessage(id, { body: EDITED }, who().token);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "FORBIDDEN" });
      expect(await messageRow(id)).toMatchObject({
        body: ORIGINAL,
        edited_at: null,
      });
      const denied = failureAuditLines(logLines);
      expect(denied.length).toBeGreaterThanOrEqual(1);
      // 拒否の記録に本文（元の本文・送られた本文）を出さない（Skill「logger」）
      expect(JSON.stringify(denied)).not.toContain(ORIGINAL);
      expect(JSON.stringify(denied)).not.toContain(EDITED);
    },
  );

  it("#134 AC-1（1-3 AC-2）: DM の相手の投稿は、当事者でも編集できず 403", async () => {
    const roomId = await insertDm(author.userId, other.userId);
    const id = await seed(roomId, other.userId);
    const response = await editMessage(id, { body: EDITED }, author.token);
    expect(response.status).toBe(403);
    expect((await messageRow(id))?.body).toBe(ORIGINAL);
  });

  it("#134 AC-1（判定の順 ②→④）: 他人の削除済みの投稿の編集は、409 ではなく 403", async () => {
    const id = await seed(deptA.dedicatedChannelId);
    await markDeleted(id, author.userId);
    const response = await editMessage(id, { body: EDITED }, other.token);
    expect(response.status).toBe(403);
  });

  it("#134 AC-1（判定の順 ②→⑤）: 部署が無効のチャンネルでも、他人の投稿の編集は 409 ではなく 403", async () => {
    const id = await seed(deptA.dedicatedChannelId);
    await deactivateDepartment(deptA.id);
    const response = await editMessage(id, { body: EDITED }, other.token);
    expect(response.status).toBe(403);
  });
});

describe("#134 AC-1（1-3 AC-5）通常のチャンネル・お知らせ専用での本人の編集", () => {
  it("#134 AC-1（1-3 AC-5）: 通常のチャンネル（normal）でも、本人は自分の投稿を編集できる", async () => {
    const roomId = await insertChannel({
      name: `${TEST_TAG}通常の編集`,
      purpose: "normal",
      departmentId: deptA.id,
    });
    await insertMember(roomId, author.userId);
    const id = await seed(roomId);
    expect((await editMessage(id, { body: EDITED }, author.token)).status).toBe(
      200,
    );
  });

  it("#134 AC-1（1-3 AC-5・U-3）: お知らせ専用の投稿権限を失った元オーナーでも、参加中なら自分の投稿を編集できる", async () => {
    const id = await seed(deptA.announcementChannelId, ownerA.userId);
    await env.DB.prepare(
      "DELETE FROM user_role_assignments WHERE user_id = ? AND department_id = ?",
    )
      .bind(ownerA.userId, deptA.id)
      .run();
    const response = await editMessage(id, { body: EDITED }, ownerA.token);
    expect(response.status).toBe(200);
    expect((await messageRow(id))?.body).toBe(EDITED);
  });

  it("#134 AC-1（1-3 AC-5・U-3）: お知らせ専用の投稿権限のない一般の参加者でも、自分の投稿なら編集できる", async () => {
    const id = await seed(deptA.announcementChannelId, author.userId);
    expect((await editMessage(id, { body: EDITED }, author.token)).status).toBe(
      200,
    );
  });

  it("#134 AC-1（U-9）: 部署のない会社直属のチャンネル（全社連絡）では、参加中の本人は編集できる", async () => {
    const general = (await companyGeneralRoomId()) ?? "";
    expect(general).not.toBe("");
    await insertMember(general, author.userId);
    const id = await seed(general);
    expect((await editMessage(id, { body: EDITED }, author.token)).status).toBe(
      200,
    );
  });
});

describe("#134 AC-1（1-3 AC-6・U-9）読み取り専用のチャンネル", () => {
  it.each(["dedicated", "announcement"] as const)(
    "#134 AC-1（1-3 AC-6・U-9）: 部署が無効のチャンネル（%s）では、本人の編集も 409 CONFLICT で、本文は変わらない",
    async (channel) => {
      const roomId =
        channel === "dedicated"
          ? deptA.dedicatedChannelId
          : deptA.announcementChannelId;
      const id = await seed(roomId);
      await deactivateDepartment(deptA.id);
      const response = await editMessage(id, { body: EDITED }, author.token);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "CONFLICT" });
      expect(await messageRow(id)).toMatchObject({
        body: ORIGINAL,
        edited_at: null,
      });
    },
  );
});

describe("#134 共通：見えない・存在しない・状態による拒否（編集）", () => {
  it.each(["missing", "private", "archived", "direct"] as const)(
    "#134 AC-1（改訂1 指摘4）: 見えないメッセージ（%s）の編集は、存在しないメッセージと同じ 404 NOT_FOUND",
    async (kind) => {
      const missingResponse = await editMessage(
        testId("NOMSG"),
        { body: EDITED },
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
        // アーカイブ済みは、本人（参加者）にも見えない（canViewChannel）。409 ではなく 404 にそろえる
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
      const response = await editMessage(id, { body: EDITED }, stranger.token);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual(await missingResponse.json());
      if (kind !== "missing")
        expect((await messageRow(id))?.body).toBe(ORIGINAL);
    },
  );

  it("#134 AC-1: 本人の投稿でも、アーカイブ済みのチャンネルでは 404 NOT_FOUND（409 にしない）", async () => {
    const id = await seed(deptA.dedicatedChannelId);
    await archiveChannel(deptA.dedicatedChannelId);
    const response = await editMessage(id, { body: EDITED }, author.token);
    expect(response.status).toBe(404);
    expect((await messageRow(id))?.body).toBe(ORIGINAL);
  });

  it("#134 AC-1（計画 5）: 本人の削除済みの投稿の編集は 409 CONFLICT で、本文も削除の状態も変わらない", async () => {
    const id = await seed(deptA.dedicatedChannelId);
    await markDeleted(id, author.userId);
    const response = await editMessage(id, { body: EDITED }, author.token);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "CONFLICT" });
    expect(await messageRow(id)).toMatchObject({
      body: ORIGINAL,
      edited_at: null,
      deleted_by: author.userId,
    });
  });

  it("#134 AC-1（U-3）: 公開チャンネルを抜けた本人は、自分の投稿を編集できず 403 FORBIDDEN", async () => {
    const id = await seed(deptA.dedicatedChannelId);
    await leaveChannel(deptA.dedicatedChannelId, author.userId);
    const response = await editMessage(id, { body: EDITED }, author.token);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "FORBIDDEN" });
    expect((await messageRow(id))?.body).toBe(ORIGINAL);
  });

  it("#134 AC-1（U-3・判定⑤）: 公開チャンネルを抜けた本人の編集の拒否（403）は、logger.audit に記録が残る（操作・利用者・対象・理由。本文は出さない）", async () => {
    const id = await seed(deptA.dedicatedChannelId);
    await leaveChannel(deptA.dedicatedChannelId, author.userId);
    const response = await editMessage(id, { body: EDITED }, author.token);
    expect(response.status).toBe(403);
    const denied = failureAuditLines(logLines).filter(
      (line) => line.attributes?.target === id,
    );
    expect(denied, JSON.stringify(failureAuditLines(logLines))).toHaveLength(1);
    const [line] = denied;
    expect(line?.body).toBe("message.edit");
    expect((line as { user_id?: string } | undefined)?.user_id).toBe(
      author.userId,
    );
    expect(line?.attributes).toMatchObject({
      log_type: "audit",
      result: "failure",
      target: id,
      reason: "not_member",
    });
    // 拒否の記録に本文（元の本文・送られた本文）を出さない（Skill「logger」）
    expect(JSON.stringify(denied)).not.toContain(ORIGINAL);
    expect(JSON.stringify(denied)).not.toContain(EDITED);
  });

  it("#134 AC-1（U-3）: 非公開チャンネルを抜けた本人には、メッセージが見えないので 404", async () => {
    const roomId = await insertChannel({
      name: `${TEST_TAG}抜けた非公開`,
      purpose: "normal",
      departmentId: deptA.id,
      visibility: "private",
    });
    await insertMember(roomId, author.userId);
    const id = await seed(roomId);
    await leaveChannel(roomId, author.userId);
    expect((await editMessage(id, { body: EDITED }, author.token)).status).toBe(
      404,
    );
  });

  it("#134 AC-1（U-3・C-168(2)）: DM の相手が無効なら、本人の投稿の編集も 409 CONFLICT で、本文は変わらない", async () => {
    const roomId = await insertDm(author.userId, other.userId);
    const id = await seed(roomId);
    await deactivateUser(other.userId);
    const response = await editMessage(id, { body: EDITED }, author.token);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "CONFLICT" });
    expect((await messageRow(id))?.body).toBe(ORIGINAL);
  });

  it("#134 AC-1（認可）: 未認証は 401 で、本文は変わらない", async () => {
    const id = await seed(deptA.dedicatedChannelId);
    const response = await editMessage(id, { body: EDITED }, null);
    expect(response.status).toBe(401);
    expect((await messageRow(id))?.body).toBe(ORIGINAL);
  });

  it("#134 AC-1（認可・C-28）: 許可されていない Origin からの編集は 403 FORBIDDEN_ORIGIN で、本文は変わらない", async () => {
    const id = await seed(deptA.dedicatedChannelId);
    const response = await editMessage(
      id,
      { body: EDITED },
      author.token,
      "https://origin.invalid",
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "FORBIDDEN_ORIGIN" });
    expect((await messageRow(id))?.body).toBe(ORIGINAL);
  });
});

describe("#134 共通：本文の検証（V-18・V-19。messageBodySchema）", () => {
  it.each([
    ["1文字", 200, "a"],
    ["4,000文字", 200, "a".repeat(4000)],
    ["0文字", 422, ""],
    ["4,001文字", 422, "a".repeat(4001)],
    ["空白と改行だけ", 422, " \n  "],
  ])("#134 AC-1: 編集の本文が%sのとき %i", async (_label, status, text) => {
    const id = await seed(deptA.dedicatedChannelId);
    const response = await editMessage(id, { body: text }, author.token);
    expect(response.status).toBe(status);
    if (status === 422) {
      const body = (await response.json()) as {
        code: string;
        fields: string[];
      };
      expect(body.code).toBe("VALIDATION_ERROR");
      expect(body.fields).toContain("body");
      expect((await messageRow(id))?.body).toBe(ORIGINAL);
    } else {
      expect((await messageRow(id))?.body).toBe(text);
    }
  });

  it.each([
    ["body がない", {}],
    ["body が文字列でない", { body: 123 }],
    ["body が null", { body: null }],
    ["余分な項目（roomId）", { body: "x", roomId: "x" }],
    ["投稿者を指定する項目（senderId）", { body: "x", senderId: "someone" }],
    [
      "編集日時を指定する項目（editedAt）",
      { body: "x", editedAt: "2020-01-01T00:00:00.000Z" },
    ],
  ])("#134 AC-1: %s は 422 で、本文は変わらない", async (_label, payload) => {
    const id = await seed(deptA.dedicatedChannelId);
    const response = await editMessage(id, payload, author.token);
    expect(response.status).toBe(422);
    expect(await messageRow(id)).toMatchObject({
      body: ORIGINAL,
      edited_at: null,
    });
  });

  it("#134 AC-1（判定の順）: 本文の形の誤りは、他人の投稿・存在しないメッセージでも 422（Controller が先）", async () => {
    const id = await seed(deptA.dedicatedChannelId);
    expect((await editMessage(id, { body: "" }, other.token)).status).toBe(422);
    expect(
      (await editMessage(testId("NOMSG"), { body: "" }, author.token)).status,
    ).toBe(422);
  });

  it("#134 AC-1: messageId が長すぎる（65文字）とき、422 または 404 で、500 にならない", async () => {
    const response = await editMessage(
      "A".repeat(65),
      { body: EDITED },
      author.token,
    );
    expect([404, 422]).toContain(response.status);
  });
});
