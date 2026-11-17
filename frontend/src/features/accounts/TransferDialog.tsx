// S-22 部署異動（即時）。異動先の部署を選び、再認証の後に送る。失敗はダイアログの中に出す。
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { SelectField } from "../../components/SelectField";
import { fetchDepartmentOptions, type AccountListItem } from "./account-api";
import {
  describeLifecycleError,
  isDepartmentFieldError,
} from "./lifecycle-errors";
import { accountKeys } from "./query-keys";
import { useTransferAccount } from "./useAccountLifecycle";

type Props = {
  account: AccountListItem;
  onClose: () => void;
  /** 成功したとき（ダイアログを閉じ、一覧に完了のメッセージを出す） */
  onDone: () => void;
};

export function TransferDialog({ account, onClose, onDone }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const transfer = useTransferAccount();
  const departments = useQuery({
    queryKey: accountKeys.departmentOptions,
    queryFn: fetchDepartmentOptions,
    retry: false,
  });
  const [departmentId, setDepartmentId] = useState("");
  const [departmentError, setDepartmentError] = useState<string>();
  const [serverError, setServerError] = useState<string>();

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setServerError(undefined);
    setDepartmentError(undefined);
    if (departmentId === "") {
      setDepartmentError("異動先の部署を選んでください");
      return;
    }
    try {
      await transfer.mutateAsync({ id: account.id, departmentId });
    } catch (error) {
      const message = describeLifecycleError(error);
      if (message === null) throw error;
      // サーバーが部署の欄を指したときは、入力欄のエラーとして出す
      if (isDepartmentFieldError(error)) setDepartmentError(message);
      else setServerError(message);
      return;
    }
    onDone();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-label="部署の異動"
      onCancel={(event) => {
        event.preventDefault();
        if (!transfer.isPending) onClose();
      }}
      className="w-full max-w-md rounded-lg bg-surface p-6 text-text shadow-float backdrop:bg-overlay"
    >
      <section>
        <h2 className="mb-4 text-xl font-bold">部署の異動</h2>
        <form onSubmit={(event) => void submit(event)} noValidate>
          <p className="mb-4">
            「{account.displayName}
            」を異動します。今の部署の専用チャンネルから外れ、異動先の部署の専用チャンネルに参加します。ロールと個別のチャンネルの参加は変わりません。
          </p>
          {departments.isError && (
            <Alert tone="error" role="alert">
              部署の候補を取得できませんでした。閉じて、もう一度お試しください。
            </Alert>
          )}
          <SelectField
            label="異動先の部署"
            value={departmentId}
            error={departmentError}
            onChange={(event) => setDepartmentId(event.target.value)}
          >
            <option value="">選んでください</option>
            {(departments.data ?? []).map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </SelectField>
          {serverError && (
            <Alert tone="error" role="alert">
              {serverError}
            </Alert>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={transfer.isPending}>
              異動する
            </Button>
            <Button
              variant="secondary"
              disabled={transfer.isPending}
              onClick={onClose}
            >
              キャンセル
            </Button>
          </div>
        </form>
      </section>
    </dialog>
  );
}
