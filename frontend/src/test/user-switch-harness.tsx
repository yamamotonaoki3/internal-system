// #284：利用者の切り替えのテストで使う、App 全体の描画の枠（架空のデータのみ）。
// main.tsx と同じ組み立てにする：データルーター（createMemoryRouter）・離脱の確認の提供元（LeaveGuardProvider）・
// 401 の共通の処理（createUnauthenticatedHandler）・切り替えの見張り（installUserSwitchGuard）。
// 描画の確定ごとの見張り（render-watch）で App 全体を包む。既存の renderApp（app-shell-harness.tsx）は変えない。
// 終わりに disposeUserSwitchApps で見張りの登録を解除する（afterEach で呼ぶ）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { App } from "../App";
import { installUserSwitchGuard } from "../features/auth";
import { createUnauthenticatedHandler } from "../features/auth/unauthenticated-handler";
import { LeaveGuardProvider } from "../features/leave-guard";
import { setUnauthenticatedHandler } from "../services/api-client";
import { createRenderWatch, type RenderWatch } from "./render-watch";

const disposers: (() => void)[] = [];

/** renderUserSwitchApp で登録した見張りを解除する（afterEach で呼ぶ） */
export function disposeUserSwitchApps(): void {
  for (const dispose of disposers.splice(0)) dispose();
}

export function renderUserSwitchApp(
  path: string,
  options: { needles: readonly string[]; client?: QueryClient },
) {
  const client =
    options.client ??
    new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: false },
        mutations: { retry: false },
      },
    });
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
  disposers.push(installUserSwitchGuard(client));
  const watch: RenderWatch = createRenderWatch(options.needles);
  const user = userEvent.setup();
  render(
    <watch.Watch>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </watch.Watch>,
  );
  return { client, router, user, watch };
}
