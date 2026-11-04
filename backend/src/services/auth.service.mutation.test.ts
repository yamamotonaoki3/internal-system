// #120 AC-1〜AC-4：auth.service の変異テストで生き残った変異を殺すための、境界・分岐・記録の内容のテスト。
// 期待値は計画と ADR-0008 から決める（監査の操作名・ロックの扱い・掃除の上限・Cron の式）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newThrottleKey, sha256Hex } from "../../test/auth-fixtures";
import { AppError } from "../lib/app-error";
import { createLogger } from "../lib/logger/logger";
import { verifyPasswordConstantCost } from "../lib/password";
import {
  admitSource,
  authCleanupJob,
  cleanupExpired,
  createAuthDeps,
  login,
  logout,
  type AuthDeps,
  type AuthRepository,
  type LoginUser,
} from "./auth.service";

const NOW = new Date("2026-11-03T03:00:00.000Z");
const LOCKED_UNTIL = new Date(NOW.getTime() + 15 * 60_000).toISOString();
const TRACE_ID = "unit-auth-mutation";
const TEST_PASSWORD = "TestPass123!";

let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const records = (spy: ReturnType<typeof vi.spyOn>): Record<string, unknown>[] =>
  spy.mock.calls.map(
    (c: unknown[]) => JSON.parse(String(c[0])) as Record<string, unknown>,
  );

const user = (overrides: Partial<LoginUser> = {}): LoginUser => ({
  id: "01JTESTUSER000000000000001",
  displayName: "テスト太郎",
  passwordHash: "$scrypt$ln=16,r=8,p=2$c2FsdA$aGFzaA",
  isActive: true,
  mustChangePassword: false,
  ...overrides,
});

function repo(overrides: Partial<AuthRepository> = {}): AuthRepository {
  return {
    acquireSourceSlot: vi.fn(async () => ({
      accepted: true,
      lockedUntil: null,
      justLocked: false,
    })),
    recordRateLimited: vi.fn(async () => {}),
    readAccountThrottle: vi.fn(async () => null),
    findLoginUser: vi.fn(async () => user()),
    recordLoginFailure: vi.fn(async () => {}),
    createSession: vi.fn(async () => true),
    updatePasswordHashIfUnchanged: vi.fn(async () => true),
    revokeSession: vi.fn(async () => {}),
    deleteExpiredSessions: vi.fn(async () => 0),
    deleteExpiredLoginAttempts: vi.fn(async () => 0),
    ...overrides,
  } as AuthRepository;
}

function deps(overrides: Partial<AuthDeps> = {}): AuthDeps {
  return {
    now: () => NOW,
    sleep: vi.fn(async () => {}),
    newToken: () => "unit-token-00000000000000000000000000000",
    verifyPassword: vi.fn(
      async (p: string, s: string | null) => s !== null && p === TEST_PASSWORD,
    ),
    needsRehash: () => false,
    hashPassword: vi.fn(async () => "new-hash"),
    logger: createLogger({ traceId: TRACE_ID }),
    ...overrides,
  };
}

const context = () => ({
  sourceKey: "a".repeat(64),
  throttleKey: newThrottleKey(),
  traceId: TRACE_ID,
  previousSessionToken: null as string | null,
});

const locked = (justLocked: boolean) =>
  vi.fn(async () => ({
    accepted: false,
    lockedUntil: LOCKED_UNTIL as string | null,
    justLocked,
  }));

