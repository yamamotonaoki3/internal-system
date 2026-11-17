// Repository：メッセージの添付（#140）。DB へのアクセスはこの層に閉じ込める（R2 の実体は Service が扱う）。
// 結び付け（bindAttachments）は、投稿・返信の条件付きの INSERT と同じ db.batch に入れる文を返す。
//   UPDATE の条件：id が指定のもの・本人がアップロード・同じ部屋・未投稿・同じ文脈（通常の投稿は thread_parent_id IS NULL、返信は親の ID）
//   直後の確かめ：結び付いた件数が指定と同じで、上限（件数・合計）以内。合わなければ NOT NULL の違反で batch 全体を取り消す
//   （D1 の batch は1つのトランザクションなので、メッセージも作られない。docs/project-rules.md「db.batch の前提の確認」）。
// 0件で取り消されたときの原因（404・409・422）は、Service が findForBinding で読み直して分ける。
import { and, asc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { messageAttachments, messages } from "../../db/schema";
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_TOTAL_BYTES,
  type AttachmentContentType,
  type AttachmentKind,
} from "../../../shared/attachment-rules";
import { attachmentVisible } from "./attachment-visibility.sql";
import { withDatabase, type Database } from "./database";

/** API で返す添付の項目（保存先のキーは含めない） */
export type AttachmentView = {
  id: string;
  name: string;
  kind: AttachmentKind;
  contentType: AttachmentContentType;
  size: number;
};

export type PendingAttachmentInsert = {
  id: string;
  roomId: string;
  threadParentId: string | null;
  uploaderId: string;
  storageKey: string;
  originalName: string;
  kind: AttachmentKind;
  contentType: AttachmentContentType;
  sizeBytes: number;
};

export type AttachmentBinding = {
  messageId: string;
  roomId: string;
  uploaderId: string;
  /** 通常の投稿は null、返信は親の ID */
  threadParentId: string | null;
  attachmentIds: readonly string[];
};

/** 結び付けの確かめで batch が取り消された（原因は呼び出し側が読み直して分ける） */
export class AttachmentBindError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("添付を結び付けられませんでした", options);
    this.name = "AttachmentBindError";
  }
}

/** 結び付けの確かめの違反（messages.room_id の NOT NULL）だけを AttachmentBindError にする。ほかのエラーは変えない */
export function translateAttachmentBindError(error: unknown): unknown {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    if (/NOT NULL constraint failed: messages\.room_id/i.test(current.message))
      return new AttachmentBindError({ cause: error });
    current = current.cause;
  }
  return error;
}

/** 投稿・返信の batch の末尾に足す文（添付がなければ空） */
export function bindAttachments(db: Database, input: AttachmentBinding) {
  if (input.attachmentIds.length === 0) return [];
  const ids = JSON.stringify(input.attachmentIds);
  const a = messageAttachments;
  const bind = db
    .update(a)
    .set({ messageId: input.messageId })
    .where(
      and(
        sql`${a.id} IN (SELECT value FROM json_each(${ids}))`,
        eq(a.uploaderId, input.uploaderId),
        eq(a.roomId, input.roomId),
        isNull(a.messageId),
        input.threadParentId === null
          ? isNull(a.threadParentId)
          : eq(a.threadParentId, input.threadParentId),
        sql`EXISTS (SELECT 1 FROM messages WHERE id = ${input.messageId})`,
      ),
    );
  // 結び付いた件数と合計が合わなければ、メッセージの room_id を NULL にして batch 全体を取り消す
  const bound = sql`(SELECT COUNT(*) FROM message_attachments WHERE message_id = ${input.messageId})`;
  const total = sql`(SELECT COALESCE(SUM(size_bytes), 0) FROM message_attachments WHERE message_id = ${input.messageId})`;
  const guard = db
    .update(messages)
    .set({
      roomId: sql`CASE WHEN ${bound} = ${input.attachmentIds.length}
        AND ${bound} <= ${MAX_ATTACHMENTS_PER_MESSAGE}
        AND ${total} <= ${MAX_ATTACHMENT_TOTAL_BYTES}
        THEN ${messages.roomId} ELSE NULL END`,
    })
    .where(eq(messages.id, input.messageId));
  return [bind, guard] as const;
}

