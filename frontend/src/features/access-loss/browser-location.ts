// 文書ごとの読み込み直し（#338）。window.location の操作はここだけに閉じる（テストでは、このファイルを差し替えて数える）。

/** いまの場所の文書を読み込み直す */
export function reloadPage(): void {
  window.location.reload();
}

/** 履歴を増やさずに、別の場所の文書へ置き換える */
export function replacePage(to: string): void {
  window.location.replace(to);
}
