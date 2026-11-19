// #148（148-B-1）のテストで使う、案件の添付の一覧（EP-5-19）の架空のテストデータの作成と、期待の形。
// 世界は case-room-fixtures.ts の setupCaseRoomWorld（案件・案件専用チャンネル・参加・通常のチャンネル）を使い、
// 後始末も cleanupCaseRoomWorld（R2 の実体 → 添付 → メッセージ → 案件と世界）に任せる。
// 添付の行は attachment-fixtures.ts の insertAttachmentRow で直接入れる（API・Repository を通さない）。
// ID は決定的（同じ n には同じ ID。n が大きいほど新しい＝ID の降順は n の降順）。データは架空（testuser_casereq_・[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { createUlidFactory } from "../src/lib/ulid";
import { insertAttachmentRow } from "./attachment-fixtures";

/** 一覧の項目のキー（計画 148-B-1「API」。保存キー・URL は含めない） */
export const CASE_ATTACHMENT_ITEM_KEYS = [
  "contentType",
  "id",
  "kind",
  "messageId",
  "name",
  "size",
  "threadParentId",
  "uploadedAt",
  "uploader",
] as const;

/** 投稿者のキー（表示名だけ。本名・メールは返さない） */
export const CASE_ATTACHMENT_UPLOADER_KEYS = [
  "displayName",
  "id",
  "isActive",
] as const;

/** 添付の ID（ULID）。n が大きいほど新しい */
export function caseAttachmentIdAt(n: number): string {
  return createUlidFactory({
    now: () => 1_860_000_000_000 + n * 1_000,
    random: (length) => new Uint8Array(length),
  })();
}

/** 添付の時刻（n 秒後。uploadedAt の確認用） */
export const caseAttachmentIsoAt = (n: number) =>
  new Date(1_860_000_000_000 + n * 1_000).toISOString();

export const caseAttachmentName = (n: number) => `[UNIT_TEST]148B添付${n}.txt`;

/** 案件の添付の行を1件入れる（投稿済みなら messageId、返信なら threadParentId も） */
export async function seedCaseAttachment(seed: {
  n: number;
  roomId: string;
  uploaderId: string;
  messageId: string | null;
  threadParentId?: string | null;
  kind?: "image" | "document" | "video";
  contentType?: string;
  sizeBytes?: number;
}): Promise<string> {
  return insertAttachmentRow({
    id: caseAttachmentIdAt(seed.n),
    roomId: seed.roomId,
    uploaderId: seed.uploaderId,
    messageId: seed.messageId,
    threadParentId: seed.threadParentId ?? null,
    originalName: caseAttachmentName(seed.n),
    kind: seed.kind ?? "document",
    contentType: seed.contentType ?? "text/plain; charset=utf-8",
    sizeBytes: seed.sizeBytes ?? 10 + seed.n,
    createdAt: caseAttachmentIsoAt(seed.n),
  });
}

/** 多数の添付を、1つのメッセージにまとめて入れる（D1 の1文の値の数の上限を超える件数の確認用。50件ずつ batch） */
export async function seedManyCaseAttachments(input: {
  from: number;
  count: number;
  roomId: string;
  uploaderId: string;
  messageId: string;
}): Promise<void> {
  const chunk = 50;
  for (let start = 0; start < input.count; start += chunk) {
    const statements = [];
    for (let i = start; i < Math.min(start + chunk, input.count); i += 1) {
      const n = input.from + i;
      const id = caseAttachmentIdAt(n);
      statements.push(
        env.DB.prepare(
          `INSERT INTO message_attachments (id, room_id, thread_parent_id, message_id, uploader_id, storage_key, original_name, kind, content_type, size_bytes, created_at)
           VALUES (?, ?, NULL, ?, ?, ?, ?, 'document', 'text/plain; charset=utf-8', 10, ?)`,
        ).bind(
          id,
          input.roomId,
          input.messageId,
          input.uploaderId,
          `attachments/${id}`,
          caseAttachmentName(n),
          caseAttachmentIsoAt(n),
        ),
      );
    }
    await env.DB.batch(statements);
  }
}

/** メッセージを削除済みにする（行は消さず、deleted_at の印だけ。#134 の削除と同じ） */
export async function markMessageDeleted(messageId: string, by: string) {
  await env.DB.prepare(
    "UPDATE messages SET deleted_at = ?, deleted_by = ? WHERE id = ?",
  )
    .bind("2026-11-17T04:00:00.000Z", by, messageId)
    .run();
}
