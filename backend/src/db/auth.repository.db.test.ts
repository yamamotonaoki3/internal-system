// #120 AC-1〜AC-4：ログイン・セッション・試行制限の Repository（sessions・login_attempts・users・audit_logs）の結合テスト。
// 本物と同じ実行エンジン（workerd）のローカルの D1 で確かめる。時刻は引数で固定する。
// 受付枠の原子的な確保（残り1回に20件の同時要求）、条件付きのセッション作成（検証と確定の間の変更）、
// ログアウトと監査の同時確定、掃除（べき等・件数の上限・ロック中の行を残す）。
// データは架空のもの（testuser_、[UNIT_TEST]）。試行制限のキーはテストの中の乱数の値。
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../db/schema";
import {
  AUTH_TRACE_PREFIX,
  authAuditRows,
  cleanupAuthTestData,
  insertSession,
  loginAttemptRow,
  sessionRow,
  setUserPassword,
} from "../../test/auth-fixtures";
import { randomBase64Url } from "../../test/random-secrets";
import {
  cleanupRoleTestData,
  insertDepartment,
  insertUser,
} from "../../test/role-fixtures";
import { createAuthRepository } from "./auth.repository";

const db = drizzle(env.DB, { schema });
const repo = createAuthRepository(db);

const MIN = 60_000;
const T0 = new Date("2026-11-03T03:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const iso = (ms: number) => at(ms).toISOString();
const TRACE = `${AUTH_TRACE_PREFIX}repo`;
const HASH = "$scrypt$ln=16,r=8,p=2$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaA";

let keys: string[];
/** 16進64文字の架空のキー（HMAC の結果と同じ形）。後始末のために覚えておく */
function newKey() {
  const key = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  keys.push(key);
  return key;
}

let userId: string;
beforeEach(async () => {
  keys = [];
  const dept = await insertDepartment("認証テスト部");
  userId = await insertUser("testuser_001", dept);
  await setUserPassword(userId, HASH);
});
afterEach(async () => {
  await cleanupAuthTestData(keys);
  await cleanupRoleTestData();
});

describe("acquireSourceSlot（接続元の受付枠。AC-3・D-1）", () => {
  it("#120 AC-3: 最初の受付で行を作り、受付数1・窓の開始・更新の時刻を now にする", async () => {
    const key = newKey();
    expect(await repo.acquireSourceSlot("source", key, T0)).toEqual({
      accepted: true,
      lockedUntil: null,
      justLocked: false,
    });
    const row = await loginAttemptRow("source", key);
    expect(row).toMatchObject({
      attempt_count: 1,
      window_started_at: T0.toISOString(),
      locked_until: null,
      updated_at: T0.toISOString(),
    });
  });

  it("#120 AC-3（最終の修正 2）: 15分の窓の中で30回までは受け付け、31回目は 429 でロックに入る（justLocked）。32回目はロック中", async () => {
    const key = newKey();
    for (let i = 0; i < 30; i += 1) {
      const r = await repo.acquireSourceSlot("source", key, at(i * 1000));
      expect(r.accepted, `${i + 1}回目`).toBe(true);
    }
    const locked = await repo.acquireSourceSlot("source", key, at(31_000));
    expect(locked.accepted).toBe(false);
    expect(locked.justLocked).toBe(true);
    expect(locked.lockedUntil).toBe(iso(31_000 + 15 * MIN));

    const during = await repo.acquireSourceSlot("source", key, at(32_000));
    expect(during).toEqual({
      accepted: false,
      lockedUntil: iso(31_000 + 15 * MIN),
      justLocked: false,
    });
  });

  it("#120 AC-3: 窓の開始から15分たつと、新しい窓で数え直す", async () => {
    const key = newKey();
    for (let i = 0; i < 29; i += 1)
      await repo.acquireSourceSlot("source", key, T0);
    const r = await repo.acquireSourceSlot("source", key, at(15 * MIN));
    expect(r.accepted).toBe(true);
    expect(await loginAttemptRow("source", key)).toMatchObject({
      attempt_count: 1,
      window_started_at: iso(15 * MIN),
    });
  });

  it("#120 AC-3: ロックは15分で自動で解除され（ちょうど解除の時刻から受け付ける）、受付数は1から数え直す", async () => {
    const key = newKey();
    for (let i = 0; i < 31; i += 1)
      await repo.acquireSourceSlot("source", key, T0);
    expect(
      (await repo.acquireSourceSlot("source", key, at(15 * MIN - 1))).accepted,
    ).toBe(false);
    const r = await repo.acquireSourceSlot("source", key, at(15 * MIN));
    expect(r.accepted).toBe(true);
    expect(await loginAttemptRow("source", key)).toMatchObject({
      attempt_count: 1,
      locked_until: null,
    });
  });

  it("#120 AC-3（並行）: 残り1回の枠に20件を同時に送っても、受け付けるのは1件だけ", async () => {
    const key = newKey();
    for (let i = 0; i < 29; i += 1)
      await repo.acquireSourceSlot("source", key, T0);
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        repo.acquireSourceSlot("source", key, at(1000)),
      ),
    );
    expect(results.filter((r) => r.accepted)).toHaveLength(1);
    expect(results.filter((r) => r.justLocked)).toHaveLength(1);
  });

  it("#120 AC-3: setup_source と source は、同じキーでも別々に数える", async () => {
    const key = newKey();
    for (let i = 0; i < 31; i += 1)
      await repo.acquireSourceSlot("setup_source", key, T0);
    expect((await repo.acquireSourceSlot("source", key, T0)).accepted).toBe(
      true,
    );
  });
});

