// DAO：自分の DM の一覧（#136）。SQL の実行と、結果の形の検証だけを行う。
// 最終活動 = 最後のメッセージのID（なければ部屋のID）。ID は ULID で、辞書順が時刻順になる。
// 相手は、会話の当事者のうち自分でない方。メッセージの最大は messages_room_id_id_idx、当事者は conversation_members_user_id_idx を使う（EXPLAIN は docs/design/dms.md）。
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { USER_STATUS_KINDS } from "../../../shared/profile-rules";
import type { CursorPayload } from "../lib/cursor";
import type { Database } from "./database";

const rowSchema = z.object({
  room_id: z.string(),
  activity_key: z.string(),
  last_message_at: z.string().nullable(),
  partner_id: z.string(),
  partner_display_name: z.string(),
  partner_is_active: z.union([z.literal(0), z.literal(1)]),
  partner_status_kind: z.enum(USER_STATUS_KINDS),
  partner_status_return_at: z.string().nullable(),
});

export type ConversationListRow = z.infer<typeof rowSchema>;

/** 「最後の(最終活動, 部屋ID)の組より古い」行の条件（カーソルがなければ全件） */
function olderThan(cursor: CursorPayload | undefined): SQL {
  if (cursor === undefined) return sql`1 = 1`;
  const activity = String(cursor.v);
  return sql`(activity_key < ${activity} OR (activity_key = ${activity} AND room_id < ${cursor.id}))`;
}

/** 新しい順に limit 件（呼び出し側が limit + 1 を渡して、続きの有無を判定する） */
export async function listConversationRows(
  db: Database,
  userId: string,
  options: { limit: number; cursor?: CursorPayload },
): Promise<ConversationListRow[]> {
  const rows = await db.all(sql`
    SELECT room_id, activity_key, last_message_at, partner_id, partner_display_name,
      partner_is_active, partner_status_kind, partner_status_return_at
    FROM (
      SELECT c.room_id AS room_id,
        COALESCE((SELECT m.id FROM messages m WHERE m.room_id = c.room_id ORDER BY m.id DESC LIMIT 1), c.room_id) AS activity_key,
        (SELECT m.created_at FROM messages m WHERE m.room_id = c.room_id ORDER BY m.id DESC LIMIT 1) AS last_message_at,
        u.id AS partner_id,
        u.display_name AS partner_display_name,
        u.is_active AS partner_is_active,
        u.status_kind AS partner_status_kind,
        u.status_return_at AS partner_status_return_at
      FROM conversation_members me
      JOIN conversations c ON c.room_id = me.conversation_id
      JOIN conversation_members pm ON pm.conversation_id = c.room_id AND pm.user_id <> me.user_id
      JOIN users u ON u.id = pm.user_id
      WHERE me.user_id = ${userId})
    WHERE ${olderThan(options.cursor)}
    ORDER BY activity_key DESC, room_id DESC
    LIMIT ${options.limit}`);
  // 生 SQL の結果は型が付かない。想定と違う行は、ここで見つける
  return z.array(rowSchema).parse(rows);
}
