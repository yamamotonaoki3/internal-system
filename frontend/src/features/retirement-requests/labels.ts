// 退職処理の申請の状態の表示名
import type { RetirementRequestStatus } from "./api/retirement-request-api";

export const STATUS_LABELS: Readonly<Record<RetirementRequestStatus, string>> =
  {
    pending: "申請中",
    approved: "完了",
    rejected: "却下",
    withdrawn: "取り下げ済み",
  };
