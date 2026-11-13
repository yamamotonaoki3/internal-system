// DAO：未読の対象の部屋（#237）。SQL の実行と、結果の形の検証だけを行う。
// 対象 = 参加中（channel_members の行がある）かつ未アーカイブのチャンネルと、当事者の DM。公開チャンネルを未参加で読むだけでは対象外（1-1 AC-2・C-94）。
// 既読位置は LEFT JOIN で一緒に取る（利用者×部屋の主キーを引く）。チャンネルの参加の時刻（joined_at）は、未読の下限を作るために返す（DM は null）。
// 索引：channel_members_user_id_idx・conversation_members_user_id_idx・channels の主キー・read_positions の主キー（EXPLAIN は docs/design/unread.md）。
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "./database";

const rowSchema = z.object({
  room_id: z.string(),
  joined_at: z.string().nullable(),
  last_read_message_id: z.string().nullable(),
});

export type UnreadTargetRow = z.infer<typeof rowSchema>;

/** 「カーソルの部屋より後」の条件（カーソルがなければ全件） */
function afterRoom(cursorRoomId: string | undefined): SQL {
  if (cursorRoomId === undefined) return sql`1 = 1`;
  return sql`t.room_id > ${cursorRoomId}`;
}

/** room_id の昇順に limit 件（呼び出し側が limit + 1 を渡して、続きの有無を判定する） */
export async function listUnreadTargetRows(
  db: Database,
  userId: string,
  options: { limit: number; cursorRoomId?: string },
): Promise<UnreadTargetRow[]> {
  const rows = await db.all(sql`
    SELECT t.room_id AS room_id, t.joined_at AS joined_at, rp.last_read_message_id AS last_read_message_id
    FROM (
      SELECT cm.channel_id AS room_id, cm.joined_at AS joined_at
      FROM channel_members cm
      JOIN channels c ON c.room_id = cm.channel_id
      WHERE cm.user_id = ${userId} AND c.deleted_at IS NULL
      UNION ALL
      SELECT conv.conversation_id AS room_id, NULL AS joined_at
      FROM conversation_members conv
      WHERE conv.user_id = ${userId}) t
    LEFT JOIN read_positions rp ON rp.user_id = ${userId} AND rp.room_id = t.room_id
    WHERE ${afterRoom(options.cursorRoomId)}
    ORDER BY t.room_id
    LIMIT ${options.limit}`);
  // 生 SQL の結果は型が付かない。想定と違う行は、ここで見つける
  return z.array(rowSchema).parse(rows);
}
