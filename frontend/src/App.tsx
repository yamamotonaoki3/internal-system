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
import { ClientsPage } from "./pages/ClientsPage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PasswordChangePage } from "./pages/PasswordChangePage";
import { SetupPage } from "./pages/SetupPage";

function ClientManageRoute() {
  const session = useSession();
  if (session.isPending) return <p role="status">確認中です</p>;
  if (session.isError) return null;
  if (!session.data.permissions?.includes("perm.client.manage"))
    return <NotFoundPage />;
  return <ClientsPage />;
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
        <Route path="/accounts" element={<AccountManageRoute page="list" />} />
        <Route
          path="/accounts/new"
          element={<AccountManageRoute page="create" />}
        />
        <Route path="/password" element={<PasswordChangePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/setup" element={<SetupPage />} />
    </Routes>
  );
}
