// #237 AC-1（3-1 AC-1・C-169 (1)）：未読の件数の表示の規則（shared/unread-rules.ts）を、要件の数字・文字だけで固定する。
// 期待値は要件（99件を超えたら「99+」、数えるのは100件まで）から書き、本番の定数から作らない。
// 契約（実装者へ。計画「変更するファイル」の共有）：
//   shared/unread-rules.ts が次を公開する
//     UNREAD_COUNT_DISPLAY_MAX: 99（画面に数字で出す最大）
//     UNREAD_COUNT_LIMIT: 100（サーバーが数える上限 = 表示の最大 + 1）
//     formatUnreadCount(count: number): string（99以下は数字の文字、99を超えたら「99+」）
import { describe, expect, it } from "vitest";
import {
  UNREAD_COUNT_DISPLAY_MAX,
  UNREAD_COUNT_LIMIT,
  formatUnreadCount,
} from "../../../shared/unread-rules";

describe("#237 AC-1（3-1 AC-1）未読の件数の表示", () => {
  it.each([
    [1, "1"],
    [2, "2"],
    [98, "98"],
    [99, "99"],
    [100, "99+"],
    [101, "99+"],
    [1000, "99+"],
  ])("#237 AC-1: %i 件は「%s」と表示する", (count, expected) => {
    expect(formatUnreadCount(count)).toBe(expected);
  });

  it("#237 AC-1・AC-4: 数える上限は100件、数字で出す最大は99件", () => {
    expect(UNREAD_COUNT_LIMIT).toBe(100);
    expect(UNREAD_COUNT_DISPLAY_MAX).toBe(99);
  });
});
