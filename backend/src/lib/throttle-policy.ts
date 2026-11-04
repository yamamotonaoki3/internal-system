// 試行制限の値と計算（ADR-0008。値は利用者の決定 D-1・D-2。Issue #120）。時刻は引数で受け取る。
// 接続元：15分の窓で受付30回まで（成功も数える）。超えたら15分ロックする。
// 社員ID：ロックはせず、これまでに記録した失敗の数に応じて検証を遅らせる。最後の失敗から15分で数え直す。

const MINUTE_MS = 60_000;

export const SOURCE_WINDOW_MS = 15 * MINUTE_MS;
export const SOURCE_LIMIT = 30;
export const SOURCE_LOCK_MS = 15 * MINUTE_MS;
export const ACCOUNT_RESET_MS = 15 * MINUTE_MS;

// 失敗数（添字）→ 遅延（ミリ秒）。3回まで0秒、4回1秒、5回2秒、6回以上は4秒で頭打ち
// （要求全体をクライアントのタイムアウト10秒に収めるため）
const DELAYS_MS = [0, 0, 0, 0, 1_000, 2_000];
const DELAY_MAX_MS = 4_000;

/** これまでに記録した失敗が failedCount 回の社員IDで、次の検証の前に待つ時間 */
export function accountDelayMs(
  failedCount: number,
  lastFailedAt: string | null,
  now: Date,
): number {
  if (lastFailedAt === null) return 0;
  if (now.getTime() - new Date(lastFailedAt).getTime() >= ACCOUNT_RESET_MS)
    return 0;
  return failedCount >= DELAYS_MS.length
    ? DELAY_MAX_MS
    : (DELAYS_MS[failedCount] ?? 0);
}

/** Retry-After の秒数（ロックの解除までを切り上げ。0や負の値にしない） */
export function retryAfterSeconds(lockedUntil: string, now: Date): number {
  const ms = new Date(lockedUntil).getTime() - now.getTime();
  return Math.max(1, Math.ceil(ms / 1_000));
}
