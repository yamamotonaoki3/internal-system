// DAO：メッセージの編集・削除の書き込み（#134）。「編集・削除してよい」条件を持つ SQL をここに閉じ込める。
// 条件を UPDATE の WHERE に置くのは、Service の確認から書き込みまでの間に状態が変わっても、条件を破る行を書かないため。
// 本人の投稿で未削除、かつ部屋が次のどちらか。
//   チャンネル：本人が参加中・未アーカイブ・部署が有効（部署のない会社直属のチャンネルは有効として扱う）・案件専用チャンネルなら案件が進行中（#148）
//   DM：本人が当事者で、当事者に無効な社員がいない
// お知らせ専用の投稿権限は条件に入れない（利用者の決定 U-3：今その部屋に参加している本人なら編集・削除できる）。
import { sql, type SQL } from "drizzle-orm";
import { messageAttachments, messageMentions, messages } from "../../db/schema";
import type { Mention } from "../../../shared/message-rules";
import {
  insertMentionNotifications,
  insertMessageMentions,
} from "./message-mentions.sql";
import { auditLogInsert } from "./audit-log.repository";
import type { Database } from "./database";
import { isStoredEmptyBody } from "./message-body";
import { activeChannelMember } from "./channel-member.sql";
import { caseRoomOpen } from "./case-room.sql";
import {
  removeStaleAttachmentIndexStatements,
  removeStaleMessageIndexStatements,
  syncMessageIndexStatements,
} from "./search-index.sql";

/** messageId は値か、外側の行の列（添付の削除の条件 deletable が添付の message_id を渡す） */
export function modifiable(messageId: string | SQL, userId: string): SQL {
  return sql`EXISTS (
    SELECT 1 FROM messages m
    WHERE m.id = ${messageId} AND m.sender_id = ${userId} AND m.deleted_at IS NULL
      AND (
        EXISTS (
          SELECT 1 FROM channels c
          LEFT JOIN departments d ON d.id = c.department_id
          WHERE c.room_id = m.room_id AND c.deleted_at IS NULL
            AND ${activeChannelMember(sql`c.room_id`, userId)}
            AND ${caseRoomOpen(sql`c.room_id`)}
            AND (c.department_id IS NULL OR d.is_active = 1))
        OR (
          EXISTS (SELECT 1 FROM conversation_members WHERE conversation_id = m.room_id AND user_id = ${userId})
          AND NOT EXISTS (SELECT 1 FROM conversation_members cv JOIN users u ON u.id = cv.user_id WHERE cv.conversation_id = m.room_id AND u.is_active = 0))))`;
}

/** そのメッセージに、削除されていない（見える）添付がある（#270。本文を目印にする書き込みの条件） */
function hasVisibleAttachment(messageId: string): SQL {
  return sql`EXISTS (SELECT 1 FROM message_attachments va WHERE va.message_id = ${messageId} AND va.deleted_at IS NULL)`;
}

/**
 * modifiable を満たすときだけ、そのメッセージの見える添付の件数を返す。条件が成り立たないときは null（#270。計画 2.6a）。
 * 条件の確かめと件数を同じ batch で読み、「編集できる」と「見える添付の件数」を同じ時点の事実にする（間に書き込みが入らない）。
 */
export async function visibleAttachmentCountIfModifiable(
  db: Database,
  messageId: string,
  userId: string,
): Promise<number | null> {
  const allowed = modifiable(messageId, userId);
  const [counted, check] = await db.batch([
    db
      .select({ n: sql<number>`COUNT(*)`.mapWith(Number) })
      .from(messageAttachments)
      .where(
        sql`${messageAttachments.messageId} = ${messageId} AND ${messageAttachments.deletedAt} IS NULL AND ${allowed}`,
      ),
    db
      .select({ ok: sql<number>`1` })
      .from(sql`(SELECT 1) c`)
      .where(allowed),
  ]);
  if (check.length === 0) return null;
  const n = counted[0]?.n;
  if (n === undefined || !Number.isInteger(n))
    throw new Error("見える添付の件数を読めませんでした");
  return n;
}

/**
 * 本文と編集日時を更新し、更新した行数（1 か 0）を返す。
 * 本文が目印（本文なし）のときは、見える添付があることも条件にする（#270。本文も添付もない投稿を作らない）
 */
