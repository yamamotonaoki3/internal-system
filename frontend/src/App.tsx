// 画面の振り分け（ルーティング）。画面は pages/ に置く。
// ログイン後の画面は、レイアウトルート（RequireAuth → AppShell）の子に足す。/login・/setup は枠の外。
import { Route, Routes } from "react-router";
import { AppShell } from "./features/app-shell/AppShell";
import { RequireAuth } from "./features/auth/components/RequireAuth";
import { ReauthProvider } from "./features/auth/ReauthProvider";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { PasswordChangePage } from "./pages/PasswordChangePage";
import { SetupPage } from "./pages/SetupPage";

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
        <Route path="/password" element={<PasswordChangePage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/setup" element={<SetupPage />} />
    </Routes>
  );
}
