// S-17（骨格）。まず概要を取り、有効な参加者のときだけ詳細（説明・参加者）を取る。
// 非参加者と、詳細が 403（外された）のときは「参加者だけが見られます（非公開）」を出し、前の詳細を出さない。
// 「参加者を管理」は有効な参加者で進行中のときだけ、「納期を変更」は概要の canEditDueDate が真のときだけ出す（表示の制御。認可はサーバー）。
// 開いているダイアログと、参加者の操作の結果は、この部品（行の外）で持つ。取り直しで非参加・詳細 403 になり「参加者を管理」が消えても、
// 操作のエラー（「参加者だけが操作できます」など）を、非公開の表示とあわせて出し続ける（コードレビュー1回目の軽微）。利用者が替わったときは、ページごと作り直して残さない（pages/CaseDetailPage.tsx）。
// 「案件を終了」「案件を再開」（#150）は有効な参加者だけに出す（R-77。非参加の管理者にも出さない）。確認のダイアログと結果はこの部品で持ち、
// 結果（完了・失敗の文言）はダイアログの外に出す。送った後は結果によらずダイアログを閉じる（409 なら状態が変わっているので、同じ確認を出し続けない）。
// 参加者の本文は、説明 → 参加者 → TODO（#149。CaseTodoSection）→ 添付ファイル（#148。CaseAttachments）→ やり取り（#148。CaseConversation）の順に見出しで縦に並べる（C-184(3)。タブは作らない）。
// TODO・添付の一覧は、詳細が取れた参加者だけが取る。参加者のヘッダーの進捗は、区画と同じ TODO の一覧の取得から出す（2秒ごとに両方が一致する。#149 計画 6.9(4)）。非参加者は概要の進捗。
import { useState } from "react";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import type { CaseSummary, TodoProgress } from "../api/case-api";
import { describeError, isApiError } from "../describe-error";
import { useCaseStatusChange } from "../hooks/useCaseWrites";
import { useCaseAttachments } from "../hooks/useCaseAttachments";
import { useCaseDetail, useCaseSummary } from "../hooks/useCases";
import { useCaseTodos } from "../hooks/useCaseTodos";
import { useParticipantWrites } from "../hooks/useParticipantWrites";
import { CASE_STATUS_CHANGE_TEXTS, PARTICIPANTS_ONLY_TEXT } from "../labels";
import { CaseAttachments } from "./CaseAttachments";
import { CaseConfirmDialog } from "./CaseConfirmDialog";
import { CaseConversation } from "./CaseConversation";
import { CaseDueDateDialog } from "./CaseDueDateDialog";
import { CaseHeader } from "./CaseHeader";
import { CaseParticipantList } from "./CaseParticipantList";
import { CaseParticipantManager } from "./CaseParticipantManager";
import { CaseTodoSection } from "./CaseTodoSection";

type OpenDialog = "participants" | "dueDate" | "close" | "reopen" | null;
type StatusChangeResult = { tone: "info" | "error"; text: string };

/** ヘッダーの進捗：参加者は TODO の一覧の取得（最後に取得したページ）の値、取れていなければ出さない。非参加者は概要の値 */
function headerProgressOf(
  item: CaseSummary,
  isParticipant: boolean,
  todos: ReturnType<typeof useCaseTodos>,
): TodoProgress | undefined {
  if (!isParticipant) return item.progress;
  return todos.isSuccess
    ? (todos.data.pages.at(-1)?.progress ?? null)
    : undefined;
}

