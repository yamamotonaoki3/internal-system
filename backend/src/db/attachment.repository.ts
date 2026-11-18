// Repository：メッセージの添付（#140）。DB へのアクセスはこの層に閉じ込める（R2 の実体は Service が扱う）。
// 結び付け（bindAttachments）は、投稿・返信の条件付きの INSERT と同じ db.batch に入れる文を返す。
//   UPDATE の条件：id が指定のもの・本人がアップロード・同じ部屋・未投稿・同じ文脈（通常の投稿は thread_parent_id IS NULL、返信は親の ID）
//   直後の確かめ：結び付いた件数が指定と同じで、上限（件数・合計）以内。合わなければ NOT NULL の違反で batch 全体を取り消す
//   （D1 の batch は1つのトランザクションなので、メッセージも作られない。docs/project-rules.md「db.batch の前提の確認」）。
// 0件で取り消されたときの原因（404・409・422）は、Service が findForBinding で読み直して分ける。
// 未投稿の行の登録（insertPending）は、保存の時点の資格を条件にした INSERT … SELECT … WHERE にする（#148）。
//   Service の確認の後、ファイルの受信中に資格を失った人の行を残さないため。0行の原因は Service が読み直して分ける。
import { and, asc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { messageAttachments, messages } from "../../db/schema";
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_TOTAL_BYTES,
  type AttachmentContentType,
  type AttachmentKind,
} from "../../../shared/attachment-rules";
import { attachmentVisible } from "./attachment-visibility.sql";
import { caseRoomOpen } from "./case-room.sql";
import {
  activeChannelMember,
  announcementPostable,
} from "./channel-member.sql";
import { withDatabase, type Database } from "./database";
import { messageViewableBy } from "./room-visibility.sql";

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

/**
 * 未投稿の添付を登録してよい、保存の時点の資格（部屋の種類によらない1つの条件。Service の requirePostable・requireReplyable の拒否と同じ範囲）：
 *   チャンネル：未アーカイブで、アップロードした人が有効な参加者・案件専用チャンネルなら案件が進行中
 *     ・部屋への添付なら、お知らせ専用は部署のオーナーか全体管理者（投稿と同じ）・返信への添付なら、部署が有効（部署なしは有効。返信と同じ）
 *   DM：アップロードした人が当事者で、当事者に無効な社員がいない
 *   返信への添付なら、親が同じ部屋のトップレベルの投稿で、削除されていない
 */
function pendingInsertable(input: PendingAttachmentInsert) {
  const context =
    input.threadParentId === null
      ? announcementPostable(
          { purpose: sql`c.purpose`, departmentId: sql`c.department_id` },
          input.uploaderId,
        )
      : sql`(c.department_id IS NULL OR EXISTS (SELECT 1 FROM departments d WHERE d.id = c.department_id AND d.is_active = 1))`;
  const room = sql`(
    EXISTS (
      SELECT 1 FROM channels c
      WHERE c.room_id = ${input.roomId} AND c.deleted_at IS NULL
        AND ${activeChannelMember(sql`c.room_id`, input.uploaderId)}
        AND ${caseRoomOpen(sql`c.room_id`)}
        AND ${context})
    OR (
      EXISTS (SELECT 1 FROM conversation_members dm WHERE dm.conversation_id = ${input.roomId} AND dm.user_id = ${input.uploaderId})
      AND NOT EXISTS (SELECT 1 FROM conversation_members cv JOIN users u ON u.id = cv.user_id WHERE cv.conversation_id = ${input.roomId} AND u.is_active = 0)))`;
  if (input.threadParentId === null) return room;
  return sql`${room} AND EXISTS (
    SELECT 1 FROM messages p
    WHERE p.id = ${input.threadParentId} AND p.room_id = ${input.roomId}
      AND p.parent_message_id IS NULL AND p.deleted_at IS NULL)`;
}

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
  viewerId: string,
): Promise<Map<string, AttachmentView[]>> {
  const result = new Map<string, AttachmentView[]>();
  if (messageIds.length === 0) return result;
  const rows = await db
    .select(viewColumns)
    .from(messageAttachments)
    .where(
      sql`${messageAttachments.messageId} IN (SELECT value FROM json_each(${JSON.stringify(messageIds)}))
        AND ${messageViewableBy(sql`${messageAttachments.messageId}`, viewerId)}`,
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
          // 列は入れ子の SQL で渡す（直接書くと表名なしになり、内側の conversations.room_id と解釈される）
          isDirect:
            sql<boolean>`EXISTS (SELECT 1 FROM conversations cv WHERE cv.room_id = ${sql`${messageAttachments.roomId}`})`.mapWith(
              Boolean,
            ),
          // 案件専用チャンネルの添付か（#148。配信に perm.case.view を求める）
          isCase:
            sql<boolean>`EXISTS (SELECT 1 FROM cases k WHERE k.channel_id = ${sql`${messageAttachments.roomId}`})`.mapWith(
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
    /** 資格（pendingInsertable）を満たすときだけ1行を登録し、登録した行数（1 か 0）を返す */
    async insertPending(input: PendingAttachmentInsert): Promise<number> {
      // 列の順は表の定義と同じ（message_id は未投稿なので NULL、created_at は表の既定と同じ形の現在時刻）
      const result = await db.insert(messageAttachments).select(sql`
        SELECT ${input.id}, ${input.roomId}, ${input.threadParentId}, NULL, ${input.uploaderId}, ${input.storageKey},
          ${input.originalName}, ${input.kind}, ${input.contentType}, ${input.sizeBytes}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE ${pendingInsertable(input)}`);
      return result.meta.changes;
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
