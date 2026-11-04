// #120 AC-3・0-2 AC-4：試行制限の値（利用者の決定 D-1・D-2。Issue #120 のコメント）。
// 接続元：窓15分・受付30回・超えたら15分ロック。社員ID：失敗3回まで0秒・4回1秒・5回2秒・6回以上4秒（頭打ち）、
// 最後の失敗から15分で数え直す（ロックしない）。時刻は引数で固定する。
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_RESET_MS,
  SOURCE_LIMIT,
  SOURCE_LOCK_MS,
  SOURCE_WINDOW_MS,
  accountDelayMs,
  retryAfterSeconds,
} from "./throttle-policy";

const MIN = 60_000;
const NOW = new Date("2026-11-03T03:00:00.000Z");
const before = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const after = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

describe("試行制限の値", () => {
  it("#120 AC-3（D-1）: 接続元は窓15分・上限30回・ロック15分", () => {
    expect(SOURCE_WINDOW_MS).toBe(15 * MIN);
    expect(SOURCE_LIMIT).toBe(30);
    expect(SOURCE_LOCK_MS).toBe(15 * MIN);
  });

  it("#120 AC-3（D-2）: 社員IDは最後の失敗から15分で数え直す", () => {
    expect(ACCOUNT_RESET_MS).toBe(15 * MIN);
  });
});

describe("accountDelayMs（社員IDの段階的な遅延）", () => {
  const last = before(1_000);

  it("#120 0-2 AC-4（D-2）: 失敗0〜3回は0秒、4回1秒、5回2秒、6回4秒", () => {
    expect(accountDelayMs(0, null, NOW)).toBe(0);
    expect(accountDelayMs(1, last, NOW)).toBe(0);
    expect(accountDelayMs(3, last, NOW)).toBe(0);
    expect(accountDelayMs(4, last, NOW)).toBe(1_000);
    expect(accountDelayMs(5, last, NOW)).toBe(2_000);
    expect(accountDelayMs(6, last, NOW)).toBe(4_000);
  });

  it("#120 0-2 AC-4（D-2）: 7回以上でも4秒で頭打ち（クライアントのタイムアウトより短い）", () => {
    for (const count of [7, 10, 100, 10_000])
      expect(accountDelayMs(count, last, NOW), String(count)).toBe(4_000);
  });

  it("#120 0-2 AC-4（D-2）: 最後の失敗から15分ちょうどで数え直し（0秒）、14分59.999秒ではまだ数える", () => {
    expect(accountDelayMs(6, before(15 * MIN - 1), NOW)).toBe(4_000);
    expect(accountDelayMs(6, before(15 * MIN), NOW)).toBe(0);
    expect(accountDelayMs(6, before(60 * MIN), NOW)).toBe(0);
  });
});

describe("retryAfterSeconds（Retry-After の秒数）", () => {
  it("#120 AC-3: ロックの解除までの秒数を、切り上げで返す", () => {
    expect(retryAfterSeconds(after(15 * MIN), NOW)).toBe(900);
    expect(retryAfterSeconds(after(1_500), NOW)).toBe(2);
    expect(retryAfterSeconds(after(1), NOW)).toBe(1);
  });

  it("#120 AC-3: 解除の直前でも1秒以上（0や負の値を返さない）", () => {
    expect(retryAfterSeconds(NOW.toISOString(), NOW)).toBeGreaterThanOrEqual(1);
  });
});
