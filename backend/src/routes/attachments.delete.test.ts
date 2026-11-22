// #270（270-A）1-6 AC-4：添付の削除（EP-1-11 DELETE /api/attachments/:attachmentId）を、実際のアプリ入口（index.ts の app）・隔離 D1・
// 手元の R2（Miniflare の ATTACHMENTS）で確かめる（結合テスト）。期待は要件 1-6 AC-4・C-127 と計画 270-A（2版）の 2章・4章から決める。
// 判定の順（計画 4.2。この順を変えない）：
//   共通のゲート（未ログイン 401・送信元 403 FORBIDDEN_ORIGIN）→ param の形（422）
//   → ① 見えるか（見えない・存在しない・削除済み・メッセージが削除済みは 404。区別しない）→ 未投稿（409）
//   → ② 本人か（403。logger.audit attachment.delete failure not_author）→ ③ perm.attachment.delete.own（全ロールが持つため、ここでは確かめない。拒否は services/attachment.service.delete.test.ts の偽の authorizer で確かめる）
//   → ④ 部屋の状態（未参加 403、部署が無効 409、DM の相手が無効 409、案件の終了 409 は attachments.delete.case-room.test.ts）
//   → ⑥ 再認証（なし・5分を超えたら 403 REAUTH_REQUIRED。最後）→ ⑦ 書き込み（印・監査・索引の1回の batch）→ 204
// 実体（計画 4.4）：印 → R2 の delete → 行の物理削除、の順で、同じ要求の中で1回試す。R2 が失敗しても 204 で、行は印つきで残り、error ログに残す。
// 監査（AC-7）：attachment.delete・success・target_type attachment・detail は { roomId, messageId } だけ。
// データは架空（testuser_attdel_、[UNIT_TEST]、@example.com）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { apiRequest } from "../../test/api-request";
import { TEXT_BYTES } from "../../test/attachment-files";
import {
  ATTACHMENT_DELETE_ACTION,
  ATTACHMENT_UPDATE,
  PENDING_DELETE_MESSAGE,
  attachmentDocumentCount,
  auditRowsOf,
  cleanupAttachmentDeleteScenario,
  deleteAttachment,
  deletionOf,
  failingStatementDb,
  jsonLogs,
  markAttachmentDeleted,
  purgeStateOf,
  recordingBucket,
} from "../../test/attachment-delete-fixtures";
import {
  attachmentPath,
  attachmentRow,
  bucket,
  downloadAttachment,
  insertAttachmentRow,
  rawRequest,
  seedStoredAttachment,
  storedKeys,
} from "../../test/attachment-fixtures";
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
import { insertMessage, ulidAt } from "../../test/message-fixtures";
import {
  REAUTH_WINDOW_MS,
  archiveChannel,
  deactivateDepartment,
  insertModifyUser,
  leaveChannel,
  markDeleted,
  messageRow,
  newSessionFor,
  type ModifyUser,
} from "../../test/message-modify-fixtures";
import {
  buildSearchIndex,
  cleanupSearchIndex,
} from "../../test/search-fixtures";
import {
  LAST_ATTACHMENT_MESSAGE,
  cleanupAttachmentOnlyLeftovers,
  insertBodylessMessage,
  visibleAttachmentCount,
} from "../../test/attachment-only-fixtures";
import { attachmentPurgeJob } from "../services/attachment.service";
import { BAD_ORIGIN, codeOf } from "../../test/thread-fixtures";

const ONE_MINUTE = 60_000;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const BODY = `${TEST_TAG}添付の削除の本文`;
const NAME = "[UNIT_TEST]消す見積.txt";
const KEPT_NAME = "[UNIT_TEST]残す資料.txt";
const MISSING_ID = "01JZZZZZZZZZZZZZZZZZZZZZZZ";

