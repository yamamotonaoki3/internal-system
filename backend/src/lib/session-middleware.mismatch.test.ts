// #298 AC-1・AC-2：loadSession が X-Expected-User-Id を読み、Cookie のセッションの利用者と食い違えば、
// requireAuth・初回パスワードのゲート・ルートより前に 409 SESSION_USER_MISMATCH（Cache-Control: no-store）で断る。公開の経路でも同じ。
// 単体：セッションの DB 処理（WithSessions）を差し替え、ミドルウェアとエラーハンドラだけを組んだ Hono のアプリで確かめる。
// ヘッダーの名前・コードはリテラルで書く（本番の定数を読み込まない）。異常な値は fast-check で作る。
import fc from "fast-check";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  SessionRecord,
  SessionRepository,
} from "../db/session.repository";
import type { WithSessions } from "../services/session.service";
import { handleError, handleNotFound } from "./error-handler";
import {
  loadSession,
  noStoreForProtected,
  requireAuth,
  requirePasswordChanged,
} from "./session-middleware";

const HEADER = "X-Expected-User-Id";
const USER_B = "01JB0000000000000000000BBB";
const USER_A = "01JA0000000000000000000AAA";

let logLines: string[];
let routeCalls: number;
let touchSession: ReturnType<typeof vi.fn<SessionRepository["touchSession"]>>;

function sessionOf(overrides: Partial<SessionRecord> = {}): SessionRecord {
  const now = Date.now();
  return {
    userId: USER_B,
    displayName: "テスト太郎",
    loginId: "testuser_mismatch_b",
    mustChangePassword: false,
    reauthenticatedAt: null,
    isActive: true,
    createdAt: new Date(now - 10 * 60_000).toISOString(),
    lastActiveAt: new Date(now - 5 * 60_000).toISOString(),
    revokedAt: null,
    ...overrides,
  };
}

function buildApp(found: SessionRecord | null = sessionOf()) {
  touchSession = vi.fn<SessionRepository["touchSession"]>(async () => true);
  const repository: SessionRepository = {
    findSession: vi.fn(async () => found),
    touchSession,
  };
  const withSessions: WithSessions = (_env, run) => run(repository);
  const handler = (status: 200 | 204) => () => {
    routeCalls += 1;
    return status === 204 ? new Response(null, { status }) : Response.json({});
  };
  return new Hono<{ Bindings: Env }>()
    .use(
      "/api/*",
      noStoreForProtected,
      loadSession(withSessions),
      requireAuth,
      requirePasswordChanged,
    )
    .post("/api/auth/logout", handler(204))
    .get("/api/auth/session", handler(200))
    .post("/api/protected", handler(200))
    .onError(handleError)
    .notFound(handleNotFound);
}

const call = (
  app: Hono<{ Bindings: Env }>,
  method: string,
  path: string,
  expected?: string,
  cookie: string | null = "test-token-298",
) => {
  const headers: Record<string, string> = {};
  if (cookie !== null) headers.Cookie = `__Host-session=${cookie}`;
  if (expected !== undefined) headers[HEADER] = expected;
  return app.request(path, { method, headers });
};

beforeEach(() => {
  logLines = [];
  routeCalls = 0;
  for (const level of ["log", "warn", "error", "info", "debug"] as const)
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logLines.push(args.map(String).join(" "));
    });
});
afterEach(() => vi.restoreAllMocks());

