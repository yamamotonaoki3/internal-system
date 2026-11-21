// #270（270-A）AC-9・計画 4.8（project-rules 既定の方針1）：#140 の後に削除されたメッセージの添付に、削除の印を付ける、べき等な SQL。
// backend/db/scripts/mark-attachments-of-deleted-messages.sql を、テスト用の D1 に対して実行し、次を確かめる（期待は計画 4.8）。
//   - 削除済みのメッセージに結び付き、deleted_at が NULL の添付に、メッセージの deleted_at・deleted_by を写す
//   - 削除されていないメッセージの添付・未投稿の添付・既に印のある添付（元の値のまま）には触れない
//   - 流す前の対象の件数 → 流した後は 0 件。2回流しても同じ結果（べき等）
// 契約（実装前の仮置き）：ファイルは `--` で始まる行がコメント。文は `;` で区切る（1文でも複数文でもよい）。
// 本番への適用は機能の完了条件に含めない（別に利用者の承認を得る）。
// データは架空（testuser_attfill_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ATTACHMENT_DELETED_AT,
  cleanupAttachmentDeleteScenario,
  deletionOf,
  markAttachmentDeleted,
} from "../../test/attachment-delete-fixtures";
import { insertAttachmentRow } from "../../test/attachment-fixtures";
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

// ファイルがまだない（実装前）ときも、ほかのテストを読み込めるように glob で読む
const scripts = import.meta.glob<string>(
  "../../db/scripts/mark-attachments-of-deleted-messages.sql",
  { query: "?raw", import: "default", eager: true },
);

function statements(): string[] {
  const sources = Object.values(scripts);
  expect(sources, "mark-attachments-of-deleted-messages.sql").toHaveLength(1);
  const body = (sources[0] ?? "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  const list = body
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  expect(list.length).toBeGreaterThan(0);
  return list;
}

const runBackfill = () =>
  env.DB.batch(statements().map((s) => env.DB.prepare(s)));

/** 対象（削除済みのメッセージに結び付き、印のない添付）の件数。計画 4.8 の「流す前・後の件数」と同じ意味を、ここで独立に書く */
async function targetCount(): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM message_attachments a JOIN messages m ON m.id = a.message_id
     WHERE m.deleted_at IS NOT NULL AND a.deleted_at IS NULL`,
  ).first<{ n: number }>();
  return row?.n ?? -1;
}

const MESSAGE_DELETED_AT = "2026-11-20T09:00:00.000Z";
let author: ModifyUser;
let deleter: ModifyUser;
let room: string;
let seq = 0;

async function post(deleted: boolean) {
  seq += 1;
  const id = ulidAt(1_897_000_000_000 + seq * 1_000);
  await insertMessage({
    roomId: room,
    senderId: author.userId,
    id,
    body: `${TEST_TAG}補完の本文${seq}`,
  });
  if (deleted)
    await env.DB.prepare(
      "UPDATE messages SET deleted_at = ?, deleted_by = ? WHERE id = ?",
    )
      .bind(MESSAGE_DELETED_AT, deleter.userId, id)
      .run();
  return id;
}

const attach = (messageId: string | null) =>
  insertAttachmentRow({ roomId: room, uploaderId: author.userId, messageId });

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  const dept = await insertDepartmentWithChannels("添付の補完");
  author = await insertModifyUser("testuser_attfill_author", dept.id);
  deleter = await insertModifyUser("testuser_attfill_deleter", dept.id);
  room = await insertChannel({
    name: `${TEST_TAG}添付の補完の部屋`,
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

describe("#270 AC-9 削除済みのメッセージの添付に、印を付ける補完の SQL", () => {
  it("#270 AC-9: 削除済みのメッセージの添付に、メッセージの deleted_at・deleted_by を写す。流す前は2件・流した後は0件", async () => {
    const deletedMessage = await post(true);
    const a = await attach(deletedMessage);
    const b = await attach(deletedMessage);
    expect(await targetCount()).toBe(2);
    await runBackfill();
    expect(await targetCount()).toBe(0);
    for (const id of [a, b])
      expect(await deletionOf(id)).toEqual({
        deleted_at: MESSAGE_DELETED_AT,
        deleted_by: deleter.userId,
      });
  });

  it("#270 AC-9: 削除されていないメッセージの添付・未投稿の添付・既に印のある添付には触れない", async () => {
    const live = await attach(await post(false));
    const pending = await attach(null);
    const deletedMessage = await post(true);
    const already = await attach(deletedMessage);
    await markAttachmentDeleted(already, author.userId);
    await runBackfill();
    for (const id of [live, pending])
      expect(await deletionOf(id)).toEqual({
        deleted_at: null,
        deleted_by: null,
      });
    expect(await deletionOf(already)).toEqual({
      deleted_at: ATTACHMENT_DELETED_AT,
      deleted_by: author.userId,
    });
  });

  it("#270 AC-9: 2回流しても結果は同じ（べき等）", async () => {
    const deletedMessage = await post(true);
    const a = await attach(deletedMessage);
    const live = await attach(await post(false));
    await runBackfill();
    const first = [await deletionOf(a), await deletionOf(live)];
    await runBackfill();
    expect([await deletionOf(a), await deletionOf(live)]).toEqual(first);
    expect(await targetCount()).toBe(0);
  });
});
