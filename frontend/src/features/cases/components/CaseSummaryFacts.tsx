// 案件の概要の項目（案件番号・状態・取引先・担当部署・納期・参加者数）。一覧の行と詳細のヘッダーで共用する。
// 参加者数は、サーバーが返したとき（参加者か管理の資格のある人）だけ出す。
import type { CaseSummary } from "../api/case-api";
import { nameWithMark, participantCountText, STATUS_LABELS } from "../labels";

export function CaseSummaryFacts({ item }: { item: CaseSummary }) {
  return (
    <p className="mt-1 flex flex-wrap gap-x-3 text-sm text-text-muted">
      <span>{item.caseNumber}</span>
      <span>{STATUS_LABELS[item.status]}</span>
      <span>取引先：{nameWithMark(item.client)}</span>
      <span>担当部署：{item.departments.map(nameWithMark).join("・")}</span>
      {item.dueDate !== null && <span>納期：{item.dueDate}</span>}
      {item.participantCount !== null && (
        <span>{participantCountText(item.participantCount)}</span>
      )}
    </p>
  );
}
