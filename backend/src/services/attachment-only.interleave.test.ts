// #270（270-B）AC-8（添付の削除の割り込み）・AC-6（⑤の読み取りの直前の割り込み）：本文のない投稿の添付の削除で、
// Service の確認の後に状態が変わったときの応答と、DB の実際の結果（印・監査・索引・R2）を確かめる（Service × SQL。結合）。
// 期待の根拠（実装から写さない）：
//   計画 AC-8：確認の後・書き込みの直前に相手の操作が確定しても、SQL の条件（deletable に足す leavesMessageNonEmpty）で 0 行になり、
//     読み直しで AC-6 の 409（「本文のない投稿の、最後の添付は削除できません。投稿ごと削除してください。」）になる
//   計画 2.5・2.6（改訂1・改訂2）：読み直しは ①見えるか（メッセージの削除が割り込めば 404）→ ①' → ② → ③ → ④ を先に確かめ、⑤はその後だけ。
//     ⑤の読み取り（lastOfBodylessIfDeletable）は「⑤を除いた削除の条件」と同じ batch で読み、条件が崩れていれば ①〜④を読み直す
//   改訂2 の軽微6：メッセージの削除が割り込む事例では、割り込んだ削除の確定の結果（添付の印は message の削除者・日時・索引なし・message.delete の監査1件）が保たれ、
//     拒否された添付の削除は attachment.delete の成功の監査を足さず、R2 の delete を追加で呼ばない
// 作り（attachment.delete.interleave.test.ts と同じ）：要求の env の DB を test/attachment-delete-fixtures.ts の interleavingDb で包み、
//   書き込みの batch（添付の UPDATE を含む）または⑤の読み取りの batch（読み取りだけで message_attachments を読む最初の batch）の直前に、1回だけ割り込む。
//   挟めたことは state.ran で確かめる。R2 は recordingBucket で包み、要求の中の delete の呼び出しを数える（割り込みの操作は env の本物の DB・R2 を使い、数えない）。
// データは架空（testuser_attonlyint_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEXT_BYTES } from "../../test/attachment-files";
import {
  ATTACHMENT_DELETE_ACTION,
  attachmentDocumentCount,
  auditRowsOf,
  cleanupAttachmentDeleteScenario,
  deletionOf,
  interleavingDb,
  markAttachmentDeleted,
  recordingBucket,
} from "../../test/attachment-delete-fixtures";
import {
  attachmentPath,
  attachmentRow,
  bucket,
  rawRequest,
  seedStoredAttachment,
  storedKeys,
} from "../../test/attachment-fixtures";
import {
  LAST_ATTACHMENT_MESSAGE,
  STORED_EMPTY_BODY,
  cleanupAttachmentOnlyLeftovers,
  emptyPostsWithoutAttachments,
  insertBodylessMessage,
} from "../../test/attachment-only-fixtures";
import {
  TEST_TAG,
  insertChannel,
  insertDepartmentWithChannels,
  insertMember,
} from "../../test/department-fixtures";
import { insertMessage, ulidAt } from "../../test/message-fixtures";
import {
  deleteAuditRows,
  insertModifyUser,
  leaveChannel,
  modifyTraceId,
  type ModifyUser,
} from "../../test/message-modify-fixtures";
import {
  buildSearchIndex,
  cleanupSearchIndex,
} from "../../test/search-fixtures";
import { withMessages } from "../db/message.repository";

const ONE_MINUTE = 60_000;
let author: ModifyUser;
let open: string;
let seq = 0;

/** ⑤の読み取りの batch：文がすべて読み取り（SELECT）で、message_attachments を読む最初の batch */
const FIFTH_READ = (queries: string[]) =>
  queries.length > 0 &&
  queries.every((query) => /^\s*select\b/i.test(query)) &&
  queries.some((query) => /message_attachments/i.test(query));

