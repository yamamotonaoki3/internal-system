// #150（150-C）のテストで使う、案件の再編集（EP-5-20 PATCH /api/cases/:caseId）の確認の部品（期待する文言・reason、状態の読み取り、取り消しの確認）。
// 世界は case-request-fixtures.ts の setupCaseWorld、案件は case-fixtures.ts の seedCase を使い、後始末は cleanupCaseTestData に任せる
// （案件・チャンネル・参加の行・担当部署は取引先 [UNIT_TEST] で、通知はテストの利用者で、監査は trace_id の接頭辞で消える）。
// 期待値は計画 150-C（4.2 判定の順・4.4 書き込み）と要件（5-1 AC-20、C-122・C-129・C-130・C-133・C-140）から決める。
// 本番の定数から作らない（誤った定義を見つけられるように）。データは架空（testuser_casereq_・testuser_case150c_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { CASES_BASE } from "./case-fixtures";
import { insertUser } from "./role-fixtures";

/** 計画 150-C 4.2 の文言（画面はこの文言をそのまま出す） */
export const CASE_EDIT_MESSAGES = {
  notFound: "案件が見つかりません",
  cannotEdit:
    "案件を編集できるのは、参加者・担当部署のオーナー・全体管理者だけです",
  descriptionParticipantsOnly: "説明を変更できるのは参加者だけです",
  closed: "終了した案件は変更できません",
  stale:
    "ほかの人が先にこの案件を変更しました。画面を確かめてから、もう一度操作してください",
} as const;

/** 計画 150-C 4.2 の 409 の reason */
export const CASE_EDIT_REASONS = {
  closed: "closed",
  stale: "stale",
  retry: "retry",
} as const;

/** 計画 150-C 4.4 の監査の操作 */
export const CASE_EDIT_ACTION = "case.edit";

export const editPath = (caseId: string) => `${CASES_BASE}/${caseId}`;

export type CaseEditAuditRow = {
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  result: string;
  detail: string | null;
};

