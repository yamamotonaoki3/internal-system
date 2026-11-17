// 案件のサーバーの状態のキー。利用者の ID を含める（ログインし直した別の利用者に、前の利用者の案件を見せないため。Skill「frontend-state」）。
// 案件が増える・参加が変わる書き込み（案件の作成の承認など）の後は all を取り直す。
import type { CaseListScope, CaseStatus } from "./case-api";

export const caseKeys = {
  all: ["cases"] as const,
  list: (userId: string, scope: CaseListScope, status: CaseStatus) =>
    ["cases", "list", userId, scope, status] as const,
  summary: (userId: string, caseId: string) =>
    ["cases", "summary", userId, caseId] as const,
  detail: (userId: string, caseId: string) =>
    ["cases", "detail", userId, caseId] as const,
};

/** list・summary・detail のキーで、利用者の ID がある位置 */
export const CASE_KEY_USER_ID_INDEX = 2;