let dept: SeededDepartment;
/** 再認証済み（1分前）の投稿者 */
let author: ModifyUser;
/** 同じ投稿者の、再認証していないセッション */
let authorPlain: string;
/** 同じ部屋の別の社員（再認証済み） */
let other: ModifyUser;
let ownerA: ModifyUser;
let admin: ModifyUser;
/** 別の部署の社員（部屋に参加していない） */
let outsider: ModifyUser;
/** 非公開のチャンネル（author・other・ownerA・admin が参加） */
let room: string;
let logLines: string[];
let errorLines: string[];
let seq = 0;

const nextMessageId = () => {
  seq += 1;
  return ulidAt(1_890_000_000_000 + seq * 1_000);
};

/** 投稿と、それに結び付いた添付2件（消すもの・残すもの）を作る。実体は R2 に入れる */
async function seedPosted(roomId = room, senderId = author.userId) {
  const messageId = nextMessageId();
  await insertMessage({ roomId, senderId, id: messageId, body: BODY });
  const target = await seedStoredAttachment(
    { roomId, uploaderId: senderId, messageId, originalName: NAME },
    TEXT_BYTES,
  );
  const kept = await seedStoredAttachment(
    { roomId, uploaderId: senderId, messageId, originalName: KEPT_NAME },
    TEXT_BYTES,
  );
  const targetKey = (await attachmentRow(target))?.storage_key ?? "";
  const keptKey = (await attachmentRow(kept))?.storage_key ?? "";
  return { messageId, target, kept, targetKey, keptKey };
}

/** 何も変わっていない（行が印なしで残り、実体があり、成功の監査がない） */
async function expectUntouched(attachmentId: string, key: string) {
  expect(await deletionOf(attachmentId)).toEqual({
    deleted_at: null,
    deleted_by: null,
  });
  expect(await storedKeys()).toContain(key);
  expect(await auditRowsOf(ATTACHMENT_DELETE_ACTION, attachmentId)).toEqual([]);
}

const failureAudits = () =>
  jsonLogs(logLines).filter(
    (line) =>
      line.attributes?.log_type === "audit" &&
      line.body === ATTACHMENT_DELETE_ACTION &&
      line.attributes.result === "failure",
  );

const roomPage = async (roomId: string, token: string) => {
  const response = await apiRequest(
    "GET",
    `/api/rooms/${roomId}/messages?limit=100`,
    { token },
  );
  expect(response.status).toBe(200);
  return (await response.json()) as {
    items: { id: string; body: string | null; attachments: { id: string }[] }[];
  };
};

beforeEach(async () => {
  logLines = [];
  errorLines = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    logLines.push(String(line));
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation((line: unknown) => {
    errorLines.push(String(line));
  });
  dept = await insertDepartmentWithChannels("添付削除");
  const otherDept = await insertDepartmentWithChannels("添付削除の別部署");
  author = await insertModifyUser(
    "testuser_attdel_author",
    dept.id,
    ONE_MINUTE,
  );
  authorPlain = await newSessionFor(author.userId, null);
  other = await insertModifyUser("testuser_attdel_other", dept.id, ONE_MINUTE);
  ownerA = await insertModifyUser("testuser_attdel_owner", dept.id, ONE_MINUTE);
  admin = await insertModifyUser("testuser_attdel_admin", dept.id, ONE_MINUTE);
  outsider = await insertModifyUser(
    "testuser_attdel_outsider",
    otherDept.id,
    ONE_MINUTE,
  );
  await makeOwner(ownerA.userId, dept.id);
  await makeGlobalAdmin(admin.userId);
  room = await insertChannel({
    name: `${TEST_TAG}添付削除の非公開`,
    purpose: "normal",
    departmentId: dept.id,
    visibility: "private",
  });
  for (const user of [author, other, ownerA, admin])
    await insertMember(room, user.userId);
});

afterEach(async () => {
  vi.restoreAllMocks();
  try {
    await cleanupAttachmentOnlyLeftovers();
    await cleanupSearchIndex();
  } finally {
    await cleanupAttachmentDeleteScenario();
  }
});

