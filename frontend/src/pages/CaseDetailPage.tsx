// S-17 案件の詳細（骨格）。
import { useParams } from "react-router";
import { CaseDetailView } from "../features/cases";

export function CaseDetailPage() {
  const { caseId = "" } = useParams();
  return (
    <section className="mx-auto max-w-3xl rounded-lg bg-surface p-4 md:p-6">
      <CaseDetailView key={caseId} caseId={caseId} />
    </section>
  );
}
