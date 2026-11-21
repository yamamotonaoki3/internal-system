// #270（270-A）AC-6・計画 4.5：メッセージの削除（EP-1-04 DELETE /api/messages/:messageId）で、その添付の実体（R2）の削除を、
// 同じ要求の中で1回試すこと（withMessageService が purgeAttachmentsOf を組んで渡す）を、実際のアプリ入口・隔離 D1・手元の R2 で確かめる（結合）。
// - 成功：応答は 204 のまま。添付の実体と行がなくなる。ほかのメッセージの添付は残る
// - R2 の失敗：応答は 204 のまま。添付の行は印（deleted_at・deleted_by）つきで残り、error ログにキー・名前を出さない（毎日の後始末が消す）
// - 断られた削除（他人）：添付も実体も変わらない
// データは架空（testuser_mdelatt_、[UNIT_TEST]、@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEXT_BYTES } from "../../test/attachment-files";
import {
  cleanupAttachmentDeleteScenario,
  deletionOf,
  purgeStateOf,
  recordingBucket,
} from "../../test/attachment-delete-fixtures";
import {
  attachmentRow,
  bucket,
  rawRequest,
  seedStoredAttachment,
  storedKeys,
} from "../../test/attachment-fixtures";
import {
  TEST_TAG,
  insertChannel,
  insertDepartmentWithChannels,
  insertMember,
} from "../../test/department-fixtures";
import { insertMessage, ulidAt } from "../../test/message-fixtures";
import {
  deleteMessage,
  insertModifyUser,
  messageItemPath,
  type ModifyUser,
} from "../../test/message-modify-fixtures";
import { attachmentPurgeJob } from "../services/attachment.service";

const NAME = "[UNIT_TEST]メッセージと消える添付.txt";
let author: ModifyUser;
let other: ModifyUser;
let room: string;
let logLines: string[];
let errorLines: string[];
let seq = 0;

async function seedWithAttachments(count: number) {
  seq += 1;
  const messageId = ulidAt(1_895_000_000_000 + seq * 1_000);
  await insertMessage({
    roomId: room,
    senderId: author.userId,
    id: messageId,
    body: `${TEST_TAG}添付つきのメッセージ${seq}`,
  });
  const ids: string[] = [];
  const keys: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = await seedStoredAttachment(
      {
        roomId: room,
        uploaderId: author.userId,
        messageId,
        originalName: NAME,
      },
      TEXT_BYTES,
    );
    ids.push(id);
    keys.push((await attachmentRow(id))?.storage_key ?? "");
  }
  return { messageId, ids, keys };
}

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
  const dept = await insertDepartmentWithChannels("メッセージ削除と実体");
  author = await insertModifyUser("testuser_mdelatt_author", dept.id, 60_000);
  other = await insertModifyUser("testuser_mdelatt_other", dept.id, 60_000);
  room = await insertChannel({
    name: `${TEST_TAG}メッセージ削除と実体の部屋`,
    purpose: "normal",
    departmentId: dept.id,
    visibility: "private",
  });
  await insertMember(room, author.userId);
  await insertMember(room, other.userId);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupAttachmentDeleteScenario();
});

describe("#270 AC-6 メッセージの削除で、添付の実体の削除を要求の中で1回試す", () => {
  it("#270 AC-6: 添付3件のメッセージを消すと 204。3件の実体と行がなくなり、ほかのメッセージの添付は残る", async () => {
    const target = await seedWithAttachments(3);
    const kept = await seedWithAttachments(1);
    const response = await deleteMessage(target.messageId, author.token);
    expect(response.status).toBe(204);
    for (const id of target.ids) expect(await attachmentRow(id)).toBeNull();
    expect(await storedKeys()).toEqual(kept.keys);
    expect(await deletionOf(kept.ids[0] ?? "")).toEqual({
      deleted_at: null,
      deleted_by: null,
    });
  });

  it("#270 AC-6・AC-5: R2 の削除が失敗しても 204。行は印つきで残り、実体も残る。error ログにキー・名前を出さない", async () => {
    const target = await seedWithAttachments(2);
    const recorded = recordingBucket(bucket(), () => true);
    const response = await rawRequest(
      "DELETE",
      messageItemPath(target.messageId),
      {
        token: author.token,
        envOverrides: { ATTACHMENTS: recorded.bucket },
      },
    );
    expect(response.status).toBe(204);
    expect([...recorded.deletes].sort()).toEqual([...target.keys].sort());
    for (const id of target.ids)
      expect((await deletionOf(id))?.deleted_by).toBe(author.userId);
    expect(await storedKeys()).toEqual([...target.keys].sort());
    expect(errorLines.length).toBeGreaterThanOrEqual(1);
    const logs = [...logLines, ...errorLines].join("\n");
    for (const key of target.keys) expect(logs).not.toContain(key);
    expect(logs).not.toContain(NAME);
  });

  it("#270 指摘1・AC-6: R2 の削除が失敗した添付には purge_failed_at が入り、後の定期の処理（R2 が戻った後）で、実体も行も消える。204 は変わらない", async () => {
    const target = await seedWithAttachments(2);
    const recorded = recordingBucket(bucket(), () => true);
    const response = await rawRequest(
      "DELETE",
      messageItemPath(target.messageId),
      {
        token: author.token,
        envOverrides: { ATTACHMENTS: recorded.bucket },
      },
    );
    expect(response.status).toBe(204);
    for (const id of target.ids)
      expect((await purgeStateOf(id))?.purge_failed_at).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );

    await attachmentPurgeJob().run(env);
    for (const id of target.ids) expect(await attachmentRow(id)).toBeNull();
    expect(await storedKeys()).toEqual([]);
  });

  it("#270 AC-6: 他人がメッセージを消そうとして断られた（403）ときは、添付の印も実体も変わらず、R2 を呼ばない", async () => {
    const target = await seedWithAttachments(2);
    const recorded = recordingBucket(bucket());
    const response = await rawRequest(
      "DELETE",
      messageItemPath(target.messageId),
      {
        token: other.token,
        envOverrides: { ATTACHMENTS: recorded.bucket },
      },
    );
    expect(response.status).toBe(403);
    expect(recorded.deletes).toEqual([]);
    for (const id of target.ids)
      expect(await deletionOf(id)).toEqual({
        deleted_at: null,
        deleted_by: null,
      });
  });

  it("#270 AC-6: 添付のないメッセージの削除は、これまでどおり 204 で、R2 を呼ばない", async () => {
    const target = await seedWithAttachments(0);
    const recorded = recordingBucket(bucket());
    const response = await rawRequest(
      "DELETE",
      messageItemPath(target.messageId),
      {
        token: author.token,
        envOverrides: { ATTACHMENTS: recorded.bucket },
      },
    );
    expect(response.status).toBe(204);
    expect(recorded.deletes).toEqual([]);
  });
});
