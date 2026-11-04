// 画面：部品を組み合わせるだけにする（C-06）。API は features/ の中の api 層が呼ぶ。
// ログイン後の画面の枠。共通レイアウト（S-01）は #121 で作る。
import { RequireAuth } from "../features/auth/components/RequireAuth";
import { WelcomeMessage } from "../features/auth/components/WelcomeMessage";

export function HomePage() {
  return (
    <main>
      <h1>ホーム</h1>
      <RequireAuth>
        <WelcomeMessage />
      </RequireAuth>
    </main>
  );
}
