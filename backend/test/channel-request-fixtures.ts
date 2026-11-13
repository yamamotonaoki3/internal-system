// #131 のテストで使う、チャンネルの作成申請（channel_creation_requests）の架空のテストデータの作成・読み取り・後始末（識別子で消す）。
// 利用者は testuser_chreq_ で始め、部署名は [UNIT_TEST] で始める（department-fixtures を使う）。
// チャンネル名は使える文字の規則（2-2 AC-13：[ ] は使えない）に合わせ、UNIT_TEST_ で始める。後始末はこの接頭辞と、テストの利用者の申請で消す。
// 表の形は計画「DB」の channel_creation_requests：id・department_id・name・name_normalized・description・visibility・requested_by・status・version・
// decided_by・decision_reason・channel_id・requested_at・decided_at。
// 全体管理者は 1 人で確定している（2-1 AC-10・data-model O-7）ため、世界には全体管理者を 1 人だけ置く。
import { env } from "cloudflare:workers";
import { createUlidFactory } from "../src/lib/ulid";
import {
  AUTH_TRACE_PREFIX,
  cleanupAuthTestData,
  insertSession,
} from "./auth-fixtures";
import {
  cleanupDepartmentTestData,
  insertDepartmentWithChannels,
  joinDepartmentChannels,
  makeGlobalAdmin,
  makeOwner,
  type SeededDepartment,
} from "./department-fixtures";
import { cleanupNotificationTestData } from "./notification-fixtures";
import { cleanupReadPositions } from "./read-position-fixtures";
import { insertUser } from "./role-fixtures";

export const CHREQ_NOW = "2026-11-12T00:00:00.000Z";
/** チャンネル名の接頭辞（使える文字だけ） */
export const NAME_PREFIX = "UNIT_TEST_";
export const BAD_ORIGIN = "https://origin.invalid";
export const BASE = "/api/channel-requests";

/** 期待する文言（計画「名前の重複判定」「batch」・利用者決定 B。画面はこの文言をそのまま表示する） */
export const MESSAGES = {
  decided: "この申請はすでに処理されています",
  nameTakenOnApprove:
    "同じ名前のチャンネルがあるため承認できません。却下してください",
  departmentInactive: "部署が無効のため承認できません",
} as const;

export type RequestStatus = "pending" | "approved" | "rejected" | "withdrawn";

let sequence = 0;
/** 時刻の順に必ず大きくなる、申請の ID（ULID） */
export function requestIdAt(ms: number): string {
  return createUlidFactory({ now: () => ms })();
}
function nextRequestId(): string {
  sequence += 1;
  return requestIdAt(1_800_000_000_000 + sequence * 1_000);
}

export type RequestSeed = {
  id?: string;
  departmentId: string | null;
  name: string;
  requestedBy: string;
  status?: RequestStatus;
  visibility?: "public" | "private";
  description?: string;
  version?: number;
  decidedBy?: string | null;
  decisionReason?: string | null;
  channelId?: string | null;
};

