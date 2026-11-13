// ログイン状態（セッション）のサーバーの状態のキー。書き込みや破棄で同じものを使う。
// mutation のキー（logout）も置く。
export const authKeys = {
  session: ["auth", "session"] as const,
  logout: ["auth", "logout"] as const,
};
