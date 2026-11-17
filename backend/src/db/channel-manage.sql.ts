// チャンネルの管理（#143。名前・説明の変更、アーカイブ・復元）の書き込みの文。
// 1つの db.batch の順：(0) 前提の確認 → (1) 監査 → (2) 通知・アーカイブの記録 → (3) チャンネルの UPDATE。
// 前提の確認（#196 の方式）は channels.version を「そのままか NULL」にする UPDATE で、条件が崩れていれば NOT NULL 違反で batch 全体を取り消す。
// 条件は Service の最初の判定のうち DB の行で決まるもの（状態・種類・操作者が有効・管理できる人・版・宛先の集合）をすべて含む。再認証は DB の行でないので入れない。
// 監査・通知・記録の文にも同じ条件を付ける：チャンネルの行が消えた場合、先頭の UPDATE は0行で失敗しないため、それらだけが残るのを防ぐ。
import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import { channelArchiveEvents, channels } from "../../db/schema";
import { ROLE_IDS } from "../lib/permissions";
import { auditLogInsert } from "./audit-log.repository";
import type { Database } from "./database";
import { notificationInserts } from "./notification.repository";

/**
 * 操作者が有効で、チャンネル（別名 c）を管理できる人であること：会社範囲の全体管理者か、チャンネルの部署のオーナー。
 * 会社直属（department_id が NULL）は全体管理者だけ。resolvePermissions の perm.channel.edit・perm.channel.delete と同じ規則を SQL で書いたもの（二重定義）。
 * 全組の一致は channel-manage.db.test.ts で固定している。部署の有効性は見ない（D-3）
 */
export function channelManagerSql(actorId: string): SQL {
  return sql`EXISTS (SELECT 1 FROM users a WHERE a.id = ${actorId} AND a.is_active = 1)
    AND EXISTS (SELECT 1 FROM user_role_assignments r
      WHERE r.user_id = ${actorId}
        AND ((r.role_id = ${ROLE_IDS.globalAdmin} AND r.scope_type = 'company')
          OR (r.role_id = ${ROLE_IDS.owner} AND r.scope_type = 'department'
            AND c.department_id IS NOT NULL AND r.department_id = c.department_id)))`;
}

/** 宛先（有効な参加者で操作者以外）が、読んだ集合と同じであること */
function recipientsUnchanged(
  roomId: string,
  actorId: string,
  recipientIds: readonly string[],
): SQL {
  const current = sql`FROM channel_members m JOIN users u ON u.id = m.user_id
    WHERE m.channel_id = ${roomId} AND u.is_active = 1 AND m.user_id <> ${actorId}`;
  const total = sql`(SELECT COUNT(*) ${current}) = ${recipientIds.length}`;
  if (recipientIds.length === 0) return total;
  return sql`${total} AND (SELECT COUNT(*) ${current} AND m.user_id IN (${sql.join(
    recipientIds.map((id) => sql`${id}`),
    sql`, `,
  )})) = ${recipientIds.length}`;
}

/** チャンネル（別名 c）の行があり、版が一致し、状態・種類の条件と管理できる人の条件を満たすこと */
function channelMatches(
  input: { roomId: string; actorId: string; version: number },
  state: SQL,
): SQL {
  return sql`EXISTS (SELECT 1 FROM channels c
    WHERE c.room_id = ${input.roomId} AND c.version = ${input.version}
      AND ${state} AND ${channelManagerSql(input.actorId)})`;
}

function assertStatement(db: Database, roomId: string, condition: SQL) {
  return db
    .update(channels)
    .set({
      version: sql`CASE WHEN ${condition} THEN ${channels.version} ELSE NULL END`,
    })
    .where(eq(channels.roomId, roomId));
}

export type ChannelUpdateInput = {
  roomId: string;
  actorId: string;
  version: number;
  /** 整形済みの名前 */
  name?: string;
  description?: string;
  traceId: string;
};

export type ChannelArchiveInput = {
  roomId: string;
  actorId: string;
  version: number;
  reason: string | null;
  /** この回のアーカイブの記録の ID（通知の target_id にも使う） */
  eventId: string;
  recipientIds: readonly string[];
  traceId: string;
};

export type ChannelRestoreInput = {
  roomId: string;
  actorId: string;
  version: number;
  /** 開いているアーカイブの記録の ID（通知の target_id にも使う） */
  eventId: string;
  recipientIds: readonly string[];
  traceId: string;
};