describe("#270 AC-1（1-6 AC-4）本人の削除", () => {
  it("#270 AC-1: 本人が自分の添付を1件消すと 204（本文なし・no-store）。実体（R2）と行がなくなり、同じメッセージのほかの添付と本文は残る", async () => {
    const seeded = await seedPosted();
    const response = await deleteAttachment(seeded.target, author.token);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("Cache-Control") ?? "").toContain("no-store");
    // 要求の中で1回試した後始末が成功した：実体と行がない（AC-5）
    expect(await storedKeys()).toEqual([seeded.keptKey]);
    expect(await attachmentRow(seeded.target)).toBeNull();
    // ほかの添付と本文は残る
    expect(await deletionOf(seeded.kept)).toEqual({
      deleted_at: null,
      deleted_by: null,
    });
    expect(await messageRow(seeded.messageId)).toMatchObject({
      body: BODY,
      deleted_at: null,
    });
  });

  it("#270 AC-1: 削除の後、配信は 404、部屋の一覧ではその添付だけが消え、ほかの添付は 200 で取れる", async () => {
    const seeded = await seedPosted();
    expect((await deleteAttachment(seeded.target, author.token)).status).toBe(
      204,
    );
    expect((await downloadAttachment(seeded.target, other.token)).status).toBe(
      404,
    );
    expect((await downloadAttachment(seeded.kept, other.token)).status).toBe(
      200,
    );
    const item = (await roomPage(room, other.token)).items.find(
      (i) => i.id === seeded.messageId,
    );
    expect(item?.body).toBe(BODY);
    expect(item?.attachments.map((a) => a.id)).toEqual([seeded.kept]);
  });

  it("#270 AC-7: 監査 attachment.delete が1行。detail は { roomId, messageId } だけで、ファイル名・本文を含まない", async () => {
    const seeded = await seedPosted();
    expect((await deleteAttachment(seeded.target, author.token)).status).toBe(
      204,
    );
    const audits = await auditRowsOf(ATTACHMENT_DELETE_ACTION, seeded.target);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_id: author.userId,
      action: ATTACHMENT_DELETE_ACTION,
      target_type: "attachment",
      target_id: seeded.target,
      result: "success",
    });
    expect(JSON.parse(audits[0]?.detail ?? "null")).toEqual({
      roomId: room,
      messageId: seeded.messageId,
    });
    expect(audits[0]?.detail ?? "").not.toContain(NAME);
    expect(audits[0]?.detail ?? "").not.toContain(BODY);
  });

  it("#270 AC-1（1-4 AC-5）: 返信に付けた自分の添付も消せる", async () => {
    const parent = nextMessageId();
    await insertMessage({
      roomId: room,
      senderId: other.userId,
      id: parent,
      body: `${TEST_TAG}親`,
    });
    const replyId = nextMessageId();
    await insertMessage({
      roomId: room,
      senderId: author.userId,
      id: replyId,
      body: `${TEST_TAG}返信`,
      parentMessageId: parent,
    });
    const onReply = await seedStoredAttachment(
      {
        roomId: room,
        uploaderId: author.userId,
        messageId: replyId,
        threadParentId: parent,
        originalName: NAME,
      },
      TEXT_BYTES,
    );
    expect((await deleteAttachment(onReply, author.token)).status).toBe(204);
    expect(await attachmentRow(onReply)).toBeNull();
  });

  it("#270 AC-4（C-171 U-3）: お知らせ専用チャンネルでも、今参加している本人なら自分の添付を消せる", async () => {
    await insertMember(dept.announcementChannelId, author.userId);
    const seeded = await seedPosted(dept.announcementChannelId);
    expect((await deleteAttachment(seeded.target, author.token)).status).toBe(
      204,
    );
  });

  it("#270 AC-1: DM の当事者は自分の添付を消せる", async () => {
    const dm = await insertDm(author.userId, other.userId);
    const seeded = await seedPosted(dm);
    expect((await deleteAttachment(seeded.target, author.token)).status).toBe(
      204,
    );
    expect(await attachmentRow(seeded.target)).toBeNull();
  });
});