const viewColumns = {
  id: messageAttachments.id,
  messageId: messageAttachments.messageId,
  name: messageAttachments.originalName,
  kind: messageAttachments.kind,
  contentType: messageAttachments.contentType,
  size: messageAttachments.sizeBytes,
};

/** メッセージごとの添付（ID の昇順）。削除済みのメッセージの扱いは呼び出し側（toItem が [] にする） */
export async function loadMessageAttachments(
  db: Database,
  messageIds: readonly string[],
): Promise<Map<string, AttachmentView[]>> {
  const result = new Map<string, AttachmentView[]>();
  if (messageIds.length === 0) return result;
  const rows = await db
    .select(viewColumns)
    .from(messageAttachments)
    .where(
      sql`${messageAttachments.messageId} IN (SELECT value FROM json_each(${JSON.stringify(messageIds)}))`,
    )
    .orderBy(asc(messageAttachments.messageId), asc(messageAttachments.id));
  for (const { messageId, ...row } of rows) {
    if (messageId === null) continue;
    const list = result.get(messageId) ?? [];
    list.push({
      ...row,
      kind: row.kind as AttachmentKind,
      contentType: row.contentType as AttachmentContentType,
    });
    result.set(messageId, list);
  }
  return result;
}

/** 結び付けが取り消された原因を分けるための読み直し（存在する行だけを返す） */
export async function findForBinding(
  db: Database,
  attachmentIds: readonly string[],
) {
  if (attachmentIds.length === 0) return [];
  return db
    .select({
      id: messageAttachments.id,
      roomId: messageAttachments.roomId,
      threadParentId: messageAttachments.threadParentId,
      messageId: messageAttachments.messageId,
      uploaderId: messageAttachments.uploaderId,
      sizeBytes: messageAttachments.sizeBytes,
    })
    .from(messageAttachments)
    .where(inArray(messageAttachments.id, [...attachmentIds]));
}

export function createAttachmentRepository(db: Database) {
  return {
    /** 見てよい添付だけを返す（条件は attachment-visibility.sql.ts）。見えない・存在しないは null */
    async findVisible(attachmentId: string, viewerId: string) {
      const rows = await db
        .select({
          id: messageAttachments.id,
          storageKey: messageAttachments.storageKey,
          originalName: messageAttachments.originalName,
          kind: messageAttachments.kind,
          contentType: messageAttachments.contentType,
          sizeBytes: messageAttachments.sizeBytes,
          isDirect:
            sql<boolean>`EXISTS (SELECT 1 FROM conversations WHERE room_id = ${messageAttachments.roomId})`.mapWith(
              Boolean,
            ),
        })
        .from(messageAttachments)
        .where(
          and(
            eq(messageAttachments.id, attachmentId),
            attachmentVisible(viewerId),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (row === undefined) return null;
      return {
        ...row,
        kind: row.kind as AttachmentKind,
        contentType: row.contentType as AttachmentContentType,
      };
    },
    async insertPending(input: PendingAttachmentInsert): Promise<void> {
      await db.insert(messageAttachments).values(input);
    },
    /** 境界より前に作られた未投稿の行を消し、消した行の保存先のキーを返す（結び付いた行は条件で消さない） */
    async deletePendingBefore(boundary: string): Promise<string[]> {
      const rows = await db
        .delete(messageAttachments)
        .where(
          and(
            isNull(messageAttachments.messageId),
            lt(messageAttachments.createdAt, boundary),
          ),
        )
        .returning({ storageKey: messageAttachments.storageKey });
      return rows.map((row) => row.storageKey);
    },
  };
}

export type AttachmentRepository = ReturnType<
  typeof createAttachmentRepository
>;

/** Repository を使う間だけ DB につなぐ */
export function withAttachments<T>(
  env: Env,
  run: (repository: AttachmentRepository) => Promise<T>,
): Promise<T> {
  return withDatabase(env, (db) => run(createAttachmentRepository(db)));
}
