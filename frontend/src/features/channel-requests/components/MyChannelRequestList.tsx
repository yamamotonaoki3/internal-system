// S-10 の「自分の申請」。読み込み中・エラー・なし・ありの4つの状態を出し分ける。
// 承認待ちの行にだけ「取り下げ」を出す（確認のダイアログ → 送信）。却下の理由は文字列としてそのまま出す。
import { useState } from "react";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import type { ChannelRequestItem } from "../api/channel-request-api";
import { describeError } from "../describe-error";
import { useMyChannelRequests } from "../hooks/useMyChannelRequests";
import { useWithdrawChannelRequest } from "../hooks/useWithdrawChannelRequest";
import { STATUS_LABELS, VISIBILITY_LABELS } from "../labels";
import { WithdrawDialog } from "./WithdrawDialog";

export function MyChannelRequestList() {
  const requests = useMyChannelRequests();
  const withdraw = useWithdrawChannelRequest();
  const [target, setTarget] = useState<ChannelRequestItem | null>(null);

  if (requests.isPending) return <p role="status">読み込み中です</p>;
  if (requests.isError)
    return (
      <Alert tone="error" role="alert">
        {describeError(requests.error)}
      </Alert>
    );

  const items = requests.data.pages.flatMap((page) => page.items);
  if (items.length === 0) return <p>申請はまだありません</p>;

  function confirmWithdraw(item: ChannelRequestItem) {
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
              <span className="font-bold">{item.name}</span>
              <span className="text-sm text-text-muted">
                {item.departmentId === null ? "会社直属" : "自部署"}・
                {VISIBILITY_LABELS[item.visibility]}
              </span>
              <span className="text-sm">{STATUS_LABELS[item.status]}</span>
              {item.status === "pending" && (
                <span className="ml-auto">
                  <Button
                    variant="secondary"
                    aria-label={`${item.name}の申請を取り下げる`}
                    onClick={() => {
                      withdraw.reset();
                      setTarget(item);
                    }}
                  >
                    取り下げ
                  </Button>
                </span>
              )}
            </div>
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
          requestName={target.name}
          pending={withdraw.isPending}
          onConfirm={() => confirmWithdraw(target)}
          onClose={() => setTarget(null)}
        />
      )}
    </>
  );
}