export async function updateBodyIfModifiable(
  db: Database,
  input: {
    messageId: string;
    userId: string;
    body: string;
    editedAt: string;
    roomId?: string;
    parentMessageId?: string;
    mentions?: readonly Mention[];
  },
): Promise<number> {
  const allowed = isStoredEmptyBody(input.body)
    ? sql`(${modifiable(input.messageId, input.userId)} AND ${hasVisibleAttachment(input.messageId)})`
    : modifiable(input.messageId, input.userId);
  // 既存のRepository呼出しの互換経路。新しいAPIはroomIdを渡し、指名も同一batchで確定する。
  // 索引の組（#155）は同じ batch の末尾に置く。拒否で0件でも、いまの行と一致する写しは消さない
  const indexStatements = syncMessageIndexStatements(db, {
    messageId: input.messageId,
    sourceBody: input.body,
  });
  if (input.roomId === undefined) {
    const [result] = await db.batch([
      db
        .update(messages)
        .set({ body: input.body, editedAt: input.editedAt })
        .where(sql`${messages.id} = ${input.messageId} AND ${allowed}`),
      ...indexStatements,
    ]);
    return result.meta.changes;
  }
  try {
    const [, , , , updated] = await db.batch([
      db
        .update(messages)
        .set({
          body: sql`CASE WHEN ${allowed} THEN ${messages.body} ELSE NULL END`,
        })
        .where(sql`${messages.id} = ${input.messageId}`),
      insertMentionNotifications(db, {
        messageId: input.messageId,
        roomId: input.roomId,
        senderId: input.userId,
        parentMessageId: input.parentMessageId,
        mentions: input.mentions ?? [],
        onlyNew: true,
        allowed,
      }),
      db
        .delete(messageMentions)
        .where(
          sql`${messageMentions.messageId} = ${input.messageId} AND ${allowed}`,
        ),
      insertMessageMentions(db, {
        messageId: input.messageId,
        roomId: input.roomId,
        mentions: input.mentions ?? [],
        allowed,
      }),
      db
        .update(messages)
        .set({ body: input.body, editedAt: input.editedAt })
        .where(sql`${messages.id} = ${input.messageId} AND ${allowed}`),
      ...indexStatements,
    ]);
    return updated.meta.changes;
  } catch (error) {
    let current: unknown = error;
    for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
      if (/NOT NULL constraint failed: messages\.body/i.test(current.message))
        return 0;
      current = current.cause;
    }
    throw error;
  }
}

/**
 * 削除の印（deleted_at・deleted_by）を付け、削除した行数（1 か 0）を返す。本文は残す（EP-1-04）。
 * 監査は、削除できるときだけ残す。UPDATE の後は条件が偽になるため、UPDATE より前に置く。detail に本文を入れない。
 * 同じ batch で、そのメッセージの添付にも削除の印を付ける（#270。監査は message.delete の1件に含める）。
 */
export async function deleteIfModifiable(
  db: Database,
  input: {
    messageId: string;
    userId: string;
    roomId: string;
    deletedAt: string;
    traceId: string;
  },
): Promise<number> {
  const allowed = modifiable(input.messageId, input.userId);
  const statements = [
    auditLogInsert(
      db,
      {
        actorId: input.userId,
        action: "message.delete",
        targetType: "message",
        targetId: input.messageId,
        result: "success",
        traceId: input.traceId,
        detail: { roomId: input.roomId },
      },
      { onlyWhen: allowed },
    ),
    // 添付の削除の印（#270）。メッセージの UPDATE の後は条件が偽になるため、その前に置く。既に印のある添付は書き換えない
    db
      .update(messageAttachments)
      .set({ deletedAt: input.deletedAt, deletedBy: input.userId })
      .where(
        sql`${messageAttachments.messageId} = ${input.messageId} AND ${messageAttachments.deletedAt} IS NULL AND ${allowed}`,
      ),
  ] as const;
  // 戻り値はメッセージの UPDATE の結果。末尾に索引の文があるので、積んだ時点の位置を保持して読む
  const updateAt = statements.length;
  const results = await db.batch([
    ...statements,
    db
      .update(messages)
      .set({ deletedAt: input.deletedAt, deletedBy: input.userId })
      .where(sql`${messages.id} = ${input.messageId} AND ${allowed}`),
    // 検索の索引（#155）。削除が確定したときだけ、写しが対象外になって消える
    ...removeStaleMessageIndexStatements(db, input.messageId),
    ...removeStaleAttachmentIndexStatements(db, input.messageId),
  ]);
  const update = results[updateAt];
  if (update === undefined)
    throw new Error("メッセージの削除の結果を読めませんでした");
  return update.meta.changes;
}