describe("#270 AC-2 見えない・存在しない・削除済みは 404（区別しない）", () => {
  it("#270 AC-2: 存在しない添付・見えない部屋の添付・削除済みの添付・削除済みのメッセージの添付は、どれも 404 NOT_FOUND で、応答の本体も同じ", async () => {
    const hidden = await seedPosted();
    const deletedAttachment = await seedPosted();
    await markAttachmentDeleted(deletedAttachment.target, author.userId);
    const deletedMessage = await seedPosted();
    await markDeleted(deletedMessage.messageId, author.userId);

    const missing = await deleteAttachment(MISSING_ID, author.token);
    const missingBody = await missing.text();
    expect(missing.status).toBe(404);
    expect(JSON.parse(missingBody)).toMatchObject({ code: "NOT_FOUND" });
    const cases: [string, string, string][] = [
      ["見えない部屋の添付", hidden.target, outsider.token],
      ["削除済みの添付", deletedAttachment.target, author.token],
      ["削除済みのメッセージの添付", deletedMessage.target, author.token],
    ];
    for (const [label, id, token] of cases) {
      const response = await deleteAttachment(id, token);
      expect(response.status, label).toBe(404);
      expect(await response.text(), label).toBe(missingBody);
    }
    await expectUntouched(hidden.target, hidden.targetKey);
    await expectUntouched(deletedMessage.target, deletedMessage.targetKey);
  });

  it("#270 AC-2: アーカイブしたチャンネルの添付は 404（見えない扱い）", async () => {
    const seeded = await seedPosted();
    await archiveChannel(room);
    expect((await deleteAttachment(seeded.target, author.token)).status).toBe(
      404,
    );
    await expectUntouched(seeded.target, seeded.targetKey);
  });

  it("#270 AC-2: 他人の未投稿の添付は 404（未投稿はアップロードした本人にしか見えない）", async () => {
    const pending = await insertAttachmentRow({
      roomId: room,
      uploaderId: other.userId,
      messageId: null,
    });
    const response = await deleteAttachment(pending, author.token);
    expect(response.status).toBe(404);
    expect(await codeOf(response)).toBe("NOT_FOUND");
  });
});

describe("#270 AC-2 未投稿の自分の添付は 409", () => {
  it("#270 AC-2: 未投稿の自分の添付は 409 CONFLICT（送信前の一覧で取り消す案内）で、行も実体も変わらない", async () => {
    const pending = await seedStoredAttachment(
      { roomId: room, uploaderId: author.userId, messageId: null },
      TEXT_BYTES,
    );
    const key = (await attachmentRow(pending))?.storage_key ?? "";
    const response = await deleteAttachment(pending, author.token);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "CONFLICT",
      message: PENDING_DELETE_MESSAGE,
    });
    await expectUntouched(pending, key);
  });
});

describe("#270 AC-2（R-34）他人の添付は、どの役割でも 403", () => {
  it.each([
    ["同じ部屋の一般社員", () => other],
    ["部署のオーナー", () => ownerA],
    ["全体管理者", () => admin],
  ])(
    "#270 AC-2: %s が他人の添付を消そうとすると 403 FORBIDDEN。監査（failure・not_author）が残り、何も変わらない",
    async (_label, who) => {
      const seeded = await seedPosted();
      const response = await deleteAttachment(seeded.target, who().token);
      expect(response.status).toBe(403);
      expect(await codeOf(response)).toBe("FORBIDDEN");
      await expectUntouched(seeded.target, seeded.targetKey);
      const audits = failureAudits();
      expect(audits).toHaveLength(1);
      expect(audits[0]?.attributes).toMatchObject({
        target: seeded.target,
        result: "failure",
        reason: "not_author",
      });
    },
  );
});