/** 名前・説明の変更：前提の確認 → 監査 → UPDATE（変えた行を返す）。通知はしない（2-6 AC-5③） */
export function channelUpdateStatements(
  db: Database,
  input: ChannelUpdateInput & { nameKey?: string; now: string },
) {
  // 名前を変えられるのは通常のチャンネルだけ。説明だけなら案件専用以外（D-2）
  const state =
    input.name === undefined
      ? sql`c.deleted_at IS NULL AND c.purpose <> 'case'`
      : sql`c.deleted_at IS NULL AND c.purpose = 'normal'`;
  const condition = channelMatches(input, state);
  const fields = [
    ...(input.name === undefined ? [] : ["name"]),
    ...(input.description === undefined ? [] : ["description"]),
  ];
  return [
    assertStatement(db, input.roomId, condition),
    auditLogInsert(
      db,
      {
        actorId: input.actorId,
        action: "channel.update",
        targetType: "channel",
        targetId: input.roomId,
        result: "success",
        traceId: input.traceId,
        detail: { fields: fields.join(",") },
      },
      { onlyWhen: condition },
    ),
    db
      .update(channels)
      .set({
        ...(input.name === undefined
          ? {}
          : { name: input.name, nameNormalized: input.nameKey }),
        ...(input.description === undefined
          ? {}
          : { description: input.description }),
        version: sql`${channels.version} + 1`,
        updatedAt: input.now,
      })
      .where(and(eq(channels.roomId, input.roomId), condition))
      .returning({
        id: channels.roomId,
        name: channels.name,
        description: channels.description,
        version: channels.version,
        updatedAt: channels.updatedAt,
      }),
  ] as const;
}

/** アーカイブ：前提の確認 → 監査 → 通知 → 記録 → UPDATE（変えた行を返す） */
export function channelArchiveStatements(
  db: Database,
  input: ChannelArchiveInput & { now: string },
) {
  const state = sql`c.deleted_at IS NULL AND c.purpose = 'normal'`;
  const condition = channelMatches(input, state);
  const prerequisite = sql`${condition} AND ${recipientsUnchanged(input.roomId, input.actorId, input.recipientIds)}`;
  return [
    assertStatement(db, input.roomId, prerequisite),
    auditLogInsert(
      db,
      {
        actorId: input.actorId,
        action: "channel.archive",
        targetType: "channel",
        targetId: input.roomId,
        result: "success",
        traceId: input.traceId,
        // 理由の文は入れない（自由な文を監査に残さない）
        detail: { hasReason: input.reason !== null },
      },
      { onlyWhen: condition },
    ),
    ...notificationInserts(
      db,
      input.recipientIds,
      {
        kind: "channel.archived",
        roomId: input.roomId,
        targetId: input.eventId,
      },
      { onlyWhen: condition },
    ),
    db.insert(channelArchiveEvents).select(sql`
      SELECT ${input.eventId}, ${input.roomId}, ${input.actorId}, ${input.now}, ${input.reason}, NULL, NULL
      WHERE ${condition}`),
    db
      .update(channels)
      .set({
        deletedAt: input.now,
        deletedBy: input.actorId,
        version: sql`${channels.version} + 1`,
        updatedAt: input.now,
      })
      .where(and(eq(channels.roomId, input.roomId), condition))
      .returning({ id: channels.roomId, version: channels.version }),
  ] as const;
}

/** 復元：前提の確認 → 監査 → 通知 → 記録を閉じる → UPDATE（変えた行を返す） */
export function channelRestoreStatements(
  db: Database,
  input: ChannelRestoreInput & { now: string },
) {
  const state = sql`c.deleted_at IS NOT NULL AND c.purpose = 'normal'`;
  const condition = channelMatches(input, state);
  const eventOpen = sql`EXISTS (SELECT 1 FROM channel_archive_events e
    WHERE e.id = ${input.eventId} AND e.channel_id = ${input.roomId} AND e.restored_at IS NULL)`;
  const prerequisite = sql`${condition} AND ${eventOpen} AND ${recipientsUnchanged(input.roomId, input.actorId, input.recipientIds)}`;
  return [
    assertStatement(db, input.roomId, prerequisite),
    auditLogInsert(
      db,
      {
        actorId: input.actorId,
        action: "channel.restore",
        targetType: "channel",
        targetId: input.roomId,
        result: "success",
        traceId: input.traceId,
      },
      { onlyWhen: sql`${condition} AND ${eventOpen}` },
    ),
    ...notificationInserts(
      db,
      input.recipientIds,
      {
        kind: "channel.restored",
        roomId: input.roomId,
        targetId: input.eventId,
      },
      { onlyWhen: sql`${condition} AND ${eventOpen}` },
    ),
    // 記録は消さずに閉じる（その回の理由を、古い通知のために残す）。UPDATE より前に置く（後ろだと状態の条件が偽になる）
    db
      .update(channelArchiveEvents)
      .set({ restoredBy: input.actorId, restoredAt: input.now })
      .where(
        and(
          eq(channelArchiveEvents.id, input.eventId),
          eq(channelArchiveEvents.channelId, input.roomId),
          isNull(channelArchiveEvents.restoredAt),
          condition,
        ),
      ),
    db
      .update(channels)
      .set({
        deletedAt: null,
        deletedBy: null,
        version: sql`${channels.version} + 1`,
        updatedAt: input.now,
      })
      .where(and(eq(channels.roomId, input.roomId), condition))
      .returning({ id: channels.roomId, version: channels.version }),
  ] as const;
}