/** 投稿（本文なし＝目印、または本文あり）と、結び付いた添付 count 件。実体は R2 に入れ、索引も作る */
async function seedPost(bodyless: boolean, count: number) {
  seq += 1;
  const messageId = ulidAt(1_899_000_000_000 + seq * 1_000);
  if (bodyless)
    await insertBodylessMessage({
      roomId: open,
      senderId: author.userId,
      id: messageId,
    });
  else
    await insertMessage({
      roomId: open,
      senderId: author.userId,
      id: messageId,
      body: `${TEST_TAG}割り込みの本文${seq}`,
    });
  const ids: string[] = [];
  const keys: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = await seedStoredAttachment(
      {
        roomId: open,
        uploaderId: author.userId,
        messageId,
        originalName: `[UNIT_TEST]割込本文なし${seq}-${i}.txt`,
      },
      TEXT_BYTES,
    );
    ids.push(id);
    keys.push((await attachmentRow(id))?.storage_key ?? "");
  }
  await buildSearchIndex();
  return { messageId, ids, keys };
}

async function deleteInterleaved(
  attachmentId: string,
  interrupt: () => Promise<void>,
  pattern?: Parameters<typeof interleavingDb>[2],
) {
  const interleaved = interleavingDb(env.DB, interrupt, pattern);
  const recorded = recordingBucket(bucket());
  const response = await rawRequest("DELETE", attachmentPath(attachmentId), {
    token: author.token,
    envOverrides: { DB: interleaved.db, ATTACHMENTS: recorded.bucket },
  });
  const body =
    response.status === 204
      ? null
      : ((await response.json()) as { code: string; message: string });
  return {
    status: response.status,
    body,
    ran: interleaved.state.ran,
    deletes: recorded.deletes,
  };
}

/** 本物のメッセージの削除（添付にも印・索引を消す。R2 は要求の外なので試さない） */
const deleteMessageForReal = (messageId: string) => () =>
  withMessages(env, async (repository) => {
    const changes = await repository.deleteIfModifiable({
      messageId,
      userId: author.userId,
      roomId: open,
      deletedAt: new Date().toISOString(),
      traceId: modifyTraceId(),
    });
    expect(changes).toBe(1);
  });

/** 拒否された添付の削除が、何も変えていない（印・成功の監査・索引・R2） */
async function expectNothingChanged(
  attachmentId: string,
  key: string,
  deletes: readonly string[],
) {
  expect(await deletionOf(attachmentId)).toEqual({
    deleted_at: null,
    deleted_by: null,
  });
  expect(await auditRowsOf(ATTACHMENT_DELETE_ACTION, attachmentId)).toEqual([]);
  expect(await attachmentDocumentCount(attachmentId)).toBe(1);
  expect(deletes).toEqual([]);
  expect(await storedKeys()).toContain(key);
}

/** 割り込んだメッセージの削除の確定の結果が保たれ、拒否された添付の削除が何も足していない */
async function expectMessageDeletionKept(
  messageId: string,
  attachmentId: string,
  deletes: readonly string[],
) {
  const deletion = await deletionOf(attachmentId);
  expect(deletion?.deleted_by).toBe(author.userId);
  expect(deletion?.deleted_at).not.toBeNull();
  expect(await attachmentDocumentCount(attachmentId)).toBe(0);
  expect(await deleteAuditRows(messageId)).toHaveLength(1);
  expect(await auditRowsOf(ATTACHMENT_DELETE_ACTION, attachmentId)).toEqual([]);
  expect(deletes).toEqual([]);
}

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  const dept = await insertDepartmentWithChannels("本文なしの添付の割り込み");
  author = await insertModifyUser(
    "testuser_attonlyint_author",
    dept.id,
    ONE_MINUTE,
  );
  open = await insertChannel({
    name: `${TEST_TAG}本文なしの添付の割り込みの公開`,
    purpose: "normal",
    departmentId: dept.id,
    visibility: "public",
  });
  await insertMember(open, author.userId);
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

