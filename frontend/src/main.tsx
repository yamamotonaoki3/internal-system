// 画面の入口。ルーティング（React Router）とサーバーの状態（TanStack Query）をここで用意する。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import "./lib/zod-config";
import { App } from "./App";
import {
  AccessLossBoundary,
  requestUserSwitchReload,
  takeAccessLossNotice,
} from "./features/access-loss";
import {
  createSessionUserMismatchHandler,
  expectedUserIdFor,
  installDocumentUser,
  installUserSwitchGuard,
} from "./features/auth";
import {
  installCaseAccessLossMonitor,
  installCaseAccessLossRelay,
} from "./features/cases";
import { createUnauthenticatedHandler } from "./features/auth/unauthenticated-handler";
import {
  openDraftStorage,
  purgeExpiredDraftsOnStartup,
} from "./features/drafts";
import { LeaveGuardProvider } from "./features/leave-guard";
import {
  setExpectedUserIdProvider,
  setSessionUserMismatchHandler,
  setUnauthenticatedHandler,
} from "./services/api-client";
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
// 文書の利用者を覚え、要求に付ける（#298）。見張りより前に登録する（見張りが別の利用者と判断する前に、最初の利用者を覚えるため）
installDocumentUser(queryClient);
setExpectedUserIdProvider(expectedUserIdFor);
// 別の利用者に替わったら、ページごと読み込み直す（#298・ADR-0035）。auth は access-loss に依存しないので、ここで入口を渡す
const onOtherUser = () => requestUserSwitchReload(queryClient);
setSessionUserMismatchHandler(
  createSessionUserMismatchHandler({ queryClient, onOtherUser }),
);
// 利用者が替わったら、前の利用者のキャッシュを捨てる（読み込み直すまでの二重の守り。アプリの間ずっと有効なので解除しない）
installUserSwitchGuard(queryClient, onOtherUser);
// 資格を失って読み込み直した前の文書の知らせを、描画の前に読んで消す（#338）
takeAccessLossNotice(queryClient);
// ほかのタブで確定した資格の喪失の合図を受ける（#341。アプリの間ずっと有効なので解除しない）。
// 登録の想定外の失敗では、アプリの描画を止めない（合図を受けられないだけで、これまでの動きのまま）。失敗はもみ消さず、標準の報告に渡す
try {
  installCaseAccessLossRelay(queryClient);
} catch (error) {
  reportError(error);
}
// 案件の画面の外での、資格の喪失の見張り（#339。アプリの間ずっと有効なので解除しない）。利用者の切り替えの見張りより後に置く
// （別の利用者に替わったときは、切り替えの見張りが先にキャッシュを捨て、見張りは捨てられた Query の応答を使わない）
installCaseAccessLossMonitor(queryClient);

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
