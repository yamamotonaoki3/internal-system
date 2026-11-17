// #146（146-A）のテストで使う、案件の作成申請（case_creation_requests）の架空のテストデータの作成・読み取り・後始末（識別子で消す）。
// 利用者は testuser_casereq_ で始め、部署名・取引先名は [UNIT_TEST] で始める。取引先のコードは英大文字3文字（QZ で始める）。
// 表の形は計画 A-1：
//   case_creation_requests：id・client_id・title・description・due_date・requested_by・status・version・decided_by・decision_reason・
//     case_id・resubmitted_from・requested_at・decided_at
//   case_creation_request_departments：request_id・department_id（PK は2列）
//   case_creation_request_candidates：request_id・user_id・added_by・added_at（PK は request_id・user_id）
// 全体管理者は DB 全体で1人（user_role_assignments_global_admin_unique）のため、世界には全体管理者を1人だけ置く。
import { env } from "cloudflare:workers";
import { createUlidFactory } from "../src/lib/ulid";
import { AUTH_TRACE_PREFIX, cleanupAuthTestData } from "./auth-fixtures";
import { insertActor, sessionFor } from "./channel-request-fixtures";
import {
  TEST_TAG,
  cleanupDepartmentTestData,
  insertDepartmentWithChannels,
  joinDepartmentChannels,
  makeGlobalAdmin,
  makeOwner,
  type SeededDepartment,
} from "./department-fixtures";
import { cleanupNotificationTestData } from "./notification-fixtures";

export { TEST_TAG };
/** 時刻の固定値。日本時間では 2026-11-17 12:00（「今日」は 2026-11-17） */
export const CASEREQ_NOW = "2026-11-17T03:00:00.000Z";
export const TODAY_JST = "2026-11-17";
export const YESTERDAY_JST = "2026-11-16";
export const TOMORROW_JST = "2026-11-18";
export const BASE = "/api/case-requests";
export const BAD_ORIGIN = "https://origin.invalid";
export const casereqTraceId = () =>
  `${AUTH_TRACE_PREFIX}casereq-${crypto.randomUUID()}`;

/** 期待する文言（計画 A-5・A-6。画面はこの文言をそのまま表示する） */
export const MESSAGES = {
  noDepartment: "所属部署がないため申請できません",
  ineligible: "申請できません",
  recipientsChanged: "審査する人が変わりました。もう一度申請してください",
  decided: "この申請はすでに処理されています",
} as const;

export type CaseRequestStatus =
  "pending" | "approved" | "rejected" | "withdrawn" | "auto_cancelled";

let sequence = 0;
/** 時刻の順に必ず大きくなる、申請の ID（ULID） */
export function caseRequestIdAt(ms: number): string {
  return createUlidFactory({ now: () => ms })();
}
function nextRequestId(): string {
  sequence += 1;
  return caseRequestIdAt(1_800_000_000_000 + sequence * 1_000);
}

let clientSequence = 0;
/** 取引先を1件入れる。code は英大文字3文字。名前は [UNIT_TEST] で始める */
export async function insertClient(
  name: string,
  options: { code?: string; isActive?: boolean } = {},
): Promise<{ id: string; code: string; name: string }> {
  clientSequence += 1;
  const id = caseRequestIdAt(1_700_000_000_000 + clientSequence * 1_000);
  const code =
    options.code ?? `QY${String.fromCharCode(65 + (clientSequence % 26))}`;
  const fullName = `${TEST_TAG}${name}`;
  await env.DB.prepare(
    "INSERT INTO clients (id, code, name, name_normalized, is_active, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)",
  )
    .bind(
      id,
      code,
      fullName,
      fullName.toLowerCase(),
      options.isActive === false ? 0 : 1,
      CASEREQ_NOW,
      CASEREQ_NOW,
    )
    .run();
  return { id, code, name: fullName };
}

export async function setClientActive(id: string, isActive: boolean) {
  await env.DB.prepare("UPDATE clients SET is_active = ? WHERE id = ?")
    .bind(isActive ? 1 : 0, id)
    .run();
}

export type CaseRequestSeed = {
  id?: string;
  clientId: string;
  title: string;
  requestedBy: string;
  departmentIds: string[];
  candidateIds?: string[];
  status?: CaseRequestStatus;
  description?: string;
  dueDate?: string | null;
  version?: number;
  decidedBy?: string | null;
  decisionReason?: string | null;
  caseId?: string | null;
  resubmittedFrom?: string | null;
};