describe("社員IDの失敗の記録（0-2 AC-4・D-2）", () => {
  it("#120 0-2 AC-4: 記録がない社員IDは null", async () => {
    expect(await repo.readAccountThrottle(newKey())).toBeNull();
  });

  it("#120 0-2 AC-4: 失敗ごとに失敗数を1増やし、最後の失敗の時刻を残す（ロックの列は使わない）", async () => {
    const key = newKey();
    for (let i = 0; i < 3; i += 1)
      await repo.recordLoginFailure({
        accountKey: key,
        now: at(i * MIN),
        traceId: TRACE,
        reason: "wrong_password",
      });
    expect(await repo.readAccountThrottle(key)).toEqual({
      failedCount: 3,
      lastFailedAt: iso(2 * MIN),
    });
    expect((await loginAttemptRow("account", key))?.locked_until).toBeNull();
  });

  it("#120 0-2 AC-4（D-2）: 最後の失敗から15分たった失敗は、1から数え直す", async () => {
    const key = newKey();
    for (let i = 0; i < 5; i += 1)
      await repo.recordLoginFailure({
        accountKey: key,
        now: T0,
        traceId: TRACE,
        reason: "wrong_password",
      });
    await repo.recordLoginFailure({
      accountKey: key,
      now: at(15 * MIN),
      traceId: TRACE,
      reason: "wrong_password",
    });
    expect((await repo.readAccountThrottle(key))?.failedCount).toBe(1);
  });

  it("#120 AC-3（並行）: 同じ社員IDの失敗を10件同時に記録しても、失敗数は10（数え落とさない）", async () => {
    const key = newKey();
    await Promise.all(
      Array.from({ length: 10 }, () =>
        repo.recordLoginFailure({
          accountKey: key,
          now: T0,
          traceId: TRACE,
          reason: "wrong_password",
        }),
      ),
    );
    expect((await repo.readAccountThrottle(key))?.failedCount).toBe(10);
  });

  it("#120 AC-1（監査）: 失敗の記録と同時に auth.login の failure を残す。操作者は null、社員ID・パスワード・IPを含まない", async () => {
    const key = newKey();
    await repo.recordLoginFailure({
      accountKey: key,
      now: T0,
      traceId: TRACE,
      reason: "unknown_user",
    });
    const rows = await authAuditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: "auth.login",
      result: "failure",
      actor_id: null,
      trace_id: TRACE,
    });
    const text = JSON.stringify(rows);
    expect(text).not.toContain("testuser_001");
    expect(text).not.toContain("TestPass123!");
    expect(text).not.toContain("192.0.2");
    expect(text).not.toContain(key);
  });
});

