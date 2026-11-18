// DAO：スレッドごとの未読数（#137。ADR-0006・C-169）。SQL の実行と、結果の形の検証だけを行う。
// スレッドと下限（この ID より大きい返信を数える）の組を JSON 1つのパラメータで渡し、1本の SQL で全スレッドを数える（スレッドの数でクエリもパラメータも増えない）。
// 数えるのは messages_parent_message_id_id_idx の範囲（parent_message_id=? AND id>?）で、上限 UNREAD_COUNT_LIMIT 件まで。自分の返信と削除済みの返信は数えない（部屋の未読と同じ）。
// json_each に別名を付けない（EXPLAIN の行に json_each の名前が残り、索引なしの表の SCAN と区別できるため）。
// 親の部屋を閲覧者がいま見てよくない（資格を失った）スレッドは、行を残したまま 0 にする（#297）。
// 戻りは、渡したすべてのスレッド（未読が 0 のものも含む。呼び出し側が親の ID で引く）。
import { sql } from "drizzle-orm";
import { z } from "zod";
import { UNREAD_COUNT_LIMIT } from "../../../shared/unread-rules";
import type { Database } from "./database";
import { messageViewableBy } from "./room-visibility.sql";

const rowSchema = z.object({
  parent_id: z.string(),
  unread_count: z.number().int().min(0).max(UNREAD_COUNT_LIMIT),
});

export type ThreadUnreadTarget = { parentId: string; lower: string };

export async function listThreadUnreadCounts(
  db: Database,
  userId: string,
  targets: readonly ThreadUnreadTarget[],
): Promise<Map<string, number>> {
  if (targets.length === 0) return new Map();
  const rows = await db.all(sql`
    SELECT json_extract(json_each.value, '$.parentId') AS parent_id,
      CASE WHEN ${messageViewableBy(sql`json_extract(json_each.value, '$.parentId')`, userId)}
        THEN (SELECT COUNT(*) FROM (
          SELECT 1 FROM messages m
          WHERE m.parent_message_id = json_extract(json_each.value, '$.parentId')
            AND m.id > json_extract(json_each.value, '$.lower')
            AND m.sender_id <> ${userId}
            AND m.deleted_at IS NULL
          LIMIT ${UNREAD_COUNT_LIMIT}))
        ELSE 0 END AS unread_count
    FROM json_each(${JSON.stringify(targets)})
    ORDER BY json_each.key`);
  // 生 SQL の結果は型が付かない。想定と違う行は、ここで見つける
  return new Map(
    z
      .array(rowSchema)
      .parse(rows)
      .map((row) => [row.parent_id, row.unread_count]),
  );
}