describe("admitSource（受付枠）", () => {
  it("#120 AC-3: ロックに入った1回は、source なら auth.rate_limited を、時刻・解除時刻・trace の ID つきで記録する", async () => {
    const r = repo({ acquireSourceSlot: locked(true) });
    await expect(
      admitSource(r, "source", "k", { traceId: TRACE_ID }, deps()),
    ).rejects.toBeInstanceOf(AppError);
    expect(r.recordRateLimited).toHaveBeenCalledWith({
      action: "auth.rate_limited",
      traceId: TRACE_ID,
      now: NOW,
      lockedUntil: LOCKED_UNTIL,
    });
    expect(r.acquireSourceSlot).toHaveBeenCalledWith("source", "k", NOW);
  });

  it("#120 AC-3: setup_source なら setup.rate_limited を記録する", async () => {
    const r = repo({ acquireSourceSlot: locked(true) });
    await admitSource(
      r,
      "setup_source",
      "k",
      { traceId: TRACE_ID },
      deps(),
    ).catch(() => {});
    expect(r.recordRateLimited).toHaveBeenCalledWith(
      expect.objectContaining({ action: "setup.rate_limited" }),
    );
  });

  it("#120 AC-3: 拒否はログの監査（logger.audit）に、操作名・対象・failure・justLocked を残す", async () => {
    for (const [type, action] of [
      ["source", "auth.rate_limited"],
      ["setup_source", "setup.rate_limited"],
    ] as const) {
      logSpy.mockClear();
      await admitSource(
        repo({ acquireSourceSlot: locked(false) }),
        type,
        "k",
        { traceId: TRACE_ID },
        deps(),
      ).catch(() => {});
      const audit = records(logSpy).find(
        (r) => (r.attributes as Record<string, unknown>)?.log_type === "audit",
      );
      expect(audit?.body).toBe(action);
      expect(audit?.attributes).toMatchObject({
        target: type,
        result: "failure",
        justLocked: false,
      });
    }
  });

  it("#120 AC-3: 拒否は RATE_LIMITED の共通の文言と、解除までの秒数", async () => {
    const error = (await admitSource(
      repo({ acquireSourceSlot: locked(false) }),
      "source",
      "k",
      { traceId: TRACE_ID },
      deps(),
    ).catch((e: unknown) => e)) as AppError;
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.userMessage).toBe("しばらくしてから、もう一度お試しください");
    expect(error.details).toEqual({ retryAfterSeconds: 900 });
  });

  it("#120 AC-3: 受け付けたときは、何も記録せずに戻る", async () => {
    const r = repo();
    await expect(
      admitSource(r, "source", "k", { traceId: TRACE_ID }, deps()),
    ).resolves.toBeUndefined();
    expect(r.recordRateLimited).not.toHaveBeenCalled();
    expect(records(logSpy)).toEqual([]);
  });

  it("#120 AC-3: 拒否なのに解除の時刻がない（壊れた状態）は、429 にせず想定外のエラーにする（成功扱いにしない）", async () => {
    const r = repo({
      acquireSourceSlot: vi.fn(async () => ({
        accepted: false,
        lockedUntil: null,
        justLocked: true,
      })),
    });
    const error = await admitSource(
      r,
      "source",
      "k",
      { traceId: TRACE_ID },
      deps(),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(AppError);
    expect(r.recordRateLimited).not.toHaveBeenCalled();
  });
});

describe("login（記録の内容）", () => {
  it("#120 AC-1: 失敗の理由は、存在しない=unknown_user・無効=inactive_user・誤り=wrong_password。時刻は now", async () => {
    const cases: [Partial<AuthRepository>, string, string][] = [
      [
        { findLoginUser: vi.fn(async () => null) },
        TEST_PASSWORD,
        "unknown_user",
      ],
      [
        { findLoginUser: vi.fn(async () => user({ isActive: false })) },
        TEST_PASSWORD,
        "inactive_user",
      ],
      [{}, "WrongPass123!", "wrong_password"],
    ];
    for (const [overrides, password, reason] of cases) {
      const r = repo(overrides);
      await login(
        r,
        { loginId: "testuser_001", password },
        context(),
        deps(),
      ).catch(() => {});
      expect(r.recordLoginFailure).toHaveBeenCalledWith(
        expect.objectContaining({ reason, now: NOW }),
      );
    }
  });

  it("#120 0-2 AC-7: 失敗の文言は「社員IDまたはパスワードが違います」", async () => {
    const error = (await login(
      repo(),
      { loginId: "testuser_001", password: "WrongPass123!" },
      context(),
      deps(),
    ).catch((e: unknown) => e)) as AppError;
    expect(error.userMessage).toBe("社員IDまたはパスワードが違います");
    const raced = (await login(
      repo({ createSession: vi.fn(async () => false) }),
      { loginId: "testuser_001", password: TEST_PASSWORD },
      context(),
      deps(),
    ).catch((e: unknown) => e)) as AppError;
    expect(raced.userMessage).toBe("社員IDまたはパスワードが違います");
  });

  it("#120 0-2 AC-1: セッションの作成に now を渡し、遅延の判定にも now を使う", async () => {
    const r = repo({
      readAccountThrottle: vi.fn(async () => ({
        failedCount: 4,
        lastFailedAt: new Date(NOW.getTime() - 14 * 60_000).toISOString(),
      })),
    });
    const d = deps();
    await login(
      r,
      { loginId: "testuser_001", password: TEST_PASSWORD },
      context(),
      d,
    );
    expect(r.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ now: NOW }),
    );
    expect(d.sleep).toHaveBeenCalledWith(1_000);
  });

  it("#120 AC-2: 再ハッシュの失敗のログに、利用者の ID を残す", async () => {
    await login(
      repo({
        updatePasswordHashIfUnchanged: vi.fn(async () => {
          throw new Error("D1 failed [UNIT_TEST]");
        }),
      }),
      { loginId: "testuser_001", password: TEST_PASSWORD },
      context(),
      deps({ needsRehash: () => true }),
    );
    const rec = records(errorSpy)[0];
    expect(rec?.severity_text).toBe("ERROR");
    expect(JSON.stringify(rec)).toContain("01JTESTUSER000000000000001");
  });
});

