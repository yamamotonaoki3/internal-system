// #196 のDBテストで使う、部署・自動専用チャンネル・参加者の架空のテストデータの作成と後始末（識別子で消す。C-05）。
// 部署名・チャンネル名は [UNIT_TEST] で始め、利用者は testuser_dept_ で始める（role-fixtures の insertUser を使う）。
// 表の形は計画 4章の前提：departments(+description・version・updated_at)、rooms、channels、channel_members。
import { env } from "cloudflare:workers";
import { ROLE_IDS } from "../src/lib/permissions";
import { AUTH_TRACE_PREFIX } from "./auth-fixtures";
import { cleanupReadPositions } from "./read-position-fixtures";
import {
  TEST_TAG,
  cleanupRoleTestData,
  insertAssignment,
  testId,
} from "./role-fixtures";

export { TEST_TAG };
export const DEPT_NOW = "2026-11-09T00:00:00.000Z";
/** 監査ログの trace_id。auth-fixtures の cleanupAuthTestData がこの接頭辞で消す */
export const deptTraceId = () =>
  `${AUTH_TRACE_PREFIX}dept-${crypto.randomUUID()}`;

export type ChannelPurpose =
  "normal" | "department" | "announcement" | "company_general" | "case";

/** rooms と channels に1件入れる（名前はそのまま使う。接頭辞は呼び出し側で付ける） */
export async function insertChannel(options: {
  name: string;
  purpose: ChannelPurpose;
  departmentId: string | null;
  visibility?: "public" | "private";
  archived?: boolean;
  id?: string;
}) {
  const id = options.id ?? testId("ROOM");
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO rooms (id, kind, created_at) VALUES (?, 'channel', ?)",
    ).bind(id, DEPT_NOW),
    env.DB.prepare(
      `INSERT INTO channels (room_id, department_id, name, name_normalized, description, visibility, purpose,
         created_by, version, created_at, updated_at, deleted_at, deleted_by)
       VALUES (?, ?, ?, ?, '', ?, ?, NULL, 1, ?, ?, ?, NULL)`,
    ).bind(
      id,
      options.departmentId,
      options.name,
      options.name.trim().toLowerCase(),
      options.visibility ?? "public",
      options.purpose,
      DEPT_NOW,
      DEPT_NOW,
      options.archived === true ? DEPT_NOW : null,
    ),
  ]);
  return id;
}

export async function insertMember(channelId: string, userId: string) {
  await env.DB.prepare(
    "INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES (?, ?, ?)",
  )
    .bind(channelId, userId, DEPT_NOW)
    .run();
}

/**
 * 既存の部署を、自動専用チャンネル2つ（通常・お知らせ）付きで作る（移行後・作成後の状態を直接作る）。
 * name には接頭辞を含めずに渡す（[UNIT_TEST] を付ける）。
 */
export async function insertDepartmentWithChannels(
  name: string,
  options: { isActive?: boolean; version?: number } = {},
) {
  const id = testId("DEPT");
  const fullName = `${TEST_TAG}${name}`;
  await env.DB.prepare(
    `INSERT INTO departments (id, name, name_normalized, is_active, created_at, description, version, updated_at)
     VALUES (?, ?, ?, ?, ?, '', ?, ?)`,
  )
    .bind(
      id,
      fullName,
      fullName.toLowerCase(),
      options.isActive === false ? 0 : 1,
      DEPT_NOW,
      options.version ?? 1,
      DEPT_NOW,
    )
    .run();
  const dedicatedChannelId = await insertChannel({
    name: fullName,
    purpose: "department",
    departmentId: id,
  });
  const announcementChannelId = await insertChannel({
    name: `${fullName}のお知らせ`,
    purpose: "announcement",
    departmentId: id,
  });
  return { id, name: fullName, dedicatedChannelId, announcementChannelId };
}

export type SeededDepartment = Awaited<
  ReturnType<typeof insertDepartmentWithChannels>
>;

/** 部署の社員として、自動専用チャンネル2つに参加させる（所属は insertUser で済ませておく） */
export async function joinDepartmentChannels(
  department: SeededDepartment,
  userId: string,
) {
  await insertMember(department.dedicatedChannelId, userId);
  await insertMember(department.announcementChannelId, userId);
}

export async function makeOwner(userId: string, departmentId: string) {
  await insertAssignment(userId, ROLE_IDS.owner, "department", departmentId);
}

export async function makeGlobalAdmin(userId: string) {
  await insertAssignment(userId, ROLE_IDS.globalAdmin, "company", null);
}

// ---- 状態の読み取り ----

