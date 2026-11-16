// S-22 アカウントの無効化の確認。再認証が必要なら、送る前に再認証のダイアログを出す。失敗はダイアログの中に出す。
import { useEffect, useRef, useState } from "react";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import type { AccountListItem } from "./account-api";
import { describeLifecycleError } from "./lifecycle-errors";
import { useDeactivateAccount } from "./useAccountLifecycle";

type Props = {
  account: AccountListItem;
  onClose: () => void;
  /** 成功したとき（ダイアログを閉じ、一覧に完了のメッセージを出す） */
  onDone: () => void;
};

export function DeactivateDialog({ account, onClose, onDone }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const deactivate = useDeactivateAccount();
  const [serverError, setServerError] = useState<string>();

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  async function confirm() {
    setServerError(undefined);
    try {
      await deactivate.mutateAsync(account.id);
    } catch (error) {
      const message = describeLifecycleError(error);
      if (message === null) throw error;
      setServerError(message);
      return;
    }
    onDone();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-label="アカウントの無効化"
      onCancel={(event) => {
        event.preventDefault();
        if (!deactivate.isPending) onClose();
      }}
      className="w-full max-w-md rounded-lg bg-surface p-6 text-text shadow-float backdrop:bg-overlay"
    >
      <section>
        <h2 className="mb-4 text-xl font-bold">アカウントの無効化</h2>
        <p className="mb-4">
          「{account.displayName}
          」を無効化します。ログインできなくなり、所属・チャンネルの参加・追加の権限が外れます。
        </p>
        {serverError && (
          <Alert tone="error" role="alert">
            {serverError}
          </Alert>
        )}
        <div className="flex gap-2">
          <Button
            variant="danger"
            disabled={deactivate.isPending}
            onClick={() => void confirm()}
          >
            無効化する
          </Button>
          <Button
            variant="secondary"
            disabled={deactivate.isPending}
            onClick={onClose}
          >
            キャンセル
          </Button>
        </div>
      </section>
    </dialog>
  );
}
