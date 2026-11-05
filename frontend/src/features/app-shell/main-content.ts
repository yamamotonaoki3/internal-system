// メインの領域（AppShell の main）の id。スキップリンクの行き先で、画面幅が変わってメニューを閉じたときのフォーカスの移し先。
export const MAIN_CONTENT_ID = "main-content";

/** md（768px）以上かどうかのメディアクエリ */
export const DESKTOP_QUERY = "(min-width: 768px)";

export function focusMainContent(): void {
  document.getElementById(MAIN_CONTENT_ID)?.focus();
}
