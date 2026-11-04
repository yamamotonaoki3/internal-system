// #120 AC-1〜AC-4・0-2 AC-1/2/4/6/7：ログインの Service（HTTP も DB のライブラリも知らない）の単体テスト。
// Repository・時刻・乱数・待ち（sleep）・パスワードの検証を差し替え、処理の順序と分岐を確かめる。
// 2段のログイン（verifyFirstFactor → issueSession。#122 の TOTP の拡張点）、受付枠は計算の前、
// 存在しない・無効・誤りで応答が同じで検証は各1回、社員IDの遅延、条件付きのセッション作成、再ハッシュ、ログアウト、掃除。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hmacHex, newThrottleKey, sha256Hex } from "../../test/auth-fixtures";
import { AppError } from "../lib/app-error";
import { createLogger } from "../lib/logger/logger";
import {
  cleanupExpired,
  issueSession,
  login,
  logout,
  verifyFirstFactor,
  type AuthDeps,
  type AuthRepository,
  type LoginUser,
} from "./auth.service";

const NOW = new Date("2026-11-03T03:00:00.000Z");
const TEST_PASSWORD = "TestPass123!";
const SOURCE_KEY = "a".repeat(64);
const TRACE_ID = "unit-auth-service";

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const activeUser = (overrides: Partial<LoginUser> = {}): LoginUser => ({
  id: "01JTESTUSER000000000000001",
  displayName: "テスト太郎",
  passwordHash: "$scrypt$ln=16,r=8,p=2$c2FsdA$aGFzaA",
  isActive: true,
  mustChangePassword: false,
  ...overrides,
});

function fakeRepository(overrides: Partial<AuthRepository> = {}) {
  const repo: AuthRepository = {
    acquireSourceSlot: vi.fn(async () => ({
      accepted: true,
      lockedUntil: null,
      justLocked: false,
    })),
    recordRateLimited: vi.fn(async () => {}),
    readAccountThrottle: vi.fn(async () => null),
    findLoginUser: vi.fn(async () => activeUser()),
    recordLoginFailure: vi.fn(async () => {}),
    createSession: vi.fn(async () => true),
    updatePasswordHashIfUnchanged: vi.fn(async () => true),
    revokeSession: vi.fn(async () => {}),
    deleteExpiredSessions: vi.fn(async () => 0),
    deleteExpiredLoginAttempts: vi.fn(async () => 0),
    ...overrides,
  };
  return repo;
}

let tokenSeq = 0;
function fakeDeps(overrides: Partial<AuthDeps> = {}) {
  const deps: AuthDeps = {
    now: () => NOW,
    sleep: vi.fn(async () => {}),
    newToken: () => {
      tokenSeq += 1;
      return `unit-token-${String(tokenSeq).padStart(32, "0")}`;
    },
    verifyPassword: vi.fn(
      async (password: string, stored: string | null) =>
        stored !== null && password === TEST_PASSWORD,
    ),
    needsRehash: vi.fn(() => false),
    hashPassword: vi.fn(async () => "$scrypt$ln=16,r=8,p=2$bmV3$bmV3aGFzaA"),
    logger: createLogger({ traceId: TRACE_ID }),
    ...overrides,
  };
  return deps;
}

let throttleKey: string;
beforeEach(() => {
  throttleKey = newThrottleKey();
});
const context = (overrides: Record<string, unknown> = {}) => ({
  sourceKey: SOURCE_KEY,
  throttleKey,
  traceId: TRACE_ID,
  previousSessionToken: null as string | null,
  ...overrides,
});
const input = (loginId = "testuser_001", password = TEST_PASSWORD) => ({
  loginId,
  password,
});

const catchError = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error("成功してしまった");
    },
    (e: unknown) => e as AppError,
  );

