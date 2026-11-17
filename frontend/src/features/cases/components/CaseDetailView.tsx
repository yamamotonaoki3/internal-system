// S-17（骨格）。まず概要を取り、有効な参加者のときだけ詳細（説明・参加者）を取る。
// 非参加者と、詳細が 403（外された）のときは「参加者だけが見られます（非公開）」を出し、前の詳細を出さない。
// やり取り・TODO・添付は後続（#148・#149）で足す。
import { Alert } from "../../../components/Alert";
import { describeError, isApiError } from "../describe-error";
import { useCaseDetail, useCaseSummary } from "../hooks/useCases";
import { PARTICIPANTS_ONLY_TEXT } from "../labels";
import { CaseHeader } from "./CaseHeader";
import { CaseParticipantList } from "./CaseParticipantList";

export function CaseDetailView({ caseId }: { caseId: string }) {
  const summary = useCaseSummary(caseId);
  const isParticipant = summary.data?.isParticipant === true;
  const detail = useCaseDetail(caseId, isParticipant);

  if (summary.isPending) return <p role="status">読み込み中です</p>;
  if (summary.isError)
    return (
      <Alert tone="error" role="alert">
        {describeError(summary.error)}
      </Alert>
    );

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
      </>
    );
  }

  return (
    <>
      <CaseHeader item={summary.data} />
      {renderBody()}
    </>
  );
}
