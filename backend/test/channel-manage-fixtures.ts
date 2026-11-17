// #143-a のテストで使う、チャンネルの管理（名前・説明の変更、アーカイブ・復元）の架空のテストデータの作成・読み取り・後始末（識別子で消す）。
// 識別子：利用者は testuser_ で始め、部署名・チャンネル名は [UNIT_TEST] で始める。理由・説明も [UNIT_TEST] を付ける。値はすべて架空のもの。
// 表の形は計画 #143-a「DB の変更」：channel_archive_events(id, channel_id, archived_by, archived_at, reason, restored_by, restored_at)。
//   channel_id は channels.room_id、archived_by・restored_by は users.id を指す（外部キー）。
// このファイルは、まだない本番のコード（管理の Service・Repository）を読み込まない。読み込むと、これを使う既存のテストまで壊れるため。
import { env } from "cloudflare:workers";
import { AUTH_TRACE_PREFIX } from "./auth-fixtures";
import { cleanupAttachmentScenario } from "./attachment-fixtures";
import { TEST_TAG, insertChannel, insertMember } from "./department-fixtures";
import { cleanupNotificationTestData } from "./notification-fixtures";
import { testId } from "./role-fixtures";

export { TEST_TAG };

/** 監査ログの trace_id（cleanupAuthTestData がこの接頭辞で消す） */
export const manageTraceId = () =>
  `${AUTH_TRACE_PREFIX}chman-${crypto.randomUUID()}`;

/** テストで直接作るアーカイブの時刻 */
export const ARCHIVED_AT = "2026-11-15T00:00:00.000Z";

/** 409 の文言（計画 #143-a。要件・計画に書かれた文をそのまま持つ。本番の定数から作らない） */
export const MANAGE_MESSAGES = {
  alreadyProcessed: "この項目はすでに処理されています",
  versionMismatch: "ほかの人が先に変更しました。読み込み直してください",
  retryConflict: "ほかの操作と重なりました。もう一度お試しください",
  duplicateName: "同じ名前のチャンネルがあります",
  notFound: "チャンネルが見つかりません",
} as const;

export const MANAGE_ACTIONS = [
  "channel.update",
  "channel.archive",
  "channel.restore",
] as const;
export const ARCHIVE_KINDS = ["channel.archived", "channel.restored"] as const;

const TEST_USERS =
  "SELECT id FROM users WHERE login_id LIKE 'testuser!_%' ESCAPE '!' OR login_id LIKE 'e2euser!_%' ESCAPE '!'";

// ---- 作成 ----

export type ManagedChannelOptions = {
  departmentId: string | null;
  visibility?: "public" | "private";
  purpose?: "normal" | "case";
  members?: string[];
};

/** [UNIT_TEST] を付けた名前で、チャンネルと参加の行を入れる（既定は公開の通常のチャンネル） */
export async function insertManagedChannel(
  label: string,
  options: ManagedChannelOptions,
): Promise<string> {
  const id = await insertChannel({
    name: `${TEST_TAG}${label}`,
    purpose: options.purpose ?? "normal",
    departmentId: options.departmentId,
    visibility: options.visibility ?? "public",
  });
  for (const member of options.members ?? []) await insertMember(id, member);
  return id;
}

/**
 * アーカイブの結果だけを直接作る（deleted_at・deleted_by・version + 1 と、開いているアーカイブの記録の行）。
 * 記録の行の ID を返す（復元の通知の target_id・前提の確認に使う）。
 */
export async function markArchived(
  roomId: string,
  archivedBy: string,
  reason: string | null = null,
): Promise<string> {
  const eventId = testId("ARCV");
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE channels SET deleted_at = ?, deleted_by = ?, version = version + 1 WHERE room_id = ?",
    ).bind(ARCHIVED_AT, archivedBy, roomId),
    env.DB.prepare(
      "INSERT INTO channel_archive_events (id, channel_id, archived_by, archived_at, reason, restored_by, restored_at) VALUES (?, ?, ?, ?, ?, NULL, NULL)",
    ).bind(eventId, roomId, archivedBy, ARCHIVED_AT, reason),
  ]);
  return eventId;
}

/** チャンネルの版を直接進める（ほかの人の変更を再現する） */
export async function bumpChannelVersion(roomId: string) {
  await env.DB.prepare(
    "UPDATE channels SET version = version + 1 WHERE room_id = ?",
  )
    .bind(roomId)
    .run();
}

// ---- 読み取り ----

export type ManagedChannelRow = {
  name: string;
  name_normalized: string;
  description: string;
  version: number;
  updated_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
};

