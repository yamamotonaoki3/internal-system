// 画面の入口。ルーティング（React Router）とサーバーの状態（TanStack Query）をここで用意する。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import "./lib/zod-config";
import { App } from "./App";
import {
  AccessLossBoundary,
  takeAccessLossNotice,
} from "./features/access-loss";
import { installUserSwitchGuard } from "./features/auth";
import { createUnauthenticatedHandler } from "./features/auth/unauthenticated-handler";
import {
  openDraftStorage,
  purgeExpiredDraftsOnStartup,
} from "./features/drafts";
import { LeaveGuardProvider } from "./features/leave-guard";
import { setUnauthenticatedHandler } from "./services/api-client";
import "./styles/index.css";

const queryClient = new QueryClient();
// API 通信の共通部分（画面の外）から移動できるよう、ルーターを部品の外で作る。
// 画面の振り分けは App の Routes が行う
// 離脱の確認の提供元（ブロッカーはルーター1つにつき1つ）で、画面の振り分けを包む
const router = createBrowserRouter([
  {
    path: "*",
    element: (
      <LeaveGuardProvider>
        <App />
      </LeaveGuardProvider>
    ),
  },
]);

// 期限切れの下書きを、アプリを開いたときに端末から消す
purgeExpiredDraftsOnStartup(openDraftStorage(), Date.now());

// 401 の共通の処理は、ここで1回だけ登録する
setUnauthenticatedHandler(
  createUnauthenticatedHandler({
    queryClient,
    navigate: (to) => void router.navigate(to),
    currentPath: () => window.location.pathname,
  }),
);
// 利用者が替わったら、前の利用者のキャッシュを捨てる（アプリの間ずっと有効なので解除しない）
installUserSwitchGuard(queryClient);
// 資格を失って読み込み直した前の文書の知らせを、描画の前に読んで消す（#338）
takeAccessLossNotice(queryClient);

const root = document.getElementById("root");
if (root === null)
  throw new Error("画面の入口（#root）が index.html にありません");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* 読み込み直しを待つ間、ルーターの下（離脱の確認・モーダルを含む）をすべて描画から外す（#338） */}
      <AccessLossBoundary>
        <RouterProvider router={router} />
      </AccessLossBoundary>
    </QueryClientProvider>
  </StrictMode>,
);
