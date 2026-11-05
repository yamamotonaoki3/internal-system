// ログイン後のホームの案内。ログイン中の利用者の表示名と、画面幅に合った操作の案内を出す。
import { useSession } from "../hooks/useSession";

export function WelcomeMessage() {
  const { data } = useSession();
  if (data === undefined) return null;
  return (
    <section>
      <p className="mb-3">ようこそ、{data.user.displayName}さん</p>
      <p className="mb-3 text-text-muted md:hidden">
        メニューからチャンネルやDMを選んでください。
      </p>
      <p className="mb-3 hidden text-text-muted md:block">
        サイドバーからチャンネルやダイレクトメッセージを選んでください。
      </p>
    </section>
  );
}
