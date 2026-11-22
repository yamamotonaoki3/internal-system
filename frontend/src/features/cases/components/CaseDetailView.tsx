// S-17（骨格）。まず概要を取り、有効な参加者のときだけ詳細（説明・参加者）を取る。
// 非参加者と、詳細が 403（外された）のときは「参加者だけが見られます（非公開）」を出し、前の詳細を出さない。
// 「参加者を管理」は有効な参加者で進行中のときだけ、「納期を変更」は概要の canEditDueDate が真のときだけ出す（表示の制御。認可はサーバー）。
// 開いているダイアログと、参加者の操作の結果は、この部品（行の外）で持つ。取り直しで非参加・詳細 403 になり「参加者を管理」が消えても、
// 操作のエラー（「参加者だけが操作できます」など）を、非公開の表示とあわせて出し続ける（コードレビュー1回目の軽微）。利用者が替わったときは、ページごと作り直して残さない（pages/CaseDetailPage.tsx）。
// 「案件を終了」「案件を再開」（#150）は有効な参加者だけに出す（R-77。非参加の管理者にも出さない）。確認のダイアログと結果はこの部品で持ち、
// 結果（完了・失敗の文言）はダイアログの外に出す。送った後は結果によらずダイアログを閉じる（409 なら状態が変わっているので、同じ確認を出し続けない）。
// 再開（150-B）は参加者の選び直しのダイアログ（CaseReopenDialog）。422 だけはダイアログを閉じず、選ぶ段階の欄（addUserIds は社員の検索）か、ダイアログの全体に出す。
// 参加者の本文は、説明 → 参加者 → TODO（#149。CaseTodoSection）→ 添付ファイル（#148。CaseAttachments）→ やり取り（#148。CaseConversation）の順に見出しで縦に並べる（C-184(3)。タブは作らない）。
// 表示中に外されたこと（#308）は useCaseAccessLoss が見つけ、非公開の表示（概要が非参加）・確かめられない表示（再試行）に切り替え、ダイアログ（添付の公開範囲の変更も）を閉じる。
// TODO の一覧は、参加者が取る（詳細の失敗の間も、外されたことの検出の契機にする。#308）。添付の一覧は、詳細が取れた参加者だけが取る。参加者のヘッダーの進捗は、区画と同じ TODO の一覧の取得から出す（2秒ごとに両方が一致する。#149 計画 6.9(4)）。非参加者は概要の進捗。
import { useCallback, useState } from "react";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import type {
  CaseAttachment,
  CaseReopenBody,
  CaseSummary,
  TodoProgress,
} from "../api/case-api";
import { describeError, isApiError } from "../describe-error";
import { isCaseNotFound, useCaseAccessLoss } from "../hooks/useCaseAccessLoss";
import { useCaseStatusChange } from "../hooks/useCaseWrites";
import { useCaseAttachments } from "../hooks/useCaseAttachments";
import { useCaseDetail, useCaseSummary } from "../hooks/useCases";
import { useCaseTodos } from "../hooks/useCaseTodos";
import { useParticipantWrites } from "../hooks/useParticipantWrites";
import {
  CASE_ACCESS_UNVERIFIED_TEXT,
  CASE_EDIT_TEXTS,
  CASE_STATUS_CHANGE_TEXTS,
  closeTodoWarning,
  PARTICIPANTS_ONLY_TEXT,
} from "../labels";
import { CaseAttachments } from "./CaseAttachments";
import { CaseConfirmDialog } from "./CaseConfirmDialog";
import { CaseConversation } from "./CaseConversation";
import { CaseDueDateDialog } from "./CaseDueDateDialog";
import { CaseEditDialog, type CaseEditBasis } from "./CaseEditDialog";
import { CaseHeader } from "./CaseHeader";
import { CaseParticipantList } from "./CaseParticipantList";
import { CaseParticipantManager } from "./CaseParticipantManager";
import { CaseReopenDialog } from "./CaseReopenDialog";
import { CaseTodoSection } from "./CaseTodoSection";

