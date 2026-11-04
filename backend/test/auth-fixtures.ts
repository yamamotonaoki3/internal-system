// #120 のテストで使う、ログイン・セッションの架空のテストデータの作成と後始末（識別子で消す。C-05）。
// 期待値は実装から導かず、仕様（ADR-0008・計画）から独立に計算する：セッションのIDはトークンの SHA-256 の16進、
// 試行制限のキーは HMAC-SHA256(LOGIN_THROTTLE_KEY, 値) の16進（社員IDは小文字にしてから）。
import { env } from "cloudflare:workers";
import { randomBase64Url } from "./random-secrets";

/** 要求の X-Request-Id（監査ログの trace_id）。後始末で、この接頭辞の監査ログだけを消す */
export const AUTH_TRACE_PREFIX = "unit-auth-";
export const SESSION_COOKIE = "__Host-session";
/** テスト専用の固定のパスワード（実アカウントの認証情報ではない） */
export const TEST_PASSWORD = "TestPass123!";
/**
 * TEST_PASSWORD の、事前に計算した固定のハッシュ（scrypt ln=16,r=8,p=2 の PHC 形式。e2e/seeds/login.sql と同じ値）。
 * テストの準備で毎回 hashPassword すると、並列の実行で scrypt の計算が重なり時間切れになるため、これを使い回す。
 */
export const TEST_PASSWORD_HASH =
  "$scrypt$ln=16,r=8,p=2$dF/oe+D7nsT+Ym0wQkXBGQ$Ehhw0tdVmO9jnWFXgGU8/TR+j4cswzbHqT2ZgSooTO8";
/**
 * 実際に scrypt（1回 約0.3〜0.5秒）を計算するテストの、個別の時間切れ（ミリ秒）。
 * 並列の実行で計算が重なっても失敗しないよう、その describe にだけ付ける（全体の設定は変えない）。
 */
export const SCRYPT_TEST_TIMEOUT_MS = 30_000;
/** 架空の接続元（RFC 5737・RFC 3849 の文書用アドレス） */
export const TEST_IP = "192.0.2.10";
export const TEST_IP_2 = "192.0.2.20";

const toHex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

export async function sha256Hex(text: string): Promise<string> {
  return toHex(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
}

/** base64url の鍵（文字列）の、バイト列 */
function base64UrlToBytes(text: string): Uint8Array<ArrayBuffer> {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * HMAC-SHA256(鍵, 値) の16進。鍵は base64url を復号したバイト列として使う前提（計画：43文字の base64url）。
 * 実装が鍵を文字列のまま使う設計を選ぶ場合は、計画と食い違うため統括に確認する。
 */
export async function hmacHex(throttleKey: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    base64UrlToBytes(throttleKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
  );
}

/** 43文字の base64url の乱数（LOGIN_THROTTLE_KEY と同じ形式） */
export const newThrottleKey = () => randomBase64Url(32);
/** セッションのトークン（実装と同じ 32バイトの base64url を想定） */
export const newSessionToken = () => randomBase64Url(32);

/** sessions に、トークンに対応する行を直接入れる（時刻を自由に決めるため） */
export async function insertSession(
  userId: string,
  options: {
    token?: string;
    createdAt: string;
    lastActiveAt?: string;
    revokedAt?: string | null;
  },
) {
  const token = options.token ?? newSessionToken();
  const id = await sha256Hex(token);
  await env.DB.prepare(
    "INSERT INTO sessions (id, user_id, created_at, last_active_at, reauthenticated_at, revoked_at) VALUES (?, ?, ?, ?, NULL, ?)",
  )
    .bind(
      id,
      userId,
      options.createdAt,
      options.lastActiveAt ?? options.createdAt,
      options.revokedAt ?? null,
    )
    .run();
  return { token, id };
}

export async function setUserPassword(
  userId: string,
  passwordHash: string,
  options: { mustChangePassword?: boolean } = {},
) {
  await env.DB.prepare(
    "UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?",
  )
    .bind(passwordHash, options.mustChangePassword === true ? 1 : 0, userId)
    .run();
}

export async function sessionRow(id: string) {
  return env.DB.prepare("SELECT * FROM sessions WHERE id = ?").bind(id).first<{
    id: string;
    user_id: string;
    created_at: string;
    last_active_at: string;
    revoked_at: string | null;
  }>();
}

export type LoginAttemptRow = {
  bucket_type: string;
  bucket_key: string;
  attempt_count: number | null;
  failed_count: number | null;
  window_started_at: string | null;
  locked_until: string | null;
  last_failed_at: string | null;
  updated_at: string;
};

export async function loginAttemptRow(bucketType: string, bucketKey: string) {
  return env.DB.prepare(
    "SELECT * FROM login_attempts WHERE bucket_type = ? AND bucket_key = ?",
  )
    .bind(bucketType, bucketKey)
    .first<LoginAttemptRow>();
}

export async function authAuditRows() {
  const { results } = await env.DB.prepare(
    "SELECT * FROM audit_logs WHERE trace_id LIKE ? ORDER BY occurred_at, id",
  )
    .bind(`${AUTH_TRACE_PREFIX}%`)
    .all<{
      actor_id: string | null;
      action: string;
      target_type: string;
      target_id: string | null;
      result: string;
      trace_id: string;
      detail: string | null;
    }>();
  return results;
}

/**
 * このテストのデータだけを消す。sessions は testuser_/e2euser_ の利用者のもの、
 * 監査ログは trace_id の接頭辞、login_attempts は渡したキー（HMAC のため、作ったテストが知っているキーだけ）。
 * 利用者・部署は role-fixtures の cleanupRoleTestData で消す（外部キーの順のため、こちらを先に呼ぶ）。
 */
export async function cleanupAuthTestData(bucketKeys: readonly string[] = []) {
  const testUsers =
    "SELECT id FROM users WHERE login_id LIKE 'testuser!_%' ESCAPE '!' OR login_id LIKE 'e2euser!_%' ESCAPE '!'";
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM sessions WHERE user_id IN (${testUsers})`),
    env.DB.prepare("DELETE FROM audit_logs WHERE trace_id LIKE ?").bind(
      `${AUTH_TRACE_PREFIX}%`,
    ),
    ...bucketKeys.map((key) =>
      env.DB.prepare("DELETE FROM login_attempts WHERE bucket_key = ?").bind(
        key,
      ),
    ),
  ]);
}

/** Set-Cookie の1つ（名前・値・属性）。属性名は小文字にそろえる */
export function parseSetCookie(header: string | null) {
  if (header === null) return null;
  const [pair = "", ...attrs] = header.split(";").map((s) => s.trim());
  const eq = pair.indexOf("=");
  const attributes = new Map<string, string>();
  for (const attr of attrs) {
    const i = attr.indexOf("=");
    if (i === -1) attributes.set(attr.toLowerCase(), "");
    else attributes.set(attr.slice(0, i).toLowerCase(), attr.slice(i + 1));
  }
  return {
    name: pair.slice(0, eq),
    value: pair.slice(eq + 1),
    attributes,
  };
}
