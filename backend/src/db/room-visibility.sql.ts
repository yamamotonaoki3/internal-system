// 「この部屋を、この閲覧者が、いま見てよいか」の SQL の部品（#147 C-182(10)）。中身を読む SQL そのものの条件に入れ、
// 資格の確認と中身の取得の間に無効化が確定しても、非公開の中身を返さないようにする。
// 規則は Service の見える判定（lib/channel-rules.ts の canViewChannel と、DM の当事者の確認）と同じ：
//   閲覧者が有効で、かつ次のどちらか
//     チャンネル：未アーカイブで、公開か、閲覧者が参加中の非公開
//     DM：閲覧者が当事者
// 閲覧者の有効性は主キーで1回、参加の行・当事者の行は主キーで引く。
// メッセージの付随情報（メンション・リアクション・添付）と未読の数の読み取りにも使う（#297。本文の読み取りの後の別の文でも、その時点の資格で絞る）。
import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

export function roomViewableBy(roomId: SQLWrapper, viewerId: string): SQL {
  return sql`(EXISTS (SELECT 1 FROM users vu WHERE vu.id = ${viewerId} AND vu.is_active = 1)
    AND (
      EXISTS (
        SELECT 1 FROM channels vc
        WHERE vc.room_id = ${roomId} AND vc.deleted_at IS NULL
          AND (vc.visibility = 'public' OR EXISTS (
            SELECT 1 FROM channel_members vm WHERE vm.channel_id = vc.room_id AND vm.user_id = ${viewerId})))
      OR EXISTS (
        SELECT 1 FROM conversation_members vv
        WHERE vv.conversation_id = ${roomId} AND vv.user_id = ${viewerId})))`;
}

/** このメッセージの部屋を、この閲覧者がいま見てよいか。messageId は値か、外側の列を入れ子の SQL（sql`${表.列}`）で渡す */
export function messageViewableBy(
  messageId: SQLWrapper,
  viewerId: string,
): SQL {
  return sql`EXISTS (SELECT 1 FROM messages vmsg
    WHERE vmsg.id = ${messageId} AND ${roomViewableBy(sql`vmsg.room_id`, viewerId)})`;
}

/**
 * 一覧・検索に DM の部屋を含めてよいか。includeDirect が偽（perm.dm.message.view がない）なら、DM でない部屋だけが真。
 * 取得の後に除くとページの件数とカーソルがずれるため、SQL の条件で除く（案件の部屋の caseRoomListable と同じ作り）
 */
export function directRoomListable(
  roomId: SQLWrapper,
  includeDirect: boolean,
): SQL {
  if (includeDirect) return sql`1 = 1`;
  return sql`NOT EXISTS (SELECT 1 FROM conversation_members dv WHERE dv.conversation_id = ${roomId})`;
}