type OpenDialog =
  "participants" | "dueDate" | "close" | "reopen" | "edit" | null;
type StatusChangeResult = { tone: "info" | "error"; text: string };
/** 再開の 422（ダイアログの中に出す）。field は欄に結び付ける項目 */
type ReopenInvalid = { field: string | undefined; text: string };

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

/** 終了の確認の警告：未完了の件数は進捗から出す（画面の行は数えない）。読み込み中・失敗・進捗なし・0件は出さない */
function CloseTodoWarning({
  todos,
}: {
  todos: ReturnType<typeof useCaseTodos>;
}) {
  const progress = todos.isSuccess
    ? todos.data.pages.at(-1)?.progress
    : undefined;
  if (!progress) return null;
  const remaining = progress.total - progress.done;
  if (remaining <= 0) return null;
  return (
    <Alert tone="info" role="status" as="p">
      {closeTodoWarning(remaining)}
    </Alert>
  );
}

/** 概要の取り直しが失敗している間（前の値が残っていても）は、参加者として取りにいかない */
function isParticipantOf(summary: ReturnType<typeof useCaseSummary>): boolean {
  return summary.isSuccess && summary.data.isParticipant;
}

/** 資格を失った証拠がある：概要が成功して非参加、または 404。5xx・通信の失敗は含めない（#363） */
function isOutsiderOf(summary: ReturnType<typeof useCaseSummary>): boolean {
  return summary.isSuccess
    ? !summary.data.isParticipant
    : summary.isError && isCaseNotFound(summary.error);
}

function todosWanted(detail: ReturnType<typeof useCaseDetail>): boolean {
  return detail.isSuccess || (detail.isError && !isForbidden(detail.error));
}

function isForbidden(error: unknown): boolean {
  return isApiError(error) && error.status === 403;
}

/**
 * 再開のダイアログに渡す、詳細の取得の状態。取得中（取り直しも）と 403（外された扱い。#308 がダイアログを閉じる）は読み込み中、
 * それ以外の失敗は文言を渡す。古い詳細が残っていても、取り直しの最中・失敗の間は選ぶ・送るを出さない
 */
function reopenLoadState(detail: ReturnType<typeof useCaseDetail>): {
  loading: boolean;
  loadError: string | undefined;
} {
  const loading = detail.isFetching || isForbidden(detail.error);
  return {
    loading,
    loadError:
      detail.isError && !loading ? describeError(detail.error) : undefined,
  };
}

type EditResult = { tone: "info" | "error"; lines: string[] };

/** 内容の編集の基準：参加者は詳細の応答だけから（版も。取れていなければ null）、参加していない管理者は概要の応答だけから（expected） */
function editBasisOf(
  item: CaseSummary,
  detail: ReturnType<typeof useCaseDetail> | null,
): CaseEditBasis | null {
  if (detail !== null) {
    if (!detail.isSuccess) return null;
    const d = detail.data;
    return {
      caseNumber: d.caseNumber,
      title: d.title,
      description: d.description,
      client: d.client,
      departments: d.departments,
      conflict: { version: d.version },
    };
  }
  return {
    caseNumber: item.caseNumber,
    title: item.title,
    description: null,
    client: item.client,
    departments: item.departments,
    conflict: {
      expected: {
        title: item.title,
        clientId: item.client.id,
        departmentIds: item.departments.map((d) => d.id),
      },
    },
  };
}

/** ヘッダーの下の操作の並びを出すか（納期の変更・終了／再開・内容の編集のどれかがある） */
const hasHeaderActions = (item: CaseSummary, isParticipant: boolean) =>
  item.canEditDueDate || isParticipant || item.canManage;

/**
 * 「内容を編集」：進行中で、有効な参加者か管理の資格のある人に出す（表示の制御。認可はサーバー）。
 * 参加者は詳細が取れるまで押せない（基準を詳細の応答から作るため）。detail は参加者のときだけ渡す
 */
