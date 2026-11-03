// ログアウトのボタン。送信中は無効にし、失敗したら画面に留まって伝える。
import { useLogout } from "../hooks/useLogout";

export function LogoutButton() {
  const { mutate, isPending, isError } = useLogout();
  return (
    <div>
      <button type="button" disabled={isPending} onClick={() => mutate()}>
        {isPending ? "ログアウト中" : "ログアウト"}
      </button>
      {isError && (
        <p role="alert">
          ログアウトできませんでした。時間をおいて、もう一度お試しください
        </p>
      )}
    </div>
  );
}
