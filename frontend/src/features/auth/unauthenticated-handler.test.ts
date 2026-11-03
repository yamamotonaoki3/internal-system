// #120 AC-1（0-2 AC-5・AC-8）：401 を受けたときの共通の処理（main.tsx が setUnauthenticatedHandler で1回だけ登録する）。
// code=UNAUTHENTICATED（期限切れ・失効）のときだけ、セッションのキャッシュを捨てて /login へ移る。
// 期限切れでは、ほかのキャッシュ（下書きにつながる状態）を消さない（0-2 AC-8：消すのは手動ログアウトのときだけ）。
// 公開形の仮定：createUnauthenticatedHandler({ queryClient, navigate, currentPath }) が (error: ApiError) => void を返す。
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  apiClient,
  setUnauthenticatedHandler,
  type ApiError,
} from "../../services/api-client";
import { TEST_USER } from "../../test/auth-handlers";
import { server } from "../../test/server";
import { authKeys } from "./api/query-keys";
import { createUnauthenticatedHandler } from "./unauthenticated-handler";

const OTHER_KEY = ["sample", "業務のデータ"] as const;

function prepare(path = "/") {
  const queryClient = new QueryClient();
  queryClient.setQueryData(authKeys.session, {
    user: TEST_USER,
    mustChangePassword: false,
  });
  queryClient.setQueryData(OTHER_KEY, { draft: "[UNIT_TEST]書きかけ" });
  let current = path;
  const navigate = vi.fn((to: string) => {
    current = to;
  });
  const handler = createUnauthenticatedHandler({
    queryClient,
    navigate,
    currentPath: () => current,
  });
  return { queryClient, navigate, handler };
}

const error = (code: string, status = 401): ApiError => ({
  status,
  code,
  message: "x",
});

afterEach(() => {
  setUnauthenticatedHandler(() => undefined);
});

describe("#120 AC-1 401 の共通の処理", () => {
  it("#120 AC-1（0-2 AC-5）: UNAUTHENTICATED ではセッションのキャッシュを捨てて /login へ移る", () => {
    const { queryClient, navigate, handler } = prepare("/");
    handler(error("UNAUTHENTICATED"));
    expect(queryClient.getQueryData(authKeys.session)).toBeUndefined();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/login");
  });

  it("#120 AC-1（0-2 AC-8）: 期限切れの 401 では、セッション以外のキャッシュを消さない", () => {
    const { queryClient, handler } = prepare("/");
    handler(error("UNAUTHENTICATED"));
    expect(queryClient.getQueryData(OTHER_KEY)).toEqual({
      draft: "[UNIT_TEST]書きかけ",
    });
  });

  it("#120 AC-1: 続けて 401 を受けても、/login への移動は1回だけ（重複しない）", () => {
    const { navigate, handler } = prepare("/");
    handler(error("UNAUTHENTICATED"));
    handler(error("UNAUTHENTICATED"));
    handler(error("UNAUTHENTICATED"));
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("#120 AC-1: すでに /login にいるときは移らない", () => {
    const { navigate, handler } = prepare("/login");
    handler(error("UNAUTHENTICATED"));
    expect(navigate).not.toHaveBeenCalled();
  });

  it("#120 AC-1: INVALID_CREDENTIALS（ログインの失敗）では、移らずキャッシュも捨てない", () => {
    const { queryClient, navigate, handler } = prepare("/login");
    handler(error("INVALID_CREDENTIALS"));
    expect(navigate).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(authKeys.session)).toBeDefined();
  });

  it("#120 AC-1: apiClient が 401 UNAUTHENTICATED を受けると、登録した処理が呼ばれて /login へ移る", async () => {
    server.use(
      http.get("/api/sample-users", () =>
        HttpResponse.json(
          { code: "UNAUTHENTICATED", message: "x" },
          { status: 401 },
        ),
      ),
    );
    const { navigate, handler } = prepare("/");
    setUnauthenticatedHandler(handler);
    await expect(apiClient.get("/sample-users")).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHENTICATED",
    });
    expect(navigate).toHaveBeenCalledWith("/login");
  });

  it("#120 AC-1: 403 PASSWORD_CHANGE_REQUIRED では /login に移らない（失敗としては呼び出し元へ返す）", async () => {
    server.use(
      http.get("/api/sample-users", () =>
        HttpResponse.json(
          { code: "PASSWORD_CHANGE_REQUIRED", message: "x" },
          { status: 403 },
        ),
      ),
    );
    const { queryClient, navigate, handler } = prepare("/");
    setUnauthenticatedHandler(handler);
    await expect(apiClient.get("/sample-users")).rejects.toMatchObject({
      status: 403,
      code: "PASSWORD_CHANGE_REQUIRED",
    });
    expect(navigate).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(authKeys.session)).toBeDefined();
    // 直接呼ばれた場合も移らない
    handler(error("PASSWORD_CHANGE_REQUIRED", 403));
    expect(navigate).not.toHaveBeenCalled();
  });
});