export function CaseDetailView({
  caseId,
  selfId,
}: {
  caseId: string;
  selfId: string;
}) {
  const summary = useCaseSummary(caseId);
  const isParticipant = summary.data?.isParticipant === true;
  const detail = useCaseDetail(caseId, isParticipant);
  const todos = useCaseTodos(caseId, isParticipant && detail.isSuccess);
  const attachments = useCaseAttachments(
    caseId,
    isParticipant && detail.isSuccess,
  );
  const [open, setOpen] = useState<OpenDialog>(null);
  const writes = useParticipantWrites(caseId);
  const statusChange = useCaseStatusChange(
    caseId,
    detail.data?.channelId ?? null,
  );
  const [statusResult, setStatusResult] = useState<StatusChangeResult>();

  if (summary.isPending) return <p role="status">読み込み中です</p>;
  if (summary.isError)
    return (
      <Alert tone="error" role="alert">
        {describeError(summary.error)}
      </Alert>
    );

  const item = summary.data;
  const headerProgress = headerProgressOf(item, isParticipant, todos);
  const close = () => setOpen(null);
  const managerShown =
    open === "participants" &&
    isParticipant &&
    detail.isSuccess &&
    item.status === "active";

  function changeStatus(to: "close" | "reopen") {
    setStatusResult(undefined);
    statusChange.mutate(to, {
      onSuccess: () =>
        setStatusResult({
          tone: "info",
          text: CASE_STATUS_CHANGE_TEXTS[to].done,
        }),
      onError: (cause) =>
        setStatusResult({ tone: "error", text: describeError(cause) }),
      onSettled: close,
    });
  }

  const statusAction = item.status === "active" ? "close" : "reopen";

  /** ヘッダーの下の操作（納期の変更・終了・再開）と、終了・再開の確認・結果 */
  function renderStatusChange() {
    return (
      <>
        {(item.canEditDueDate || isParticipant) && (
          <div className="mb-4 flex flex-wrap gap-2">
            {item.canEditDueDate && (
              <Button variant="secondary" onClick={() => setOpen("dueDate")}>
                納期を変更
              </Button>
            )}
            {isParticipant && (
              <Button variant="secondary" onClick={() => setOpen(statusAction)}>
                {CASE_STATUS_CHANGE_TEXTS[statusAction].button}
              </Button>
            )}
          </div>
        )}
        {(open === "close" || open === "reopen") && (
          <CaseConfirmDialog
            title={CASE_STATUS_CHANGE_TEXTS[open].title}
            confirmLabel={CASE_STATUS_CHANGE_TEXTS[open].confirm}
            pending={statusChange.isPending}
            onConfirm={() => changeStatus(open)}
            onClose={close}
          >
            {CASE_STATUS_CHANGE_TEXTS[open].body}
          </CaseConfirmDialog>
        )}
        {statusResult !== undefined && (
          <Alert
            tone={statusResult.tone}
            role={statusResult.tone === "error" ? "alert" : "status"}
          >
            {statusResult.text}
          </Alert>
        )}
      </>
    );
  }

  function renderBody() {
    if (!isParticipant) return <p>{PARTICIPANTS_ONLY_TEXT}</p>;
    if (detail.isError)
      return isApiError(detail.error) && detail.error.status === 403 ? (
        <p>{PARTICIPANTS_ONLY_TEXT}</p>
      ) : (
        <Alert tone="error" role="alert">
          {describeError(detail.error)}
        </Alert>
      );
    if (detail.isPending) return <p role="status">読み込み中です</p>;
    return (
      <>
        <section>
          <h2 className="mb-2 text-lg font-bold">説明</h2>
          <p className="whitespace-pre-wrap">{detail.data.description}</p>
        </section>
        <CaseParticipantList participants={detail.data.participants} />
        {item.status === "active" && (
          <div className="mt-2">
            <Button variant="secondary" onClick={() => setOpen("participants")}>
              参加者を管理
            </Button>
          </div>
        )}
        {open === "participants" && (
          <CaseParticipantManager
            selfId={selfId}
            writes={writes}
            participants={detail.data.participants}
            onClose={close}
          />
        )}
        <CaseTodoSection
          caseId={caseId}
          selfId={selfId}
          closed={item.status === "closed"}
          participants={detail.data.participants}
          todos={todos}
        />
        <CaseAttachments attachments={attachments} />
        <CaseConversation
          caseId={caseId}
          selfId={selfId}
          roomId={detail.data.channelId}
          closed={item.status === "closed"}
        />
      </>
    );
  }

  return (
    <>
      <CaseHeader item={item} progress={headerProgress} />
      {renderStatusChange()}
      {open === "dueDate" && (
        <CaseDueDateDialog
          caseId={caseId}
          dueDate={item.dueDate}
          onClose={close}
        />
      )}
      {!managerShown && writes.error !== undefined && (
        <Alert tone="error" role="alert">
          {writes.error}
        </Alert>
      )}
      {renderBody()}
    </>
  );
}
