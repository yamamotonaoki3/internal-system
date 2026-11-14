// #137：スレッド（S-07・S-35）のテストで使う共通の描画（架空のデータのみ）。
// ThreadPane は useThreadParam（URL のクエリ ?thread=）を使うため、ルーター（MemoryRouter）の中に置く。
// 利用者は SELF（message() の既定の投稿者と同じ ID）としてログイン済みにする（自分の返信の判定・下書きのキー）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { vi } from "vitest";
import { authKeys } from "../features/auth";
import { ReauthProvider } from "../features/auth/ReauthProvider";
import { ThreadPane } from "../features/threads";
import { server } from "./server";

export const SELF = {
  id: "01JTESTUSER000000000000001",
  displayName: "testuser_001",
  loginId: "testuser_001",
} as const;

/** 現在の場所（パス＋クエリ）を出す。URL の確認に使う */
export function CurrentUrl() {
  const location = useLocation();
  return <div data-testid="url">{location.pathname + location.search}</div>;
}

/** GET /api/auth/session：SELF としてログイン済み（セッションを取り直す部品があっても未処理の通信にならないように） */
export function respondSelf() {
  server.use(
    http.get("/api/auth/session", () =>
      HttpResponse.json({
        user: SELF,
        permissions: [],
        mustChangePassword: false,
        reauthenticatedAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    ),
  );
}

export function newClient(signedIn = true) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  if (signedIn)
    client.setQueryData(authKeys.session, {
      user: SELF,
      permissions: [],
      mustChangePassword: false,
      reauthenticatedAt: new Date(Date.now() - 60_000).toISOString(),
    });
  return client;
}

/** ルーター・QueryClient・再認証の提供元で包んで描画する。fakeTimers: true のときは userEvent の待ちも fake timers に合わせる */
export function renderInApp(
  children: ReactNode,
  options: {
    path?: string;
    client?: QueryClient;
    fakeTimers?: boolean;
  } = {},
) {
  const client = options.client ?? newClient();
  const user = userEvent.setup(
    options.fakeTimers ? { advanceTimers: vi.advanceTimersByTime } : {},
  );
  const result = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[options.path ?? "/"]}>
        <ReauthProvider>
          {children}
          <CurrentUrl />
        </ReauthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, client, user };
}

/** S-07 だけを描画する。?thread=<親ID> を持つ場所で開く */
export function renderPane(
  parentMessageId: string,
  options: {
    path?: string;
    client?: QueryClient;
    fakeTimers?: boolean;
    retiredAuthorIds?: readonly string[];
  } = {},
) {
  return renderInApp(
    <ThreadPane
      parentMessageId={parentMessageId}
      retiredAuthorIds={options.retiredAuthorIds}
    />,
    {
      ...options,
      path: options.path ?? `/channels/room?thread=${parentMessageId}`,
    },
  );
}
