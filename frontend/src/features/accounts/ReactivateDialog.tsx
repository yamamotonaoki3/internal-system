// S-22 アカウントの再有効化。所属部署を選び、再認証の後に送る。成功すると一時パスワードを一度だけ表示する。
// 一時パスワードは useMutation に載せず（project-rules #199）、このダイアログの useState だけに置く。閉じると消える。
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { SelectField } from "../../components/SelectField";
import { useReauth } from "../auth";
import {
  fetchDepartmentOptions,
  reactivateAccount,
  type AccountListItem,
} from "./account-api";
import { describeLifecycleError, sendWithReauth } from "./lifecycle-errors";
import { accountKeys } from "./query-keys";
import { invalidateAfterLifecycle } from "./useAccountLifecycle";

type Props = {
  account: AccountListItem;
  onClose: () => void;
  /** 一時パスワードの表示を閉じたとき（一覧に完了のメッセージを出す） */
  onDone: () => void;
};

export function ReactivateDialog({ account, onClose, onDone }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const queryClient = useQueryClient();
  const { withReauth } = useReauth();
  const departments = useQuery({
    queryKey: accountKeys.departmentOptions,
    queryFn: fetchDepartmentOptions,
    retry: false,
  });
  const [departmentId, setDepartmentId] = useState("");
  const [departmentError, setDepartmentError] = useState<string>();
  const [serverError, setServerError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  // 例外：サーバーのデータを useState に入れている。一時パスワードをキャッシュ・端末に残さないため
  const [initialPassword, setInitialPassword] = useState<string | null>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  function close() {
    const succeeded = initialPassword !== null;
    setInitialPassword(null);
    if (succeeded) onDone();
    else onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setServerError(undefined);
    setDepartmentError(undefined);
    if (departmentId === "") {
      setDepartmentError("所属部署を選んでください");
      return;
    }
    setSubmitting(true);
    try {
      const result = await sendWithReauth(
        withReauth,
        "アカウントの再有効化",
        () => reactivateAccount(account.id, { departmentId }),
      );
      setInitialPassword(result.initialPassword);
    } catch (error) {
      const message = describeLifecycleError(error);
      if (message === null) throw error;
      setServerError(message);
      return;
    } finally {
      setSubmitting(false);
    }
    await invalidateAfterLifecycle(queryClient);
  }

  return (
    <dialog
      ref={dialogRef}
      aria-label="アカウントの再有効化"
      onCancel={(event) => {
        event.preventDefault();
        if (!submitting) close();
      }}
      className="w-full max-w-md rounded-lg bg-surface p-6 text-text shadow-float backdrop:bg-overlay"
    >
      <section>
        <h2 className="mb-4 text-xl font-bold">アカウントの再有効化</h2>
        {initialPassword !== null ? (
          <>
            <dl className="mb-4">
              <dt className="text-xs text-text-muted">社員ID</dt>
              <dd className="mb-3">
                <code className="font-mono break-all">{account.loginId}</code>
              </dd>
              <dt className="text-xs text-text-muted">一時パスワード</dt>
              <dd className="mb-3">
                <code className="font-mono break-all">{initialPassword}</code>
              </dd>
            </dl>
            <p className="mb-4">
              一時パスワードは、ここで一度だけ表示します。別の連絡手段で本人へ伝え、次のログインで変更してもらってください。
            </p>
            <Button onClick={close}>閉じる</Button>
          </>
        ) : (
          <form onSubmit={(event) => void submit(event)} noValidate>
            <p className="mb-4">
              「{account.displayName}
              」を再有効化します。ロールと個別のチャンネルの参加は戻りません。
            </p>
            {departments.isError && (
              <Alert tone="error" role="alert">
                所属部署の候補を取得できませんでした。閉じて、もう一度お試しください。
              </Alert>
            )}
            <SelectField
              label="所属部署"
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
              <Button type="submit" disabled={submitting}>
                再有効化する
              </Button>
              <Button variant="secondary" disabled={submitting} onClick={close}>
                キャンセル
              </Button>
            </div>
          </form>
        )}
      </section>
    </dialog>
  );
}