describe("createSession（条件付きのセッション作成。0-2 AC-1・AC-6）", () => {
  const input = (overrides: Record<string, unknown> = {}) => ({
    sessionId: newKey(),
    userId,
    passwordHash: HASH,
    previousSessionId: null as string | null,
    accountKey: newKey(),
    now: T0,
    traceId: TRACE,
    ...overrides,
  });

  it("#120 0-2 AC-1: 作成して true。作成・最終操作の時刻は now、失効なし。監査 auth.login の success（操作者は本人）", async () => {
    const i = input();
    expect(await repo.createSession(i)).toBe(true);
    expect(await sessionRow(i.sessionId)).toMatchObject({
      user_id: userId,
      created_at: T0.toISOString(),
      last_active_at: T0.toISOString(),
      revoked_at: null,
    });
    const rows = await authAuditRows();
    expect(rows).toEqual([
      expect.objectContaining({
        action: "auth.login",
        result: "success",
        actor_id: userId,
      }),
    ]);
  });

  it("#120 0-2 AC-4（D-2）: 成功すると社員IDの失敗数を0に戻す", async () => {
    const accountKey = newKey();
    for (let k = 0; k < 4; k += 1)
      await repo.recordLoginFailure({
        accountKey,
        now: T0,
        traceId: TRACE,
        reason: "wrong_password",
      });
    await repo.createSession(input({ accountKey }));
    const state = await repo.readAccountThrottle(accountKey);
    expect(state === null || state.failedCount === 0).toBe(true);
  });

  it("#120 AC-3（ADR-0008）: 成功しても、接続元の受付数は戻さない", async () => {
    const sourceKey = newKey();
    for (let k = 0; k < 5; k += 1)
      await repo.acquireSourceSlot("source", sourceKey, T0);
    await repo.createSession(input());
    expect((await loginAttemptRow("source", sourceKey))?.attempt_count).toBe(5);
  });

  it("#120 0-2 AC-6: 同じ利用者の別のセッションは、そのまま残る（同時ログイン）", async () => {
    const other = await insertSession(userId, { createdAt: T0.toISOString() });
    await repo.createSession(input());
    expect((await sessionRow(other.id))?.revoked_at).toBeNull();
  });

  it("#120 0-2 AC-1（固定化対策）: 送られてきた古いセッションは、同じ確定で失効させる", async () => {
    const old = await insertSession(userId, { createdAt: T0.toISOString() });
    await repo.createSession(input({ previousSessionId: old.id }));
    expect((await sessionRow(old.id))?.revoked_at).toBe(T0.toISOString());
  });

  it("#120（失効との競合）: 検証の後にパスワードが変わっていたら、作らずに false。成功の監査も残さない", async () => {
    await setUserPassword(
      userId,
      "$scrypt$ln=16,r=8,p=2$Y2hhbmdlZA$Y2hhbmdlZGhhc2g",
    );
    const i = input();
    expect(await repo.createSession(i)).toBe(false);
    expect(await sessionRow(i.sessionId)).toBeNull();
    expect(
      (await authAuditRows()).filter((r) => r.result === "success"),
    ).toEqual([]);
  });

  it("#120（失効との競合）: 検証の後に無効化されていたら、作らずに false", async () => {
    await env.DB.prepare("UPDATE users SET is_active = 0 WHERE id = ?")
      .bind(userId)
      .run();
    const i = input();
    expect(await repo.createSession(i)).toBe(false);
    expect(await sessionRow(i.sessionId)).toBeNull();
  });
});

