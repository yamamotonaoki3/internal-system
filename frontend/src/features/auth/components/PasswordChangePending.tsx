// 初回パスワードの変更が必要な利用者向けの案内（本体の S-03 は #123）。ログアウトだけ使える。
import { LogoutButton } from "./LogoutButton";

export function PasswordChangePending() {
  return (
    <section>
      <p className="mb-3">パスワードの変更が必要です。変更画面は準備中です</p>
      <LogoutButton />
    </section>
  );
}
