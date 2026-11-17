// S-16 案件一覧。
import { Link } from "react-router";
import { CaseList } from "../features/cases";

export function CasesPage() {
  return (
    <section className="mx-auto max-w-3xl rounded-lg bg-surface p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">案件一覧</h1>
        <Link to="/case-requests" className="text-primary underline">
          案件の作成を申請
        </Link>
      </div>
      <CaseList />
    </section>
  );
}