describe("login（成功）", () => {
  it("#120 0-2 AC-1: 正しい社員IDとパスワードでログインでき、利用者・初回の印・新しいトークンを返す", async () => {
    const repo = fakeRepository();
    const deps = fakeDeps();
    const result = await login(repo, input(), context(), deps);
    expect(result.user).toEqual({
      id: "01JTESTUSER000000000000001",
      displayName: "テスト太郎",
    });
    expect(result.mustChangePassword).toBe(false);
    expect(typeof result.token).toBe("string");
    expect(result.token.length).toBeGreaterThan(0);
  });

  it("#120 0-2 AC-1: セッションのIDはトークンの SHA-256 で、条件付きの作成に検証時のハッシュを渡す（競合対策）", async () => {
    const repo = fakeRepository();
    const result = await login(repo, input(), context(), fakeDeps());
    expect(repo.createSession).toHaveBeenCalledTimes(1);
    expect(repo.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: await sha256Hex(result.token),
        userId: "01JTESTUSER000000000000001",
        passwordHash: activeUser().passwordHash,
        accountKey: await hmacHex(throttleKey, "testuser_001"),
        previousSessionId: null,
        traceId: TRACE_ID,
      }),
    );
  });

  it("#120 0-2 AC-1（固定化対策）: 送られてきた古いトークンは使い回さず、古いセッションを失効の対象として渡す", async () => {
    const repo = fakeRepository();
    const old = "unit-old-token-0000000000000000000000000";
    const result = await login(
      repo,
      input(),
      context({ previousSessionToken: old }),
      fakeDeps(),
    );
    expect(result.token).not.toBe(old);
    expect(repo.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ previousSessionId: await sha256Hex(old) }),
    );
  });

  it("#120 0-2 AC-1: 初回パスワードの利用者は mustChangePassword=true の印を付ける（強制変更の本体は #123）", async () => {
    const repo = fakeRepository({
      findLoginUser: vi.fn(async () =>
        activeUser({ mustChangePassword: true }),
      ),
    });
    const result = await login(repo, input(), context(), fakeDeps());
    expect(result.mustChangePassword).toBe(true);
  });

  it("#120 0-2 AC-6: 毎回違うトークンを発行する（同じアカウントの同時ログインを妨げない）", async () => {
    const repo = fakeRepository();
    const a = await login(repo, input(), context(), fakeDeps());
    const b = await login(repo, input(), context(), fakeDeps());
    expect(a.token).not.toBe(b.token);
  });
});

describe("verifyFirstFactor と issueSession（2段のログイン。#122 の拡張点）", () => {
  it("#120 0-2 AC-1: verifyFirstFactor はセッションを作らず、確認できた利用者を返す", async () => {
    const repo = fakeRepository();
    const verified = await verifyFirstFactor(
      repo,
      input(),
      context(),
      fakeDeps(),
    );
    expect(verified.user.id).toBe("01JTESTUSER000000000000001");
    expect(repo.createSession).not.toHaveBeenCalled();
  });

  it("#120 0-2 AC-1: issueSession が、確認済みの利用者のセッションを作ってトークンを返す", async () => {
    const repo = fakeRepository();
    const deps = fakeDeps();
    const verified = await verifyFirstFactor(repo, input(), context(), deps);
    const { token } = await issueSession(repo, verified, context(), deps);
    expect(repo.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: await sha256Hex(token) }),
    );
  });
});

describe("login（失敗。0-2 AC-7：どれが違うかを示さない）", () => {
  const cases: [string, Partial<AuthRepository>, string][] = [
    [
      "存在しない社員ID",
      { findLoginUser: vi.fn(async () => null) },
      TEST_PASSWORD,
    ],
    [
      "無効化した利用者（正しいパスワード）",
      { findLoginUser: vi.fn(async () => activeUser({ isActive: false })) },
      TEST_PASSWORD,
    ],
    ["誤ったパスワード", {}, "WrongPass123!"],
  ];

  it("#120 0-2 AC-7: 存在しない・無効・誤りは、どれも同じ INVALID_CREDENTIALS（同じ文言・同じ details）", async () => {
    const errors: AppError[] = [];
    for (const [label, overrides, password] of cases) {
      const error = await catchError(
        login(
          fakeRepository(overrides),
          input("testuser_001", password),
          context(),
          fakeDeps(),
        ),
      );
      expect(error, label).toBeInstanceOf(AppError);
      expect(error.code, label).toBe("INVALID_CREDENTIALS");
      errors.push(error);
    }
    const shapes = errors.map((e) => ({
      message: e.userMessage,
      details: e.details,
    }));
    expect(shapes[1]).toEqual(shapes[0]);
    expect(shapes[2]).toEqual(shapes[0]);
  });

  it("#120 0-2 AC-7（時間差対策）: 存在しない・無効・誤りのどれでも、パスワードの検証をちょうど1回呼ぶ", async () => {
    for (const [label, overrides, password] of cases) {
      const deps = fakeDeps();
      await catchError(
        login(
          fakeRepository(overrides),
          input("testuser_001", password),
          context(),
          deps,
        ),
      );
      expect(deps.verifyPassword, label).toHaveBeenCalledTimes(1);
    }
  });

  it("#120 0-2 AC-7: 存在しない社員IDでは、パスワードの検証に保存値なし（null。現行のダミーで計算）を渡す", async () => {
    const deps = fakeDeps();
    await catchError(
      login(
        fakeRepository({ findLoginUser: vi.fn(async () => null) }),
        input(),
        context(),
        deps,
      ),
    );
    expect(deps.verifyPassword).toHaveBeenCalledWith(TEST_PASSWORD, null);
  });

  it("#120 AC-3: 失敗は、社員IDのキー（HMAC）と trace の ID を付けて1回だけ記録する。セッションは作らない", async () => {
    const repo = fakeRepository();
    await catchError(
      login(
        repo,
        input("TestUser_001", "WrongPass123!"),
        context(),
        fakeDeps(),
      ),
    );
    expect(repo.recordLoginFailure).toHaveBeenCalledTimes(1);
    expect(repo.recordLoginFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        accountKey: await hmacHex(throttleKey, "testuser_001"),
        traceId: TRACE_ID,
      }),
    );
    expect(repo.createSession).not.toHaveBeenCalled();
  });

  it("#120 AC-3: 失敗の記録に、社員IDの文字列・パスワードを渡さない", async () => {
    const repo = fakeRepository();
    await catchError(
      login(
        repo,
        input("testuser_001", "WrongPass123!"),
        context(),
        fakeDeps(),
      ),
    );
    const args = JSON.stringify(
      (repo.recordLoginFailure as ReturnType<typeof vi.fn>).mock.calls,
    );
    expect(args).not.toContain("testuser_001");
    expect(args).not.toContain("WrongPass123!");
  });

  it("#120（失効との競合）: 検証と確定の間にパスワード・有効状態が変わり、セッションが入らなかったら 401 にしてトークンを返さない", async () => {
    const repo = fakeRepository({ createSession: vi.fn(async () => false) });
    const deps = fakeDeps();
    const error = await catchError(login(repo, input(), context(), deps));
    expect(error.code).toBe("INVALID_CREDENTIALS");
    expect(deps.hashPassword).not.toHaveBeenCalled();
  });
});

