// 案件の概要の項目（案件番号・状態・取引先・担当部署・納期・参加者数・TODO の進捗）。一覧の行と詳細のヘッダーで共用する。
// 参加者数は、サーバーが返したとき（参加者か管理の資格のある人）だけ出す。
// 進捗は呼び出し側が渡す：一覧と非参加者は概要の値、参加者の S-17 は TODO の一覧の取得の値（区画と同じ値にするため。#149 計画 6.9(4)）。
// undefined（参加者の S-17 で、TODO の一覧をまだ取れていない）なら出さない。
import type { CaseSummary, TodoProgress } from "../api/case-api";
import { nameWithMark, participantCountText, STATUS_LABELS } from "../labels";
import { CaseTodoProgress } from "./CaseTodoProgress";

export function CaseSummaryFacts({
  item,
  progress,
}: {
  item: CaseSummary;
  progress: TodoProgress | undefined;
}) {
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
      {progress !== undefined && (
        <span>
          TODO：
          <CaseTodoProgress progress={progress} />
        </span>
      )}
    </p>
  );
}
