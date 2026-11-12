// S-11 の審査一覧。読み込み中・エラー・なし・ありの4つの状態を出し分ける。状態で絞り込む（既定は承認待ち）。
// 承認・却下は再認証が要る。却下は再認証の後に理由のダイアログを出す。決裁できない申請（canApprove=false）にはボタンを出さない。
import { useState } from "react";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { SelectField } from "../../../components/SelectField";
import type {
  ChannelRequestReviewItem,
  RequestStatus,
} from "../api/channel-request-api";
import { describeError } from "../describe-error";
import { useDecideChannelRequest } from "../hooks/useDecideChannelRequest";
import { useReviewChannelRequests } from "../hooks/useReviewChannelRequests";
import { STATUS_LABELS, VISIBILITY_LABELS } from "../labels";
import { RejectReasonDialog } from "./RejectReasonDialog";

// 絞り込みの選択肢（承認待ちが既定）
const FILTER_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "withdrawn",
] as const satisfies readonly RequestStatus[];

const FILTER_LABELS: Readonly<Record<RequestStatus, string>> = {
  ...STATUS_LABELS,
  withdrawn: "取り下げ",
};

function isRequestStatus(value: string): value is RequestStatus {
  return (FILTER_STATUSES as readonly string[]).includes(value);
}

export function ChannelRequestReviewList() {
  const [status, setStatus] = useState<RequestStatus>("pending");
  const [rejecting, setRejecting] = useState<ChannelRequestReviewItem | null>(
    null,
  );
  const requests = useReviewChannelRequests(status);
  const { decide, confirmReauth } = useDecideChannelRequest();
  const busy = decide.isPending || confirmReauth.isPending;
  const error = confirmReauth.error ?? decide.error;

  function resetErrors() {
    decide.reset();
    confirmReauth.reset();
  }

  function approve(item: ChannelRequestReviewItem) {
    resetErrors();
    decide.mutate({ kind: "approve", requestId: item.id });
  }

  function startReject(item: ChannelRequestReviewItem) {
    resetErrors();
    // 再認証が済んでから理由のダイアログを出す（再認証を中止したら出さない）
    confirmReauth.mutate(undefined, { onSuccess: () => setRejecting(item) });
  }

  function reject(item: ChannelRequestReviewItem, reason: string) {
    // 成功しても失敗しても理由のダイアログを閉じる。失敗の理由は一覧の上に出す
    decide.mutate(
      { kind: "reject", requestId: item.id, reason },
      { onSettled: () => setRejecting(null) },
    );
  }

  function renderList() {
    if (requests.isPending) return <p role="status">読み込み中です</p>;
    if (requests.isError)
      return (
        <Alert tone="error" role="alert">
          {describeError(requests.error)}
        </Alert>
      );
    const items = requests.data.pages.flatMap((page) => page.items);
    if (items.length === 0) return <p>該当する申請はありません</p>;
    return (
      <>
        <ul className="mb-4">
          {items.map((item) => (
            <li key={item.id} className="border-t border-border-strong p-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-bold">{item.name}</span>
                <span className="text-sm text-text-muted">
                  {item.departmentId === null ? "会社直属" : "部署"}・
                  {VISIBILITY_LABELS[item.visibility]}
                </span>
                <span className="text-sm">
                  申請者：{item.requesterDisplayName}
                </span>
                <span className="text-sm">{STATUS_LABELS[item.status]}</span>
                {item.canApprove && (
                  <span className="ml-auto flex gap-2">
                    <Button
                      disabled={busy}
                      aria-label={`${item.name}の申請を承認する`}
                      onClick={() => approve(item)}
                    >
                      承認
                    </Button>
                    <Button
                      variant="danger"
                      disabled={busy}
                      aria-label={`${item.name}の申請を却下する`}
                      onClick={() => startReject(item)}
                    >
                      却下
                    </Button>
                  </span>
                )}
              </div>
              {item.rejectReason !== null && (
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
      </>
    );
  }

  return (
    <>
      <SelectField
        label="状態"
        value={status}
        onChange={(event) => {
          if (isRequestStatus(event.target.value))
            setStatus(event.target.value);
        }}
      >
        {FILTER_STATUSES.map((value) => (
          <option key={value} value={value}>
            {FILTER_LABELS[value]}
          </option>
        ))}
      </SelectField>
      {error !== null && (
        <Alert tone="error" role="alert">
          {describeError(error)}
        </Alert>
      )}
      {renderList()}
      {rejecting !== null && (
        <RejectReasonDialog
          pending={decide.isPending}
          onSubmit={(reason) => reject(rejecting, reason)}
          onClose={() => setRejecting(null)}
        />
      )}
    </>
  );
}