describe("login（接続元の受付枠。AC-3・D-1）", () => {
  it("#120 AC-3: 受付枠が取れない（ロック中）ときは 429 と Retry-After の秒数。利用者の検索・パスワードの計算・遅延をしない", async () => {
    const repo = fakeRepository({
      acquireSourceSlot: vi.fn(async () => ({
        accepted: false,
        lockedUntil: new Date(NOW.getTime() + 15 * 60_000).toISOString(),
        justLocked: false,
      })),
    });
    const deps = fakeDeps();
    const error = await catchError(login(repo, input(), context(), deps));
    expect(error.code).toBe("RATE_LIMITED");
    expect(error.details).toEqual({ retryAfterSeconds: 900 });
    expect(deps.verifyPassword).not.toHaveBeenCalled();
    expect(deps.sleep).not.toHaveBeenCalled();
    expect(repo.findLoginUser).not.toHaveBeenCalled();
    expect(repo.recordLoginFailure).not.toHaveBeenCalled();
  });

  it("#120 AC-3: 受付枠は、接続元のキーで、利用者の検索・計算より前に確保する", async () => {
    const order: string[] = [];
    const repo = fakeRepository({
      acquireSourceSlot: vi.fn(async () => {
        order.push("acquire");
        return { accepted: true, lockedUntil: null, justLocked: false };
      }),
      findLoginUser: vi.fn(async () => {
        order.push("find");
        return activeUser();
      }),
    });
    const deps = fakeDeps({
      verifyPassword: vi.fn(async () => {
        order.push("verify");
        return true;
      }),
    });
    await login(repo, input(), context(), deps);
    expect(order[0]).toBe("acquire");
    expect(order.indexOf("verify")).toBeGreaterThan(order.indexOf("acquire"));
    expect(repo.acquireSourceSlot).toHaveBeenCalledWith(
      "source",
      SOURCE_KEY,
      NOW,
    );
  });

  it("#120 AC-3: ロックに入った1回だけ auth.rate_limited を記録し、ロック中の429では記録しない", async () => {
    const lockedUntil = new Date(NOW.getTime() + 15 * 60_000).toISOString();
    const entering = fakeRepository({
      acquireSourceSlot: vi.fn(async () => ({
        accepted: false,
        lockedUntil,
        justLocked: true,
      })),
    });
    await catchError(login(entering, input(), context(), fakeDeps()));
    expect(entering.recordRateLimited).toHaveBeenCalledTimes(1);

    const during = fakeRepository({
      acquireSourceSlot: vi.fn(async () => ({
        accepted: false,
        lockedUntil,
        justLocked: false,
      })),
    });
    await catchError(login(during, input(), context(), fakeDeps()));
    expect(during.recordRateLimited).not.toHaveBeenCalled();
  });

  it("#120 0-2 AC-7: 429 の文言は、どの制限か・残り回数・アカウントの有無を示さない", async () => {
    const repo = fakeRepository({
      acquireSourceSlot: vi.fn(async () => ({
        accepted: false,
        lockedUntil: new Date(NOW.getTime() + 60_000).toISOString(),
        justLocked: false,
      })),
    });
    const error = await catchError(login(repo, input(), context(), fakeDeps()));
    expect(error.userMessage).not.toMatch(/接続元|IP|社員ID|回|アカウント/);
  });
});