describe("#270 AC-4 部屋が書き込めない状態では何も変わらない", () => {
  it("#270 AC-4: 公開チャンネルで、参加を外れた本人は 403 FORBIDDEN（見えるが書き込めない）", async () => {
    const open = await insertChannel({
      name: `${TEST_TAG}添付削除の公開`,
      purpose: "normal",
      departmentId: dept.id,
      visibility: "public",
    });
    await insertMember(open, author.userId);
    const seeded = await seedPosted(open);
    await leaveChannel(open, author.userId);
    const response = await deleteAttachment(seeded.target, author.token);
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe("FORBIDDEN");
    await expectUntouched(seeded.target, seeded.targetKey);
  });

  it("#270 AC-4: 部署が無効なら 409 CONFLICT", async () => {
    const seeded = await seedPosted();
    await deactivateDepartment(dept.id);
    const response = await deleteAttachment(seeded.target, author.token);
    expect(response.status).toBe(409);
    expect(await codeOf(response)).toBe("CONFLICT");
    await expectUntouched(seeded.target, seeded.targetKey);
  });

  it("#270 AC-4: DM の相手が無効なら 409 CONFLICT", async () => {
    const dm = await insertDm(author.userId, other.userId);
    const seeded = await seedPosted(dm);
    await deactivateUser(other.userId);
    const response = await deleteAttachment(seeded.target, author.token);
    expect(response.status).toBe(409);
    expect(await codeOf(response)).toBe("CONFLICT");
    await expectUntouched(seeded.target, seeded.targetKey);
  });
});

describe("#270 AC-3 再認証（0-5）は最後", () => {
  it("#270 AC-3: 再認証していないセッションは 403 REAUTH_REQUIRED で、DB も R2 も監査も変わらない", async () => {
    const seeded = await seedPosted();
    const response = await deleteAttachment(seeded.target, authorPlain);
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe("REAUTH_REQUIRED");
    await expectUntouched(seeded.target, seeded.targetKey);
  });

  it("#270 AC-3: 再認証から5分を超えたセッションも 403 REAUTH_REQUIRED", async () => {
    const seeded = await seedPosted();
    const stale = await newSessionFor(
      author.userId,
      REAUTH_WINDOW_MS + ONE_MINUTE,
    );
    const response = await deleteAttachment(seeded.target, stale);
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe("REAUTH_REQUIRED");
    await expectUntouched(seeded.target, seeded.targetKey);
  });

  it("#270 AC-3: ①〜⑤で断られる場合は、再認証がなくても、その応答が先（404・409・403・409）", async () => {
    const others = await seedPosted(room, other.userId);
    const pending = await insertAttachmentRow({
      roomId: room,
      uploaderId: author.userId,
      messageId: null,
    });
    expect(await codeOf(await deleteAttachment(MISSING_ID, authorPlain))).toBe(
      "NOT_FOUND",
    );
    const pendingResponse = await deleteAttachment(pending, authorPlain);
    expect(pendingResponse.status).toBe(409);
    const notMine = await deleteAttachment(others.target, authorPlain);
    expect(notMine.status).toBe(403);
    expect(await codeOf(notMine)).toBe("FORBIDDEN");
    const mine = await seedPosted();
    await deactivateDepartment(dept.id);
    const inactive = await deleteAttachment(mine.target, authorPlain);
    expect(inactive.status).toBe(409);
    expect(await codeOf(inactive)).toBe("CONFLICT");
  });
});

describe("#270 共通のゲートと入力（Skill error-api・security）", () => {
  it("#270 AC-2: 未ログインは 401 UNAUTHENTICATED で、何も変わらない", async () => {
    const seeded = await seedPosted();
    const response = await deleteAttachment(seeded.target, null);
    expect(response.status).toBe(401);
    await expectUntouched(seeded.target, seeded.targetKey);
  });

  it("#270 AC-2: 許可していない送信元（Origin）は 403 FORBIDDEN_ORIGIN で、何も変わらない", async () => {
    const seeded = await seedPosted();
    const response = await deleteAttachment(seeded.target, author.token, {
      origin: BAD_ORIGIN,
    });
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe("FORBIDDEN_ORIGIN");
    await expectUntouched(seeded.target, seeded.targetKey);
  });

  it("#270 AC-2: param が ULID の形でなければ 422 VALIDATION_ERROR（判定より前）", async () => {
    const response = await deleteAttachment("not-a-ulid", outsider.token);
    expect(response.status).toBe(422);
    expect(await codeOf(response)).toBe("VALIDATION_ERROR");
  });
});

