// 画面 S-34：初代全体管理者の初回セットアップ。部品を組み合わせるだけにする（C-06）。
import { PageLayout } from "../components/PageLayout";
import { SetupFlow } from "../features/setup/components/SetupFlow";

export function SetupPage() {
  return (
    <PageLayout title="初代全体管理者の登録">
      <SetupFlow />
    </PageLayout>
  );
}