/** 申請の行（と部署・候補）を直接入れる（却下済み・取り下げ済みなど、状態を自由に作るため） */
export async function insertCaseRequest(
  seed: CaseRequestSeed,
): Promise<string> {
  const id = seed.id ?? nextRequestId();
  const status = seed.status ?? "pending";
  const decided = status !== "pending";
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO case_creation_requests (id, client_id, title, description, due_date, requested_by, status, version,
         decided_by, decision_reason, case_id, resubmitted_from, requested_at, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      seed.clientId,
      seed.title,
      seed.description ?? "",
      seed.dueDate ?? null,
      seed.requestedBy,
      status,
      seed.version ?? 1,
      decided ? (seed.decidedBy ?? seed.requestedBy) : null,
      status === "rejected"
        ? (seed.decisionReason ?? "テストの却下理由")
        : null,
      status === "approved"
        ? (seed.caseId ?? "01JTESTCASEREQAPPROVED0001")
        : null,
      seed.resubmittedFrom ?? null,
      CASEREQ_NOW,
      decided ? CASEREQ_NOW : null,
    ),
    ...seed.departmentIds.map((departmentId) =>
      env.DB.prepare(
        "INSERT INTO case_creation_request_departments (request_id, department_id) VALUES (?, ?)",
      ).bind(id, departmentId),
    ),
    ...(seed.candidateIds ?? []).map((userId) =>
      env.DB.prepare(
        "INSERT INTO case_creation_request_candidates (request_id, user_id, added_by, added_at) VALUES (?, ?, ?, ?)",
      ).bind(id, userId, seed.requestedBy, CASEREQ_NOW),
    ),
  ]);
  return id;
}

export type CaseRequestRow = {
  id: string;
  client_id: string;
  title: string;
  description: string;
  due_date: string | null;
  requested_by: string;
  status: CaseRequestStatus | string;
  version: number;
  decided_by: string | null;
  decision_reason: string | null;
  case_id: string | null;
  resubmitted_from: string | null;
  requested_at: string;
  decided_at: string | null;
};

export async function caseRequestRow(id: string) {
  return env.DB.prepare("SELECT * FROM case_creation_requests WHERE id = ?")
    .bind(id)
    .first<CaseRequestRow>();
}

export async function caseRequestRows() {
  const { results } = await env.DB.prepare(
    "SELECT * FROM case_creation_requests ORDER BY id",
  ).all<CaseRequestRow>();
  return results;
}

export async function requestDepartments(requestId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT department_id FROM case_creation_request_departments WHERE request_id = ? ORDER BY department_id",
  )
    .bind(requestId)
    .all<{ department_id: string }>();
  return results.map((r) => r.department_id);
}