describe("updatePasswordHashIfUnchanged（再ハッシュの置き換え。AC-2）", () => {
  it("#120 AC-2: 旧ハッシュが一致すれば置き換えて true", async () => {
    const next = "$scrypt$ln=16,r=8,p=2$bmV3c2FsdA$bmV3aGFzaA";
    expect(await repo.updatePasswordHashIfUnchanged(userId, HASH, next)).toBe(
      true,
    );
    const row = await env.DB.prepare(
      "SELECT password_hash FROM users WHERE id = ?",
    )
      .bind(userId)
      .first<{ password_hash: string }>();
    expect(row?.password_hash).toBe(next);
  });

  it("#120 AC-2: 並行してパスワードが変わっていたら（旧ハッシュが不一致）、上書きせず false", async () => {
    const changed = "$scrypt$ln=16,r=8,p=2$Y2hhbmdlZA$Y2hhbmdlZGhhc2g";
    await setUserPassword(userId, changed);
    expect(
      await repo.updatePasswordHashIfUnchanged(
        userId,
        HASH,
        "$scrypt$ln=16,r=8,p=2$bmV3c2FsdA$bmV3aGFzaA",
      ),
    ).toBe(false);
    const row = await env.DB.prepare(
      "SELECT password_hash FROM users WHERE id = ?",
    )
      .bind(userId)
      .first<{ password_hash: string }>();
    expect(row?.password_hash).toBe(changed);
  });
});

describe("findLoginUser（0-2 AC-1・AC-7）", () => {
  it("#120 0-2 AC-1: 社員IDは大文字小文字を区別せずに探し、検証に要る項目を返す", async () => {
    expect(await repo.findLoginUser("TestUser_001")).toEqual({
      id: userId,
      displayName: "テスト太郎",
      passwordHash: HASH,
      isActive: true,
      mustChangePassword: false,
    });
  });

  it("#120 0-2 AC-7: 存在しない社員IDは null。無効な利用者も返し（isActive=false）、判断は Service に任せる", async () => {
    expect(await repo.findLoginUser("testuser_999")).toBeNull();
    await env.DB.prepare("UPDATE users SET is_active = 0 WHERE id = ?")
      .bind(userId)
      .run();
    expect((await repo.findLoginUser("testuser_001"))?.isActive).toBe(false);
  });
});

describe("revokeSession（ログアウト。0-2 AC-2・AC-6）", () => {
  it("#120 0-2 AC-2: そのセッションだけを失効させ、同じ確定で監査 auth.logout（本人）を残す", async () => {
    const mine = await insertSession(userId, { createdAt: T0.toISOString() });
    const other = await insertSession(userId, { createdAt: T0.toISOString() });
    await repo.revokeSession({
      sessionId: mine.id,
      now: at(MIN),
      traceId: TRACE,
    });
    expect((await sessionRow(mine.id))?.revoked_at).toBe(iso(MIN));
    expect((await sessionRow(other.id))?.revoked_at).toBeNull();
    expect(await authAuditRows()).toEqual([
      expect.objectContaining({
        action: "auth.logout",
        result: "success",
        actor_id: userId,
      }),
    ]);
  });

  it("#120 0-2 AC-2: 失効済み・存在しないセッションは、変えず、監査も残さない（べき等）", async () => {
    const done = await insertSession(userId, {
      createdAt: T0.toISOString(),
      revokedAt: T0.toISOString(),
    });
    await repo.revokeSession({
      sessionId: done.id,
      now: at(MIN),
      traceId: TRACE,
    });
    await repo.revokeSession({
      sessionId: newKey(),
      now: at(MIN),
      traceId: TRACE,
    });
    expect((await sessionRow(done.id))?.revoked_at).toBe(T0.toISOString());
    expect(await authAuditRows()).toEqual([]);
  });
});