describe("#270 AC-8 書き込みの直前の割り込み（添付の UPDATE を含む batch の直前）", () => {
  it("#270 AC-8 (1): 本文なし＋添付2件で、同じ投稿のもう1件の削除が確定すると、AC-6 の 409。対象は何も変わらない", async () => {
    const seeded = await seedPost(true, 2);
    const [target = "", other = ""] = seeded.ids;
    const result = await deleteInterleaved(target, () =>
      markAttachmentDeleted(other, author.userId),
    );
    expect(result.ran).toBe(true);
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({
      code: "CONFLICT",
      message: LAST_ATTACHMENT_MESSAGE,
    });
    await expectNothingChanged(target, seeded.keys[0] ?? "", result.deletes);
    expect(await emptyPostsWithoutAttachments()).toEqual([]);
  });

  it("#270 AC-8 (2): 本文あり＋添付1件で、本文を空にする編集（本文が目印になる）が確定すると、AC-6 の 409。対象は何も変わらない", async () => {
    const seeded = await seedPost(false, 1);
    const [target = ""] = seeded.ids;
    const result = await deleteInterleaved(target, async () => {
      await env.DB.prepare("UPDATE messages SET body = ? WHERE id = ?")
        .bind(STORED_EMPTY_BODY, seeded.messageId)
        .run();
    });
    expect(result.ran).toBe(true);
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ message: LAST_ATTACHMENT_MESSAGE });
    await expectNothingChanged(target, seeded.keys[0] ?? "", result.deletes);
    expect(await emptyPostsWithoutAttachments()).toEqual([]);
  });

  it("#270 AC-8 (3)（改訂2 の軽微6）: メッセージの削除が確定すると、①で見えない 404（AC-6 の 409 にしない）。割り込んだ削除の結果が保たれ、添付の削除は成功の監査も R2 の削除も足さない", async () => {
    const seeded = await seedPost(true, 2);
    const [target = ""] = seeded.ids;
    const result = await deleteInterleaved(
      target,
      deleteMessageForReal(seeded.messageId),
    );
    expect(result.ran).toBe(true);
    expect(result.status).toBe(404);
    expect(result.body?.message).not.toBe(LAST_ATTACHMENT_MESSAGE);
    await expectMessageDeletionKept(seeded.messageId, target, result.deletes);
  });

  it("#270 AC-8 (4): 参加の解除（公開チャンネル）が確定すると 403（AC-6 の 409 にしない）。対象は何も変わらない", async () => {
    const seeded = await seedPost(true, 2);
    const [target = ""] = seeded.ids;
    const result = await deleteInterleaved(target, () =>
      leaveChannel(open, author.userId),
    );
    expect(result.ran).toBe(true);
    expect(result.status).toBe(403);
    await expectNothingChanged(target, seeded.keys[0] ?? "", result.deletes);
  });

  it("#270 AC-8（対照）: 本文なし＋添付2件で、何も挟まなければ（同じ包み方で）204 になり、実体の削除を1回試す", async () => {
    const seeded = await seedPost(true, 2);
    const [target = ""] = seeded.ids;
    const result = await deleteInterleaved(target, async () => {});
    expect(result.ran).toBe(true);
    expect(result.status).toBe(204);
    expect(result.deletes).toEqual([seeded.keys[0]]);
  });
});

describe("#270 AC-6（改訂2）⑤の読み取りの直前の割り込み", () => {
  it("#270 AC-6: 本文なし＋添付1件で、⑤の読み取りの直前にメッセージの削除が確定すると 404（AC-6 の 409 にしない）。割り込んだ削除の結果が保たれる", async () => {
    const seeded = await seedPost(true, 1);
    const [target = ""] = seeded.ids;
    const result = await deleteInterleaved(
      target,
      deleteMessageForReal(seeded.messageId),
      FIFTH_READ,
    );
    expect(result.ran).toBe(true);
    expect(result.status).toBe(404);
    expect(result.body?.message).not.toBe(LAST_ATTACHMENT_MESSAGE);
    await expectMessageDeletionKept(seeded.messageId, target, result.deletes);
  });

  it("#270 AC-6: 本文なし＋添付1件で、⑤の読み取りの直前に参加の解除（公開チャンネル）が確定すると 403（AC-6 の 409 にしない）", async () => {
    const seeded = await seedPost(true, 1);
    const [target = ""] = seeded.ids;
    const result = await deleteInterleaved(
      target,
      () => leaveChannel(open, author.userId),
      FIFTH_READ,
    );
    expect(result.ran).toBe(true);
    expect(result.status).toBe(403);
    await expectNothingChanged(target, seeded.keys[0] ?? "", result.deletes);
  });

  it("#270 AC-6（対照）: ⑤の読み取りの直前に何も起きなければ、AC-6 の 409", async () => {
    const seeded = await seedPost(true, 1);
    const [target = ""] = seeded.ids;
    const result = await deleteInterleaved(target, async () => {}, FIFTH_READ);
    expect(result.ran).toBe(true);
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ message: LAST_ATTACHMENT_MESSAGE });
  });
});
