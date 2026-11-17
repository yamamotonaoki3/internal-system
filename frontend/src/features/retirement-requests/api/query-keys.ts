// 退職処理の申請のサーバーの状態のキー。書き込み（申請・取り下げ・却下・無効化）が成功したら all を取り直す
// （自分の申請と全体管理者の一覧が一度に更新される）。
import type { RetirementRequestStatus } from "./retirement-request-api";

export const retirementRequestKeys = {
  all: ["retirement-requests"] as const,
  // 利用者ごとに分ける（利用者の切り替えで、前の利用者の一覧を見せない）
  mine: (userId: string) => ["retirement-requests", "mine", userId] as const,
  review: (userId: string, status: RetirementRequestStatus) =>
    ["retirement-requests", "review", userId, status] as const,
};
