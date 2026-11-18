// 指名の保存と通知。配列はJSON 1パラメータで渡し、D1のbind数を指名数に依存させない。
import { eq, sql, type SQL } from "drizzle-orm";
import { messageMentions, notifications, rooms, users } from "../../db/schema";
import type { Mention } from "../../../shared/message-rules";
import { newUlid } from "../lib/ulid";
import type { Database } from "./database";
import { eligibleMentionRecipient } from "./notification.repository";
import { messageViewableBy } from "./room-visibility.sql";

/** 直前の条件付きINSERTが0行なら、部屋の必須列の違反でbatch全体を取り消す。 */
export function guardInsertedMessage(db: Database, roomId: string) {
  return db
    .update(rooms)
    .set({
      kind: sql`CASE WHEN changes() = 1 THEN ${rooms.kind} ELSE NULL END`,
    })
    .where(eq(rooms.id, roomId));
}

/** 前提が失われたため、条件付きINSERTを再評価する。未知のDBエラーはこの型へ変えない。 */
export class MessageInsertGuardError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("メッセージの挿入条件が変わりました", options);
    this.name = "MessageInsertGuardError";
  }
}

export function translateMessageInsertError(error: unknown): unknown {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    if (/NOT NULL constraint failed: rooms\.kind/i.test(current.message))
      return new MessageInsertGuardError({ cause: error });
    current = current.cause;
  }
  return error;
}

export function insertMessageMentions(
  db: Database,
  input: {
    messageId: string;
    roomId: string;
    mentions: readonly Mention[];
    allowed?: SQL;
  },
) {
  return db.insert(messageMentions).select(sql`
    SELECT ${input.messageId}, json_extract(j.value, '$.userId'),
      json_extract(j.value, '$.start'), json_extract(j.value, '$.end')
    FROM json_each(${JSON.stringify(input.mentions)}) j
    JOIN messages m ON m.id = ${input.messageId} AND m.room_id = ${input.roomId}
    WHERE ${input.allowed ?? sql`1 = 1`}`);
}

export function insertMentionNotifications(
  db: Database,
  input: {
    messageId: string;
    roomId: string;
    senderId: string;
    parentMessageId?: string;
    mentions: readonly Mention[];
    onlyNew?: boolean;
    allowed?: SQL;
  },
) {
  const recipients = [
    ...new Set(input.mentions.map((mention) => mention.userId)),
  ].map((userId) => ({ userId, notificationId: newUlid() }));
  const candidate = sql`json_extract(j.value, '$.userId')`;
  return db.insert(notifications).select(sql`
    SELECT json_extract(j.value, '$.notificationId'), ${candidate},
      'message.mentioned', ${input.roomId}, ${input.messageId}, ${input.parentMessageId ?? input.messageId},
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL
    FROM json_each(${JSON.stringify(recipients)}) j
    JOIN messages m ON m.id = ${input.messageId} AND m.room_id = ${input.roomId}
    WHERE ${input.allowed ?? sql`1 = 1`}
      AND ${eligibleMentionRecipient(candidate, sql`${input.roomId}`, input.senderId)}
      ${
        input.onlyNew
          ? sql`AND NOT EXISTS (
        SELECT 1 FROM message_mentions old
        WHERE old.message_id = ${input.messageId} AND old.user_id = ${candidate})`
          : sql``
      }`);
}

export async function loadMessageMentions(
  db: Database,
  messageIds: readonly string[],
  viewerId: string,
): Promise<Map<string, Mention[]>> {
  const result = new Map<string, Mention[]>();
  if (messageIds.length === 0) return result;
  const rows = await db
    .select({
      messageId: messageMentions.messageId,
      userId: messageMentions.userId,
      start: messageMentions.start,
      end: messageMentions.end,
    })
    .from(messageMentions)
    .where(
      sql`${messageMentions.messageId} IN (SELECT value FROM json_each(${JSON.stringify(messageIds)}))
        AND ${messageViewableBy(sql`${messageMentions.messageId}`, viewerId)}`,
    )
    .orderBy(messageMentions.messageId, messageMentions.start);
  for (const row of rows) {
    const mentions = result.get(row.messageId) ?? [];
    mentions.push({ userId: row.userId, start: row.start, end: row.end });
    result.set(row.messageId, mentions);
  }
  return result;
}

export async function activeMentionNames(
  db: Database,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(
      sql`${users.isActive} = 1 AND ${users.id} IN (SELECT value FROM json_each(${JSON.stringify([...new Set(userIds)])}))`,
    );
  return new Map(rows.map((row) => [row.id, row.displayName]));
}