export async function ownersOf(departmentId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT user_id FROM user_role_assignments WHERE role_id = ? AND department_id = ? ORDER BY user_id",
  )
    .bind(ROLE_IDS.owner, departmentId)
    .all<{ user_id: string }>();
  return results.map((r) => r.user_id);
}

export async function departmentOf(userId: string) {
  const row = await env.DB.prepare(
    "SELECT department_id FROM users WHERE id = ?",
  )
    .bind(userId)
    .first<{ department_id: string | null }>();
  return row?.department_id ?? null;
}

export type DepartmentRow = {
  id: string;
  name: string;
  name_normalized: string;
  description: string;
  version: number;
  is_active: number;
};

export async function departmentRow(id: string) {
  return env.DB.prepare(
    "SELECT id, name, name_normalized, description, version, is_active FROM departments WHERE id = ?",
  )
    .bind(id)
    .first<DepartmentRow>();
}

export type ChannelRow = {
  room_id: string;
  department_id: string | null;
  name: string;
  name_normalized: string;
  description: string;
  visibility: string;
  purpose: string;
  deleted_at: string | null;
};

/** 部署の自動専用チャンネル（department・announcement）を、purpose の順で */
export async function autoChannelsOf(departmentId: string) {
  const { results } = await env.DB.prepare(
    `SELECT room_id, department_id, name, name_normalized, description, visibility, purpose, deleted_at
     FROM channels WHERE department_id = ? AND purpose IN ('department', 'announcement') ORDER BY purpose`,
  )
    .bind(departmentId)
    .all<ChannelRow>();
  return results;
}

export async function membersOf(channelId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT user_id FROM channel_members WHERE channel_id = ? ORDER BY user_id",
  )
    .bind(channelId)
    .all<{ user_id: string }>();
  return results.map((r) => r.user_id);
}

export async function departmentAudits() {
  const { results } = await env.DB.prepare(
    "SELECT actor_id, action, target_type, target_id, result, detail FROM audit_logs WHERE action LIKE 'department.%' ORDER BY occurred_at, id",
  ).all<{
    actor_id: string | null;
    action: string;
    target_type: string;
    target_id: string | null;
    result: string;
    detail: string | null;
  }>();
  return results;
}

/**
 * 取り消しの確認用：部署・チャンネル・参加・ロール・所属・部署の監査の全体の状態。
 * 失敗した操作のあとで、操作の前と完全に同じであることを toEqual で確かめる。
 */
export async function departmentSnapshot() {
  const all = async (sql: string) =>
    (await env.DB.prepare(sql).all<Record<string, unknown>>()).results;
  return {
    departments: await all(
      "SELECT id, name, name_normalized, description, version, is_active FROM departments ORDER BY id",
    ),
    rooms: await all("SELECT id, kind FROM rooms ORDER BY id"),
    channels: await all(
      "SELECT room_id, department_id, name, name_normalized, purpose, visibility, deleted_at FROM channels ORDER BY room_id",
    ),
    members: await all(
      "SELECT channel_id, user_id FROM channel_members ORDER BY channel_id, user_id",
    ),
    assignments: await all(
      "SELECT user_id, role_id, scope_type, department_id FROM user_role_assignments ORDER BY user_id, role_id, department_id",
    ),
    affiliations: await all(
      "SELECT id, department_id, is_active FROM users ORDER BY id",
    ),
    audits: await all(
      "SELECT action, target_id FROM audit_logs WHERE action LIKE 'department.%' ORDER BY id",
    ),
  };
}

/**
 * 部署とオーナーの不変条件（0-8 AC-3・AC-5・AC-7・AC-10、7-1 AC-1）を、DB の全体で確かめる。
 * 破れていれば、その内容の一覧を返す（空なら守られている）。
 * 1 有効な部署ごとに、オーナーがちょうど1人いる
 * 2 全体管理者でないオーナーは、オーナーを務める部署に所属し、オーナーは1部署だけ
 * 3 部署ごとに、自動専用チャンネル（department・announcement）がちょうど1つずつある
 * 4 オーナーは有効な社員
 */