export async function managedChannelRow(roomId: string) {
  return env.DB.prepare(
    "SELECT name, name_normalized, description, version, updated_at, deleted_at, deleted_by FROM channels WHERE room_id = ?",
  )
    .bind(roomId)
    .first<ManagedChannelRow>();
}

export async function channelVersion(roomId: string): Promise<number> {
  const row = await managedChannelRow(roomId);
  if (row === null) throw new Error("チャンネルの行がありません");
  return row.version;
}

export type ArchiveEventRow = {
  id: string;
  channel_id: string;
  archived_by: string;
  archived_at: string;
  reason: string | null;
  restored_by: string | null;
  restored_at: string | null;
};

/** そのチャンネルのアーカイブの記録（アーカイブの日時・ID の順） */
export async function archiveEvents(roomId: string) {
  const { results } = await env.DB.prepare(
    "SELECT id, channel_id, archived_by, archived_at, reason, restored_by, restored_at FROM channel_archive_events WHERE channel_id = ? ORDER BY archived_at, id",
  )
    .bind(roomId)
    .all<ArchiveEventRow>();
  return results;
}

export type ManageAuditRow = {
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  result: string;
  detail: string | null;
};

/** 管理の監査（channel.update・channel.archive・channel.restore）の行。action を渡すとその種類だけ */
export async function manageAudits(roomId: string, action?: string) {
  const { results } = await (
    action === undefined
      ? env.DB.prepare(
          "SELECT actor_id, action, target_type, target_id, result, detail FROM audit_logs WHERE action IN ('channel.update', 'channel.archive', 'channel.restore') AND target_id = ? ORDER BY occurred_at, id",
        ).bind(roomId)
      : env.DB.prepare(
          "SELECT actor_id, action, target_type, target_id, result, detail FROM audit_logs WHERE action = ? AND target_id = ? ORDER BY occurred_at, id",
        ).bind(action, roomId)
  ).all<ManageAuditRow>();
  return results;
}

export type ArchiveNotificationRow = {
  user_id: string;
  kind: string;
  room_id: string | null;
  message_id: string | null;
  target_id: string | null;
};

/** アーカイブ・復元の通知（宛先の ID の順）。kind を渡すとその種類だけ */
export async function archiveNotifications(roomId: string, kind?: string) {
  const { results } = await (
    kind === undefined
      ? env.DB.prepare(
          "SELECT user_id, kind, room_id, message_id, target_id FROM notifications WHERE kind IN ('channel.archived', 'channel.restored') AND room_id = ? ORDER BY user_id, kind",
        ).bind(roomId)
      : env.DB.prepare(
          "SELECT user_id, kind, room_id, message_id, target_id FROM notifications WHERE kind = ? AND room_id = ? ORDER BY user_id",
        ).bind(kind, roomId)
  ).all<ArchiveNotificationRow>();
  return results;
}

/** チャンネルの管理の結果の全体（何も書かれていないことの比較に使う） */
export async function manageSnapshot(roomId: string) {
  return {
    channel: await managedChannelRow(roomId),
    events: await archiveEvents(roomId),
    audits: await manageAudits(roomId),
    notifications: await archiveNotifications(roomId),
  };
}

// ---- 後始末 ----

/**
 * アーカイブの記録 → 通知 → 管理の監査（テストの利用者のもの）→ 添付・リアクション・スレッド・メッセージ・セッション・チャンネル・部署・利用者の順に消す。
 * アーカイブの記録はチャンネルと利用者を外部キーで指すため、それらより先に消す。途中で失敗しても残りは必ず行う。
 */
export async function cleanupChannelManageScenario() {
  const tagged = `${TEST_TAG}%`;
  try {
    await env.DB.prepare(
      `DELETE FROM channel_archive_events
         WHERE channel_id IN (SELECT room_id FROM channels WHERE department_id IN (SELECT id FROM departments WHERE name LIKE ?1) OR name LIKE ?1)
           OR archived_by IN (${TEST_USERS}) OR restored_by IN (${TEST_USERS})`,
    )
      .bind(tagged)
      .run();
  } finally {
    try {
      await cleanupNotificationTestData();
    } finally {
      try {
        await env.DB.prepare(
          `DELETE FROM audit_logs WHERE action IN ('channel.update', 'channel.archive', 'channel.restore')
             AND (trace_id LIKE ? OR actor_id IN (${TEST_USERS}))`,
        )
          .bind(`${AUTH_TRACE_PREFIX}%`)
          .run();
      } finally {
        await cleanupAttachmentScenario();
      }
    }
  }
}
