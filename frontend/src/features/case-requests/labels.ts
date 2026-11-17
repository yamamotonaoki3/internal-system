// 申請の状態の表示名（S-18 の自分の申請）。
import type { CaseRequestStatus } from "./api/case-request-api";

export const STATUS_LABELS: Readonly<Record<CaseRequestStatus, string>> = {
  pending: "承認待ち",
  approved: "承認済み",
  rejected: "却下",
  withdrawn: "取り下げ済み",
  auto_cancelled: "自動取消",
};
