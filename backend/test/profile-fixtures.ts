// #130 のテストで使う、プロフィール・社員一覧・ステータスの架空のテストデータの作成と後始末（識別子で消す。C-05）。
// 利用者は testuser_prof_ で始め、部署名は [UNIT_TEST] で始める。本名は「テスト花子」等の架空の値を、このテストの中だけの鍵で暗号化して入れる
// （aad は利用者のID。account.service.ts・setup.service.ts と同じ作り方）。鍵は乱数で作り、ファイルに書かない。
// 要求は実際のアプリ入口（index.ts の app）に、テストごとに同じ鍵（PII_ENCRYPTION_KEY）を渡して送る。
import { env } from "cloudflare:workers";
import {
  AUTH_TRACE_PREFIX,
  SESSION_COOKIE,
  TEST_IP,
  cleanupAuthTestData,
  insertSession,
  newThrottleKey,
} from "./auth-fixtures";
import { newPiiKey, newSetupToken } from "./random-secrets";
import {
  TEST_TAG,
  cleanupRoleTestData,
  insertAssignment,
  insertDepartment,
  insertUser,
} from "./role-fixtures";
import { ROLE_IDS } from "../src/lib/permissions";
import { encryptLegalName } from "../src/lib/pii-crypto";
import { loadConfig } from "../src/config";
import { app } from "../src/index";

export { TEST_TAG };
export const PROFILE_ORIGIN = loadConfig(env).allowedOrigins[0] ?? "";
/** 時刻を固定するテストの現在時刻 */
export const PROFILE_NOW = new Date("2026-11-11T00:00:00.000Z");

export type ProfileContext = {
  piiKey: string;
  throttleKey: string;
};

export function newProfileContext(): ProfileContext {
  return { piiKey: newPiiKey(), throttleKey: newThrottleKey() };
}

export async function profileRequest(
  context: ProfileContext,
  method: string,
  path: string,
  options: {
    token?: string | null;
    origin?: string | null;
    body?: unknown;
    rawBody?: string;
  } = {},
) {
  const headers: Record<string, string> = {
    "CF-Connecting-IP": TEST_IP,
    "X-Request-Id": `${AUTH_TRACE_PREFIX}prof-${crypto.randomUUID()}`,
  };
  const origin = options.origin === undefined ? PROFILE_ORIGIN : options.origin;
  if (origin !== null) headers.Origin = origin;
  if (options.token) headers.Cookie = `${SESSION_COOKIE}=${options.token}`;
  const body =
    options.rawBody ??
    (options.body === undefined ? undefined : JSON.stringify(options.body));
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return app.request(path, { method, headers, body }, {
    ...env,
    LOGIN_THROTTLE_KEY: context.throttleKey,
    SETUP_TOKEN: newSetupToken(),
    PII_ENCRYPTION_KEY: context.piiKey,
  } as unknown as Env);
}

/**
 * 有効な利用者を作り、本名を暗号化して入れ、パスワード変更の必要をなくす。
 * departmentId に null を渡すと所属なしにする（無効化済みの利用者の作成に使う）。
 */
export async function insertProfileUser(
  context: ProfileContext,
  loginId: string,
  departmentId: string | null,
  options: {
    legalName?: string;
    displayName?: string;
    extension?: string | null;
    isActive?: boolean;
  } = {},
) {
  const placeholderDept = departmentId ?? (await insertDepartment("仮所属"));
  const userId = await insertUser(loginId, placeholderDept, {
    isActive: options.isActive ?? true,
  });
  const encrypted = await encryptLegalName(
    options.legalName ?? "テスト花子",
    context.piiKey,
    userId,
  );
  await env.DB.prepare(
    "UPDATE users SET legal_name = ?, display_name = ?, extension = ?, department_id = ?, must_change_password = 0 WHERE id = ?",
  )
    .bind(
      encrypted,
      options.displayName ?? "テスト太郎",
      options.extension === undefined ? "1234" : options.extension,
      departmentId,
      userId,
    )
    .run();
  return userId;
}

export async function sessionTokenFor(userId: string) {
  const session = await insertSession(userId, {
    createdAt: new Date().toISOString(),
  });
  return session.token;
}

export async function makeProfileOwner(userId: string, departmentId: string) {
  await insertAssignment(userId, ROLE_IDS.owner, "department", departmentId);
}

export async function makeProfileGlobalAdmin(userId: string) {
  await insertAssignment(userId, ROLE_IDS.globalAdmin, "company", null);
}

export type UserStatusRow = {
  display_name: string;
  status_kind: string;
  status_return_at: string | null;
  status_message: string | null;
  status_updated_at: string | null;
  status_updated_by: string | null;
};

export async function userStatusRow(userId: string) {
  return env.DB.prepare(
    "SELECT display_name, status_kind, status_return_at, status_message, status_updated_at, status_updated_by FROM users WHERE id = ?",
  )
    .bind(userId)
    .first<UserStatusRow>();
}

export type ProfileAuditRow = {
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  result: string;
  detail: string | null;
};

/** #130 で足す2つの操作の監査ログ（このテストの要求の trace_id のものだけ） */
export async function profileAuditRows() {
  const { results } = await env.DB.prepare(
    "SELECT actor_id, action, target_type, target_id, result, detail FROM audit_logs WHERE trace_id LIKE ? AND action IN ('status.proxy_set', 'profile.display_name_change') ORDER BY occurred_at, id",
  )
    .bind(`${AUTH_TRACE_PREFIX}prof-%`)
    .all<ProfileAuditRow>();
  return results;
}

/** detail の JSON のキーの集合（null・空文字は空の集合として扱う） */
export function detailKeys(detail: string | null): string[] {
  if (detail === null || detail === "") return [];
  const parsed: unknown = JSON.parse(detail);
  if (parsed === null || typeof parsed !== "object") return [];
  return Object.keys(parsed).sort();
}

const TRIGGERS = [
  "unit_130_fail_proxy_audit",
  "unit_130_fail_display_name_audit",
] as const;

/** この監査の操作だけを失敗させるトリガーを作る（同じ db.batch の取り消しを確かめるため） */
export async function failAuditOf(
  action: "status.proxy_set" | "profile.display_name_change",
) {
  const name = action === "status.proxy_set" ? TRIGGERS[0] : TRIGGERS[1];
  await env.DB.exec(
    `CREATE TRIGGER ${name} BEFORE INSERT ON audit_logs WHEN NEW.action = '${action}' BEGIN SELECT RAISE(ABORT, 'unit test failure'); END`,
  );
}

/** このテストのデータだけを消す。外部キーの順：トリガー → 監査・セッション → 割り当て・利用者・部署 */
export async function cleanupProfileTestData() {
  for (const name of TRIGGERS)
    await env.DB.exec(`DROP TRIGGER IF EXISTS ${name}`);
  // status_updated_by が同じテストの利用者を指すため、利用者を消す前に外す
  await env.DB.prepare(
    "UPDATE users SET status_updated_by = NULL WHERE login_id LIKE 'testuser!_%' ESCAPE '!'",
  )
    .run()
    .catch((error: unknown) => {
      // migration 0013 の前（列がない）だけは、外す対象がない。それ以外の失敗は伝える
      if (!String(error).includes("status_updated_by")) throw error;
    });
  await cleanupAuthTestData();
  await cleanupRoleTestData();
}
