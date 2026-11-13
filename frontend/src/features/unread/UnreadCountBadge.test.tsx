// #237 AC-1（3-1 AC-1・C-169 (1)）：未読の件数の印（UnreadCountBadge）。期待値は要件の数字・文字（99件を超えたら「99+」）で書く。
// 契約（実装者へ。計画「5. 画面」）：
//   features/unread/index.ts から UnreadCountBadge を公開する。props は { count: number | undefined }。
//   件数が1以上のとき、見える印（aria-hidden。1〜99 は数字、100 は「99+」）と、読み上げ用の文（sr-only。「未読 n件」／「未読 99件以上」）を出す。
//   0・undefined（取得前・取得失敗・未読なし）は何も出さない（誤った件数を出さない）。
//   色だけに頼らない（件数の文字そのものを出す。非機能要件6・C-80）。
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UnreadCountBadge } from "./index";

function renderBadge(count: number | undefined) {
  return render(
    <p data-testid="wrap">
      <UnreadCountBadge count={count} />
    </p>,
  );
}

describe("#237 AC-1（3-1 AC-1）UnreadCountBadge", () => {
  it.each([
    [1, "1", "未読 1件"],
    [2, "2", "未読 2件"],
    [99, "99", "未読 99件"],
    [100, "99+", "未読 99件以上"],
  ])(
    "#237 AC-1: %i 件は、見える印が「%s」、読み上げが「%s」",
    (count, mark, spoken) => {
      renderBadge(count);
      const visible = screen.getByText(mark, { exact: true });
      expect(visible.closest("[aria-hidden='true']")).not.toBeNull();
      expect(screen.getByText(spoken, { exact: true })).toBeDefined();
    },
  );

  it.each([
    ["0 件", 0],
    ["取得前・取得失敗（undefined）", undefined],
  ])("#237 AC-1: %s は何も出さない", (_label, count) => {
    renderBadge(count);
    expect(screen.getByTestId("wrap").textContent).toBe("");
  });

  it("#237 AC-1: 99件では「99+」を出さず、100件で初めて「99+」になる", () => {
    const { unmount } = renderBadge(99);
    expect(screen.queryByText("99+")).toBeNull();
    unmount();
    renderBadge(100);
    expect(screen.queryByText("99", { exact: true })).toBeNull();
    expect(screen.getByText("99+")).toBeDefined();
  });
});
