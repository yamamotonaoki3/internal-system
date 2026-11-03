// ログイン状態（セッション）のサーバーの状態のキー。書き込みや破棄で同じものを使う。
export const authKeys = {
  session: ["auth", "session"] as const,
};
