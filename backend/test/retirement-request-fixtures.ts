// #128（128-c）退職処理の申請のテストで使う、架空のテストデータの作成・読み取り・後始末（識別子で消す。C-05）。
// 表 retirement_requests（計画 5.1）：id・target_user_id・requested_by・department_id・status（pending／approved／rejected／withdrawn）・
//   decision_reason・decided_by・decided_at・created_at・updated_at。部分一意索引 target_user_id WHERE status='pending'。
// 表がまだない（migration の前）ときも後始末が他のテストを壊さないよう、表の有無を確かめてから消す。
import { env } from "cloudflare:workers";
import { AUTH_TRACE_PREFIX } from "./auth-fixtures";
import { testId } from "./role-fixtures";

export const RETIRE_NOW = "2026-11-17T03:00:00.000Z";
export const RETIRE_LATER = "2026-11-17T04:00:00.000Z";

const TEST_USERS =
  "SELECT id FROM users WHERE login_id LIKE 'testuser!_%' ESCAPE '!' OR login_id LIKE 'e2euser!_%' ESCAPE '!'";

export type RetirementSeed = {
  id?: string;
  targetUserId: string;
  requestedBy: string;
  departmentId: string;
  status?: "pending" | "approved" | "rejected" | "withdrawn";
  decisionReason?: string | null;
  decidedBy?: string | null;
  decidedAt?: string | null;
  createdAt?: string;
};

/** 申請の行を直接入れる（Repository を通さない前提の準備用） */
export async function insertRetirementRequest(
  seed: RetirementSeed,
): Promise<string> {
  const id = seed.id ?? testId("RETIRE");
  const status = seed.status ?? "pending";
  const decided = status !== "pending";
  await env.DB.prepare(
    `INSERT INTO retirement_requests (id, target_user_id, requested_by, department_id, status, decision_reason,
       decided_by, decided_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      seed.targetUserId,
      seed.requestedBy,
      seed.departmentId,
      status,
      seed.decisionReason ??
        (status === "rejected" ? "[UNIT_TEST]却下の理由" : null),
      seed.decidedBy ?? (decided ? seed.requestedBy : null),
      seed.decidedAt ?? (decided ? RETIRE_NOW : null),
      seed.createdAt ?? RETIRE_NOW,
      seed.createdAt ?? RETIRE_NOW,
    )
    .run();
  return id;
}

export type RetirementRow = {
  id: string;
  target_user_id: string;
  requested_by: string;
  department_id: string;
  status: string;
  decision_reason: string | null;
  decided_by: string | null;
  decided_at: string | null;
};

export async function retirementRows(): Promise<RetirementRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT id, target_user_id, requested_by, department_id, status, decision_reason, decided_by, decided_at FROM retirement_requests ORDER BY created_at, id",
  ).all<RetirementRow>();
  return results;
}

export async function retirementRow(id: string): Promise<RetirementRow> {
  const row = await env.DB.prepare(
    "SELECT id, target_user_id, requested_by, department_id, status, decision_reason, decided_by, decided_at FROM retirement_requests WHERE id = ?",
  )
    .bind(id)
    .first<RetirementRow>();
  if (row === null) throw new Error("申請がありません");
  return row;
}

export type RetirementNotification = {
  user_id: string;
  kind: string;
  room_id: string | null;
  message_id: string | null;
  target_id: string | null;
};

export async function retirementNotifications(): Promise<
  RetirementNotification[]
> {
  const { results } = await env.DB.prepare(
    "SELECT user_id, kind, room_id, message_id, target_id FROM notifications WHERE kind LIKE 'retirement_request.%' ORDER BY user_id, kind",
  ).all<RetirementNotification>();
  return results;
}

export type RetirementAudit = {
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  result: string;
  detail: string | null;
};

export async function retirementAudits(): Promise<RetirementAudit[]> {
  const { results } = await env.DB.prepare(
    "SELECT actor_id, action, target_type, target_id, result, detail FROM audit_logs WHERE action LIKE 'retirement_request.%' ORDER BY occurred_at, id",
  ).all<RetirementAudit>();
  return results;
}

/** 監査の detail が入れ子でない（値がすべて文字列・数値・真偽・null）ことを確かめるための値の型の一覧 */
export function detailValueTypes(detail: string | null): string[] {
  const parsed = JSON.parse(detail ?? "{}") as Record<string, unknown>;
  return Object.values(parsed).map((v) =>
    v === null ? "null" : Array.isArray(v) ? "array" : typeof v,
  );
}

/** 失敗の後に、操作の前と完全に同じであることを toEqual で確かめるための状態 */
export async function retirementSnapshot() {
  const all = async (sql: string) =>
    (await env.DB.prepare(sql).all<Record<string, unknown>>()).results;
  return {
    requests: await all(
      "SELECT id, target_user_id, requested_by, department_id, status, decision_reason, decided_by, decided_at, updated_at FROM retirement_requests ORDER BY id",
    ),
    users: await all(
      "SELECT id, is_active, deactivated_at, department_id FROM users ORDER BY id",
    ),
    assignments: await all(
      "SELECT user_id, role_id, scope_type, department_id FROM user_role_assignments ORDER BY user_id, role_id",
    ),
    members: await all(
      "SELECT channel_id, user_id FROM channel_members ORDER BY channel_id, user_id",
    ),
    sessions: await all("SELECT id, revoked_at FROM sessions ORDER BY id"),
    notifications: await all(
      "SELECT user_id, kind, target_id FROM notifications ORDER BY id",
    ),
    audits: await all(
      "SELECT action, target_id FROM audit_logs WHERE action LIKE 'retirement_request.%' OR action LIKE 'account.%' ORDER BY id",
    ),
  };
}

async function retirementTableExists(): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'retirement_requests'",
  ).first<{ n: number }>();
  return (row?.n ?? 0) > 0;
}

/**
 * このテストの申請・通知・監査だけを消す（利用者・部署は呼び出し側の cleanupAuthTestData・cleanupDepartmentTestData で消す）。
 * 申請は利用者を外部キーで指すため、利用者より先に呼ぶ。
 */
export async function cleanupRetirementRequestTestData() {
  await env.DB.exec("DROP TRIGGER IF EXISTS unit_fail_128c_notification");
  const hasTable = await retirementTableExists();
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM notifications WHERE kind LIKE 'retirement_request.%' AND user_id IN (${TEST_USERS})`,
    ),
    ...(hasTable
      ? [
          env.DB.prepare(
            `DELETE FROM retirement_requests WHERE requested_by IN (${TEST_USERS}) OR target_user_id IN (${TEST_USERS})`,
          ),
        ]
      : []),
    env.DB.prepare(
      `DELETE FROM audit_logs WHERE action LIKE 'retirement_request.%' AND (trace_id LIKE ? OR actor_id IN (${TEST_USERS}))`,
    ).bind(`${AUTH_TRACE_PREFIX}%`),
  ]);
}
