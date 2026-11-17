// 監査ログの検索のサーバーの状態のキー。
// 利用者の ID を含める：401 の処理はセッションのキャッシュだけを捨てるため、利用者が切り替わっても、前の利用者の一覧を出さない（0-2 AC-8）。
// requestNumber は「絞り込む」を押した回数。同じ条件で押し直したときも最初のページから読み直す（取得のたびに閲覧の記録が残るため、押したときだけ送る）。
import type { AuditLogFilters } from "./audit-log-api";

export const auditLogKeys = {
  all: ["audit-logs"] as const,
  search: (userId: string, filters: AuditLogFilters, requestNumber = 0) =>
    [...auditLogKeys.all, "search", userId, filters, requestNumber] as const,
};
