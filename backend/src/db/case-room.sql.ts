// 「この部屋が案件専用チャンネルなら、案件が進行中か」の SQL の部品（#148。5-1 AC-11）。案件でない部屋は真。
// 書き込みの SQL の条件に入れ、Service の確認の後に案件が終了しても、終了した案件の部屋に行を書かないようにする。
// 外側の列は、表の名前つき・別名つきの SQL の式（sql`c.room_id` 等）で渡す。列オブジェクトを渡すと、表の名前なしで書き出され、
// 内側の cases の同じ名前の列として解釈されうる（#294）。内側の表には別名 k を付ける。
import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

export function caseRoomOpen(roomId: SQLWrapper): SQL {
  return sql`NOT EXISTS (SELECT 1 FROM cases k WHERE k.channel_id = ${roomId} AND k.status <> 'active')`;
}

/**
 * 一覧（スレッドの一覧・未読の対象）に案件専用チャンネルを含めてよいか。includeCase が偽（perm.case.view がない）なら、案件でない部屋だけが真。
 * 取得の後に除くとページの件数とカーソルがずれるため、SQL の条件で除く（DM の includeDirect と同じ作り）。
 */
export function caseRoomListable(
  roomId: SQLWrapper,
  includeCase: boolean,
): SQL {
  if (includeCase) return sql`1 = 1`;
  return sql`NOT EXISTS (SELECT 1 FROM cases k WHERE k.channel_id = ${roomId})`;
}
