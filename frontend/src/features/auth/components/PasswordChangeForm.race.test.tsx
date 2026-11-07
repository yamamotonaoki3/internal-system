import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { useEffect } from "react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../../App";
import {
  installDomStubs,
  type DomStubs,
} from "../../../test/app-shell-harness";
import {
  respondPublicStatus,
  TEST_PASSWORD,
  TEST_USER,
} from "../../../test/auth-handlers";
import { server } from "../../../test/server";
import * as authApi from "../api/auth-api";
import { authKeys } from "../api/query-keys";
import { createUnauthenticatedHandler } from "../unauthenticated-handler";

const SESSION = {
  user: TEST_USER,
  mustChangePassword: false,
  reauthenticatedAt: null,
};
let stubs: DomStubs;
beforeEach(() => {
  stubs = installDomStubs();
});
afterEach(() => {
  stubs.restore();
  vi.restoreAllMocks();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function Controls({ client, paths }: { client: QueryClient; paths: string[] }) {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    paths.push(location.pathname);
  }, [location.pathname, paths]);
  const expired = createUnauthenticatedHandler({
    queryClient: client,
    navigate: (to) => {
      void navigate(to);
    },
    currentPath: () => location.pathname,
  });
  return (
    <>
      <output data-testid="path">{location.pathname}</output>
      <button
        onClick={() => {
          void navigate("/after");
        }}
      >
        別画面へ移動
      </button>
      <button
        onClick={() =>
          expired({
            status: 401,
            code: "UNAUTHENTICATED",
            message: "ログインしてください",
          })
        }
      >
        401を受信
      </button>
    </>
  );
}

describe("#123 0-3 AC-4 認証失効後の遅延成功（レビュー回帰）", () => {
  it.each(["logout", "401", "unmount"] as const)(
    "#123 0-3 AC-4: %s後の応答で旧sessionを戻さず、破棄フォームから遷移しない",
    async (reason) => {
      const response = deferred<Response>();
      const received = deferred<void>();
      let loggedIn = true;
      respondPublicStatus();
      server.use(
        http.get("/api/auth/session", () =>
          loggedIn
            ? HttpResponse.json(SESSION)
            : HttpResponse.json(
                { code: "UNAUTHENTICATED", message: "ログインしてください" },
                { status: 401 },
              ),
        ),
        http.post("/api/auth/logout", () => {
          loggedIn = false;
          return new HttpResponse(null, { status: 204 });
        }),
        http.put("/api/me/password", () => {
          received.resolve();
          return response.promise;
        }),
      );
      // 実通信は変更せず、応答処理が完了するまで検証を待つ。
      const original = authApi.changePassword;
      let delivered!: Promise<authApi.SessionInfo>;
      vi.spyOn(authApi, "changePassword").mockImplementation((input) => {
        delivered = original(input);
        return delivered;
      });
      const client = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      });
      const paths: string[] = [];
      const user = userEvent.setup();
      render(
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={["/password"]}>
            <Routes>
              <Route path="/after" element={<p>移動先</p>} />
              <Route path="*" element={<App />} />
            </Routes>
            <Controls client={client} paths={paths} />
          </MemoryRouter>
        </QueryClientProvider>,
      );
      await user.type(
        await screen.findByLabelText("現在のパスワード"),
        TEST_PASSWORD,
      );
      await user.type(
        screen.getByLabelText("新しいパスワード"),
        "Different456!",
      );
      await user.type(
        screen.getByLabelText("新しいパスワード（確認）"),
        "Different456!",
      );
      await user.click(
        screen.getByRole("button", { name: "パスワードを変更" }),
      );
      await received.promise;
      if (reason === "logout") {
        await user.click(
          screen.getByRole("button", {
            name: `アカウントメニュー（${TEST_USER.displayName}）`,
          }),
        );
        await user.click(screen.getByRole("button", { name: "ログアウト" }));
      } else if (reason === "401") {
        loggedIn = false;
        await user.click(screen.getByRole("button", { name: "401を受信" }));
      } else {
        await user.click(screen.getByRole("button", { name: "別画面へ移動" }));
      }
      const expectedPath = reason === "unmount" ? "/after" : "/login";
      await waitFor(() =>
        expect(screen.getByTestId("path").textContent).toBe(expectedPath),
      );
      const before = client.getQueryData(authKeys.session);
      const pathsBefore = [...paths];
      await act(async () => {
        response.resolve(HttpResponse.json(SESSION));
        await delivered;
      });
      expect(client.getQueryData(authKeys.session)).toBe(before);
      expect(screen.getByTestId("path").textContent).toBe(expectedPath);
      expect(paths).toEqual(pathsBefore);
      expect(
        screen.queryByText(`ようこそ、${TEST_USER.displayName}さん`),
      ).toBeNull();
    },
  );
});
