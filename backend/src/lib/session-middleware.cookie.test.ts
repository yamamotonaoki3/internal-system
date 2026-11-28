// #383 AC-1・AC-2（2026-11-25 の利用者の決定で書き換えた AC-2）：期限切れ・失効・無効なセッションの Cookie を持った通常の要求は、
// 今までどおり認証を拒否する（保護された経路は 401）が、応答でセッションの Cookie を消さない（Set-Cookie を付けない）。
// 明示的なログアウトの Cookie の削除は、ルートが失効を確定した後に行う（ミドルウェアは消さない。対照として確かめる）。
// 単体：セッションの DB 処理（WithSessions）を差し替え、ミドルウェアとエラーハンドラだけを組んだ Hono のアプリで確かめる。
// Cookie の名前・コードはリテラルで書く（本番の定数を読み込まない。独立した期待値）。データは架空のもの（testuser_cookie_383）。
import { Hono, type Context } from "hono";
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

const SESSION_COOKIE_NAME = "__Host-session";
const MIN = 60_000;

let routeCalls: number;

function sessionOf(overrides: Partial<SessionRecord> = {}): SessionRecord {
  const now = Date.now();
  return {
    userId: "01JC0000000000000000000383",
    displayName: "テスト太郎",
    loginId: "testuser_cookie_383",
    mustChangePassword: false,
    reauthenticatedAt: null,
    isActive: true,
    createdAt: new Date(now - 10 * MIN).toISOString(),
    lastActiveAt: new Date(now - 5 * MIN).toISOString(),
    revokedAt: null,
    ...overrides,
  };
}

function buildApp(findSession: SessionRepository["findSession"]) {
  const repository: SessionRepository = {
    findSession: vi.fn(findSession),
    touchSession: vi.fn<SessionRepository["touchSession"]>(async () => true),
  };
  const withSessions: WithSessions = (_env, run) => run(repository);
  // 実際のルートと同じく、Context（c.json・c.body）で応答を作る。素の Response を返すと、ミドルウェアが付けたヘッダー（Set-Cookie）が落ち、検出できない
  const handler = (status: 200 | 204) => (c: Context) => {
    routeCalls += 1;
    return status === 204 ? c.body(null, 204) : c.json({});
  };
  return new Hono<{ Bindings: Env }>()
    .use(
      "/api/*",
      noStoreForProtected,
      loadSession(withSessions),
      requireAuth,
      requirePasswordChanged,
    )
    .get("/api/health", handler(200))
    .get("/api/auth/session", handler(200))
    .post("/api/auth/logout", handler(204))
    .get("/api/me/unread", handler(200))
    .post("/api/protected", handler(200))
    .onError(handleError)
    .notFound(handleNotFound);
}

const call = (
  app: Hono<{ Bindings: Env }>,
  method: string,
  path: string,
  cookie: string | null,
) =>
  app.request(path, {
    method,
    headers:
      cookie === null ? {} : { Cookie: `${SESSION_COOKIE_NAME}=${cookie}` },
  });

/** 応答の Set-Cookie のうち、セッションの Cookie（名前が __Host-session）のものだけ。中身が分かるよう、文字列のまま返す */
function sessionSetCookies(res: Response): string[] {
  return res.headers
    .getSetCookie()
    .filter((line) => line.trim().startsWith(`${SESSION_COOKIE_NAME}=`));
}

/** その Set-Cookie が、Cookie を消す指示か（Max-Age=0 以下・過去の Expires・空の値） */
function isDeletion(line: string): boolean {
  const [pair = "", ...attrs] = line.split(";").map((s) => s.trim());
  const value = pair.slice(pair.indexOf("=") + 1);
  return (
    value === "" ||
    attrs.some((attr) => {
      const [name = "", raw = ""] = attr.split("=");
      if (name.toLowerCase() === "max-age") return Number(raw) <= 0;
      if (name.toLowerCase() === "expires")
        return new Date(raw).getTime() <= Date.now();
      return false;
    })
  );
}

/** 通常の要求の応答では、セッションの Cookie を消さない（Set-Cookie で Cookie を変えない） */
function expectSessionCookieUntouched(res: Response) {
  const lines = sessionSetCookies(res);
  expect(
    lines.filter(isDeletion),
    "セッションの Cookie を消す Set-Cookie",
  ).toEqual([]);
  expect(lines, "セッションの Cookie の Set-Cookie").toEqual([]);
}