export async function departmentInvariantViolations(): Promise<string[]> {
  const violations: string[] = [];
  const owners = await env.DB.prepare(
    `SELECT d.id, COUNT(a.id) AS n FROM departments d
     LEFT JOIN user_role_assignments a ON a.department_id = d.id AND a.role_id = ?
     WHERE d.is_active = 1 GROUP BY d.id HAVING n <> 1`,
  )
    .bind(ROLE_IDS.owner)
    .all<{ id: string; n: number }>();
  for (const r of owners.results)
    violations.push(`部署 ${r.id} のオーナーが ${r.n} 人`);
  const misplaced = await env.DB.prepare(
    `SELECT a.user_id, a.department_id, u.department_id AS affiliation, u.is_active FROM user_role_assignments a
     JOIN users u ON u.id = a.user_id
     WHERE a.role_id = ? AND NOT EXISTS (
       SELECT 1 FROM user_role_assignments g WHERE g.user_id = a.user_id AND g.role_id = ?)
       AND (u.department_id IS NOT a.department_id)`,
  )
    .bind(ROLE_IDS.owner, ROLE_IDS.globalAdmin)
    .all<{ user_id: string; department_id: string; affiliation: string }>();
  for (const r of misplaced.results)
    violations.push(
      `全体管理者でないオーナー ${r.user_id} が、部署 ${r.department_id} に所属していない`,
    );
  const multi = await env.DB.prepare(
    `SELECT a.user_id, COUNT(*) AS n FROM user_role_assignments a
     WHERE a.role_id = ? AND NOT EXISTS (
       SELECT 1 FROM user_role_assignments g WHERE g.user_id = a.user_id AND g.role_id = ?)
     GROUP BY a.user_id HAVING n > 1`,
  )
    .bind(ROLE_IDS.owner, ROLE_IDS.globalAdmin)
    .all<{ user_id: string; n: number }>();
  for (const r of multi.results)
    violations.push(`全体管理者でない ${r.user_id} が ${r.n} 部署のオーナー`);
  const inactiveOwners = await env.DB.prepare(
    `SELECT a.user_id FROM user_role_assignments a JOIN users u ON u.id = a.user_id
     WHERE a.role_id = ? AND u.is_active = 0`,
  )
    .bind(ROLE_IDS.owner)
    .all<{ user_id: string }>();
  for (const r of inactiveOwners.results)
    violations.push(`無効な社員 ${r.user_id} がオーナー`);
  const channels = await env.DB.prepare(
    `SELECT d.id,
       (SELECT COUNT(*) FROM channels c WHERE c.department_id = d.id AND c.purpose = 'department') AS normal,
       (SELECT COUNT(*) FROM channels c WHERE c.department_id = d.id AND c.purpose = 'announcement') AS announcement
     FROM departments d WHERE d.name LIKE ?`,
  )
    .bind(`${TEST_TAG}%`)
    .all<{ id: string; normal: number; announcement: number }>();
  for (const r of channels.results)
    if (r.normal !== 1 || r.announcement !== 1)
      violations.push(
        `部署 ${r.id} の自動専用チャンネルが 通常${r.normal}・お知らせ${r.announcement}`,
      );
  return violations;
}

/**
 * このテストのデータだけを消す。外部キーの順：参加者 → チャンネル → ルーム → 監査 → ロール・利用者・部署（cleanupRoleTestData）。
 * 対象は [UNIT_TEST] の部署のチャンネル、[UNIT_TEST] で始まる名前のチャンネル、testuser_/e2euser_ の利用者の参加。
 */
export async function cleanupDepartmentTestData() {
  const tagged = `${TEST_TAG}%`;
  const testUsers =
    "SELECT id FROM users WHERE login_id LIKE 'testuser!_%' ESCAPE '!' OR login_id LIKE 'e2euser!_%' ESCAPE '!'";
  const channelFilter =
    "department_id IN (SELECT id FROM departments WHERE name LIKE ?1) OR name LIKE ?1";
  const { results } = await env.DB.prepare(
    `SELECT room_id FROM channels WHERE ${channelFilter}`,
  )
    .bind(tagged)
    .all<{ room_id: string }>();
  const roomIds = results.map((r) => r.room_id);
  // #237：既読位置（read_positions）は部屋・利用者を外部キーで指すため、部屋より先に消す
  await cleanupReadPositions();
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM channel_members WHERE user_id IN (${testUsers}) OR channel_id IN (SELECT room_id FROM channels WHERE ${channelFilter})`,
    ).bind(tagged),
    env.DB.prepare(`DELETE FROM channels WHERE ${channelFilter}`).bind(tagged),
    ...roomIds.map((id) =>
      env.DB.prepare("DELETE FROM rooms WHERE id = ?").bind(id),
    ),
    env.DB.prepare(
      "DELETE FROM audit_logs WHERE action LIKE 'department.%' AND (trace_id LIKE ? OR target_id IN (SELECT id FROM departments WHERE name LIKE ?))",
    ).bind(`${AUTH_TRACE_PREFIX}%`, tagged),
  ]);
  await cleanupRoleTestData();
}
