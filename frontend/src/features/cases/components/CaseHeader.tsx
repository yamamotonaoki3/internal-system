// S-17 のヘッダー（件名の見出しと概要の項目）。参加者・非参加者の両方に出す。
import type { CaseSummary, TodoProgress } from "../api/case-api";
import { CaseSummaryFacts } from "./CaseSummaryFacts";

export function CaseHeader({
  item,
  progress,
}: {
  item: CaseSummary;
  /** TODO の進捗（出どころは CaseSummaryFacts の説明のとおり） */
  progress: TodoProgress | undefined;
}) {
  return (
    <header className="mb-4">
      <h1 className="text-2xl font-bold">{item.title}</h1>
      <CaseSummaryFacts item={item} progress={progress} />
    </header>
  );
}
