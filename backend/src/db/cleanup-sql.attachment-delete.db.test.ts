// #270（270-A）計画 4.6 の7「後始末の SQL」：共通のテストデータの削除（backend/db/seeds/cleanup.sql）は、削除済みの添付の行
// （deleted_at・deleted_by が入った行）も、削除されていない行と同じ条件で消し、残数の確認が 0 になること。
// deleted_by はテストの利用者を指す（外部キー）ため、利用者を消す前に、添付の行が消えている必要がある。
// 方法：cleanup-sql.search.db.test.ts と同じ（cleanup.sql をコメント行を除いて文ごとに分け、1つの batch で隔離 D1 に流す）。
// データは架空（testuser_attclean_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import cleanupSql from "../../db/seeds/cleanup.sql?raw";
import {
  cleanupAttachmentDeleteScenario,
  markAttachmentDeleted,
} from "../../test/attachment-delete-fixtures";
import {
  attachmentRow,
  insertAttachmentRow,
} from "../../test/attachment-fixtures";
import {
  TEST_TAG,
  insertChannel,
  insertDepartmentWithChannels,
  insertMember,
} from "../../test/department-fixtures";
import { insertMessage, ulidAt } from "../../test/message-fixtures";
import {
  insertModifyUser,
  type ModifyUser,
} from "../../test/message-modify-fixtures";

function statementsOf(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*\n/)
    .map((s) => s.trim().replace(/;$/, ""))
    .filter((s) => s.length > 0);
}

let author: ModifyUser;
let room: string;

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  const dept = await insertDepartmentWithChannels("添付削除の後始末");
  author = await insertModifyUser("testuser_attclean_author", dept.id);
  room = await insertChannel({
    name: `${TEST_TAG}添付削除の後始末の部屋`,
    purpose: "normal",
    departmentId: dept.id,
    visibility: "private",
  });
  await insertMember(room, author.userId);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupAttachmentDeleteScenario();
});

describe("#270 計画 4.6 の7 後始末の SQL", () => {
  it("#270 AC-1: 削除済みの添付の行も消え、残数の確認の remaining_message_attachments は 0", async () => {
    const messageId = ulidAt(1_898_000_000_000);
    await insertMessage({
      roomId: room,
      senderId: author.userId,
      id: messageId,
      body: `${TEST_TAG}後始末の本文`,
    });
    const deleted = await insertAttachmentRow({
      roomId: room,
      uploaderId: author.userId,
      messageId,
    });
    const live = await insertAttachmentRow({
      roomId: room,
      uploaderId: author.userId,
      messageId,
    });
    await markAttachmentDeleted(deleted, author.userId);

    const list = statementsOf(cleanupSql);
    const results = await env.DB.batch(list.map((s) => env.DB.prepare(s)));
    expect(await attachmentRow(deleted)).toBeNull();
    expect(await attachmentRow(live)).toBeNull();
    const counts = results
      .flatMap((r) => (r.results ?? []) as Record<string, unknown>[])
      .find((row) => "remaining_message_attachments" in row);
    expect(counts?.remaining_message_attachments).toBe(0);
  });
});
