// #148（148-B-1）のテストで使う、案件の添付の一覧（EP-5-19）の架空のテストデータの作成と、期待の形。
// 世界は case-room-fixtures.ts の setupCaseRoomWorld（案件・案件専用チャンネル・参加・通常のチャンネル）を使い、
// 後始末も cleanupCaseRoomWorld（R2 の実体 → 添付 → メッセージ → 案件と世界）に任せる。
// 添付の行は attachment-fixtures.ts の insertAttachmentRow で直接入れる（API・Repository を通さない）。
// ID は決定的（同じ n には同じ ID。n が大きいほど新しい＝ID の降順は n の降順）。データは架空（testuser_casereq_・[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { createUlidFactory } from "../src/lib/ulid";
import { apiRequest } from "./api-request";
import { insertAttachmentRow } from "./attachment-fixtures";

/** 一覧の項目のキー（計画 148-B-1「API」。保存キー・URL は含めない） */
// #148（148-B-2）で canChangeVisibility・publicationVisibility を足した（応答に項目が加わる分）
export const CASE_ATTACHMENT_ITEM_KEYS = [
  "canChangeVisibility",
  "contentType",
  "id",
  "kind",
  "messageId",
  "name",
  "publicationVisibility",
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

// ---- #148（148-B-2）5-2 AC-8・AC-9：公開範囲 ----
// 期待値は要件（5-2 AC-8 の2値。初期値は参加者限定）から直接書く（shared の定義から作らない）。

/** 公開範囲の2値（D1） */
export const PUBLICATION = {
  participantsOnly: "participants_only",
  publicArchive: "public_archive",
} as const;
export type PublicationValue = (typeof PUBLICATION)[keyof typeof PUBLICATION];

/** EP-1-23 の文言（計画 6.4。画面はこの文言をそのまま出す） */
export const VISIBILITY_MESSAGES = {
  notFound: "添付が見つかりません",
  forbidden: "この添付の公開範囲は変更できません",
  closed: "終了した案件の添付の公開範囲は変更できません",
  stateChanged:
    "状態が変わったため、変更できませんでした。読み込み直してからお試しください",
} as const;

export const VISIBILITY_ACTION = "case.attachment.visibility.change";

/** EP-1-23 PATCH /api/attachments/:attachmentId */
export function changeVisibilityRequest(
  attachmentId: string,
  body: unknown,
  token: string | null,
  origin?: string,
) {
  return apiRequest("PATCH", `/api/attachments/${attachmentId}`, {
    token,
    body,
    ...(origin === undefined ? {} : { origin }),
  });
}

/** 公開範囲を直接変える（API を通さない。状態の準備・同時の変更の代わり） */
export async function setPublicationVisibility(
  attachmentId: string,
  value: string,
) {
  await env.DB.prepare(
    "UPDATE message_attachments SET publication_visibility = ? WHERE id = ?",
  )
    .bind(value, attachmentId)
    .run();
}

export async function publicationVisibilityOf(
  attachmentId: string,
): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT publication_visibility AS v FROM message_attachments WHERE id = ?",
  )
    .bind(attachmentId)
    .first<{ v: string }>();
  return row?.v ?? null;
}

export type VisibilityAuditRow = {
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  result: string;
  detail: string | null;
};

/** 公開範囲の変更の監査（書かれた順） */
export async function visibilityAudits(): Promise<VisibilityAuditRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT actor_id, action, target_type, target_id, result, detail FROM audit_logs
     WHERE action = ? ORDER BY occurred_at, id`,
  )
    .bind(VISIBILITY_ACTION)
    .all<VisibilityAuditRow>();
  return results;
}