/** 申請の行を直接入れる（決裁済み・取り下げ済みなど、状態を自由に作るため）。名前は呼び出し側で接頭辞を付ける */
export async function insertChannelRequest(seed: RequestSeed): Promise<string> {
  const id = seed.id ?? nextRequestId();
  const status = seed.status ?? "pending";
  const decided = status !== "pending";
  await env.DB.prepare(
    `INSERT INTO channel_creation_requests (id, department_id, name, name_normalized, description, visibility, requested_by,
       status, version, decided_by, decision_reason, channel_id, requested_at, decided_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      seed.departmentId,
      seed.name,
      seed.name.trim().toLowerCase(),
      seed.description ?? "",
      seed.visibility ?? "public",
      seed.requestedBy,
      status,
      seed.version ?? 1,
      decided ? (seed.decidedBy ?? seed.requestedBy) : null,
      status === "rejected"
        ? (seed.decisionReason ?? "テストの却下理由")
        : null,
      status === "approved"
        ? (seed.channelId ?? "01JTESTCHREQAPPROVEDROOM01")
        : null,
      CHREQ_NOW,
      decided ? CHREQ_NOW : null,
    )
    .run();
  return id;
}

export type RequestRow = {
  id: string;
  department_id: string | null;
  name: string;
  name_normalized: string;
  description: string;
  visibility: string;
  requested_by: string;
  status: RequestStatus;
  version: number;
  decided_by: string | null;
  decision_reason: string | null;
  channel_id: string | null;
  requested_at: string;
  decided_at: string | null;
};

export async function requestRow(id: string) {
  return env.DB.prepare("SELECT * FROM channel_creation_requests WHERE id = ?")
    .bind(id)
    .first<RequestRow>();
}

export async function requestRows() {
  const { results } = await env.DB.prepare(
    "SELECT * FROM channel_creation_requests ORDER BY id",
  ).all<RequestRow>();
  return results;
}

export type AuditRow = {
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  result: string;
  detail: string | null;
};

/** 申請の操作の監査ログ（channel_request.*） */
export async function requestAudits() {
  const { results } = await env.DB.prepare(
    "SELECT actor_id, action, target_type, target_id, result, detail FROM audit_logs WHERE action LIKE 'channel_request.%' ORDER BY occurred_at, id",
  ).all<AuditRow>();
  return results;
}

/** 申請・承認以外の操作（channel.join など）の監査ログ。承認で増えないことを確かめる */
export async function otherAudits() {
  const { results } = await env.DB.prepare(
    "SELECT action, target_id FROM audit_logs WHERE action NOT LIKE 'channel_request.%' AND action NOT LIKE 'auth.%' ORDER BY id",
  ).all<{ action: string; target_id: string | null }>();
  return results;
}

/** detail の JSON のキーの集合（null・空文字は空の集合） */
export function detailKeys(detail: string | null): string[] {
  if (detail === null || detail === "") return [];
  const parsed: unknown = JSON.parse(detail);
  if (parsed === null || typeof parsed !== "object") return [];
  return Object.keys(parsed).sort();
}

export type RequestNotification = {
  user_id: string;
  kind: string;
  room_id: string | null;
  message_id: string | null;
  target_id: string | null;
};

/** 申請の通知（channel_request.*）。宛先・種類の順 */
export async function requestNotifications() {
  const { results } = await env.DB.prepare(
    "SELECT user_id, kind, room_id, message_id, target_id FROM notifications WHERE kind LIKE 'channel_request.%' ORDER BY user_id, kind",
  ).all<RequestNotification>();
  return results;
}

/** 通知の表の全列（個人情報・本文を持たないことを確かめる） */
export async function requestNotificationColumns(): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT name FROM pragma_table_info('notifications') ORDER BY name",
  ).all<{ name: string }>();
  return results.map((r) => r.name);
}

export type ChannelRow = {
  room_id: string;
  department_id: string | null;
  name: string;
  name_normalized: string;
  description: string;
  visibility: string;
  purpose: string;
  created_by: string | null;
  deleted_at: string | null;
};

export async function channelRow(roomId: string) {
  return env.DB.prepare(
    "SELECT room_id, department_id, name, name_normalized, description, visibility, purpose, created_by, deleted_at FROM channels WHERE room_id = ?",
  )
    .bind(roomId)
    .first<ChannelRow>();
}

export async function membersOfChannel(channelId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT user_id FROM channel_members WHERE channel_id = ? ORDER BY user_id",
  )
    .bind(channelId)
    .all<{ user_id: string }>();
  return results.map((r) => r.user_id);
}

export async function departmentVersion(id: string): Promise<number | null> {
  const row = await env.DB.prepare(
    "SELECT version FROM departments WHERE id = ?",
  )
    .bind(id)
    .first<{ version: number }>();
  return row?.version ?? null;
}

/**
 * 取り消しの確認用：申請・ルーム・チャンネル・参加・ロール・部署・申請の監査・申請の通知の全体の状態。
 * 失敗した操作のあとで、操作の前と完全に同じであることを toEqual で確かめる。
 */
export async function requestSnapshot() {
  const all = async (sql: string) =>
    (await env.DB.prepare(sql).all<Record<string, unknown>>()).results;
  return {
    requests: await all(
      "SELECT id, status, version, decided_by, decision_reason, channel_id, decided_at FROM channel_creation_requests ORDER BY id",
    ),
    rooms: await all("SELECT id, kind FROM rooms ORDER BY id"),
    channels: await all(
      "SELECT room_id, department_id, name_normalized, purpose, visibility, deleted_at FROM channels ORDER BY room_id",
    ),
    members: await all(
      "SELECT channel_id, user_id FROM channel_members ORDER BY channel_id, user_id",
    ),
    assignments: await all(
      "SELECT user_id, role_id, scope_type, department_id FROM user_role_assignments ORDER BY user_id, role_id, department_id",
    ),
    departments: await all(
      "SELECT id, version, is_active FROM departments ORDER BY id",
    ),
    audits: await all(
      "SELECT action, target_id FROM audit_logs WHERE action LIKE 'channel_request.%' ORDER BY id",
    ),
    notifications: await all(
      "SELECT user_id, kind, target_id FROM notifications ORDER BY id",
    ),
  };
}

// ---- 失敗を起こすトリガー（同じ db.batch の取り消しを確かめる） ----

const TRIGGERS = [
  "unit_131_fail_audit",
  "unit_131_fail_notification",
  "unit_131_fail_member",
] as const;

export async function failAuditOf(action: string) {
  await env.DB.exec(
    `CREATE TRIGGER ${TRIGGERS[0]} BEFORE INSERT ON audit_logs WHEN NEW.action = '${action}' BEGIN SELECT RAISE(ABORT, 'unit_131_fail_audit'); END`,
  );
}

export async function failNotificationInsert() {
  await env.DB.exec(
    `CREATE TRIGGER ${TRIGGERS[1]} BEFORE INSERT ON notifications WHEN NEW.kind LIKE 'channel_request.%' BEGIN SELECT RAISE(ABORT, 'unit_131_fail_notification'); END`,
  );
}

export async function failMemberInsert() {
  await env.DB.exec(
    `CREATE TRIGGER ${TRIGGERS[2]} BEFORE INSERT ON channel_members BEGIN SELECT RAISE(ABORT, 'unit_131_fail_member'); END`,
  );
}

// ---- 利用者・セッション ----

/** 有効で、パスワード変更の要らない利用者を作る */
export async function insertActor(
  loginId: string,
  departmentId: string | null,
): Promise<string> {
  // insertUser は所属を必須にするため、所属なしは作ってから外す
  const placeholder = departmentId ?? (await firstTestDepartment());
  const id = await insertUser(loginId, placeholder);
  await env.DB.prepare(
    "UPDATE users SET must_change_password = 0, department_id = ? WHERE id = ?",
  )
    .bind(departmentId, id)
    .run();
  return id;
}

async function firstTestDepartment(): Promise<string> {
  const row = await env.DB.prepare(
    "SELECT id FROM departments WHERE name LIKE '[UNIT_TEST]%' ORDER BY id LIMIT 1",
  ).first<{ id: string }>();
  if (row === null) throw new Error("テスト用の部署がありません");
  return row.id;
}

/** セッションを作る。reauthAgoMs は再認証からの経過（null は再認証なし） */
export async function sessionFor(
  userId: string,
  reauthAgoMs: number | null = 60_000,
): Promise<string> {
  const now = new Date();
  const session = await insertSession(userId, {
    createdAt: now.toISOString(),
  });
  if (reauthAgoMs !== null)
    await env.DB.prepare(
      "UPDATE sessions SET reauthenticated_at = ? WHERE id = ?",
    )
      .bind(new Date(now.getTime() - reauthAgoMs).toISOString(), session.id)
      .run();
  return session.token;
}

export type Actor = {
  id: string;
  /** 再認証済み（1分前）のセッション */
  token: string;
  /** 再認証していないセッション */
  plain: string;
};

async function actor(
  loginId: string,
  departmentId: string | null,
): Promise<Actor> {
  const id = await insertActor(loginId, departmentId);
  return {
    id,
    token: await sessionFor(id),
    plain: await sessionFor(id, null),
  };
}

/**
 * 部署 3 つと利用者の世界。
 * - deptS（営業）：オーナー ownerS、メンバー memberS1・memberS2
 * - deptD（開発）：オーナーは全体管理者 admin（任命された部署。admin の所属は deptH）、メンバー memberD1
 * - deptH（本部）：オーナー ownerH、メンバー memberH1、全体管理者 admin（オーナーではない）
 * 全体管理者は admin の 1 人だけ。
 */
export async function setupWorld() {
  const deptS = await insertDepartmentWithChannels("chreq営業");
  const deptD = await insertDepartmentWithChannels("chreq開発");
  const deptH = await insertDepartmentWithChannels("chreq本部");
  const ownerS = await actor("testuser_chreq_owner_s", deptS.id);
  const memberS1 = await actor("testuser_chreq_s1", deptS.id);
  const memberS2 = await actor("testuser_chreq_s2", deptS.id);
  const memberD1 = await actor("testuser_chreq_d1", deptD.id);
  const ownerH = await actor("testuser_chreq_owner_h", deptH.id);
  const memberH1 = await actor("testuser_chreq_h1", deptH.id);
  const admin = await actor("testuser_chreq_admin", deptH.id);
  await makeOwner(ownerS.id, deptS.id);
  await makeOwner(admin.id, deptD.id);
  await makeOwner(ownerH.id, deptH.id);
  await makeGlobalAdmin(admin.id);
  const join = async (dept: SeededDepartment, users: Actor[]) => {
    for (const user of users) await joinDepartmentChannels(dept, user.id);
  };
  await join(deptS, [ownerS, memberS1, memberS2]);
  await join(deptD, [memberD1]);
  await join(deptH, [ownerH, memberH1, admin]);
  return {
    deptS,
    deptD,
    deptH,
    ownerS,
    memberS1,
    memberS2,
    memberD1,
    ownerH,
    memberH1,
    admin,
  };
}

export type World = Awaited<ReturnType<typeof setupWorld>>;

// ---- ログ ----

export type LogLine = {
  body?: string;
  trace_id?: string;
  user_id?: string;
  attributes?: Record<string, unknown>;
};

/** console に出た行のうち、監査（log_type: audit）の記録 */
export function auditLogLines(lines: readonly string[]): LogLine[] {
  return lines
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as LogLine)
    .filter((line) => line.attributes?.log_type === "audit");
}

// ---- 後始末 ----

async function requestTableExists(): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'channel_creation_requests'",
  ).first<{ n: number }>();
  return (row?.n ?? 0) > 0;
}

/**
 * このテストのデータだけを消す。外部キーの順：トリガー → メッセージ → 参加 → チャンネル → ルーム → 申請 → 通知 → 監査 →
 * セッション（cleanupAuthTestData）→ 部署・自動専用チャンネル・ロール・利用者（cleanupDepartmentTestData）。
 * 対象：名前が UNIT_TEST_ で始まるチャンネル、testuser_/e2euser_ の利用者の申請とその承認で作られたチャンネル。
 */
export async function cleanupChannelRequestTestData() {
  for (const name of TRIGGERS)
    await env.DB.exec(`DROP TRIGGER IF EXISTS ${name}`);
  const testUsers =
    "SELECT id FROM users WHERE login_id LIKE 'testuser!_%' ESCAPE '!' OR login_id LIKE 'e2euser!_%' ESCAPE '!'";
  const hasTable = await requestTableExists();
  const byRequest = hasTable
    ? ` OR room_id IN (SELECT channel_id FROM channel_creation_requests WHERE channel_id IS NOT NULL AND requested_by IN (${testUsers}))`
    : "";
  const { results } = await env.DB.prepare(
    `SELECT room_id FROM channels WHERE name_normalized LIKE 'unit!_test!_%' ESCAPE '!'${byRequest}`,
  ).all<{ room_id: string }>();
  const roomIds = results.map((r) => r.room_id);
  const inRooms = roomIds.map(() => "?").join(", ");
  // #237：既読位置（read_positions）は承認で作った部屋・利用者を外部キーで指すため、部屋より先に消す
  await cleanupReadPositions();
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM messages WHERE sender_id IN (${testUsers})`),
    ...(roomIds.length === 0
      ? []
      : [
          env.DB.prepare(
            `DELETE FROM channel_members WHERE channel_id IN (${inRooms})`,
          ).bind(...roomIds),
          env.DB.prepare(
            `DELETE FROM channels WHERE room_id IN (${inRooms})`,
          ).bind(...roomIds),
          env.DB.prepare(`DELETE FROM rooms WHERE id IN (${inRooms})`).bind(
            ...roomIds,
          ),
        ]),
    ...(hasTable
      ? [
          env.DB.prepare(
            `DELETE FROM channel_creation_requests WHERE requested_by IN (${testUsers})`,
          ),
        ]
      : []),
    env.DB.prepare(
      `DELETE FROM audit_logs WHERE action LIKE 'channel_request.%' AND (trace_id LIKE ? OR actor_id IN (${testUsers}))`,
    ).bind(`${AUTH_TRACE_PREFIX}%`),
  ]);
  await cleanupNotificationTestData();
  await cleanupAuthTestData();
  await cleanupDepartmentTestData();
}