export async function requestCandidates(requestId: string) {
  const { results } = await env.DB.prepare(
    "SELECT user_id, added_by FROM case_creation_request_candidates WHERE request_id = ? ORDER BY user_id",
  )
    .bind(requestId)
    .all<{ user_id: string; added_by: string }>();
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

/** 申請の操作の監査ログ（case_request.*） */
export async function caseRequestAudits() {
  const { results } = await env.DB.prepare(
    "SELECT actor_id, action, target_type, target_id, result, detail FROM audit_logs WHERE action LIKE 'case_request.%' ORDER BY occurred_at, id",
  ).all<AuditRow>();
  return results;
}

/** detail の JSON のキーの集合（null・空文字は空の集合） */
export function detailKeys(detail: string | null): string[] {
  if (detail === null || detail === "") return [];
  const parsed: unknown = JSON.parse(detail);
  if (parsed === null || typeof parsed !== "object") return [];
  return Object.keys(parsed).sort();
}

export type CaseRequestNotification = {
  user_id: string;
  kind: string;
  room_id: string | null;
  message_id: string | null;
  target_id: string | null;
};

/** 申請の通知（case_request.*）。宛先の順 */
export async function caseRequestNotifications() {
  const { results } = await env.DB.prepare(
    "SELECT user_id, kind, room_id, message_id, target_id FROM notifications WHERE kind LIKE 'case_request.%' ORDER BY user_id, kind",
  ).all<CaseRequestNotification>();
  return results;
}

/**
 * 取り消しの確認用：申請・部署・候補・チャンネル・申請の監査・申請の通知の全体の状態。
 * 失敗した操作のあとで、操作の前と完全に同じであることを toEqual で確かめる。
 */
export async function caseRequestSnapshot() {
  const all = async (sql: string) =>
    (await env.DB.prepare(sql).all<Record<string, unknown>>()).results;
  return {
    requests: await all(
      "SELECT id, client_id, title, status, version, decided_by, decided_at, case_id, resubmitted_from FROM case_creation_requests ORDER BY id",
    ),
    departments: await all(
      "SELECT request_id, department_id FROM case_creation_request_departments ORDER BY request_id, department_id",
    ),
    candidates: await all(
      "SELECT request_id, user_id FROM case_creation_request_candidates ORDER BY request_id, user_id",
    ),
    rooms: await all("SELECT id, kind FROM rooms ORDER BY id"),
    channels: await all(
      "SELECT room_id, purpose FROM channels ORDER BY room_id",
    ),
    audits: await all(
      "SELECT action, target_id FROM audit_logs WHERE action LIKE 'case_request.%' ORDER BY id",
    ),
    notifications: await all(
      "SELECT user_id, kind, target_id FROM notifications ORDER BY id",
    ),
  };
}

// ---- 失敗を起こすトリガー（同じ db.batch の取り消しを確かめる） ----

const TRIGGERS = ["unit_146_fail_audit", "unit_146_fail_notification"] as const;

export async function failAuditOf(action: string) {
  await env.DB.exec(
    `CREATE TRIGGER ${TRIGGERS[0]} BEFORE INSERT ON audit_logs WHEN NEW.action = '${action}' BEGIN SELECT RAISE(ABORT, 'unit_146_fail_audit'); END`,
  );
}

export async function failNotificationInsert() {
  await env.DB.exec(
    `CREATE TRIGGER ${TRIGGERS[1]} BEFORE INSERT ON notifications WHEN NEW.kind LIKE 'case_request.%' BEGIN SELECT RAISE(ABORT, 'unit_146_fail_notification'); END`,
  );
}

// ---- 世界（部署・利用者・取引先） ----

export type Actor = { id: string; token: string };

async function actor(
  loginId: string,
  departmentId: string | null,
): Promise<Actor> {
  const id = await insertActor(loginId, departmentId);
  return { id, token: await sessionFor(id, null) };
}

/**
 * 部署 3 つと利用者・取引先の世界。
 * - deptS（営業）：オーナー ownerS、メンバー memberS1・memberS2
 * - deptD（開発）：オーナー ownerD、メンバー memberD1
 * - deptH（本部）：オーナー ownerH、全体管理者 admin（所属は deptH。オーナーではない）
 * - noDept：所属のない一般社員。inactive：無効な社員（所属 deptS）
 * - clientA・clientB：有効な取引先、clientOff：無効な取引先
 * 全体管理者は admin の 1 人だけ。
 */
export async function setupCaseWorld() {
  const deptS = await insertDepartmentWithChannels("casereq営業");
  const deptD = await insertDepartmentWithChannels("casereq開発");
  const deptH = await insertDepartmentWithChannels("casereq本部");
  const ownerS = await actor("testuser_casereq_owner_s", deptS.id);
  const memberS1 = await actor("testuser_casereq_s1", deptS.id);
  const memberS2 = await actor("testuser_casereq_s2", deptS.id);
  const ownerD = await actor("testuser_casereq_owner_d", deptD.id);
  const memberD1 = await actor("testuser_casereq_d1", deptD.id);
  const ownerH = await actor("testuser_casereq_owner_h", deptH.id);
  const admin = await actor("testuser_casereq_admin", deptH.id);
  const noDept = await actor("testuser_casereq_nodept", null);
  const inactive = await actor("testuser_casereq_inactive", deptS.id);
  await env.DB.prepare(
    "UPDATE users SET is_active = 0, deactivated_at = ? WHERE id = ?",
  )
    .bind(CASEREQ_NOW, inactive.id)
    .run();
  await makeOwner(ownerS.id, deptS.id);
  await makeOwner(ownerD.id, deptD.id);
  await makeOwner(ownerH.id, deptH.id);
  await makeGlobalAdmin(admin.id);
  const join = async (dept: SeededDepartment, users: Actor[]) => {
    for (const user of users) await joinDepartmentChannels(dept, user.id);
  };
  await join(deptS, [ownerS, memberS1, memberS2]);
  await join(deptD, [ownerD, memberD1]);
  await join(deptH, [ownerH, admin]);
  const clientA = await insertClient("テスト商事A", { code: "QZA" });
  const clientB = await insertClient("テスト商事B", { code: "QZB" });
  const clientOff = await insertClient("テスト商事無効", {
    code: "QZX",
    isActive: false,
  });
  return {
    deptS,
    deptD,
    deptH,
    ownerS,
    memberS1,
    memberS2,
    ownerD,
    memberD1,
    ownerH,
    admin,
    noDept,
    inactive,
    clientA,
    clientB,
    clientOff,
  };
}

export type CaseWorld = Awaited<ReturnType<typeof setupCaseWorld>>;

/** 部署のオーナーの割り当てを外す（交代・不在を作るため） */
export async function removeOwner(userId: string, departmentId: string) {
  await env.DB.prepare(
    "DELETE FROM user_role_assignments WHERE user_id = ? AND role_id = 'role_owner' AND department_id = ?",
  )
    .bind(userId, departmentId)
    .run();
}

export async function setUserActive(userId: string, isActive: boolean) {
  await env.DB.prepare(
    "UPDATE users SET is_active = ?, deactivated_at = ? WHERE id = ?",
  )
    .bind(isActive ? 1 : 0, isActive ? null : CASEREQ_NOW, userId)
    .run();
}

export async function setUserDepartment(
  userId: string,
  departmentId: string | null,
) {
  await env.DB.prepare("UPDATE users SET department_id = ? WHERE id = ?")
    .bind(departmentId, userId)
    .run();
}

export async function setDepartmentActive(id: string, isActive: boolean) {
  await env.DB.prepare("UPDATE departments SET is_active = ? WHERE id = ?")
    .bind(isActive ? 1 : 0, id)
    .run();
}

export async function removeGlobalAdmin(userId: string) {
  await env.DB.prepare(
    "DELETE FROM user_role_assignments WHERE user_id = ? AND role_id = 'role_global_admin'",
  )
    .bind(userId)
    .run();
}

// ---- 後始末 ----

async function tableExists(name: string): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?",
  )
    .bind(name)
    .first<{ n: number }>();
  return (row?.n ?? 0) > 0;
}

