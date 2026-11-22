// 離脱の確認（beforeunload）を止めない印（#338）。資格を失って文書を読み込み直す間は、確認を出さずに離れるため。
// 文書ごとに1つ。立てるのも外すのも、読み込み直しの入口（features/access-loss）だけ。

let suppressed = false;

export function suppressBeforeUnload(): void {
  suppressed = true;
}

export function restoreBeforeUnload(): void {
  suppressed = false;
}

export function isBeforeUnloadSuppressed(): boolean {
  return suppressed;
}
