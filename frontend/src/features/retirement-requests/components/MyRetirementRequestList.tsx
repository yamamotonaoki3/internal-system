// 自分の退職処理の申請の一覧。読み込み中・エラー・なし・ありの4つの状態を出し分ける。
// 申請中の行にだけ「取り下げ」を出す（確認のダイアログ → 送信）。却下の理由は文字列としてそのまま出す（HTML として解釈しない）。
import { useState } from "react";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import type { MyRetirementRequestItem } from "../api/retirement-request-api";
import {
  useMyRetirementRequests,
  useWithdrawRetirementRequest,
} from "../hooks/useRetirementRequests";
import { STATUS_LABELS } from "../labels";
import { ConfirmDialog } from "./ConfirmDialog";
import { useMutationError } from "./useMutationError";

const COLUMNS = ["対象", "部署", "状態", "申請日時", "操作"] as const;

function WithdrawDialog({
  request,
  onClose,
}: {
  request: MyRetirementRequestItem;
  onClose: () => void;
}) {
  const withdraw = useWithdrawRetirementRequest();
  const { error, run } = useMutationError();
  async function confirm() {
    if (await run(() => withdraw.mutateAsync(request.id))) onClose();
  }
  return (
    <ConfirmDialog
      title="退職処理の申請の取り下げ"
      confirmLabel="取り下げる"
      pending={withdraw.isPending}
      error={error}
      onConfirm={() => void confirm()}
      onClose={onClose}
    >
      <p>「{request.target.displayName}」への退職処理の申請を取り下げます。</p>
    </ConfirmDialog>
  );
}

export function MyRetirementRequestList() {
  const requests = useMyRetirementRequests();
  const [target, setTarget] = useState<MyRetirementRequestItem | null>(null);

  function listContent() {
    if (requests.isPending) return <p role="status">読み込み中です</p>;
    if (requests.isError)
      return (
        <Alert tone="error" role="alert">
          退職処理の申請を取得できませんでした。時間をおいて、もう一度お試しください。
        </Alert>
      );
    const items = requests.data.pages.flatMap((page) => page.items);
    if (items.length === 0) return <p>退職処理の申請はまだありません</p>;
    return (
      <>
        <div className="mb-4 overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr>
                {COLUMNS.map((column) => (
                  <th key={column} scope="col" className="p-2">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t border-border-strong">
                  <td className="p-2">{item.target.displayName}</td>
                  <td className="p-2">{item.department.name}</td>
                  <td className="p-2">
                    <span>{STATUS_LABELS[item.status]}</span>
                    {item.status === "rejected" &&
                      item.decisionReason !== null && (
                        <p className="mt-1 text-sm">{item.decisionReason}</p>
                      )}
                  </td>
                  <td className="p-2">{item.createdAt}</td>
                  <td className="p-2">
                    {item.status === "pending" && (
                      <Button
                        variant="secondary"
                        aria-label={`${item.target.displayName}への申請を取り下げ`}
                        onClick={() => setTarget(item)}
                      >
                        取り下げ
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {requests.hasNextPage && (
          <Button
            variant="secondary"
            disabled={requests.isFetchingNextPage}
            onClick={() => void requests.fetchNextPage()}
          >
            次のページ
          </Button>
        )}
      </>
    );
  }

  return (
    <>
      {listContent()}
      {target !== null && (
        <WithdrawDialog request={target} onClose={() => setTarget(null)} />
      )}
    </>
  );
}
