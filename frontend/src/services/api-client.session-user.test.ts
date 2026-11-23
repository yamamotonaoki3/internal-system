// #298 AC-3・AC-5・AC-6（計画 plan-298 改訂3 の 2-1・2-2・2-6、8-1 の AC-3 の単体の行）：
// 画面は、この文書で最初に確定した利用者を、要求ヘッダー X-Expected-User-Id で付ける。セッションの取得・ログインには付けない。ログアウトには付ける。
// 401・別の利用者への替わりの後も、読み込み直すまで値を変えない。409 SESSION_USER_MISMATCH を受けたら、登録した処理を呼び、エラーは失敗として返す（もみ消さない）。
// 期待の値（ヘッダーの名前・利用者の ID・エラーのコード）は、本番の定義から取り込まず、ここにリテラルで書く。
// api-client・document-user は文書ごとの状態を持つので、各テストで vi.resetModules して新しい文書として読み込む。
// 前提にした口（実装の担当へ）：
//   services/api-client.ts の setExpectedUserIdProvider(provider: (request: { method: string; url: string }) => string | undefined)
//     （url は baseURL を除いた、要求に渡した値。method は大文字・小文字を問わない）
//   services/api-client.ts の setSessionUserMismatchHandler(handler: (error: ApiError) => void)
//   features/auth（index）の installDocumentUser(queryClient): () => void と expectedUserIdFor（provider の形）
// データはすべて架空（testuser_298_・[UNIT_TEST]）。
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server";

const HEADER = "X-Expected-User-Id";
const USER_A = "01JTESTUSER298A00000000001";
const USER_B = "01JTESTUSER298B00000000001";
const SESSION_KEY = ["auth", "session"] as const;

function sessionOf(id: string) {
  return {
    user: { id, displayName: `testuser_298_${id.slice(-3)}`, loginId: id },
    permissions: [],
    mustChangePassword: false,
    reauthenticatedAt: null,
  };
}

/** 新しい文書として読み込む */
async function freshDocument() {
  vi.resetModules();
  const api = await import("./api-client");
  const auth = await import("../features/auth");
  return { api, auth };
}

/** 受けた要求のヘッダーを記録する（どの要求にも 200 を返す） */
function recordHeaders() {
  const seen: { method: string; path: string; header: string | null }[] = [];
  const record = ({ request }: { request: Request }) => {
    seen.push({
      method: request.method,
      path: new URL(request.url).pathname,
      header: request.headers.get(HEADER),
    });
    return HttpResponse.json(sessionOf(USER_A));
  };
  server.use(
    http.get("/api/*", record),
    http.post("/api/*", record),
    http.put("/api/*", record),
    http.delete("/api/*", record),
  );
  const last = () => seen[seen.length - 1];
  return { seen, last };
}

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

describe("#298 AC-3 api-client のヘッダーの提供元", () => {
  it("#298 AC-3: 提供元を登録していないときは、ヘッダーを付けない", async () => {
    const { api } = await freshDocument();
    const rec = recordHeaders();
    await api.apiClient.get("/[UNIT_TEST]298-read");
    expect(rec.last()?.header).toBeNull();
  });

  it("#298 AC-3: 登録した提供元の値をヘッダーに付ける。提供元は、要求の method と url を受け取る", async () => {
    const { api } = await freshDocument();
    const rec = recordHeaders();
    const provider = vi.fn(() => USER_A);
    api.setExpectedUserIdProvider(provider);
    await api.apiClient.post("/[UNIT_TEST]298-write", { value: 1 });
    expect(rec.last()?.header).toBe(USER_A);
    const request = provider.mock.calls[0]?.[0] as
      { method: string; url: string } | undefined;
    expect(request?.method.toLowerCase()).toBe("post");
    expect(request?.url).toBe("/[UNIT_TEST]298-write");
  });

  it("#298 AC-3: 提供元が undefined を返した要求には、ヘッダーを付けない", async () => {
    const { api } = await freshDocument();
    const rec = recordHeaders();
    api.setExpectedUserIdProvider(() => undefined);
    await api.apiClient.get("/[UNIT_TEST]298-read");
    expect(rec.last()?.header).toBeNull();
  });
});

