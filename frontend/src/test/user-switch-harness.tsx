// #284：利用者の切り替えのテストで使う、App 全体の描画の枠（架空のデータのみ）。
// main.tsx と同じ組み立てにする：データルーター（createMemoryRouter）・離脱の確認の提供元（LeaveGuardProvider）・
// 401 の共通の処理（createUnauthenticatedHandler）・切り替えの見張り（installUserSwitchGuard）。
// 描画の確定ごとの見張り（render-watch）で App 全体を包む。既存の renderApp（app-shell-harness.tsx）は変えない。
// 終わりに disposeUserSwitchApps で見張りの登録を解除する（afterEach で呼ぶ）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";
import { App } from "../App";
import {
  AccessLossBoundary,
  requestUserSwitchReload,
} from "../features/access-loss";
import {
  createSessionUserMismatchHandler,
  expectedUserIdFor,
  installDocumentUser,
  installUserSwitchGuard,
} from "../features/auth";
import { createUnauthenticatedHandler } from "../features/auth/unauthenticated-handler";
import { LeaveGuardProvider } from "../features/leave-guard";
import {
  setExpectedUserIdProvider,
  setSessionUserMismatchHandler,
  setUnauthenticatedHandler,
} from "../services/api-client";
import { createRenderWatch, type RenderWatch } from "./render-watch";

const disposers: (() => void)[] = [];
const clients: QueryClient[] = [];

/**
 * 描画した App の通信が、すべて終わるのを待つ（afterEach で、disposeUserSwitchApps の前に呼ぶ）。
 * 終わる前にテストを閉じると、通信の続きが模擬のサーバーの後始末の後に届き、
 * 401 の共通の処理（全体で1つ）を通して、次のテストの画面を /login へ移してしまうため。
 */
export async function settleUserSwitchApps(): Promise<void> {
  await waitFor(() => {
    for (const client of clients) expect(client.isFetching()).toBe(0);
  });
}

/** renderUserSwitchApp で登録した見張りを解除する（afterEach で呼ぶ） */
export function disposeUserSwitchApps(): void {
  for (const dispose of disposers.splice(0)) dispose();
  clients.splice(0);
}

export function renderUserSwitchApp(
  path: string,
  options: {
    needles: readonly string[];
    client?: QueryClient;
    /** #298：main.tsx と同じく、ルーターを読み込み直しの境界（AccessLossBoundary）で包む（覆い・hidden・inert を確かめるテストだけ） */
    boundary?: boolean;
  },
) {
  const client =
    options.client ??
    new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: false },
        mutations: { retry: false },
      },
    });
  clients.push(client);
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <LeaveGuardProvider>
            <App />
          </LeaveGuardProvider>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  setUnauthenticatedHandler(
    createUnauthenticatedHandler({
      queryClient: client,
      navigate: (to) => void router.navigate(to),
      currentPath: () => router.state.location.pathname,
    }),
  );
  // #298（計画 2-1・2-6・2-8）：main.tsx と同じく、文書の利用者・ヘッダーの提供元・409 の処理・切り替えの入口をつなぐ。
  // 入口 requestUserSwitchReload は test/setup.ts で vi.fn に差し替えてある（呼ばれた回数を数える）。
  // 文書の利用者は解除で忘れる（前提にした口）。テストの間で、前のテストの利用者を持ち越さないため
  disposers.push(installDocumentUser(client));
  setExpectedUserIdProvider(expectedUserIdFor);
  const onOtherUser = () => requestUserSwitchReload(client);
  setSessionUserMismatchHandler(
    createSessionUserMismatchHandler({ queryClient: client, onOtherUser }),
  );
  disposers.push(installUserSwitchGuard(client, onOtherUser));
  const watch: RenderWatch = createRenderWatch(options.needles);
  const user = userEvent.setup();
  const routed = <RouterProvider router={router} />;
  render(
    <watch.Watch>
      <QueryClientProvider client={client}>
        {options.boundary === true ? (
          <AccessLossBoundary>{routed}</AccessLossBoundary>
        ) : (
          routed
        )}
      </QueryClientProvider>
    </watch.Watch>,
  );
  return { client, router, user, watch };
}
