// 画面の振り分け（ルーティング）。画面は pages/ に置く。
// ログイン後の画面は、レイアウトルート（RequireAuth → AppShell）の子に足す。/login・/setup は枠の外。
import { Route, Routes } from "react-router";
import { AppShell } from "./features/app-shell/AppShell";
import { AuditLogsPage } from "./features/audit-logs";
import { RequireAuth } from "./features/auth/components/RequireAuth";
import { useSignedInUserId } from "./features/auth";
import { useSession } from "./features/auth/hooks/useSession";
import { ReauthProvider } from "./features/auth/ReauthProvider";
import { HomePage } from "./pages/HomePage";
import { AccountCreatePage } from "./pages/AccountCreatePage";
import { AccountsPage } from "./pages/AccountsPage";
import { ArchivePage } from "./pages/ArchivePage";
import { ChannelApprovalsPage } from "./pages/ChannelApprovalsPage";
import { ChannelDetailPage } from "./pages/ChannelDetailPage";
import { ChannelManagePage } from "./pages/ChannelManagePage";
import { CaseApprovalsPage } from "./pages/CaseApprovalsPage";
import { CaseRequestPage } from "./pages/CaseRequestPage";
import { ChannelRequestPage } from "./pages/ChannelRequestPage";
import { ChannelsPage } from "./pages/ChannelsPage";
import { ClientsPage } from "./pages/ClientsPage";
import { DepartmentCreatePage } from "./pages/DepartmentCreatePage";
import { DepartmentsPage } from "./pages/DepartmentsPage";
import { DmNewPage } from "./pages/DmNewPage";
import { DmPage } from "./pages/DmPage";
import { DmsPage } from "./pages/DmsPage";
import { LoginPage } from "./pages/LoginPage";
import { MembersPage } from "./pages/MembersPage";
import { MyRetirementRequestsPage } from "./pages/MyRetirementRequestsPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { PasswordChangePage } from "./pages/PasswordChangePage";
import { ProfilePage } from "./pages/ProfilePage";
import { SetupPage } from "./pages/SetupPage";
import { ThreadsPage } from "./pages/ThreadsPage";

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

// 案件作成の承認（S-29。全体管理者かいずれかの部署のオーナー）。セッション確認中は拒否せず待つ。表示の制御であり、認可はサーバーが申請ごとに行う
function CaseApprovalsRoute() {
  const session = useSession();
  if (session.isPending) return <p role="status">確認中です</p>;
  if (session.isError) return null;
  if (!session.data.permissions?.includes("perm.case.request.approve"))
    return <NotFoundPage />;
  return <CaseApprovalsPage />;
}

// 監査ログ（全体管理者のみ）。セッション確認中は拒否せず待つ。表示の制御であり、認可はサーバーが毎回行う
function AuditLogsRoute() {
  const session = useSession();
  if (session.isPending) return <p role="status">確認中です</p>;
  if (session.isError) return null;
  if (!session.data.permissions?.includes("perm.audit_log.view"))
    return <NotFoundPage />;
  return <AuditLogsPage />;
}

// チャンネル管理（S-39）とアーカイブ（S-38）。全体管理者かいずれかの部署のオーナー（#143-b）。
// セッション確認中は拒否せず待つ。表示の制御であり、認可はサーバーが毎回行う
function ChannelAdminRoute({ page }: { page: "manage" | "archive" }) {
  const session = useSession();
  const userId = useSignedInUserId();
  if (session.isPending) return <p role="status">確認中です</p>;
  if (session.isError) return null;
  const required =
    page === "manage" ? "perm.channel.edit" : "perm.channel.delete";
  if (!session.data.permissions?.includes(required)) return <NotFoundPage />;
  // 利用者が替わったら、ページの状態（ダイアログの対象・完了の通知・絞り込みの入力）ごと作り直す。ID が確かめられる前は描画しない
  if (userId === undefined) return <p role="status">確認中です</p>;
  return page === "manage" ? (
    <ChannelManagePage key={userId} />
  ) : (
    <ArchivePage key={userId} />
  );
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
        <Route path="/audit-logs" element={<AuditLogsRoute />} />
        <Route
          path="/channel-management"
          element={<ChannelAdminRoute page="manage" />}
        />
        <Route path="/archive" element={<ChannelAdminRoute page="archive" />} />
        <Route path="/channels" element={<ChannelsPage />} />
        <Route path="/channels/:channelId" element={<ChannelDetailPage />} />
        <Route path="/channel-requests" element={<ChannelRequestPage />} />
        <Route path="/case-requests" element={<CaseRequestPage />} />
        <Route path="/channel-approvals" element={<ChannelApprovalsRoute />} />
        <Route path="/case-approvals" element={<CaseApprovalsRoute />} />
        <Route path="/dms" element={<DmsPage />} />
        <Route path="/dms/new" element={<DmNewPage />} />
        <Route path="/dms/:roomId" element={<DmPage />} />
        <Route path="/members" element={<MembersPage />} />
        <Route
          path="/retirement-requests/mine"
          element={<MyRetirementRequestsPage />}
        />
        <Route path="/threads" element={<ThreadsPage />} />
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
