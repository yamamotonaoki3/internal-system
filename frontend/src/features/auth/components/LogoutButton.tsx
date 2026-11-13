// ログアウトのボタン。送信中は無効にし、失敗したら画面に留まって伝える。
// 入力中の内容があるときは、ログアウトの API を呼ぶ前に、失われることを確認する（提供元がなければ確認なし）。
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { useLeaveConfirmation } from "../../leave-guard";
import { authKeys } from "../api/query-keys";
import { useLogout } from "../hooks/useLogout";
import { LOGOUT_FAILED_MESSAGE } from "./logout-failed-message";

export function LogoutButton() {
  const { mutate, isPending, isError } = useLogout();
  const leave = useLeaveConfirmation();
  const queryClient = useQueryClient();
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const onClick = () => {
    if (leave === null || !leave.hasChanges()) {
      mutate();
      return;
    }
    void leave.confirmLeave().then((canLeave) => {
      // 確認を待つ間に画面が替わった・セッションが捨てられた（401）ときは、ログアウトを呼ばない
      if (
        canLeave &&
        mounted.current &&
        queryClient.getQueryData(authKeys.session) !== undefined
      )
        mutate();
    });
  };

  return (
    <div>
      <Button variant="secondary" disabled={isPending} onClick={onClick}>
        {isPending ? "ログアウト中" : "ログアウト"}
      </Button>
      {isError && (
        <div className="mt-3">
          <Alert tone="error" role="alert" as="p">
            {LOGOUT_FAILED_MESSAGE}
          </Alert>
        </div>
      )}
    </div>
  );
}
