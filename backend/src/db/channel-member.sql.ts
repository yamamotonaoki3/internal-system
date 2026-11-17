// 「有効な参加者」の共通の SQL の部品（#147）。参加の行（channel_members）があり、かつ利用者が有効であること。
// 参加の行は退職者の表示・参加者数のために残す記録（C-142(1)）であり、いまの閲覧の資格はこの部品で判定する。
import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { channelMembers } from "../../db/schema";

/** 部屋・利用者は値でも SQL の式（外側の表の列）でも渡せる */
export function activeChannelMember(roomId: SQL, userId: string | SQL): SQL {
  return sql`EXISTS (SELECT 1 FROM channel_members cm
    JOIN users u ON u.id = cm.user_id AND u.is_active = 1
    WHERE cm.channel_id = ${roomId} AND cm.user_id = ${userId})`;
}

/**
 * channel_members を外部結合するときの結合の条件。結合した行があること＝閲覧者が有効な参加者であること（activeChannelMember と同じ規則）。
 * 利用者の有効性は主キーで1行を引く。
 */
export function activeMembershipJoin(roomId: SQLWrapper, userId: string): SQL {
  return sql`${channelMembers.channelId} = ${roomId} AND ${channelMembers.userId} = ${userId}
    AND EXISTS (SELECT 1 FROM users u WHERE u.id = ${userId} AND u.is_active = 1)`;
}
