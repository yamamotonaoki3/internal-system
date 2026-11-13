// DAO：部屋ごとの未読数（#237。ADR-0006）。SQL の実行と、結果の形の検証だけを行う。
// 部屋と下限（この ID より大きいメッセージを数える）の組を JSON 1つのパラメータで渡し、1本の SQL で全部屋を数える（部屋の数でクエリもパラメータも増えない）。
// 数えるのは messages_room_id_id_idx の範囲（room_id=? AND id>?）で、上限 UNREAD_COUNT_LIMIT 件まで。自分の投稿は数えない（C-169 (3)）。
// json_each に別名を付けない（EXPLAIN の行に json_each の名前が残り、索引なしの表の SCAN と区別できるため）。
// 戻りは未読が1件以上の部屋だけ。順序は渡した部屋の順（呼び出し側が room_id の昇順で渡す）。json_each の返す順に頼らず、配列の添字（key）で並べる。
import { sql } from "drizzle-orm";
import { z } from "zod";
import { UNREAD_COUNT_LIMIT } from "../../../shared/unread-rules";
import type { Database } from "./database";

const rowSchema = z.object({
  room_id: z.string(),
  unread_count: z.number().int().min(0).max(UNREAD_COUNT_LIMIT),
});

export type UnreadCountRow = { roomId: string; count: number };

export type UnreadCountTarget = { roomId: string; lower: string };

export async function listUnreadCountRows(
  db: Database,
  userId: string,
  targets: readonly UnreadCountTarget[],
): Promise<UnreadCountRow[]> {
  if (targets.length === 0) return [];
  const rows = await db.all(sql`
    SELECT json_extract(json_each.value, '$.roomId') AS room_id,
      (SELECT COUNT(*) FROM (
        SELECT 1 FROM messages m
        WHERE m.room_id = json_extract(json_each.value, '$.roomId')
          AND m.id > json_extract(json_each.value, '$.lower')
          AND m.sender_id <> ${userId}
        LIMIT ${UNREAD_COUNT_LIMIT})) AS unread_count
    FROM json_each(${JSON.stringify(targets)})
    ORDER BY json_each.key`);
  // 生 SQL の結果は型が付かない。想定と違う行は、ここで見つける
  return z
    .array(rowSchema)
    .parse(rows)
    .filter((row) => row.unread_count > 0)
    .map((row) => ({ roomId: row.room_id, count: row.unread_count }));
}
