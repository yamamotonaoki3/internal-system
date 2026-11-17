// 退職処理の申請のサーバーの状態のキー。書き込み（申請・取り下げ・却下・無効化）が成功したら all を取り直す
// （自分の申請と全体管理者の一覧が一度に更新される）。
import type { RetirementRequestStatus } from "./retirement-request-api";

export const retirementRequestKeys = {
  all: ["retirement-requests"] as const,
  mine: ["retirement-requests", "mine"] as const,
  review: (status: RetirementRequestStatus) =>
    ["retirement-requests", "review", status] as const,
};
