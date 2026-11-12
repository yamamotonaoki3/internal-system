// 画面の振り分け（ルーティング）。画面は pages/ に置く。
// ログイン後の画面は、レイアウトルート（RequireAuth → AppShell）の子に足す。/login・/setup は枠の外。
import { Route, Routes } from "react-router";
import { AppShell } from "./features/app-shell/AppShell";
import { RequireAuth } from "./features/auth/components/RequireAuth";
import { useSession } from "./features/auth/hooks/useSession";
import { ReauthProvider } from "./features/auth/ReauthProvider";
import { HomePage } from "./pages/HomePage";
import { AccountCreatePage } from "./pages/AccountCreatePage";
import { AccountsPage } from "./pages/AccountsPage";
import { ChannelApprovalsPage } from "./pages/ChannelApprovalsPage";
import { ChannelDetailPage } from "./pages/ChannelDetailPage";
import { ChannelRequestPage } from "./pages/ChannelRequestPage";
import { ChannelsPage } from "./pages/ChannelsPage";
import { ClientsPage } from "./pages/ClientsPage";
import { DepartmentCreatePage } from "./pages/DepartmentCreatePage";
import { DepartmentsPage } from "./pages/DepartmentsPage";
import { LoginPage } from "./pages/LoginPage";
import { MembersPage } from "./pages/MembersPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { PasswordChangePage } from "./pages/PasswordChangePage";
import { ProfilePage } from "./pages/ProfilePage";
import { SetupPage } from "./pages/SetupPage";

function ClientManageRoute() {
  const session = useSession();
  if (session.isPending) return <p role="status">確認中です</p>;
  if (session.isError) return null;
  if (!session.data.permissions?.includes("perm.client.manage"))
    return <NotFoundPage />;
  return <ClientsPage />;
}

// 部署管理（全体管理者のみ）。セッション確認中は拒否せず待つ。表示の制御であり、認可はサーバーが行う
function DepartmentManageRoute({ create }: { create?: boolean }) {
  const session = useSession();
  if (session.isPending) return <p role="status">確認中です</p>;
  if (session.isError) return null;
  if (!session.data.permissions?.includes("perm.workspace.create"))
    return <NotFoundPage />;
  return create ? <DepartmentCreatePage /> : <DepartmentsPage />;
}

// チャンネル作成の承認（全体管理者かいずれかの部署のオーナー）。セッション確認中は拒否せず待つ。表示の制御であり、認可はサーバーが申請ごとに行う
function ChannelApprovalsRoute() {
  const session = useSession();
  if (session.isPending) return <p role="status">確認中です</p>;
  if (session.isError) return null;
  if (!session.data.permissions?.includes("perm.channel.request.approve.owner"))
    return <NotFoundPage />;
  return <ChannelApprovalsPage />;
}

function AccountManageRoute({ page }: { page: "list" | "create" }) {
  const session = useSession();
  if (session.isPending) return <p role="status">確認中です</p>;
  if (session.isError) return null;
  if (!session.data.permissions?.includes("perm.account.create"))
    return <NotFoundPage />;
  return page === "list" ? <AccountsPage /> : <AccountCreatePage />;
}

export function App() {
  return (
    <Routes>
      <Route
        element={
          <RequireAuth>
            <ReauthProvider>
              <AppShell />
            </ReauthProvider>
          </RequireAuth>
        }
      >
        <Route index element={<HomePage />} />
        <Route path="/clients" element={<ClientManageRoute />} />
        <Route path="/departments" element={<DepartmentManageRoute />} />
        <Route
          path="/departments/new"
          element={<DepartmentManageRoute create />}
        />
        <Route path="/accounts" element={<AccountManageRoute page="list" />} />
        <Route
          path="/accounts/new"
          element={<AccountManageRoute page="create" />}
        />
        <Route path="/channels" element={<ChannelsPage />} />
        <Route path="/channels/:channelId" element={<ChannelDetailPage />} />
        <Route path="/channel-requests" element={<ChannelRequestPage />} />
        <Route path="/channel-approvals" element={<ChannelApprovalsRoute />} />
        <Route path="/members" element={<MembersPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/password" element={<PasswordChangePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/setup" element={<SetupPage />} />
    </Routes>
  );
}
