// ログアウトのボタン。送信中は無効にし、失敗したら画面に留まって伝える。
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { useLogout } from "../hooks/useLogout";

export function LogoutButton() {
  const { mutate, isPending, isError } = useLogout();
  return (
    <div>
      <Button variant="secondary" disabled={isPending} onClick={() => mutate()}>
        {isPending ? "ログアウト中" : "ログアウト"}
      </Button>
      {isError && (
        <div className="mt-3">
          <Alert tone="error" role="alert" as="p">
            ログアウトできませんでした。時間をおいて、もう一度お試しください
          </Alert>
        </div>
      )}
    </div>
  );
}