function CaseEditButton({
  item,
  detail,
  onOpen,
}: {
  item: CaseSummary;
  detail: ReturnType<typeof useCaseDetail> | null;
  onOpen: (basis: CaseEditBasis) => void;
}) {
  if (item.status !== "active" || (detail === null && !item.canManage))
    return null;
  const basis = editBasisOf(item, detail);
  return (
    <Button
      variant="secondary"
      disabled={basis === null}
      onClick={() => {
        if (basis !== null) onOpen(basis);
      }}
    >
      {CASE_EDIT_TEXTS.button}
    </Button>
  );
}

/** 内容の編集のダイアログ（basis があるときだけ）と、結果の表示（ダイアログの外） */
function CaseEditPanel({
  caseId,
  basis,
  result,
  onResult,
  onClose,
}: {
  caseId: string;
  basis: CaseEditBasis | null;
  result: EditResult | undefined;
  onResult: (result: EditResult) => void;
  onClose: () => void;
}) {
  return (
    <>
      {basis !== null && (
        <CaseEditDialog
          caseId={caseId}
          basis={basis}
          onSaved={(titleFormatted) =>
            onResult({
              tone: "info",
              lines: [
                CASE_EDIT_TEXTS.saved,
                ...(titleFormatted ? [CASE_EDIT_TEXTS.formatted] : []),
              ],
            })
          }
          onFailed={(text) => onResult({ tone: "error", lines: [text] })}
          onClose={onClose}
        />
      )}
      {result !== undefined && (
        <Alert
          tone={result.tone}
          role={result.tone === "error" ? "alert" : "status"}
        >
          {result.lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </Alert>
      )}
    </>
  );
}

/** 外されたかを確かめられないとき（#308）：中身を描かず、失敗の表示と再試行だけを出す */
function UnverifiedAlert({ onRetry }: { onRetry: () => void }) {
  return (
    <Alert tone="error" role="alert">
      <p>{CASE_ACCESS_UNVERIFIED_TEXT}</p>
      <Button variant="secondary" onClick={onRetry}>
        再試行
      </Button>
    </Alert>
  );
}

export function CaseDetailView({
  caseId,
  selfId,
}: {
  caseId: string;
  selfId: string;
}) {
  const summary = useCaseSummary(caseId);
  const isParticipant = isParticipantOf(summary);
  const detail = useCaseDetail(caseId, isParticipant);
  // 詳細の読み込みに失敗していても取る：外されたことの検出の契機（useCaseAccessLoss）にするため。
  // 詳細の応答の前と、詳細が 403（既に非公開の表示）のときは取らない
  const todos = useCaseTodos(caseId, isParticipant && todosWanted(detail));
  const attachments = useCaseAttachments(
    caseId,
    isParticipant && detail.isSuccess,
  );
  const [open, setOpen] = useState<OpenDialog>(null);
  const [visibilityTarget, setVisibilityTarget] =
    useState<CaseAttachment | null>(null);
  const writes = useParticipantWrites(caseId);
  const roomId = detail.data?.channelId ?? null;
  const statusChange = useCaseStatusChange(caseId, roomId);
  const [statusResult, setStatusResult] = useState<StatusChangeResult>();
  const [reopenInvalid, setReopenInvalid] = useState<ReopenInvalid>();
  // 内容の編集の基準（開いた時点の1つの応答から作り、開いている間は差し替えない。#150 の 150-C）と結果
  const [editBasis, setEditBasis] = useState<CaseEditBasis | null>(null);
  const [editResult, setEditResult] = useState<EditResult>();
  const closeDialog = useCallback(() => {
    setOpen(null);
    setVisibilityTarget(null);
    setEditBasis(null);
  }, []);
  const accessLoss = useCaseAccessLoss({
    caseId,
    userId: selfId,
    roomId,
    isParticipant,
    outsider: isOutsiderOf(summary),
    onLost: closeDialog,
  });

  if (accessLoss.unverified)
    return <UnverifiedAlert onRetry={accessLoss.retry} />;
  if (summary.isPending) return <p role="status">読み込み中です</p>;
  if (summary.isError)
    return (
      <Alert tone="error" role="alert">
        {describeError(summary.error)}
      </Alert>
    );

  const item = summary.data;
  const headerProgress = headerProgressOf(item, isParticipant, todos);
  const close = closeDialog;
  const managerShown =
    open === "participants" &&
    isParticipant &&
    detail.isSuccess &&
    item.status === "active";

  function closeCase() {
    setStatusResult(undefined);
    statusChange.mutate(
      { to: "close" },
      {
        onSuccess: () =>
          setStatusResult({
            tone: "info",
            text: CASE_STATUS_CHANGE_TEXTS.close.done,
          }),
        onError: (cause) =>
          setStatusResult({ tone: "error", text: describeError(cause) }),
        onSettled: close,
      },
    );
  }

  function reopenCase(body: CaseReopenBody, invalid: () => void) {
    setStatusResult(undefined);
    setReopenInvalid(undefined);
    statusChange.mutate(
      { to: "reopen", body },
      {
        onSuccess: () => {
          setStatusResult({
            tone: "info",
            text: CASE_STATUS_CHANGE_TEXTS.reopen.done,
          });
          close();
        },
        onError: (cause) => {
          if (isApiError(cause) && cause.status === 422) {
            setReopenInvalid({
              field: cause.fields?.[0],
              text: describeError(cause),
            });
            invalid();
            return;
          }
          setStatusResult({ tone: "error", text: describeError(cause) });
          close();
        },
      },
    );
  }

  function closeReopenDialog() {
    setReopenInvalid(undefined);
    close();
  }

  const statusAction = item.status === "active" ? "close" : "reopen";
  function openEdit(basis: CaseEditBasis) {
    setEditResult(undefined);
    setEditBasis(basis);
    setOpen("edit");
  }

  /** ヘッダーの下の操作（納期の変更・終了・再開）と、終了・再開の確認・結果 */
  function renderStatusChange() {
    return (
      <>
        {hasHeaderActions(item, isParticipant) && (
          <div className="mb-4 flex flex-wrap gap-2">
            <CaseEditButton
              item={item}
              detail={isParticipant ? detail : null}
              onOpen={openEdit}
            />
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
        {open === "close" && (
          <CaseConfirmDialog
            title={CASE_STATUS_CHANGE_TEXTS.close.title}
            confirmLabel={CASE_STATUS_CHANGE_TEXTS.close.confirm}
            pending={statusChange.isPending}
            notice={<CloseTodoWarning todos={todos} />}
            onConfirm={closeCase}
            onClose={close}
          >
            {CASE_STATUS_CHANGE_TEXTS.close.body}
          </CaseConfirmDialog>
        )}
        {open === "reopen" && (
          <CaseReopenDialog
            selfId={selfId}
            participants={detail.data?.participants}
            {...reopenLoadState(detail)}
            onRetry={() => void detail.refetch()}
            pending={statusChange.isPending}
            searchError={
              reopenInvalid?.field === "addUserIds"
                ? reopenInvalid.text
                : undefined
            }
            error={
              reopenInvalid !== undefined &&
              reopenInvalid.field !== "addUserIds"
                ? reopenInvalid.text
                : undefined
            }
            onConfirm={reopenCase}
            onClose={closeReopenDialog}
          />
        )}
        <CaseEditPanel
          caseId={caseId}
          basis={editBasis}
          result={editResult}
          onResult={(next) => {
            setEditResult(next);
            close();
          }}
          onClose={close}
        />
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
      return isForbidden(detail.error) ? (
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
          closed={item.status === "closed"}
          participants={detail.data.participants}
          todos={todos}
        />
        <CaseAttachments
          caseId={caseId}
          attachments={attachments}
          visibilityTarget={visibilityTarget}
          onVisibilityTargetChange={setVisibilityTarget}
        />
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
