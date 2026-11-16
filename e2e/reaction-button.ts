// #138：メッセージの行には、全投稿に「リアクションを付ける」ボタンが付き、リアクションがあれば「付けた人」ボタンとチップ（aria-pressed を持つ）が付く。
// これらは名前に投稿者名・付けた人の名前を含む。退職者の名前からプロフィールカード・「DMを送る」を出さない（C-74）ことを確かめる spec が、
// ボタンの絞り込みからこれらを除くための部品。使い方：locator.and(notReactionButton(page))
import type { Locator, Page } from "@playwright/test";

export function notReactionButton(page: Page): Locator {
  return page.locator(
    'button:not([aria-label^="リアクションを付ける"]):not([aria-label^="付けた人"]):not([aria-pressed])',
  );
}
