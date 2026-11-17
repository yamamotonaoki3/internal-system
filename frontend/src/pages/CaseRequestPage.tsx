// S-18 案件の作成の申請（申請フォームと自分の申請）。
import { CaseRequestWorkspace } from "../features/case-requests";

export function CaseRequestPage() {
  return (
    <section className="mx-auto max-w-3xl rounded-lg bg-surface p-4 md:p-6">
      <h1 className="mb-4 text-2xl font-bold">案件の作成の申請</h1>
      <CaseRequestWorkspace />
    </section>
  );
}
