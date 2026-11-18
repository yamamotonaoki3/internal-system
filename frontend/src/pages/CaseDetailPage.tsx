// S-17 案件の詳細（骨格）。
// ページの中の状態（ダイアログ・入力・完了の表示）を、利用者が替わったときに残さないため、利用者の ID を key にして作り直す。
// ID が確かめられる前は描画しない（Skill「frontend-state」）。
import { useParams } from "react-router";
import { useSignedInUserId } from "../features/auth";
import { CaseDetailView } from "../features/cases";

export function CaseDetailPage() {
  const { caseId = "" } = useParams();
  const userId = useSignedInUserId();
  return (
    <section className="mx-auto max-w-3xl rounded-lg bg-surface p-4 md:p-6">
      {userId !== undefined && (
        <CaseDetailView
          key={`${userId}:${caseId}`}
          caseId={caseId}
          selfId={userId}
        />
      )}
    </section>
  );
}