describe("#270 AC-5 実体（R2）の削除の失敗", () => {
  it("#270 AC-5: R2 の delete が失敗しても 204。行は印（deleted_at・deleted_by）つきで残り、見えない。error ログにキー・名前を出さない", async () => {
    const seeded = await seedPosted();
    const recorded = recordingBucket(bucket(), () => true);
    const response = await rawRequest("DELETE", attachmentPath(seeded.target), {
      token: author.token,
      envOverrides: { ATTACHMENTS: recorded.bucket },
    });
    expect(response.status).toBe(204);
    expect(recorded.deletes).toEqual([seeded.targetKey]);
    const deletion = await deletionOf(seeded.target);
    expect(deletion?.deleted_by).toBe(author.userId);
    expect(deletion?.deleted_at).toMatch(ISO);
    expect(await storedKeys()).toContain(seeded.targetKey);
    expect((await downloadAttachment(seeded.target, author.token)).status).toBe(
      404,
    );
    expect(errorLines.length).toBeGreaterThanOrEqual(1);
    const logs = [...logLines, ...errorLines].join("\n");
    expect(logs).not.toContain(seeded.targetKey);
    expect(logs).not.toContain(NAME);
  });

  it("#270 指摘1・AC-5: R2 の削除が失敗した行には purge_failed_at が入り（deleted_at・deleted_by は変わらない）、後の定期の処理（R2 が戻った後）で、実体も行も消える", async () => {
    const seeded = await seedPosted();
    const recorded = recordingBucket(bucket(), () => true);
    const response = await rawRequest("DELETE", attachmentPath(seeded.target), {
      token: author.token,
      envOverrides: { ATTACHMENTS: recorded.bucket },
    });
    expect(response.status).toBe(204);
    const failed = await purgeStateOf(seeded.target);
    expect(failed?.deleted_by).toBe(author.userId);
    expect(failed?.deleted_at).toMatch(ISO);
    expect(failed?.purge_failed_at).toMatch(ISO);

    await attachmentPurgeJob().run(env);
    expect(await attachmentRow(seeded.target)).toBeNull();
    expect(await storedKeys()).toEqual([seeded.keptKey]);
  });

  it("#270 AC-5: R2 の削除の後に行の削除が失敗しても 204。実体はなく、行は印つきで残る（次の定期の処理が消す）", async () => {
    const seeded = await seedPosted();
    const failing = failingStatementDb(
      env.DB,
      /delete\s+from\s+["`]?message_attachments/i,
    );
    const response = await rawRequest("DELETE", attachmentPath(seeded.target), {
      token: author.token,
      envOverrides: { DB: failing.db },
    });
    expect(response.status).toBe(204);
    expect(failing.state.replaced).toBeGreaterThanOrEqual(1);
    expect(await storedKeys()).toEqual([seeded.keptKey]);
    expect((await deletionOf(seeded.target))?.deleted_by).toBe(author.userId);
  });
});

describe("#270 batch の失敗の注入（D1 の batch は全部か、なしか）", () => {
  it.each([
    ["監査の文", /insert\s+into\s+["`]?audit_logs/i],
    ["削除の印の UPDATE", ATTACHMENT_UPDATE],
    ["索引の文", /delete\s+from\s+["`]?search_(fts|documents)/i],
  ])(
    "#270 AC-1・AC-7: %s が失敗すると、成功にせず（500）、印・監査・索引のどれも残らず、R2 の delete を呼ばない",
    async (_label, pattern) => {
      const seeded = await seedPosted();
      const failing = failingStatementDb(env.DB, pattern);
      const recorded = recordingBucket(bucket());
      const response = await rawRequest(
        "DELETE",
        attachmentPath(seeded.target),
        {
          token: author.token,
          envOverrides: { DB: failing.db, ATTACHMENTS: recorded.bucket },
        },
      );
      expect(failing.state.replaced).toBeGreaterThanOrEqual(1);
      expect(response.status).toBe(500);
      expect(recorded.deletes).toEqual([]);
      await expectUntouched(seeded.target, seeded.targetKey);
    },
  );
});

describe("#270 同時の操作", () => {
  it("#270 AC-1: 同じ添付の削除を2回送ると、2回目は 404。監査は1行", async () => {
    const seeded = await seedPosted();
    expect((await deleteAttachment(seeded.target, author.token)).status).toBe(
      204,
    );
    expect((await deleteAttachment(seeded.target, author.token)).status).toBe(
      404,
    );
    expect(
      await auditRowsOf(ATTACHMENT_DELETE_ACTION, seeded.target),
    ).toHaveLength(1);
  });

  it("#270 AC-1: 同じ添付の削除を同時に2つ送ると、204 と 404 が1つずつ。監査は1行で、実体はない", async () => {
    const seeded = await seedPosted();
    const statuses = (
      await Promise.all([
        deleteAttachment(seeded.target, author.token),
        deleteAttachment(seeded.target, author.token),
      ])
    )
      .map((r) => r.status)
      .sort();
    expect(statuses).toEqual([204, 404]);
    expect(
      await auditRowsOf(ATTACHMENT_DELETE_ACTION, seeded.target),
    ).toHaveLength(1);
    expect(await storedKeys()).toEqual([seeded.keptKey]);
  });

  it("#270 AC-1: 配信の直後に削除すると、次の配信は 404", async () => {
    const seeded = await seedPosted();
    expect((await downloadAttachment(seeded.target, other.token)).status).toBe(
      200,
    );
    expect((await deleteAttachment(seeded.target, author.token)).status).toBe(
      204,
    );
    expect((await downloadAttachment(seeded.target, other.token)).status).toBe(
      404,
    );
  });

  it("#270 AC-6: メッセージを削除した後の、その添付の削除は 404", async () => {
    const seeded = await seedPosted();
    expect(
      (
        await apiRequest("DELETE", `/api/messages/${seeded.messageId}`, {
          token: author.token,
        })
      ).status,
    ).toBe(204);
    expect((await deleteAttachment(seeded.target, author.token)).status).toBe(
      404,
    );
  });
});

// ---- #270（270-B）AC-6・利用者の決定2：本文のない投稿の、最後の添付の削除は 409 で、投稿ごとの削除を案内する ----
// 根拠：決定2・計画 AC-6（応答の文は「本文のない投稿の、最後の添付は削除できません。投稿ごと削除してください。」。何も変わらない〔印・監査・索引・R2〕。
//   再認証は求めない〔判定は再認証より前〕。添付が2件以上なら、最後の1件の手前まで1件ずつ消せる）・計画 2.5（判定の順：①見えるか 404 → ①' 未投稿 409 →
//   ② 本人か 403 → ③ 権限 → ④ 部屋の状態 → ⑤ 本文のない投稿の最後の添付 409 → ⑥ 再認証。⑤の 409 は状態の衝突なので logger.audit に残さない）。
describe("#270 AC-6 本文のない投稿の最後の添付（決定2）", () => {
  /** 本文なしの投稿（目印）と、結び付いた添付 count 件。実体は R2 に入れ、索引も作る */
  async function seedBodyless(count: number, roomId = room) {
    const messageId = nextMessageId();
    await insertBodylessMessage({
      roomId,
      senderId: author.userId,
      id: messageId,
    });
    const ids: string[] = [];
    const keys: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const id = await seedStoredAttachment(
        {
          roomId,
          uploaderId: author.userId,
          messageId,
          originalName: `[UNIT_TEST]本文なしの添付${i}.txt`,
        },
        TEXT_BYTES,
      );
      ids.push(id);
      keys.push((await attachmentRow(id))?.storage_key ?? "");
    }
    await buildSearchIndex();
    return { messageId, ids, keys };
  }

  /** 印・監査・索引・R2 のどれも変わらない */
  async function expectNothingChanged(attachmentId: string, key: string) {
    await expectUntouched(attachmentId, key);
    expect(await attachmentDocumentCount(attachmentId)).toBe(1);
  }

  it("#270 AC-6: 本文なし＋添付1件の、その添付の削除は 409 CONFLICT で、文は案内のとおり。印・監査・索引・R2 は変わらず、拒否の監査も残さない", async () => {
    const seeded = await seedBodyless(1);
    const [id = "", key = ""] = [seeded.ids[0], seeded.keys[0]];
    const response = await deleteAttachment(id, author.token);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "CONFLICT",
      message: LAST_ATTACHMENT_MESSAGE,
    });
    await expectNothingChanged(id, key);
    expect(failureAudits()).toEqual([]);
    expect(await visibleAttachmentCount(seeded.messageId)).toBe(1);
  });

  it("#270 AC-6（⑤は⑥再認証より前）: 再認証していないセッションでも、403 REAUTH_REQUIRED ではなく AC-6 の 409", async () => {
    const seeded = await seedBodyless(1);
    const response = await deleteAttachment(seeded.ids[0] ?? "", authorPlain);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      message: LAST_ATTACHMENT_MESSAGE,
    });
    await expectNothingChanged(seeded.ids[0] ?? "", seeded.keys[0] ?? "");
  });

  it("#270 AC-6（②は⑤より先）: 同じ部屋の他人が消そうとすると、AC-6 の 409 ではなく 403", async () => {
    const seeded = await seedBodyless(1);
    const response = await deleteAttachment(seeded.ids[0] ?? "", other.token);
    expect(response.status).toBe(403);
    expect(await codeOf(response)).toBe("FORBIDDEN");
  });

  it("#270 AC-6（①は⑤より先）: 見えない人（部屋の外）には 404 で、投稿の中身（本文がないこと）を知らせない", async () => {
    const seeded = await seedBodyless(1);
    const response = await deleteAttachment(
      seeded.ids[0] ?? "",
      outsider.token,
    );
    expect(response.status).toBe(404);
  });

  it("#270 AC-6（①・④は⑤より先）: アーカイブしたチャンネルでは 404、部署が無効なら④の 409（AC-6 の文ではない）", async () => {
    const archived = await seedBodyless(1);
    const inactive = await seedBodyless(1);
    await archiveChannel(room);
    expect(
      (await deleteAttachment(archived.ids[0] ?? "", author.token)).status,
    ).toBe(404);
    await env.DB.prepare(
      "UPDATE channels SET deleted_at = NULL WHERE room_id = ?",
    )
      .bind(room)
      .run();
    await deactivateDepartment(dept.id);
    const response = await deleteAttachment(
      inactive.ids[0] ?? "",
      author.token,
    );
    expect(response.status).toBe(409);
    expect(((await response.json()) as { message: string }).message).not.toBe(
      LAST_ATTACHMENT_MESSAGE,
    );
  });

  it("#270 AC-6: 本文なし＋添付2件なら、1件目は 204 で消え、残りの1件は AC-6 の 409 になる", async () => {
    const seeded = await seedBodyless(2);
    const first = await deleteAttachment(seeded.ids[0] ?? "", author.token);
    expect(first.status).toBe(204);
    const second = await deleteAttachment(seeded.ids[1] ?? "", author.token);
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({
      message: LAST_ATTACHMENT_MESSAGE,
    });
    expect(await visibleAttachmentCount(seeded.messageId)).toBe(1);
    expect(await storedKeys()).toContain(seeded.keys[1] ?? "");
  });

  it("#270 AC-6: DM の本文なし＋添付1件も、AC-6 の 409", async () => {
    const dm = await insertDm(author.userId, other.userId);
    const seeded = await seedBodyless(1, dm);
    const response = await deleteAttachment(seeded.ids[0] ?? "", author.token);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      message: LAST_ATTACHMENT_MESSAGE,
    });
  });

  it("#270 AC-6（対照）: 本文あり＋添付の最後の1件は、これまでどおり 204 で消せる", async () => {
    const seeded = await seedPosted();
    expect((await deleteAttachment(seeded.target, author.token)).status).toBe(
      204,
    );
    expect((await deleteAttachment(seeded.kept, author.token)).status).toBe(
      204,
    );
    expect(await messageRow(seeded.messageId)).toMatchObject({ body: BODY });
  });
});
