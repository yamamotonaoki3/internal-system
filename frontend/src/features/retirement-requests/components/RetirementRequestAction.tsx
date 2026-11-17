// S-20 の行からの退職処理の申請。サーバーが canRequestRetirement を true にした行にだけボタンを出す（表示の制御。認可はサーバー）。
// 確認 → 再認証（期限内なら省略）→ 送信。成功でダイアログを閉じ、一覧の上に完了の文を出す（次の操作を始めたら消す）。
import { useState } from "react";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { useCreateRetirementRequest } from "../hooks/useRetirementRequests";
import { ConfirmDialog } from "./ConfirmDialog";
import { useMutationError } from "./useMutationError";

const DONE_MESSAGE =
  "全体管理者へ退職処理を申請しました。処理が完了するまで社員は有効です";

type Target = { id: string; displayName: string };

function RequestDialog({
  target,
  onClose,
  onDone,
}: {
  target: Target;
  onClose: () => void;
  onDone: () => void;
}) {
  const create = useCreateRetirementRequest();
  const { error, run } = useMutationError();
  async function confirm() {
    if (await run(() => create.mutateAsync(target.id))) onDone();
  }
  return (
    <ConfirmDialog
      title="退職処理の申請"
      confirmLabel="申請する"
      pending={create.isPending}
      error={error}
      onConfirm={() => void confirm()}
      onClose={onClose}
    >
      <p>
        「{target.displayName}
        」の退職処理を全体管理者へ申請します。全体管理者が処理するまで、社員は有効のままです。
      </p>
    </ConfirmDialog>
  );
}

/** 行のボタン（renderButton）と、一覧の上に置く完了の文・ダイアログ（element）を返す */
export function useRetirementRequestAction() {
  const [target, setTarget] = useState<Target | null>(null);
  const [done, setDone] = useState(false);

  const renderButton = (member: Target & { canRequestRetirement: boolean }) =>
    member.canRequestRetirement ? (
      <Button
        variant="secondary"
        aria-label={`${member.displayName}の退職処理を申請`}
        onClick={() => {
          setDone(false);
          setTarget({ id: member.id, displayName: member.displayName });
        }}
      >
        退職処理を申請
      </Button>
    ) : null;

  const element = (
    <>
      {done && (
        <Alert tone="info" role="status">
          {DONE_MESSAGE}
        </Alert>
      )}
      {target !== null && (
        <RequestDialog
          target={target}
          onClose={() => setTarget(null)}
          onDone={() => {
            setTarget(null);
            setDone(true);
          }}
        />
      )}
    </>
  );

  return { renderButton, element };
}
