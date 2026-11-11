// プロフィール・社員一覧・カードのサーバーの状態のキー。変更したときは all を取り直す（自分の画面・一覧・カードが一度に更新される）。
export const profileKeys = {
  all: ["profile"] as const,
  me: ["profile", "me"] as const,
  card: (userId: string) => ["profile", "card", userId] as const,
  directory: ["profile", "directory"] as const,
  departments: ["profile", "departments"] as const,
};
