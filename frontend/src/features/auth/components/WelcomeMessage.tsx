// ログイン後の画面の枠（S-01 の共通レイアウトは #121）。ログイン中の利用者の表示名を出す。
import { useSession } from "../hooks/useSession";
import { LogoutButton } from "./LogoutButton";

export function WelcomeMessage() {
  const { data } = useSession();
  if (data === undefined) return null;
  return (
    <section>
      <p>ようこそ、{data.user.displayName}さん</p>
      <LogoutButton />
    </section>
  );
}