beforeEach(() => {
  routeCalls = 0;
  for (const level of ["log", "warn", "error", "info", "debug"] as const)
    vi.spyOn(console, level).mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

/** 使えないセッション（resolveSession が null にするもの）。期限は 0-2 AC-5 の値（無操作30分・ログインから24時間）から独立に作る */
const UNUSABLE: readonly (readonly [string, () => SessionRecord | null])[] = [
  [
    "失効",
    () => sessionOf({ revokedAt: new Date(Date.now() - MIN).toISOString() }),
  ],
  [
    "期限切れ（無操作30分）",
    () =>
      sessionOf({
        lastActiveAt: new Date(Date.now() - 30 * MIN - 1000).toISOString(),
      }),
  ],
  [
    "期限切れ（ログインから24時間）",
    () =>
      sessionOf({
        createdAt: new Date(Date.now() - 24 * 60 * MIN - 1000).toISOString(),
        lastActiveAt: new Date(Date.now() - MIN).toISOString(),
      }),
  ],
  ["存在しないトークン", () => null],
  ["無効化された利用者", () => sessionOf({ isActive: false })],
];

describe("#383 AC-1・AC-2 loadSession：使えないセッションの Cookie を、通常の要求の応答で消さない", () => {
  it.each(UNUSABLE)(
    "#383 AC-1・AC-2: セッションが%sなら、保護された API（GET）は 401 UNAUTHENTICATED のまま、セッションの Cookie を消さない",
    async (_label, found) => {
      const res = await call(
        buildApp(async () => found()),
        "GET",
        "/api/me/unread",
        "test-token-383",
      );
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
      expect(routeCalls).toBe(0);
      expectSessionCookieUntouched(res);
    },
  );

  it.each(UNUSABLE)(
    "#383 AC-1・AC-2: セッションが%sなら、保護された API（POST）も 401 のまま、セッションの Cookie を消さない",
    async (_label, found) => {
      const res = await call(
        buildApp(async () => found()),
        "POST",
        "/api/protected",
        "test-token-383",
      );
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
      expectSessionCookieUntouched(res);
    },
  );

  it.each(UNUSABLE)(
    "#383 AC-2: セッションが%sなら、GET /api/auth/session に届いても（ルートの応答のまま）、ミドルウェアはセッションの Cookie を消さない",
    async (_label, found) => {
      const res = await call(
        buildApp(async () => found()),
        "GET",
        "/api/auth/session",
        "test-token-383",
      );
      expect(routeCalls).toBe(1);
      expectSessionCookieUntouched(res);
    },
  );

  it.each(UNUSABLE)(
    "#383 AC-2: セッションが%sでも、認証の要らない GET /api/health は今までの応答（200）のまま、セッションの Cookie を消さない",
    async (_label, found) => {
      const res = await call(
        buildApp(async () => found()),
        "GET",
        "/api/health",
        "test-token-383",
      );
      expect(res.status).toBe(200);
      expectSessionCookieUntouched(res);
    },
  );

  it.each([
    ["使えない文字を含む値", "not*a*valid*token"],
    ["極端に長い値", "x".repeat(4096)],
    ["1文字", "x"],
  ])(
    "#383 AC-1・AC-2: 形の壊れたトークン（%s）でも、保護された API は 401 のまま、セッションの Cookie を消さない",
    async (_label, token) => {
      const res = await call(
        buildApp(async () => null),
        "GET",
        "/api/me/unread",
        token,
      );
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
      expectSessionCookieUntouched(res);
    },
  );
});

describe("#383 AC-2 loadSession：今までどおりの動き（退行の確認）", () => {
  it("#383 AC-2: Cookie が無い・空の要求は、保護された API が 401 で、Set-Cookie を付けない", async () => {
    const app = buildApp(async () => sessionOf());
    for (const cookie of [null, ""]) {
      const res = await call(app, "GET", "/api/me/unread", cookie);
      expect(res.status, String(cookie)).toBe(401);
      expectSessionCookieUntouched(res);
    }
  });

  it("#383 AC-2: 有効なセッションの要求は、ルートに届き、Set-Cookie を付けない", async () => {
    const res = await call(
      buildApp(async () => sessionOf()),
      "GET",
      "/api/me/unread",
      "test-token-383",
    );
    expect(res.status).toBe(200);
    expect(routeCalls).toBe(1);
    expectSessionCookieUntouched(res);
  });

  it("#383 AC-2（error-api）: セッションの読み取りが DB の失敗で落ちたら、未ログインとして扱わず 500 を返し、セッションの Cookie を消さない", async () => {
    const res = await call(
      buildApp(async () => {
        throw new Error("D1 failed [UNIT_TEST]");
      }),
      "GET",
      "/api/me/unread",
      "test-token-383",
    );
    expect(res.status).toBe(500);
    expect(routeCalls).toBe(0);
    expectSessionCookieUntouched(res);
  });

  it.each(UNUSABLE)(
    "#383 AC-2（対照）: セッションが%sのログアウトは、ミドルウェアでは消さず、ルートに届く（削除はルートが失効の確定の後に行う）",
    async (_label, found) => {
      const res = await call(
        buildApp(async () => found()),
        "POST",
        "/api/auth/logout",
        "test-token-383",
      );
      expect(res.status).toBe(204);
      expect(routeCalls).toBe(1);
      expectSessionCookieUntouched(res);
    },
  );
});
