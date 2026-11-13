// 未読の件数の規則の定義元（#237。3-1 AC-1・C-169）。サーバーの数える上限と、画面の表示の上限は同じ知識（上限 = 表示の最大 + 1）なので、ここ1か所に置く。
// 通知のベルの上限（#124）とは要件が別なので統合しない。

/** 画面に数字で出す件数の最大。これを超えたら「99+」と出す */
export const UNREAD_COUNT_DISPLAY_MAX = 99;

/** サーバーが1つの部屋で数える上限。表示の最大より1つ大きければ「99+」を出せる（それ以上は数えない） */
export const UNREAD_COUNT_LIMIT = UNREAD_COUNT_DISPLAY_MAX + 1;

/** 件数の表示。99件以下は数字、超えたら「99+」 */
export function formatUnreadCount(count: number): string {
  return count > UNREAD_COUNT_DISPLAY_MAX
    ? `${UNREAD_COUNT_DISPLAY_MAX}+`
    : String(count);
}
