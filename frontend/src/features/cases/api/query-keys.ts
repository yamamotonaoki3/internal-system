// 案件のサーバーの状態のキー。利用者の ID を含める（ログインし直した別の利用者に、前の利用者の案件を見せないため。Skill「frontend-state」）。
// 案件が増える・参加が変わる書き込み（案件の作成の承認など）の後は all を取り直す。
import type { CaseListScope, CaseStatus } from "./case-api";

const caseTodoEventsPrefix = (userId: string, caseId: string) =>
  ["cases", "todoEvents", userId, caseId] as const;

export const caseKeys = {
  all: ["cases"] as const,
  list: (userId: string, scope: CaseListScope, status: CaseStatus) =>
    ["cases", "list", userId, scope, status] as const,
  summary: (userId: string, caseId: string) =>
    ["cases", "summary", userId, caseId] as const,
  detail: (userId: string, caseId: string) =>
    ["cases", "detail", userId, caseId] as const,
  /** 案件の TODO の一覧（#149）。all の下なので、参加者の変更などの後の取り直しにも含まれる */
  todos: (userId: string, caseId: string) =>
    ["cases", "todos", userId, caseId] as const,
  /** 案件の添付の一覧（#148）。all の下なので、参加者の変更などの後の取り直しにも含まれる */
  attachments: (userId: string, caseId: string) =>
    ["cases", "attachments", userId, caseId] as const,
  /** TODO の変更履歴（#149 の 149-C）。案件までの前方一致で、その案件の全 TODO の履歴を指せる */
  todoEvents: (userId: string, caseId: string, todoId: string) =>
    [...caseTodoEventsPrefix(userId, caseId), todoId] as const,
  /** その案件のすべての TODO の履歴（前方一致で使う） */
  caseTodoEvents: (userId: string, caseId: string) =>
    caseTodoEventsPrefix(userId, caseId),
  /** 案件の削除済みの TODO の一覧（#149 の 149-C） */
  deletedTodos: (userId: string, caseId: string) =>
    ["cases", "deletedTodos", userId, caseId] as const,
};

/** list・summary・detail・todos・attachments・todoEvents・deletedTodos のキーで、利用者の ID がある位置 */
export const CASE_KEY_USER_ID_INDEX = 2;