describe("#298 AC-3 文書の利用者（document-user）とヘッダー", () => {
  async function wired() {
    const m = await freshDocument();
    const client = new QueryClient();
    disposers.push(m.auth.installDocumentUser(client));
    m.api.setExpectedUserIdProvider(m.auth.expectedUserIdFor);
    const rec = recordHeaders();
    return { ...m, client, rec };
  }

  it("#298 AC-3: 文書の利用者が確定する前（ログイン画面など）は、ヘッダーを付けない", async () => {
    const { api, rec } = await wired();
    await api.apiClient.get("/health");
    expect(rec.last()?.header).toBeNull();
  });

  it("#298 AC-3: 最初に確定した A を、読み取り・書き込み（POST・PUT・DELETE）に付ける", async () => {
    const { api, client, rec } = await wired();
    client.setQueryData(SESSION_KEY, sessionOf(USER_A));
    await api.apiClient.get("/channels");
    await api.apiClient.post("/rooms/[UNIT_TEST]298/messages", { body: "x" });
    await api.apiClient.put("/me/profile", { displayName: "x" });
    await api.apiClient.delete("/messages/[UNIT_TEST]298");
    expect(rec.seen.map((entry) => entry.header)).toEqual([
      USER_A,
      USER_A,
      USER_A,
      USER_A,
    ]);
  });

  it("#298 AC-3: セッションのキャッシュが B に替わった後に始めた要求にも、A を付ける（読み込み直すまで変えない）", async () => {
    const { api, client, rec } = await wired();
    client.setQueryData(SESSION_KEY, sessionOf(USER_A));
    client.setQueryData(SESSION_KEY, sessionOf(USER_B));
    await api.apiClient.post("/rooms/[UNIT_TEST]298/messages", { body: "x" });
    expect(rec.last()?.header).toBe(USER_A);
  });

  it("#298 AC-3: 401 でセッションのキャッシュが消えた後の要求にも、A を付ける", async () => {
    const { api, client, rec } = await wired();
    client.setQueryData(SESSION_KEY, sessionOf(USER_A));
    client.removeQueries({ queryKey: SESSION_KEY });
    await api.apiClient.get("/channels");
    expect(rec.last()?.header).toBe(USER_A);
  });

  it("#298 AC-3: 最初のセッションの確認が 401 でも（未ログインで始まった文書）、後で最初に確定した利用者を付ける", async () => {
    const { api, client, rec } = await wired();
    client.removeQueries({ queryKey: SESSION_KEY });
    client.setQueryData(SESSION_KEY, sessionOf(USER_B));
    await api.apiClient.get("/channels");
    expect(rec.last()?.header).toBe(USER_B);
  });

  it("#298 AC-3: セッションの取得（GET /auth/session）とログイン（POST /auth/login）には付けない。ログアウト（POST /auth/logout）には付ける", async () => {
    const { api, client, rec } = await wired();
    client.setQueryData(SESSION_KEY, sessionOf(USER_A));
    await api.apiClient.get("/auth/session");
    await api.apiClient.post("/auth/login", {
      loginId: "testuser_298_b",
      password: "TestPass123!",
    });
    await api.apiClient.post("/auth/logout");
    expect(rec.seen).toEqual([
      { method: "GET", path: "/api/auth/session", header: null },
      { method: "POST", path: "/api/auth/login", header: null },
      { method: "POST", path: "/api/auth/logout", header: USER_A },
    ]);
  });
});

describe("#298 AC-6 409 SESSION_USER_MISMATCH の処理の登録", () => {
  function respond(status: number, code: string) {
    server.use(
      http.get("/api/[UNIT_TEST]298-fail", () =>
        HttpResponse.json({ code, message: "x" }, { status }),
      ),
    );
  }

  async function failOf(api: typeof import("./api-client")) {
    return api.apiClient.get("/[UNIT_TEST]298-fail").then(
      () => {
        throw new Error("成功してはいけない");
      },
      (error: unknown) => error,
    );
  }

  it("#298 AC-6: 409 SESSION_USER_MISMATCH では、登録した処理を1回呼び、エラーは失敗として呼び出し元へ返す（401 の処理は呼ばない）", async () => {
    const { api } = await freshDocument();
    const onMismatch = vi.fn();
    const onUnauthenticated = vi.fn();
    api.setSessionUserMismatchHandler(onMismatch);
    api.setUnauthenticatedHandler(onUnauthenticated);
    respond(409, "SESSION_USER_MISMATCH");
    const error = await failOf(api);
    expect(error).toMatchObject({ status: 409, code: "SESSION_USER_MISMATCH" });
    expect(onMismatch).toHaveBeenCalledTimes(1);
    expect(onMismatch.mock.calls[0]?.[0]).toMatchObject({
      status: 409,
      code: "SESSION_USER_MISMATCH",
    });
    expect(onUnauthenticated).not.toHaveBeenCalled();
    // 競合（CONFLICT）の分岐には入らない（AC-5）
    expect(api.isConflictError(error)).toBe(false);
  });

  it("#298 AC-5: 409 CONFLICT では、食い違いの処理を呼ばない（競合の判定はこれまでどおり）", async () => {
    const { api } = await freshDocument();
    const onMismatch = vi.fn();
    api.setSessionUserMismatchHandler(onMismatch);
    respond(409, "CONFLICT");
    const error = await failOf(api);
    expect(api.isConflictError(error)).toBe(true);
    expect(onMismatch).not.toHaveBeenCalled();
  });

  it("#298 AC-6: 401・403・500 では、食い違いの処理を呼ばない", async () => {
    const { api } = await freshDocument();
    const onMismatch = vi.fn();
    api.setSessionUserMismatchHandler(onMismatch);
    api.setUnauthenticatedHandler(() => undefined);
    for (const [status, code] of [
      [401, "UNAUTHENTICATED"],
      [403, "FORBIDDEN"],
      [500, "INTERNAL_ERROR"],
    ] as const) {
      respond(status, code);
      await failOf(api);
    }
    expect(onMismatch).not.toHaveBeenCalled();
  });

  it("#298 AC-6: 処理を登録していなくても、409 SESSION_USER_MISMATCH は失敗として返る（例外で落ちない）", async () => {
    const { api } = await freshDocument();
    respond(409, "SESSION_USER_MISMATCH");
    expect(await failOf(api)).toMatchObject({
      status: 409,
      code: "SESSION_USER_MISMATCH",
    });
  });
});
