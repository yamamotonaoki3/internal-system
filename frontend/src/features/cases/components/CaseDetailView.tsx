// S-17（骨格）。まず概要を取り、有効な参加者のときだけ詳細（説明・参加者）を取る。
// 非参加者と、詳細が 403（外された）のときは「参加者だけが見られます（非公開）」を出し、前の詳細を出さない。
// 「参加者を管理」は有効な参加者で進行中のときだけ、「納期を変更」は概要の canEditDueDate が真のときだけ出す（表示の制御。認可はサーバー）。
// 開いているダイアログは、この部品（行の外）で持つ。利用者が替わったときは、ページごと作り直して残さない（pages/CaseDetailPage.tsx）。
// やり取り・TODO・添付は後続（#148・#149）で足す。
import { useState } from "react";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { describeError, isApiError } from "../describe-error";
import { useCaseDetail, useCaseSummary } from "../hooks/useCases";
import { PARTICIPANTS_ONLY_TEXT } from "../labels";
import { CaseDueDateDialog } from "./CaseDueDateDialog";
import { CaseHeader } from "./CaseHeader";
import { CaseParticipantList } from "./CaseParticipantList";
import { CaseParticipantManager } from "./CaseParticipantManager";

type OpenDialog = "participants" | "dueDate" | null;

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
  const [open, setOpen] = useState<OpenDialog>(null);

  if (summary.isPending) return <p role="status">読み込み中です</p>;
  if (summary.isError)
    return (
      <Alert tone="error" role="alert">
        {describeError(summary.error)}
      </Alert>
    );

  const item = summary.data;
  const close = () => setOpen(null);

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
            caseId={caseId}
            selfId={selfId}
            participants={detail.data.participants}
            onClose={close}
          />
        )}
      </>
    );
  }

  return (
    <>
      <CaseHeader item={item} />
      {item.canEditDueDate && (
        <div className="mb-4">
          <Button variant="secondary" onClick={() => setOpen("dueDate")}>
            納期を変更
          </Button>
        </div>
      )}
      {open === "dueDate" && (
        <CaseDueDateDialog
          caseId={caseId}
          dueDate={item.dueDate}
          onClose={close}
        />
      )}
      {renderBody()}
    </>
  );
}