describe("#298 AC-1 loadSession の食い違いの判定", () => {
  it("#298 AC-1: 保護された経路で食い違えば 409 SESSION_USER_MISMATCH・no-store。ルートを呼ばず、最終操作の時刻も更新しない", async () => {
    const res = await call(buildApp(), "POST", "/api/protected", USER_A);
    expect(res.status).toBe(409);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("SESSION_USER_MISMATCH");
    expect(typeof body.message).toBe("string");
    expect(routeCalls).toBe(0);
    expect(touchSession).not.toHaveBeenCalled();
  });

  it.each([
    ["POST", "/api/auth/logout"],
    ["GET", "/api/auth/session"],
  ])(
    "#298 AC-1・AC-2: 公開の経路（%s %s）でも、セッションがあって食い違えば 409 と no-store。ルートを呼ばない",
    async (method, path) => {
      const res = await call(buildApp(), method, path, USER_A);
      expect(res.status).toBe(409);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(await res.json()).toMatchObject({
        code: "SESSION_USER_MISMATCH",
      });
      expect(routeCalls).toBe(0);
    },
  );

  it("#298 AC-2: 食い違ったログアウトは、セッションの Cookie を消す Set-Cookie を付けない", async () => {
    const res = await call(buildApp(), "POST", "/api/auth/logout", USER_A);
    expect(res.status).toBe(409);
    expect(res.headers.get("Set-Cookie") ?? "").not.toContain("__Host-session");
  });

  it("#298 AC-1: 初回パスワードのままの利用者でも、食い違いは PASSWORD_CHANGE_REQUIRED より先に 409", async () => {
    const res = await call(
      buildApp(sessionOf({ mustChangePassword: true })),
      "POST",
      "/api/protected",
      USER_A,
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "SESSION_USER_MISMATCH" });
  });

  it("#298 AC-1: 一致・ヘッダーなしは今どおりルートに届く", async () => {
    const app = buildApp();
    expect((await call(app, "POST", "/api/protected", USER_B)).status).toBe(
      200,
    );
    expect((await call(app, "POST", "/api/protected")).status).toBe(200);
    expect(routeCalls).toBe(2);
  });

  it("#298 AC-1: Cookie が無い要求は、ヘッダーがあっても今どおり（保護は 401、公開のログアウトは 204）", async () => {
    const app = buildApp();
    const protectedRes = await call(
      app,
      "POST",
      "/api/protected",
      USER_A,
      null,
    );
    expect(protectedRes.status).toBe(401);
    expect(await protectedRes.json()).toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(
      (await call(app, "POST", "/api/auth/logout", USER_A, null)).status,
    ).toBe(204);
  });

  it.each([
    [
      "失効",
      sessionOf({ revokedAt: new Date(Date.now() - 60_000).toISOString() }),
    ],
    [
      "期限切れ",
      sessionOf({
        lastActiveAt: new Date(Date.now() - 31 * 60_000).toISOString(),
      }),
    ],
    ["存在しないトークン", null],
  ] as const)(
    "#298 AC-1: セッションが%sなら、食い違いのヘッダーがあっても 409 ではなく今どおり 401",
    async (_label, found) => {
      const res = await call(buildApp(found), "POST", "/api/protected", USER_A);
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
    },
  );

  it("#298 AC-1: 65文字の値（先頭は B の ID）は食い違いとして 409", async () => {
    const res = await call(
      buildApp(),
      "POST",
      "/api/protected",
      USER_B.padEnd(65, "0"),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "SESSION_USER_MISMATCH" });
  });

  it.each([
    ["空", ""],
    ["空白だけ", "   "],
  ])(
    "#298 AC-1: ヘッダーがあって値が%sなら、食い違いとして 409・no-store（ルートを呼ばない）",
    async (_label, value) => {
      const res = await call(buildApp(), "POST", "/api/protected", value);
      expect(res.status).toBe(409);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      expect(await res.json()).toMatchObject({
        code: "SESSION_USER_MISMATCH",
      });
      expect(routeCalls).toBe(0);
    },
  );

  it("#298 AC-1: 任意の文字列（印字可能な ASCII・長さ1〜200）は、B の ID と違えば必ず 409・no-store で、500 にならない", async () => {
    const printable = fc
      .integer({ min: 0x21, max: 0x7e })
      .map((code) => String.fromCharCode(code));
    await fc.assert(
      fc.asyncProperty(
        fc
          .string({ unit: printable, minLength: 1, maxLength: 200 })
          .filter((value) => value !== USER_B),
        async (value) => {
          const res = await call(buildApp(), "POST", "/api/protected", value);
          expect(res.status).toBe(409);
          expect(res.headers.get("Cache-Control")).toBe("no-store");
          expect(((await res.json()) as { code?: string }).code).toBe(
            "SESSION_USER_MISMATCH",
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  it("#298 AC-1: ヘッダーの値を、ログにも応答の本文にも出さない", async () => {
    const marker = "testuser_header_marker_298";
    const res = await call(buildApp(), "POST", "/api/protected", marker);
    expect(res.status).toBe(409);
    expect(await res.text()).not.toContain(marker);
    expect(logLines.join("\n")).not.toContain(marker);
  });
});
