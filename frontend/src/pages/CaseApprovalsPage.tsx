// S-29 案件作成の承認（審査一覧・承認・却下）。
import { CaseRequestReviewList } from "../features/case-requests";

export function CaseApprovalsPage() {
  return (
    <section className="mx-auto max-w-3xl rounded-lg bg-surface p-4 md:p-6">
      <h1 className="mb-4 text-2xl font-bold">案件作成の承認</h1>
      <CaseRequestReviewList />
    </section>
  );
}