describe("logout", () => {
  it("#120 0-2 AC-2: 失効の時刻は now", async () => {
    const r = repo();
    await logout(r, { sessionToken: "t", traceId: TRACE_ID }, deps());
    expect(r.revokeSession).toHaveBeenCalledWith({
      sessionId: await sha256Hex("t"),
      now: NOW,
      traceId: TRACE_ID,
    });
  });
});

describe("cleanupExpired（上限）", () => {
  it("#120 AC-4: 499件（上限未満）なら1回で止め、500件ちょうどなら続ける", async () => {
    const a = repo({
      deleteExpiredLoginAttempts: vi
        .fn<() => Promise<number>>()
        .mockResolvedValueOnce(499),
    });
    await cleanupExpired(a, deps());
    expect(a.deleteExpiredLoginAttempts).toHaveBeenCalledTimes(1);
    expect(a.deleteExpiredLoginAttempts).toHaveBeenCalledWith(NOW, 500);

    const b = repo({
      deleteExpiredLoginAttempts: vi
        .fn<() => Promise<number>>()
        .mockResolvedValueOnce(500)
        .mockResolvedValueOnce(0),
    });
    await expect(cleanupExpired(b, deps())).resolves.toEqual({
      sessions: 0,
      loginAttempts: 500,
    });
    expect(b.deleteExpiredLoginAttempts).toHaveBeenCalledTimes(2);
  });

  it("#120 AC-4: 件数が尽きないときは100回で止め、WARN に対象と件数を残す。尽きたときは WARN を出さない", async () => {
    const r = repo({ deleteExpiredSessions: vi.fn(async () => 500) });
    const result = await cleanupExpired(r, deps());
    expect(r.deleteExpiredSessions).toHaveBeenCalledTimes(100);
    expect(result.sessions).toBe(50_000);
    const warn = records(warnSpy)[0];
    expect(warn?.attributes).toMatchObject({
      target: "sessions",
      deleted: 50_000,
    });

    warnSpy.mockClear();
    await cleanupExpired(repo(), deps());
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("#120 AC-4: login_attempts の上限の WARN は、対象を login_attempts と書く", async () => {
    await cleanupExpired(
      repo({ deleteExpiredLoginAttempts: vi.fn(async () => 500) }),
      deps(),
    );
    expect(records(warnSpy)[0]?.attributes).toMatchObject({
      target: "login_attempts",
    });
  });
});

describe("authCleanupJob（Cron。D-3）", () => {
  it("#120 AC-4: 式は 17 18 * * *（UTC 18:17 = JST 03:17）、名前は auth-cleanup", () => {
    const job = authCleanupJob(async () => {
      throw new Error("使わない");
    });
    expect(job.cron).toBe("17 18 * * *");
    expect(job.name).toBe("auth-cleanup");
  });

  it("#120 AC-4: 実行すると掃除をして、開始と終了（件数つき）を INFO に残す", async () => {
    const r = repo({ deleteExpiredSessions: vi.fn(async () => 7) });
    const job = authCleanupJob((_env, run) => run(r));
    await job.run({} as Env);
    expect(r.deleteExpiredSessions).toHaveBeenCalledTimes(1);
    const infos = records(logSpy).filter((x) => x.severity_text === "INFO");
    expect(infos).toHaveLength(2);
    expect(String(infos[0]?.body)).toContain("auth-cleanup");
    expect(String(infos[1]?.body)).toContain("auth-cleanup");
    // 件数は伏せ字（[REDACTED]）にならず、数値で出る（計画：開始・終了・件数をログに残す）。deletedLoginRows はセッション、deletedAttemptRows は試行制限の行の削除件数
    expect(infos[1]?.attributes).toEqual({
      deletedLoginRows: 7,
      deletedAttemptRows: 0,
    });
  });
});

describe("createAuthDeps（本物の部品）", () => {
  it("#120: 本物のパスワードの検証・時刻・トークンを使う", () => {
    const logger = createLogger();
    const d = createAuthDeps(logger);
    expect(d.verifyPassword).toBe(verifyPasswordConstantCost);
    expect(d.logger).toBe(logger);
    expect(Math.abs(d.now().getTime() - Date.now())).toBeLessThan(5_000);
    expect(d.newToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(d.needsRehash("$scrypt$ln=14,r=8,p=2$c2FsdA$aGFzaA")).toBe(true);
  });

  it("#120 0-2 AC-4: sleep は指定したミリ秒だけ待つ（それより前には終わらない）", async () => {
    vi.useFakeTimers();
    const d = createAuthDeps(createLogger());
    let done = false;
    const waiting = d.sleep(1_000).then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await waiting;
    expect(done).toBe(true);
  });
});