describe("login（社員IDの段階的な遅延。0-2 AC-4・D-2）", () => {
  const lastFailedAt = new Date(NOW.getTime() - 60_000).toISOString();
  const expectations: [number, number][] = [
    [0, 0],
    [3, 0],
    [4, 1_000],
    [5, 2_000],
    [6, 4_000],
    [50, 4_000],
  ];

  for (const [failedCount, delay] of expectations) {
    it(`#120 0-2 AC-4: 失敗 ${failedCount} 回の社員IDは ${delay}ms 待ってから検証する（ロックはしない）`, async () => {
      const order: string[] = [];
      const repo = fakeRepository({
        readAccountThrottle: vi.fn(async () => ({ failedCount, lastFailedAt })),
      });
      const deps = fakeDeps({
        sleep: vi.fn(async (ms: number) => {
          order.push(`sleep:${ms}`);
        }),
        verifyPassword: vi.fn(async () => {
          order.push("verify");
          return true;
        }),
      });
      await expect(login(repo, input(), context(), deps)).resolves.toBeTruthy();
      const slept = (deps.sleep as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => Number(c[0]))
        .reduce((a, b) => a + b, 0);
      expect(slept).toBe(delay);
      if (delay > 0) expect(order.indexOf("verify")).toBeGreaterThan(0);
    });
  }

  it("#120 0-2 AC-4: 社員IDの状態は、小文字にした社員IDの HMAC キーで読む", async () => {
    const repo = fakeRepository();
    await login(repo, input("TESTUSER_001"), context(), fakeDeps());
    expect(repo.readAccountThrottle).toHaveBeenCalledWith(
      await hmacHex(throttleKey, "testuser_001"),
    );
  });

  it("#120 0-2 AC-4: 最後の失敗から15分を過ぎた社員IDは、待たない", async () => {
    const repo = fakeRepository({
      readAccountThrottle: vi.fn(async () => ({
        failedCount: 10,
        lastFailedAt: new Date(NOW.getTime() - 15 * 60_000).toISOString(),
      })),
    });
    const deps = fakeDeps();
    await login(repo, input(), context(), deps);
    const slept = (deps.sleep as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => Number(c[0]))
      .reduce((a, b) => a + b, 0);
    expect(slept).toBe(0);
  });
});

describe("login（再ハッシュ。AC-2）", () => {
  it("#120 AC-2: 必要なら、セッションの作成の後に新しいハッシュを作り、旧ハッシュが一致するときだけ置き換える", async () => {
    const order: string[] = [];
    const repo = fakeRepository({
      createSession: vi.fn(async () => {
        order.push("session");
        return true;
      }),
      updatePasswordHashIfUnchanged: vi.fn(async () => {
        order.push("rehash");
        return true;
      }),
    });
    const deps = fakeDeps({ needsRehash: vi.fn(() => true) });
    await login(repo, input(), context(), deps);
    expect(deps.hashPassword).toHaveBeenCalledWith(TEST_PASSWORD);
    expect(repo.updatePasswordHashIfUnchanged).toHaveBeenCalledWith(
      "01JTESTUSER000000000000001",
      activeUser().passwordHash,
      "$scrypt$ln=16,r=8,p=2$bmV3$bmV3aGFzaA",
    );
    expect(order).toEqual(["session", "rehash"]);
  });

  it("#120 AC-2: 再ハッシュが不要なら、計算も置き換えもしない", async () => {
    const repo = fakeRepository();
    const deps = fakeDeps();
    await login(repo, input(), context(), deps);
    expect(deps.hashPassword).not.toHaveBeenCalled();
    expect(repo.updatePasswordHashIfUnchanged).not.toHaveBeenCalled();
  });

  it("#120 AC-2（C-148）: 再ハッシュの保存が失敗しても、ログインは成功のまま、logger.error に残す", async () => {
    const repo = fakeRepository({
      updatePasswordHashIfUnchanged: vi.fn(async () => {
        throw new Error("D1 failed [UNIT_TEST]");
      }),
    });
    const deps = fakeDeps({ needsRehash: vi.fn(() => true) });
    const result = await login(repo, input(), context(), deps);
    expect(result.user.id).toBe("01JTESTUSER000000000000001");
    expect(errorSpy).toHaveBeenCalled();
    const output = errorSpy.mock.calls
      .map((c: unknown[]) => c.join(" "))
      .join("\n");
    expect(output).not.toContain(TEST_PASSWORD);
  });

  it("#120 AC-2: ログインに失敗したときは、再ハッシュしない", async () => {
    const repo = fakeRepository();
    const deps = fakeDeps({ needsRehash: vi.fn(() => true) });
    await catchError(
      login(repo, input("testuser_001", "WrongPass123!"), context(), deps),
    );
    expect(deps.hashPassword).not.toHaveBeenCalled();
    expect(repo.updatePasswordHashIfUnchanged).not.toHaveBeenCalled();
  });
});

