// セッションの有効期間の値と、期限の判定（ADR-0003・0-2 AC-5）。時刻は引数で受け取り、期限は読み取り時に判定する。
// 期限は「ちょうど」で切れる（無操作30分ちょうど・ログインから24時間ちょうどで使えなくなる）。

/** Cookie の名前。__Host- を付けて、ドメイン指定を禁じ、Path=/ ・Secure を必須にする（ADR-0008） */
export const SESSION_COOKIE = "__Host-session";
export const SESSION_COOKIE_ATTRIBUTES = { path: "/", secure: true } as const;
export const SESSION_IDLE_MS = 30 * 60_000;
export const SESSION_MAX_AGE_MS = 24 * 60 * 60_000;
/** 最終操作の時刻の更新は、この間隔に間引く（書き込みを減らす。C-149） */
export const SESSION_TOUCH_INTERVAL_MS = 60_000;

export type SessionTimes = {
  createdAt: string;
  lastActiveAt: string;
  revokedAt: string | null;
};

export function isSessionExpired(session: SessionTimes, now: Date): boolean {
  if (session.revokedAt !== null) return true;
  const nowMs = now.getTime();
  return (
    nowMs - new Date(session.lastActiveAt).getTime() >= SESSION_IDLE_MS ||
    nowMs - new Date(session.createdAt).getTime() >= SESSION_MAX_AGE_MS
  );
}
