// S-18 の「自分の申請」。読み込み中・エラー・なし・ありの4つの状態を出し分ける。
// 承認待ちの行にだけ「取り下げ」（確認のダイアログ → 送信）、却下・取り下げ済みの行にだけ「修正して再申請」を出す。
// 却下の理由は文字列としてそのまま出す（HTML として解釈しない）。
import { useState } from "react";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import type { CaseRequestItem } from "../api/case-request-api";
import { describeError } from "../describe-error";
import { useMyCaseRequests } from "../hooks/useMyCaseRequests";
import { useWithdrawCaseRequest } from "../hooks/useWithdrawCaseRequest";
import { STATUS_LABELS } from "../labels";
import { WithdrawDialog } from "./WithdrawDialog";

const INACTIVE_MARK = "（無効）";

const nameWithMark = (item: { name: string; isActive: boolean }) =>
  item.isActive ? item.name : `${item.name}${INACTIVE_MARK}`;

type Props = { onResubmit: (item: CaseRequestItem) => void };

export function MyCaseRequestList({ onResubmit }: Props) {
  const requests = useMyCaseRequests();
  const withdraw = useWithdrawCaseRequest();
  const [target, setTarget] = useState<CaseRequestItem | null>(null);

  if (requests.isPending) return <p>読み込み中です</p>;
  if (requests.isError)
    return (
      <Alert tone="error" role="alert">
        {describeError(requests.error)}
      </Alert>
    );

  const items = requests.data.pages.flatMap((page) => page.items);
  if (items.length === 0) return <p>申請はまだありません</p>;

  function confirmWithdraw(item: CaseRequestItem) {
    // 成功しても失敗しても確認を閉じる。失敗の理由（すでに処理されていた等）は一覧の上に出す
    withdraw.mutate(item.id, { onSettled: () => setTarget(null) });
  }

  return (
    <>
      {withdraw.isError && (
        <Alert tone="error" role="alert">
          {describeError(withdraw.error)}
        </Alert>
      )}
      <ul className="mb-4">
        {items.map((item) => (
          <li key={item.id} className="border-t border-border-strong p-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-bold">{item.title}</span>
              <span className="text-sm">{STATUS_LABELS[item.status]}</span>
              {item.status === "pending" && (
                <span className="ml-auto">
                  <Button
                    variant="secondary"
                    aria-label={`${item.title}の申請を取り下げる`}
                    onClick={() => {
                      withdraw.reset();
                      setTarget(item);
                    }}
                  >
                    取り下げ
                  </Button>
                </span>
              )}
              {(item.status === "rejected" ||
                item.status === "withdrawn" ||
                item.status === "auto_cancelled") && (
                <span className="ml-auto">
                  <Button variant="secondary" onClick={() => onResubmit(item)}>
                    修正して再申請
                  </Button>
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-text-muted">
              取引先：{nameWithMark(item.client)}
              <span className="mx-2">担当部署：</span>
              {item.departments.map(nameWithMark).join("・")}
              {item.dueDate !== null && (
                <span className="ml-2">納期：{item.dueDate}</span>
              )}
            </p>
            {item.status === "rejected" && item.rejectReason !== null && (
              <p className="mt-2 text-sm">却下の理由：{item.rejectReason}</p>
            )}
          </li>
        ))}
      </ul>
      {requests.hasNextPage && (
        <Button
          variant="secondary"
          disabled={requests.isFetchingNextPage}
          onClick={() => void requests.fetchNextPage()}
        >
          次のページ
        </Button>
      )}
      {target !== null && (
        <WithdrawDialog
          title={target.title}
          pending={withdraw.isPending}
          onConfirm={() => confirmWithdraw(target)}
          onClose={() => setTarget(null)}
        />
      )}
    </>
  );
}
