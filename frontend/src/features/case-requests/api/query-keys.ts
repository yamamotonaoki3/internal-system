// 案件の作成申請のサーバーの状態のキー。書き込み（申請・取り下げ・承認・却下）の後は all を取り直す。
// 欄の候補（取引先・部署・社員の検索）は申請の書き込みで変わらないため、別のキーにする。
export const caseRequestKeys = {
  all: ["case-requests"] as const,
  mine: ["case-requests", "mine"] as const,
  review: (status: string) => ["case-requests", "review", status] as const,
  similar: (clientId: string, title: string) =>
    ["case-requests", "similar-title", clientId, title] as const,
};

export const caseRequestChoiceKeys = {
  clients: ["case-request-choices", "clients"] as const,
  departments: ["case-request-choices", "departments"] as const,
  users: (q: string) => ["case-request-choices", "users", q] as const,
};