describe("掃除（AC-4・D-3）", () => {
  it("#120 AC-4: sessions は、失効済み・ログインから1日・無操作30分のものを消し、有効なものを残す", async () => {
    const now = at(2 * 24 * 60 * MIN);
    const nowMs = now.getTime();
    const ago = (ms: number) => new Date(nowMs - ms).toISOString();
    const revoked = await insertSession(userId, {
      createdAt: ago(MIN),
      revokedAt: ago(30_000),
    });
    const tooOld = await insertSession(userId, {
      createdAt: ago(24 * 60 * MIN),
      lastActiveAt: ago(MIN),
    });
    const idle = await insertSession(userId, {
      createdAt: ago(60 * MIN),
      lastActiveAt: ago(30 * MIN),
    });
    const valid = await insertSession(userId, {
      createdAt: ago(24 * 60 * MIN - MIN),
      lastActiveAt: ago(30 * MIN - 1000),
    });
    expect(await repo.deleteExpiredSessions(now, 500)).toBe(3);
    for (const s of [revoked, tooOld, idle])
      expect(await sessionRow(s.id)).toBeNull();
    expect(await sessionRow(valid.id)).not.toBeNull();
  });

  it("#120 AC-4: 1回で消すのは上限の件数まで。繰り返すと残りも消え、最後は0件（べき等）", async () => {
    for (let i = 0; i < 5; i += 1)
      await insertSession(userId, {
        createdAt: T0.toISOString(),
        revokedAt: T0.toISOString(),
      });
    const now = at(MIN);
    expect(await repo.deleteExpiredSessions(now, 2)).toBe(2);
    expect(await repo.deleteExpiredSessions(now, 2)).toBe(2);
    expect(await repo.deleteExpiredSessions(now, 2)).toBe(1);
    expect(await repo.deleteExpiredSessions(now, 2)).toBe(0);
  });

  it("#120 AC-4（最終の修正 2）: login_attempts は、最後の更新から1日たった行を消す。成功だけで作られた受付の行も消える", async () => {
    const sourceKey = newKey();
    await repo.acquireSourceSlot("source", sourceKey, T0);
    const accountKey = newKey();
    await repo.recordLoginFailure({
      accountKey,
      now: T0,
      traceId: TRACE,
      reason: "wrong_password",
    });
    const recentKey = newKey();
    await repo.acquireSourceSlot("source", recentKey, at(24 * 60 * MIN - MIN));

    const now = at(24 * 60 * MIN);
    expect(await repo.deleteExpiredLoginAttempts(now, 500)).toBe(2);
    expect(await loginAttemptRow("source", sourceKey)).toBeNull();
    expect(await loginAttemptRow("account", accountKey)).toBeNull();
    expect(await loginAttemptRow("source", recentKey)).not.toBeNull();
  });

  it("#120 AC-4（最終の修正 2）: ロック中の行は、最後の更新が古くても消さない", async () => {
    const key = newKey();
    await env.DB.prepare(
      `INSERT INTO login_attempts (bucket_type, bucket_key, attempt_count, failed_count, window_started_at, locked_until, last_failed_at, updated_at)
       VALUES ('source', ?, 31, NULL, ?, ?, NULL, ?)`,
    )
      .bind(key, iso(0), iso(3 * 24 * 60 * MIN), iso(0))
      .run();
    expect(
      await repo.deleteExpiredLoginAttempts(at(2 * 24 * 60 * MIN), 500),
    ).toBe(0);
    expect(await loginAttemptRow("source", key)).not.toBeNull();
  });
});

describe("login_attempts の保存（AC-3）", () => {
  it("#120 AC-3: bucket_type は source・setup_source・account だけ（CHECK の制約）", async () => {
    await expect(
      env.DB.prepare(
        "INSERT INTO login_attempts (bucket_type, bucket_key, updated_at) VALUES ('ip', ?, ?)",
      )
        .bind(randomBase64Url(8), T0.toISOString())
        .run(),
    ).rejects.toThrow();
  });
});
