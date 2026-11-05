// 画面：部品を組み合わせるだけにする（C-06）。
// ログイン後の画面の枠（main）と、ログイン済みの確認は、レイアウトルート（App.tsx の RequireAuth → AppShell）が持つ。
import { WelcomeMessage } from "../features/auth/components/WelcomeMessage";

export function HomePage() {
  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">ホーム</h1>
      <WelcomeMessage />
    </>
  );
}