describe("logout（0-2 AC-2・AC-6）", () => {
  it("#120 0-2 AC-2: 提示されたトークンのセッション（SHA-256）だけを失効させる", async () => {
    const repo = fakeRepository();
    const token = "unit-logout-token-000000000000000000000000";
    await logout(repo, { sessionToken: token, traceId: TRACE_ID }, fakeDeps());
    expect(repo.revokeSession).toHaveBeenCalledTimes(1);
    expect(repo.revokeSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: await sha256Hex(token),
        now: NOW,
        traceId: TRACE_ID,
      }),
    );
  });

  it("#120 0-2 AC-2: トークンがなければ DB に触れずに成功する（べき等）", async () => {
    const repo = fakeRepository();
    await expect(
      logout(repo, { sessionToken: null, traceId: TRACE_ID }, fakeDeps()),
    ).resolves.toBeUndefined();
    expect(repo.revokeSession).not.toHaveBeenCalled();
  });

  it("#120 0-2 AC-2: 失効の DB 処理が失敗したら、成功扱いにせず例外を伝える", async () => {
    const repo = fakeRepository({
      revokeSession: vi.fn(async () => {
        throw new Error("D1 failed [UNIT_TEST]");
      }),
    });
    await expect(
      logout(
        repo,
        {
          sessionToken: "unit-logout-token-000000000000000000000000",
          traceId: TRACE_ID,
        },
        fakeDeps(),
      ),
    ).rejects.toThrow("D1 failed [UNIT_TEST]");
  });
});

describe("cleanupExpired（掃除。AC-4・D-3）", () => {
  it("#120 AC-4: 500件ずつ、0件になる（500件未満が返る）まで繰り返し、件数を返す", async () => {
    const sessions = [500, 500, 200];
    const repo = fakeRepository({
      deleteExpiredSessions: vi.fn(async () => sessions.shift() ?? 0),
      deleteExpiredLoginAttempts: vi.fn(async () => 3),
    });
    const result = await cleanupExpired(repo, fakeDeps());
    expect(result).toEqual({ sessions: 1200, loginAttempts: 3 });
    expect(repo.deleteExpiredSessions).toHaveBeenCalledTimes(3);
    for (const call of (repo.deleteExpiredSessions as ReturnType<typeof vi.fn>)
      .mock.calls)
      expect(call).toEqual([NOW, 500]);
    expect(repo.deleteExpiredLoginAttempts).toHaveBeenCalledTimes(1);
  });

  it("#120 AC-4: 消すものがなくても成功する（べき等）", async () => {
    const repo = fakeRepository();
    await expect(cleanupExpired(repo, fakeDeps())).resolves.toEqual({
      sessions: 0,
      loginAttempts: 0,
    });
  });

  it("#120 AC-4: 件数が尽きなくても、回数の上限で止まる（無限に繰り返さない）", async () => {
    const repo = fakeRepository({
      deleteExpiredSessions: vi.fn(async () => 500),
    });
    await cleanupExpired(repo, fakeDeps());
    const calls = (repo.deleteExpiredSessions as ReturnType<typeof vi.fn>).mock
      .calls.length;
    expect(calls).toBeGreaterThan(1);
    expect(calls).toBeLessThanOrEqual(1000);
  });

  it("#120 AC-4: DB の失敗は、受け止めずに伝える", async () => {
    const repo = fakeRepository({
      deleteExpiredSessions: vi.fn(async () => {
        throw new Error("D1 failed [UNIT_TEST]");
      }),
    });
    await expect(cleanupExpired(repo, fakeDeps())).rejects.toThrow(
      "D1 failed [UNIT_TEST]",
    );
  });
});
