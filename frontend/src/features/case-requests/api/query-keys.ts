// 一覧のキーには利用者の ID を含める。ログインし直した別の利用者に、前の利用者の一覧を見せないため（Skill「frontend-state」）。
// 案件の作成申請のサーバーの状態のキー。書き込み（申請・取り下げ・承認・却下）の後は all を取り直す。
// 欄の候補（取引先・部署・社員の検索）は申請の書き込みで変わらないため、別のキーにする。
export const caseRequestKeys = {
  all: ["case-requests"] as const,
  mine: (userId: string) => ["case-requests", "mine", userId] as const,
  review: (userId: string, status: string) =>
    ["case-requests", "review", userId, status] as const,
  similar: (clientId: string, title: string, excludeCaseId: string | null) =>
    ["case-requests", "similar-title", clientId, title, excludeCaseId] as const,
};

export const caseRequestChoiceKeys = {
  clients: ["case-request-choices", "clients"] as const,
  departments: ["case-request-choices", "departments"] as const,
};
