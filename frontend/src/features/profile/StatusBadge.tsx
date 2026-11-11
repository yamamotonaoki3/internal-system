// ステータスの表示（色つきの丸＋文字）。色だけに頼らず、種類を文字でも出す。
// 戻り予定を過ぎていても、ステータスは自動では変えない。「戻り予定を過ぎています」を添えるだけで、判定は描画したときの時刻で行う（開いたままでは更新しない）。
import type { UserStatus } from "./api/profile-api";
import { STATUS_DOT_CLASSES, STATUS_LABELS } from "./status-labels";

const returnAtFormat = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "short",
  timeStyle: "short",
});

export function StatusBadge({
  status,
}: {
  status: Pick<UserStatus, "kind" | "returnAt">;
}) {
  const overdue =
    status.returnAt !== null &&
    new Date(status.returnAt).getTime() < new Date().getTime();
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2">
      <span className="inline-flex items-center gap-1">
        <span aria-hidden="true" className={STATUS_DOT_CLASSES[status.kind]} />
        <span>{STATUS_LABELS[status.kind]}</span>
      </span>
      {status.returnAt !== null && (
        <span className="text-text-muted">
          戻り予定：{returnAtFormat.format(new Date(status.returnAt))}
        </span>
      )}
      {overdue && <span className="text-danger">戻り予定を過ぎています</span>}
    </span>
  );
}
