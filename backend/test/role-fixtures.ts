// #119 のDBテストで使う、架空のテストデータの作成と後始末（識別子で消す。C-05）。
// 利用者のIDは testuser_ で始まる社員ID、部署名・会社名は [UNIT_TEST] で始まる。値はすべて架空のもの。
import { env } from "cloudflare:workers";

export const TEST_TAG = "[UNIT_TEST]";
// ハッシュ・暗号文の形だけを持つダミー（本物の認証情報・本名ではない）
const DUMMY_PASSWORD_HASH =
  "$scrypt$ln=16,r=8,p=2$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaA";
const DUMMY_LEGAL_NAME = "v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAAAA";
const NOW = "2026-11-03T00:00:00.000Z";

let sequence = 0;
/** ULID と同じ26文字の、テスト用のID（Crockford の Base32 の文字だけ） */
export function testId(prefix: string): string {
  sequence += 1;
  const body = `${prefix}${String(sequence).padStart(6, "0")}`
    .toUpperCase()
    .replace(/[^0-9A-HJKMNP-TV-Z]/g, "X");
  return `01J${body}`.padEnd(26, "0").slice(0, 26);
}

export async function insertDepartment(name: string, id = testId("DEPT")) {
  await env.DB.prepare(
    "INSERT INTO departments (id, name, name_normalized, is_active, created_at) VALUES (?, ?, ?, 1, ?)",
  )
    .bind(id, `${TEST_TAG}${name}`, `${TEST_TAG}${name}`.toLowerCase(), NOW)
    .run();
  return id;
}

export async function insertUser(
  loginId: string,
  departmentId: string,
  options: { isActive?: boolean; id?: string } = {},
) {
  const id = options.id ?? testId("USER");
  const isActive = options.isActive ?? true;
  await env.DB.prepare(
    `INSERT INTO users (id, login_id, login_id_normalized, display_name, legal_name, email, email_normalized,
       email_verified_by, email_verified_at, department_id, extension, job_title, password_hash,
       must_change_password, is_active, deactivated_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 1, ?, ?, ?)`,
  )
    .bind(
      id,
      loginId,
      loginId.toLowerCase(),
      "テスト太郎",
      DUMMY_LEGAL_NAME,
      `${loginId}@example.com`,
      `${loginId}@example.com`.toLowerCase(),
      id,
      NOW,
      departmentId,
      DUMMY_PASSWORD_HASH,
      isActive ? 1 : 0,
      isActive ? null : NOW,
      NOW,
    )
    .run();
  return id;
}

export function assignmentStatement(
  userId: string,
  roleId: string,
  scopeType: string,
  departmentId: string | null,
) {
  return env.DB.prepare(
    "INSERT INTO user_role_assignments (id, user_id, role_id, scope_type, department_id, assigned_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(testId("ASGN"), userId, roleId, scopeType, departmentId, NOW);
}

export async function insertAssignment(
  userId: string,
  roleId: string,
  scopeType: string,
  departmentId: string | null,
) {
  await assignmentStatement(userId, roleId, scopeType, departmentId).run();
}

/** このテストのデータだけを、識別子で消す。外部キーの順（割り当て→利用者→部署） */
export async function cleanupRoleTestData() {
  const testUsers =
    "SELECT id FROM users WHERE login_id LIKE 'testuser!_%' ESCAPE '!' OR login_id LIKE 'e2euser!_%' ESCAPE '!'";
  await env.DB.batch([
    // #200：アカウント発行・セットアップは全社連絡などの channel_members に参加の行を作るため、利用者より先に消す
    env.DB.prepare(
      `DELETE FROM channel_members WHERE user_id IN (${testUsers})`,
    ),
    env.DB.prepare(
      `DELETE FROM user_role_assignments WHERE user_id IN (${testUsers})`,
    ),
    env.DB.prepare(
      "DELETE FROM users WHERE login_id LIKE 'testuser!_%' ESCAPE '!' OR login_id LIKE 'e2euser!_%' ESCAPE '!'",
    ),
    env.DB.prepare("DELETE FROM departments WHERE name LIKE ?").bind(
      `${TEST_TAG}%`,
    ),
    env.DB.prepare(
      "DELETE FROM company_settings WHERE company_name LIKE ?",
    ).bind(`${TEST_TAG}%`),
  ]);
}

export async function countRows(table: string): Promise<number> {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{
    n: number;
  }>();
  if (row === null) throw new Error(`${table} の件数を読めませんでした`);
  return row.n;
}