/**
 * このテストのデータだけを消す。外部キーの順：トリガー → 通知 → 候補 → 申請の部署 → 申請（再申請の自己参照を先に外す）→
 * 申請の監査 → 取引先（[UNIT_TEST]）→ セッション・監査（cleanupAuthTestData）→ 部署・チャンネル・ロール・利用者（cleanupDepartmentTestData）。
 * 表がまだない（実装前）ときは、申請の表には触れない。
 */
export async function cleanupCaseRequestTestData() {
  for (const name of TRIGGERS)
    await env.DB.exec(`DROP TRIGGER IF EXISTS ${name}`);
  const testUsers =
    "SELECT id FROM users WHERE login_id LIKE 'testuser!_%' ESCAPE '!' OR login_id LIKE 'e2euser!_%' ESCAPE '!'";
  await cleanupNotificationTestData();
  if (await tableExists("case_creation_requests")) {
    const mine = `SELECT id FROM case_creation_requests WHERE requested_by IN (${testUsers}) OR client_id IN (SELECT id FROM clients WHERE name LIKE ?1)`;
    await env.DB.batch([
      env.DB.prepare(
        `DELETE FROM case_creation_request_candidates WHERE request_id IN (${mine}) OR user_id IN (${testUsers})`,
      ).bind(`${TEST_TAG}%`),
      env.DB.prepare(
        `DELETE FROM case_creation_request_departments WHERE request_id IN (${mine})`,
      ).bind(`${TEST_TAG}%`),
      env.DB.prepare(
        `UPDATE case_creation_requests SET resubmitted_from = NULL WHERE id IN (${mine})`,
      ).bind(`${TEST_TAG}%`),
      env.DB.prepare(
        `DELETE FROM case_creation_requests WHERE id IN (${mine})`,
      ).bind(`${TEST_TAG}%`),
    ]);
  }
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM audit_logs WHERE action LIKE 'case_request.%' AND (trace_id LIKE ? OR actor_id IN (${testUsers}))`,
    ).bind(`${AUTH_TRACE_PREFIX}%`),
    env.DB.prepare("DELETE FROM clients WHERE name LIKE ?").bind(
      `${TEST_TAG}%`,
    ),
  ]);
  await cleanupAuthTestData();
  await cleanupDepartmentTestData();
}
