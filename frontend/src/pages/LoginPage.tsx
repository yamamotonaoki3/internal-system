// 画面 S-02：ログイン。部品を組み合わせるだけにする（C-06）。
// 未ログインでも見えるよう、サーバーの状態と初回セットアップへのリンクもここに置く。
import { Navigate } from "react-router";
import { DraftCleanupNotice } from "../features/auth";
import { LoginForm } from "../features/auth/components/LoginForm";
import { useSession } from "../features/auth/hooks/useSession";
import { PageLayout } from "../components/PageLayout";
import { HealthStatus } from "../features/health/HealthStatus";
import { SetupEntryLink } from "../features/setup/components/SetupEntryLink";

export function LoginPage() {
  const session = useSession();
  // ログイン済みなら共通レイアウト側（/）へ移る
  if (session.isSuccess) return <Navigate to="/" replace />;

  return (
    <PageLayout title="ログイン" width="narrow">
      <DraftCleanupNotice />
      <LoginForm />
      <HealthStatus />
      <SetupEntryLink />
    </PageLayout>
  );
}
