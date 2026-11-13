// ログアウトの失敗の案内へフォーカスを移すかの判定。
// 利用者が見えている要素を触っているときは奪わない。フォーカスがない・見えない要素の中（閉じた popover・dialog）なら移す。
export function shouldFocusLogoutFailure(
  active: Element | null,
  isVisible: ((element: Element) => boolean) | undefined,
): boolean {
  if (active === null || active === document.body) return true;
  // 判定できない環境（checkVisibility がない）では、失敗を見えなくしない側に倒す
  if (isVisible === undefined) return true;
  return !isVisible(active);
}