/** 再編集の監査（書かれた順） */
export async function caseEditAudits(): Promise<CaseEditAuditRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT actor_id, action, target_type, target_id, result, detail FROM audit_logs
     WHERE action = 'case.edit' ORDER BY occurred_at, id`,
  ).all<CaseEditAuditRow>();
  return results;
}

export type CaseEditRow = {
  case_number: string;
  number_client_id: string;
  client_id: string;
  title: string;
  description: string;
  due_date: string | null;
  status: string;
  version: number;
  updated_at: string;
};

/** 案件の行（再編集で変わる列と、変わらない列） */
export async function caseEditRow(caseId: string): Promise<CaseEditRow> {
  const row = await env.DB.prepare(
    `SELECT case_number, number_client_id, client_id, title, description, due_date, status, version, updated_at
     FROM cases WHERE id = ?`,
  )
    .bind(caseId)
    .first<CaseEditRow>();
  if (row === null) throw new Error(`案件 ${caseId} がありません`);
  return row;
}

/** 案件の担当部署の ID（昇順） */
export async function caseDepartmentIdsOf(caseId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT department_id FROM case_departments WHERE case_id = ? ORDER BY department_id",
  )
    .bind(caseId)
    .all<{ department_id: string }>();
  return results.map((row) => row.department_id);
}

/** 案件の行を直接書き換える（同時の操作の代わり。版は変えない） */
export async function setCaseColumns(
  caseId: string,
  columns: Partial<{
    title: string;
    description: string;
    client_id: string;
    due_date: string | null;
  }>,
) {
  const entries = Object.entries(columns);
  if (entries.length === 0) throw new Error("書き換える列がありません");
  await env.DB.prepare(
    `UPDATE cases SET ${entries.map(([name]) => `${name} = ?`).join(", ")} WHERE id = ?`,
  )
    .bind(...entries.map(([, value]) => value), caseId)
    .run();
}

/**
 * 取り消しの確認用：案件の行（全列）・担当部署・参加の行・再編集と版を進める操作の監査・通知の件数。
 * 失敗した操作の後で、操作の前（または割り込みの直後）と完全に同じであることを確かめる
 */
export async function caseEditSnapshot() {
  const all = async (sql: string) =>
    (await env.DB.prepare(sql).all<Record<string, unknown>>()).results;
  return {
    cases: await all(
      `SELECT id, case_number, number_client_id, client_id, channel_id, title, description, due_date, status, version, updated_at
       FROM cases ORDER BY id`,
    ),
    departments: await all(
      "SELECT case_id, department_id FROM case_departments ORDER BY case_id, department_id",
    ),
    members: await all(
      "SELECT channel_id, user_id, joined_at FROM channel_members WHERE channel_id IN (SELECT channel_id FROM cases) ORDER BY channel_id, user_id",
    ),
    audits: await all(
      `SELECT actor_id, action, target_id, detail FROM audit_logs
       WHERE action IN ('case.edit', 'case.close', 'case.reopen', 'case.participant.add', 'case.participant.remove', 'case.due_date.change')
       ORDER BY occurred_at, id`,
    ),
    notifications: await all(
      "SELECT user_id, kind, target_id FROM notifications ORDER BY id",
    ),
  };
}

/** 通知の件数（再編集は通知しない：C-124・C-140(3)） */
export async function notificationCount(): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM notifications",
  ).first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * 部署を count 件まとめて入れる（D1 の上限の確認用）。名前は [UNIT_TEST]150C部署_ で始める（後始末は cleanupDepartmentTestData）。
 * ID は昇順に並ぶよう、決定的に作る（I・L・O・U を使わない）
 */
export async function insertBulkDepartments(count: number): Promise<string[]> {
  const ids: string[] = [];
  const statements = [];
  for (let i = 0; i < count; i += 1) {
    const id = `01JTESTCASE150CDP${String(i).padStart(9, "0")}`;
    const name = `[UNIT_TEST]150C部署_${String(i).padStart(3, "0")}`;
    statements.push(
      env.DB.prepare(
        `INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
         VALUES (?, ?, ?, 1, '2026-11-17T03:00:00.000Z', '', 1, '2026-11-17T03:00:00.000Z')`,
      ).bind(id, name, name.toLowerCase()),
    );
    ids.push(id);
  }
  for (let i = 0; i < statements.length; i += 50)
    await env.DB.batch(statements.slice(i, i + 50));
  return ids;
}

/** 部署のオーナーをまとめて割り当てる（同じ人を複数の部署のオーナーにしてもよい） */
export async function assignOwners(
  pairs: readonly { userId: string; departmentId: string }[],
) {
  const statements = pairs.map((pair, i) =>
    env.DB.prepare(
      `INSERT INTO user_role_assignments (id, user_id, role_id, scope_type, department_id, assigned_at)
       VALUES (?, ?, 'role_owner', 'department', ?, '2026-11-17T03:00:00.000Z')`,
    ).bind(
      `01JTESTCASE150CRA${String(i).padStart(9, "0")}`,
      pair.userId,
      pair.departmentId,
    ),
  );
  for (let i = 0; i < statements.length; i += 50)
    await env.DB.batch(statements.slice(i, i + 50));
}

/** 有効な一般社員を count 人作る。ログイン ID は testuser_case150c_bulk_ で始める（後始末は cleanupDepartmentTestData） */
export async function insertBulkEditUsers(
  count: number,
  departmentId: string,
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = `01JTESTCASE150CBK${String(i).padStart(9, "0")}`;
    await insertUser(
      `testuser_case150c_bulk_${String(i).padStart(3, "0")}`,
      departmentId,
      { id },
    );
    ids.push(id);
  }
  return ids;
}

/**
 * 部署のオーナーを入れ替える（オーナーは部署ごとに1人：user_role_assignments の一意制約）。
 * いまのオーナーの割り当てを外してから、userId をオーナーにする。外れた人の参加の行には触れない
 */
export async function replaceOwner(userId: string, departmentId: string) {
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM user_role_assignments WHERE role_id = 'role_owner' AND department_id = ?",
    ).bind(departmentId),
    env.DB.prepare(
      `INSERT INTO user_role_assignments (id, user_id, role_id, scope_type, department_id, assigned_at)
       VALUES (?, ?, 'role_owner', 'department', ?, '2026-11-17T03:00:00.000Z')`,
    ).bind(
      `01JTESTCASE150CR0${crypto
        .randomUUID()
        .replace(/[^0-9]/g, "")
        .padEnd(9, "0")
        .slice(0, 9)}`,
      userId,
      departmentId,
    ),
  ]);
}
