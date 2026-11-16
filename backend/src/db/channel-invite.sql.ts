// チャンネルへの招待（#135）の書き込み。監査・通知・参加の3文に同じ条件を付け、同じ db.batch で確定する。
// 条件は Service の最初の判定（閲覧可否・招待の権限・チャンネルの状態・相手の有効性・参加済み）をすべて含む。
// 確認から書き込みまでの間に状態が変わった場合は、3文とも0行になる（監査・通知だけが残ることはない）。
import { sql, type SQL } from "drizzle-orm";
import { channelMembers, notifications } from "../../db/schema";
import { newUlid } from "../lib/ulid";
import { auditLogInsert } from "./audit-log.repository";
import type { Database } from "./database";

export type ChannelInviteInput = {
  roomId: string;
  inviterId: string;
  inviteeId: string;
  traceId: string;
};

/**
 * 招待してよい条件：
 * (a) 未アーカイブ (b) 案件でない (c) 部署がない、または部署が有効
 * (d) 招待者の参加の行がある（公開・非公開とも） (e) 招待者が有効 (f) 相手が有効 (g) 相手が未参加
 */
function invitable(input: ChannelInviteInput): SQL {
  return sql`EXISTS (
      SELECT 1 FROM channels c LEFT JOIN departments d ON d.id = c.department_id
      WHERE c.room_id = ${input.roomId} AND c.deleted_at IS NULL AND c.purpose <> 'case'
        AND (c.department_id IS NULL OR d.is_active = 1))
    AND EXISTS (SELECT 1 FROM channel_members WHERE channel_id = ${input.roomId} AND user_id = ${input.inviterId})
    AND EXISTS (SELECT 1 FROM users WHERE id = ${input.inviterId} AND is_active = 1)
    AND EXISTS (SELECT 1 FROM users WHERE id = ${input.inviteeId} AND is_active = 1)
    AND NOT EXISTS (SELECT 1 FROM channel_members WHERE channel_id = ${input.roomId} AND user_id = ${input.inviteeId})`;
}

/**
 * 監査 → 通知 → 参加の順の3文（参加の挿入の後だと (g) が偽になるため、監査と通知を先に置く）。
 * 最後の文は挿入した参加の joined_at を返す（0行なら空配列）。
 */
export function channelInviteStatements(
  db: Database,
  input: ChannelInviteInput,
) {
  const condition = invitable(input);
  // 通知の行にはチャンネル名を保存しない（表示はチャンネルの ID から引く）
  return [
    auditLogInsert(
      db,
      {
        actorId: input.inviterId,
        action: "channel.invite",
        targetType: "channel",
        targetId: input.roomId,
        result: "success",
        traceId: input.traceId,
        detail: { invitedUserId: input.inviteeId },
      },
      { onlyWhen: condition },
    ),
    db.insert(notifications).select(sql`
      SELECT ${newUlid()}, ${input.inviteeId}, 'channel.invited', ${input.roomId}, NULL, NULL,
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL
      WHERE ${condition}`),
    db
      .insert(channelMembers)
      .select(
        sql`SELECT ${input.roomId}, ${input.inviteeId}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE ${condition}`,
      )
      .returning({ joinedAt: channelMembers.joinedAt }),
  ] as const;
}
