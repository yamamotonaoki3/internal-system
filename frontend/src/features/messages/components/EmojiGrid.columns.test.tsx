// #138 コードレビュー1回目（軽微）: 絵文字のグリッドの列の数（1行に並べる個数）と、上下キーの移動の幅・行の区切りが一致する。
// 背景：1行8個がピッカーの幅に収まらず、列の数を変えることになった。列の数は実装の役割が決める（ボタンの寸法を小さくする、または列の数を減らす）。
// このテストは、列の数 N を画面の行の区切り（最初の行のセルの数）から読み取り、次を確かめる（N の具体的な値は固定しない）：
//   - 最後の行を除くすべての行が、ちょうど N 個のセルを持つ（最後の行は N 個以下）。
//   - ↓ は N 個先のセル（次の行の同じ列）、↑ は N 個前のセルへ動く。
//   - End は行の最後のセル（N 番目）、Home は行の最初のセル。
//   （行の端で ←→ が前後の行へ続くか止まるかは、計画「端では止まり、折り返さない」の「端」が行の端かグリッド全体の端か決まっていないため、ここでは確かめない）
//   - グリッドが aria-colcount を持つなら、その値は N と一致する。
// 8 を前提にしている既存のテストは ReactionPicker.test.tsx（実装の役割が列の数を決めた後に合わせる）。
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ReactionPicker } from "./ReactionPicker";

function setup() {
  render(
    <ReactionPicker reactions={[]} onSelect={vi.fn()} onClose={vi.fn()} />,
  );
  const grid = within(
    screen.getByRole("dialog", { name: "リアクションを選ぶ" }),
  ).getByRole("grid");
  const rows = within(grid)
    .getAllByRole("row")
    .map((row) => within(row).getAllByRole("button"));
  const cells = within(grid).getAllByRole("button");
  return { grid, rows, cells, user: userEvent.setup() };
}

describe("#138 コードレビュー1回目（軽微）グリッドの列の数と上下キー", () => {
  it("#138 AC-1: 最後の行を除くすべての行が同じ個数（列の数 N）で、最後の行は N 個以下。N は2以上", () => {
    const { rows } = setup();
    const columns = rows[0]?.length ?? 0;
    expect(columns).toBeGreaterThanOrEqual(2);
    for (const row of rows.slice(0, -1)) expect(row).toHaveLength(columns);
    expect(rows.at(-1)?.length ?? 0).toBeLessThanOrEqual(columns);
    expect(rows.at(-1)?.length ?? 0).toBeGreaterThan(0);
  });

  it("#138 AC-1: aria-colcount があれば、実際の行の区切り（列の数）と一致する", () => {
    const { grid, rows } = setup();
    const columns = rows[0]?.length ?? 0;
    expect(grid.getAttribute("aria-colcount") ?? String(columns)).toBe(
      String(columns),
    );
  });

  it("#138 AC-1: ↓ は1行分（列の数）だけ先、↑ は列の数だけ前のセルへ動く", async () => {
    const { rows, cells, user } = setup();
    const columns = rows[0]?.length ?? 0;
    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(cells[1]);
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(cells[1 + columns]);
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(cells[1]);
  });

  it("#138 AC-1: End は行の最後（N 番目）のセル、Home は行の最初のセル", async () => {
    const { rows, cells, user } = setup();
    const columns = rows[0]?.length ?? 0;
    await user.tab();
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(cells[columns - 1]);
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(cells[0]);
  });

  it("#138 AC-1: 2行目で End は2行目の最後のセル", async () => {
    const { rows, cells, user } = setup();
    const columns = rows[0]?.length ?? 0;
    await user.tab();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(cells[columns]);
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(cells[2 * columns - 1]);
  });
});
