// #237：サイドバーの部屋（チャンネル・DM）のリンクを、名前で探すための共通の部品。
// 未読があると、リンクの名前の後ろに読み上げ用の「未読 n件」（100件以上は「未読 99件以上」）が付く（3-1 AC-1・C-169）。
// 名前の完全一致（SALES と SALES_ANNOUNCEMENT の区別）を保ったまま、未読の読み上げ名だけを許す。確かめる性質（その名前の部屋のリンクがある）は弱めない。
// 使い方：mainMenu.getByRole("link", { name: roomLinkName(SALES) })

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 先頭から名前、その後ろに任意で「未読 n件」か「未読 99件以上」、そこで終わる名前の正規表現 */
export function roomLinkName(name: string): RegExp {
  return new RegExp(
    `^\\s*${escapeRegExp(name)}(?:\\s+未読 (?:99件以上|\\d+件))?\\s*$`,
  );
}
