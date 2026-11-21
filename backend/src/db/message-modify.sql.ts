// DAO：メッセージの編集・削除の書き込み（#134）。「編集・削除してよい」条件を持つ SQL をここに閉じ込める。
// 条件を UPDATE の WHERE に置くのは、Service の確認から書き込みまでの間に状態が変わっても、条件を破る行を書かないため。
// 本人の投稿で未削除、かつ部屋が次のどちらか。
//   チャンネル：本人が参加中・未アーカイブ・部署が有効（部署のない会社直属のチャンネルは有効として扱う）・案件専用チャンネルなら案件が進行中（#148）
//   DM：本人が当事者で、当事者に無効な社員がいない
// お知らせ専用の投稿権限は条件に入れない（利用者の決定 U-3：今その部屋に参加している本人なら編集・削除できる）。
import { sql, type SQL } from "drizzle-orm";
import { messageMentions, messages } from "../../db/schema";
import type { Mention } from "../../../shared/message-rules";
import {
  insertMentionNotifications,
  insertMessageMentions,
} from "./message-mentions.sql";
import { auditLogInsert } from "./audit-log.repository";
import type { Database } from "./database";
import { activeChannelMember } from "./channel-member.sql";
import { caseRoomOpen } from "./case-room.sql";
import {
  removeStaleAttachmentIndexStatements,
  removeStaleMessageIndexStatements,
  syncMessageIndexStatements,
} from "./search-index.sql";

export function modifiable(messageId: string, userId: string): SQL {
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

/** 本文と編集日時を更新し、更新した行数（1 か 0）を返す */
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
  const allowed = modifiable(input.messageId, input.userId);
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
  const [, update] = await db.batch([
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
      { onlyWhen: modifiable(input.messageId, input.userId) },
    ),
    db
      .update(messages)
      .set({ deletedAt: input.deletedAt, deletedBy: input.userId })
      .where(
        sql`${messages.id} = ${input.messageId} AND ${modifiable(input.messageId, input.userId)}`,
      ),
    // 検索の索引（#155）。削除が確定したときだけ、写しが対象外になって消える
    ...removeStaleMessageIndexStatements(db, input.messageId),
    ...removeStaleAttachmentIndexStatements(db, input.messageId),
  ]);
  return update.meta.changes;
}
