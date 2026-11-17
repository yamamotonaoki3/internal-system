// S-29 の審査一覧。読み込み中・エラー・なし・ありの4つの状態を出し分ける。状態で絞り込む（既定は承認待ち）。
// 承認（候補を足すダイアログ）・却下（理由のダイアログ）は再認証を経ない（C-81）。決裁できない申請（canApprove=false）にはボタンを出さない。
// 409 はサーバーの文言をそのまま一覧の上に出し、一覧を取り直す（useDecideCaseRequest）。却下の理由は文字列として出す。
// 422 で fields に該当の欄（候補・理由）があるときは、ダイアログを開いたまま入力を残し、その欄のエラーとして出す。
import { useEffect, useRef, useState } from "react";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { SelectField } from "../../../components/SelectField";
import {
  CASE_REQUEST_STATUSES,
  type CandidateUser,
  type CaseRequestReviewItem,
  type CaseRequestStatus,
} from "../api/case-request-api";
import { describeError, isApiError } from "../describe-error";
import { useDecideCaseRequest } from "../hooks/useDecideCaseRequest";
import { useReviewCaseRequests } from "../hooks/useReviewCaseRequests";
import { STATUS_LABELS } from "../labels";
import { CandidatePicker } from "./CandidatePicker";
import { RejectReasonDialog } from "./RejectReasonDialog";

const INACTIVE_MARK = "（無効）";

const nameWithMark = (item: { name: string; isActive: boolean }) =>
  item.isActive ? item.name : `${item.name}${INACTIVE_MARK}`;

// 絞り込みの選択肢の名前（承認待ちが既定）
const FILTER_LABELS: Readonly<Record<CaseRequestStatus, string>> = {
  ...STATUS_LABELS,
  withdrawn: "取り下げ",
};

function isCaseRequestStatus(value: string): value is CaseRequestStatus {
  return (CASE_REQUEST_STATUSES as readonly string[]).includes(value);
}

type ApproveDialogProps = {
  item: CaseRequestReviewItem;
  pending: boolean;
  candidateError?: string;
  onSubmit: (additionalCandidateIds: string[]) => void;
  onClose: () => void;
};

/** 承認の確認。承認者は候補を足せる（5-3 AC-5）。申請者は検索の結果に出さない。すでに候補の人を足しても、サーバーが重ねない */
function ApproveDialog({
  item,
  pending,
  candidateError,
  onSubmit,
  onClose,
}: ApproveDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [added, setAdded] = useState<CandidateUser[]>([]);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-label="案件の作成の承認"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
      className="w-full max-w-md rounded-lg bg-surface p-6 text-text shadow-float backdrop:bg-overlay"
    >
      <section>
        <h2 className="mb-4 text-xl font-bold">案件の作成の承認</h2>
        <p className="mb-4">
          「{item.title}
          」の案件を作ります。申請者・候補・担当部署のオーナー・全体管理者が参加します。
        </p>
        <CandidatePicker
          selfId={item.requesterId}
          selected={added}
          error={candidateError}
          onChange={setAdded}
        />
        <div className="flex gap-2">
          <Button
            disabled={pending}
            onClick={() => onSubmit(added.map((user) => user.id))}
          >
            承認する
          </Button>
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            キャンセル
          </Button>
        </div>
      </section>
    </dialog>
  );
}

export function CaseRequestReviewList() {
  const [status, setStatus] = useState<CaseRequestStatus>("pending");
  const [approving, setApproving] = useState<CaseRequestReviewItem | null>(
    null,
  );
  const [rejecting, setRejecting] = useState<CaseRequestReviewItem | null>(
    null,
  );
  // 422 で該当の欄が示されたときのサーバーの文（ダイアログの欄に出す）
  const [fieldError, setFieldError] = useState<string>();
  const requests = useReviewCaseRequests(status);
  const decide = useDecideCaseRequest();

  // 該当の欄があれば、ダイアログを閉じずにその欄の文を覚える。なければ閉じて、一覧の上に出す
  function settle(field: string, error: unknown, close: () => void) {
    if (isApiError(error) && error.fields?.includes(field)) {
      setFieldError(error.message);
      return;
    }
    close();
  }

  function approve(item: CaseRequestReviewItem, ids: string[]) {
    if (decide.isPending) return;
    // 成功しても、候補の欄以外の失敗でも確認を閉じる。失敗の理由は一覧の上に出す
    setFieldError(undefined);
    decide.mutate(
      { kind: "approve", requestId: item.id, additionalCandidateIds: ids },
      {
        onSuccess: () => setApproving(null),
        onError: (error) =>
          settle("additionalCandidateIds", error, () => setApproving(null)),
      },
    );
  }

  function reject(item: CaseRequestReviewItem, reason: string) {
    setFieldError(undefined);
    decide.mutate(
      { kind: "reject", requestId: item.id, reason },
      {
        onSuccess: () => setRejecting(null),
        onError: (error) => settle("reason", error, () => setRejecting(null)),
      },
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
                <span className="font-bold">{item.title}</span>
                <span className="text-sm">{STATUS_LABELS[item.status]}</span>
                {item.hasSimilarTitle && (
                  <span className="text-sm text-danger">
                    似た案件があります
                  </span>
                )}
                {item.canApprove && (
                  <span className="ml-auto flex gap-2">
                    <Button
                      disabled={decide.isPending}
                      aria-label={`${item.title}の申請を承認する`}
                      onClick={() => {
                        decide.reset();
                        setFieldError(undefined);
                        setApproving(item);
                      }}
                    >
                      承認
                    </Button>
                    <Button
                      variant="danger"
                      disabled={decide.isPending}
                      aria-label={`${item.title}の申請を却下する`}
                      onClick={() => {
                        decide.reset();
                        setFieldError(undefined);
                        setRejecting(item);
                      }}
                    >
                      却下
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
              <p className="mt-1 text-sm">
                申請者：{item.requesterDisplayName}
                {item.candidates.length > 0 && (
                  <span className="ml-2">
                    候補：
                    {item.candidates
                      .map((c) =>
                        nameWithMark({
                          name: c.displayName,
                          isActive: c.isActive,
                        }),
                      )
                      .join("・")}
                  </span>
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
      </>
    );
  }

  return (
    <>
      <SelectField
        label="状態"
        value={status}
        onChange={(event) => {
          if (isCaseRequestStatus(event.target.value))
            setStatus(event.target.value);
        }}
      >
        {CASE_REQUEST_STATUSES.map((value) => (
          <option key={value} value={value}>
            {FILTER_LABELS[value]}
          </option>
        ))}
      </SelectField>
      {decide.isError && fieldError === undefined && (
        <Alert tone="error" role="alert">
          {describeError(decide.error)}
        </Alert>
      )}
      {renderList()}
      {approving !== null && (
        <ApproveDialog
          item={approving}
          pending={decide.isPending}
          candidateError={fieldError}
          onSubmit={(ids) => approve(approving, ids)}
          onClose={() => setApproving(null)}
        />
      )}
      {rejecting !== null && (
        <RejectReasonDialog
          pending={decide.isPending}
          serverError={fieldError}
          onSubmit={(reason) => reject(rejecting, reason)}
          onClose={() => setRejecting(null)}
        />
      )}
    </>
  );
}
