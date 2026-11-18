// DAO：自分のスレッドの一覧（#137。EP-3-08）。SQL の実行と、結果の形の検証だけを行う。
// 含めるスレッド：返信が1件以上あり、自分が親の投稿者か、自分が返信したもの。そのうち、部屋が参加中で未アーカイブのチャンネル、または当事者である DM（閲覧者が有効なときだけ。#297）のものだけ（U-4。参加していない公開チャンネルの本文を返さない）。
// 並び：最後の返信の ID の降順（削除済みの返信も含む）、同じなら親の ID の降順。カーソルは「最後の(最後の返信の ID, 親の ID)の組より古い」。
// 索引：自分の投稿は messages_sender_id_parent_message_id_idx（sender_id, parent_message_id）で引き、会社全体の返信を読まない。
//   最後の返信は messages_parent_message_id_id_idx の MAX、親・部屋・参加は主キー、スレッドの既読位置は主キー（EXPLAIN は docs/design/threads.md）。
// 内側の SELECT で「見える範囲の絞り込み・並び・LIMIT」を済ませ、返信の件数・部屋・既読位置などの詳細は、LIMIT 後の行にだけ付ける（件数はスレッドの数に比例しない）。
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { CursorPayload } from "../lib/cursor";
import type { Database } from "./database";
import { activeChannelMember } from "./channel-member.sql";
import { caseRoomListable } from "./case-room.sql";

const rowSchema = z.object({
  id: z.string(),
  room_id: z.string(),
  sender_id: z.string(),
  sender_display_name: z.string(),
  body: z.string(),
  created_at: z.string(),
  edited_at: z.string().nullable(),
  deleted_at: z.string().nullable(),
  author_is_active: z.union([z.literal(0), z.literal(1)]),
  reply_count: z.number().int().min(1),
  last_reply_id: z.string(),
  last_reply_at: z.string(),
  channel_name: z.string().nullable(),
  joined_at: z.string().nullable(),
  partner_id: z.string().nullable(),
  partner_display_name: z.string().nullable(),
  partner_is_active: z.union([z.literal(0), z.literal(1)]).nullable(),
  last_read_message_id: z.string().nullable(),
});

export type ThreadListRow = z.infer<typeof rowSchema>;

/** 「最後の(最後の返信の ID, 親の ID)の組より古い」行の条件（カーソルがなければ全件） */
function olderThan(cursor: CursorPayload | undefined): SQL {
  if (cursor === undefined) return sql`1 = 1`;
  const lastReplyId = String(cursor.v);
  return sql`(t.last_reply_id < ${lastReplyId} OR (t.last_reply_id = ${lastReplyId} AND t.parent_id < ${cursor.id}))`;
}

/** 新しい順に limit 件（呼び出し側が limit + 1 を渡して、続きの有無を判定する） */
export async function listThreadRows(
  db: Database,
  userId: string,
  options: {
    limit: number;
    cursor?: CursorPayload;
    includeDirect: boolean;
    /** perm.case.view を持つか。偽なら案件専用チャンネルのスレッドを含めない（#148） */
    includeCase: boolean;
  },
): Promise<ThreadListRow[]> {
  // DM のスレッドを見せない利用者（perm.dm.message.view なし）は、SQL の条件で除く（取得の後に除くと、ページの件数と nextCursor がずれる）
  const directVisible = options.includeDirect
    ? sql`(EXISTS (SELECT 1 FROM users du WHERE du.id = ${userId} AND du.is_active = 1)
        AND EXISTS (SELECT 1 FROM conversation_members cv WHERE cv.conversation_id = pp.room_id AND cv.user_id = ${userId}))`
    : sql`0`;
  const rows = await db.all(sql`
    WITH mine(parent_id) AS (
      SELECT id FROM messages WHERE sender_id = ${userId} AND parent_message_id IS NULL
      UNION
      SELECT parent_message_id FROM messages WHERE sender_id = ${userId} AND parent_message_id IS NOT NULL
      UNION
      SELECT m.id FROM message_mentions mm JOIN messages m ON m.id = mm.message_id
        WHERE mm.user_id = ${userId} AND m.parent_message_id IS NULL
      UNION
      SELECT m.parent_message_id FROM message_mentions mm JOIN messages m ON m.id = mm.message_id
        WHERE mm.user_id = ${userId} AND m.parent_message_id IS NOT NULL)
    SELECT p.id AS id, p.room_id AS room_id, p.sender_id AS sender_id, p.sender_display_name AS sender_display_name,
      p.body AS body, p.created_at AS created_at, p.edited_at AS edited_at, p.deleted_at AS deleted_at,
      au.is_active AS author_is_active,
      (SELECT COUNT(*) FROM messages rc WHERE rc.parent_message_id = p.id) AS reply_count,
      page.last_reply_id AS last_reply_id,
      (SELECT lr.created_at FROM messages lr WHERE lr.id = page.last_reply_id) AS last_reply_at,
      c.name AS channel_name, cm.joined_at AS joined_at,
      pu.id AS partner_id, pu.display_name AS partner_display_name, pu.is_active AS partner_is_active,
      tp.last_read_message_id AS last_read_message_id
    FROM (
      SELECT t.parent_id AS parent_id, t.last_reply_id AS last_reply_id
      FROM (
        SELECT mine.parent_id AS parent_id,
          (SELECT MAX(r.id) FROM messages r WHERE r.parent_message_id = mine.parent_id) AS last_reply_id
        FROM mine) t
      JOIN messages pp ON pp.id = t.parent_id
      WHERE t.last_reply_id IS NOT NULL
        AND (
          EXISTS (
            SELECT 1 FROM channels ch
            WHERE ch.room_id = pp.room_id AND ch.deleted_at IS NULL
              AND ${activeChannelMember(sql`ch.room_id`, userId)}
              AND ${caseRoomListable(sql`ch.room_id`, options.includeCase)})
          OR ${directVisible})
        AND ${olderThan(options.cursor)}
      ORDER BY t.last_reply_id DESC, t.parent_id DESC
      LIMIT ${options.limit}) page
    JOIN messages p ON p.id = page.parent_id
    JOIN users au ON au.id = p.sender_id
    LEFT JOIN channels c ON c.room_id = p.room_id
    LEFT JOIN channel_members cm ON cm.channel_id = p.room_id AND cm.user_id = ${userId}
    LEFT JOIN conversation_members pm ON pm.conversation_id = p.room_id AND pm.user_id <> ${userId}
    LEFT JOIN users pu ON pu.id = pm.user_id
    LEFT JOIN thread_read_positions tp ON tp.user_id = ${userId} AND tp.parent_message_id = p.id
    ORDER BY page.last_reply_id DESC, page.parent_id DESC`);
  // 生 SQL の結果は型が付かない。想定と違う行は、ここで見つける
  return z.array(rowSchema).parse(rows);
}
