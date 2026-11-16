// #138 AC-1（1-7 AC-1・AC-2・AC-4）: ReactionPicker（と中の EmojiGrid・StampList）— 自前の小さなピッカーのタブ・キーボード・上限の表示。データは架空。
// 契約（計画「画面」の「タブ・キーボード・フォーカス」。WAI-ARIA の Tabs・Grid のパターン）：
//   <ReactionPicker reactions onSelect onClose />
//   reactions：その投稿の今の集計（上限・「自分が付けている」の表示に使う）。onSelect(kind, value)：1つ選んだ。onClose()：Esc・外のクリックで閉じたい。
//   閉じる（アンマウント）・フォーカスを開いたボタンに戻すのは、ReactionBar（呼び出し側）が行う（messages.reactions.test.tsx で確かめる）。
//   - 枠は role="dialog"（名前「リアクションを選ぶ」）。開いたら、選ばれたタブにフォーカスを移す。
//   - タブ：role="tablist" の中に role="tab" が5つ（順：よく使う・顔・ハート・もの・スタンプ。最初と最後の名前を固定）。aria-selected・aria-controls。
//     Tab キーで止まるのは選ばれたタブだけ（tabIndex 0。ほかは -1）。←→ で移動して、移動と同時に選ぶ。Home・End で最初・最後。パネルは role="tabpanel"。
//   - 絵文字のパネル：role="grid"。行は role="row"、セルは role="gridcell" の中に Button（aria-label は日本語の名前、見える文字は絵文字）。1行6個（枠に収まる数。コードレビュー1回目で8から変更）。
//     Tab で止まるのは1セルだけ（tabIndex 0 は1つ）。←→↑↓ で移動（端で止まる・折り返さない）。Home・End は行の最初・最後、Ctrl+Home・Ctrl+End は最初・最後のセル。
//     Enter と Space の両方で選べる（onSelect("emoji", 文字)）。タブを切り替えたら、フォーカスの位置は先頭に戻る。
//     自分が付けている種類のセルは aria-pressed="true"（ほかは "false"）。
//   - スタンプのパネル：6つのスタンプを、名前（いいね・了解・ありがとう・お疲れさまです・確認します・おめでとう）の Button で並べる。押すと onSelect("stamp", id)。
//   - 上限：20種類に達していて、まだ付いていない種類は、aria-disabled="true"（選べない・onSelect を呼ばない）。パネルの上に role="status" で「リアクションは20種類までです」を出す。
//     すでに付いている種類は選べる（自分が付ける・取り消す）。20種類に達していないときは status を出さない。
//   - Esc で onClose。枠の外のクリックで onClose（枠の中のクリックでは呼ばない）。
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { reaction, reactor } from "../../../test/reaction-handlers";
import { ReactionPicker } from "./ReactionPicker";

type Props = Parameters<typeof ReactionPicker>[0];

// 20種類（計画の「よく使う」の20個。実在の絵文字）
const TWENTY = [
  "👍",
  "👏",
  "🙏",
  "🙇",
  "✅",
  "👀",
  "💯",
  "🎉",
  "✨",
  "🔥",
  "💪",
  "🙌",
  "👌",
  "⭐",
  "💡",
  "📌",
  "⏰",
  "🆗",
  "❗",
  "❓",
].map((value) => reaction("emoji", value, { others: [reactor(1)] }));

function setup(reactions: Props["reactions"] = []) {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(
    <div>
      <button type="button">ピッカーの外</button>
      <ReactionPicker
        reactions={reactions}
        onSelect={onSelect}
        onClose={onClose}
      />
    </div>,
  );
  return { onSelect, onClose, user };
}

const dialog = () => screen.getByRole("dialog", { name: "リアクションを選ぶ" });
const tabs = () => within(dialog()).getAllByRole("tab");
const grid = () => within(dialog()).getByRole("grid");
const cells = () => within(grid()).getAllByRole("button");
const focused = () => document.activeElement;

describe("#138 AC-1（1-7 AC-1）タブ", () => {
  it("#138 AC-1: タブは5つ（最初は「よく使う」、最後は「スタンプ」）。最初のタブが選ばれ、開いたらそこにフォーカスがある", () => {
    setup();
    expect(tabs()).toHaveLength(5);
    expect(tabs()[0]?.textContent).toBe("よく使う");
    expect(tabs()[4]?.textContent).toBe("スタンプ");
    expect(tabs()[0]?.getAttribute("aria-selected")).toBe("true");
    expect(focused()).toBe(tabs()[0]);
    expect(within(dialog()).getByRole("tablist")).toBeTruthy();
  });

  it("#138 AC-1: 選ばれたタブだけが Tab で止まる（tabIndex 0。ほかは -1）。aria-controls が tabpanel を指す", () => {
    setup();
    expect(tabs().map((tab) => tab.getAttribute("tabindex"))).toEqual([
      "0",
      "-1",
      "-1",
      "-1",
      "-1",
    ]);
    const panel = within(dialog()).getByRole("tabpanel");
    expect(tabs()[0]?.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.id).not.toBe("");
  });

  it("#138 AC-1: → で次のタブへ移動し、移動と同時に選ぶ（フォーカスも移る）。← で戻る", async () => {
    const { user } = setup();
    await user.keyboard("{ArrowRight}");
    expect(tabs()[1]?.getAttribute("aria-selected")).toBe("true");
    expect(tabs()[0]?.getAttribute("aria-selected")).toBe("false");
    expect(focused()).toBe(tabs()[1]);
    expect(tabs()[1]?.getAttribute("tabindex")).toBe("0");
    expect(tabs()[0]?.getAttribute("tabindex")).toBe("-1");
    await user.keyboard("{ArrowLeft}");
    expect(tabs()[0]?.getAttribute("aria-selected")).toBe("true");
    expect(focused()).toBe(tabs()[0]);
  });

  it("#138 AC-1: End で最後のタブ（スタンプ）、Home で最初のタブへ", async () => {
    const { user } = setup();
    await user.keyboard("{End}");
    expect(tabs()[4]?.getAttribute("aria-selected")).toBe("true");
    expect(focused()).toBe(tabs()[4]);
    await user.keyboard("{Home}");
    expect(tabs()[0]?.getAttribute("aria-selected")).toBe("true");
    expect(focused()).toBe(tabs()[0]);
  });

  it("#138 AC-1: タブを押して選ぶこともできる", async () => {
    const { user } = setup();
    await user.click(tabs()[2] as HTMLElement);
    expect(tabs()[2]?.getAttribute("aria-selected")).toBe("true");
  });
});

describe("#138 AC-1（1-7 AC-1）絵文字のグリッド", () => {
  it("#138 AC-1: グリッド（role=grid）に、行（row）・セル（gridcell）があり、セルの中のボタンに日本語の名前（aria-label）と絵文字の文字がある", () => {
    setup();
    expect(within(grid()).getAllByRole("row").length).toBeGreaterThan(1);
    expect(within(grid()).getAllByRole("gridcell").length).toBe(cells().length);
    for (const cell of cells()) {
      expect(cell.getAttribute("aria-label")?.length ?? 0).toBeGreaterThan(0);
      expect((cell.textContent ?? "").length).toBeGreaterThan(0);
    }
  });

  it("#138 AC-1: 1行は6個。最初の行の6個目の次のセルは2行目", () => {
    setup();
    const rows = within(grid()).getAllByRole("row");
    expect(within(rows[0] as HTMLElement).getAllByRole("button")).toHaveLength(
      6,
    );
  });

  it("#138 AC-1（C-128 の問題）: Tab で止まるのは1セルだけ（tabIndex 0 が1つ）。タブから Tab で入ると最初のセル、もう一度 Tab でグリッドを出る", async () => {
    const { user } = setup();
    expect(
      cells().filter((cell) => cell.getAttribute("tabindex") === "0"),
    ).toHaveLength(1);
    await user.tab();
    expect(focused()).toBe(cells()[0]);
    await user.tab();
    expect(cells()).not.toContain(focused());
  });

  it("#138 AC-1: →・← でセルを移動し、端（最初のセル）で止まる（折り返さない）。tabIndex 0 も移る", async () => {
    const { user } = setup();
    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(focused()).toBe(cells()[1]);
    expect(cells()[1]?.getAttribute("tabindex")).toBe("0");
    expect(cells()[0]?.getAttribute("tabindex")).toBe("-1");
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(focused()).toBe(cells()[0]);
  });

  it("#138 AC-1: ↓ で6つ先（次の行の同じ列）、↑ で戻る。最初の行の ↑ では動かない", async () => {
    const { user } = setup();
    await user.tab();
    await user.keyboard("{ArrowDown}");
    expect(focused()).toBe(cells()[6]);
    await user.keyboard("{ArrowUp}");
    expect(focused()).toBe(cells()[0]);
    await user.keyboard("{ArrowUp}");
    expect(focused()).toBe(cells()[0]);
  });

  it("#138 AC-1: 行の途中で End・Home は行の最後・最初のセル。Ctrl+End・Ctrl+Home は全体の最後・最初のセル", async () => {
    const { user } = setup();
    await user.tab();
    await user.keyboard("{ArrowRight}{ArrowRight}{End}");
    expect(focused()).toBe(cells()[5]);
    await user.keyboard("{Home}");
    expect(focused()).toBe(cells()[0]);
    await user.keyboard("{Control>}{End}{/Control}");
    expect(focused()).toBe(cells().at(-1));
    await user.keyboard("{Control>}{Home}{/Control}");
    expect(focused()).toBe(cells()[0]);
  });

  it("#138 AC-1: 最後のセルで → ・ ↓ を押しても、先へは行かない（折り返さない）", async () => {
    const { user } = setup();
    await user.tab();
    await user.keyboard("{Control>}{End}{/Control}");
    const last = cells().at(-1);
    await user.keyboard("{ArrowRight}{ArrowDown}");
    expect(focused()).toBe(last);
  });

  it("#138 AC-1（キーボード）: Enter で選べる（onSelect に emoji と、そのセルの文字を渡す）", async () => {
    const { user, onSelect } = setup();
    await user.tab();
    const first = cells()[0]?.textContent;
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("emoji", first);
  });

  it("#138 AC-1（キーボード）: Space でも選べる", async () => {
    const { user, onSelect } = setup();
    await user.tab();
    await user.keyboard("{ArrowRight}");
    const second = cells()[1]?.textContent;
    await user.keyboard(" ");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("emoji", second);
  });

  it("#138 AC-1: セルを押して選べる", async () => {
    const { user, onSelect } = setup();
    await user.click(cells()[3] as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith("emoji", cells()[3]?.textContent);
  });

  it("#138 AC-1: タブを切り替えたら、グリッドのフォーカスの位置は先頭に戻る", async () => {
    const { user } = setup();
    await user.tab();
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
    expect(focused()).toBe(cells()[3]);
    await user.click(tabs()[1] as HTMLElement);
    expect(cells().map((cell) => cell.getAttribute("tabindex"))).toEqual(
      cells().map((_, i) => (i === 0 ? "0" : "-1")),
    );
    await user.click(tabs()[0] as HTMLElement);
    expect(cells()[0]?.getAttribute("tabindex")).toBe("0");
    expect(cells()[3]?.getAttribute("tabindex")).toBe("-1");
  });

  it("#138 AC-1（自分が付けている種類）: 自分が付けているセルは aria-pressed=true、ほかは false", () => {
    setup([reaction("emoji", "👍", { mine: true, others: [reactor(1)] })]);
    const pressed = cells().filter(
      (cell) => cell.getAttribute("aria-pressed") === "true",
    );
    expect(pressed.map((cell) => cell.textContent)).toEqual(["👍"]);
    expect(
      cells().every((cell) => cell.getAttribute("aria-pressed") !== null),
    ).toBe(true);
  });

  it("#138 AC-1（自分が付けている種類）: 自分が付けているセルを選ぶと onSelect を呼ぶ（取り消しの判断は呼び出し側）", async () => {
    const { user, onSelect } = setup([reaction("emoji", "👍", { mine: true })]);
    const mine = cells().find((cell) => cell.textContent === "👍");
    await user.click(mine as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith("emoji", "👍");
  });
});

describe("#138 AC-1（1-7 AC-2）スタンプ", () => {
  it("#138 AC-1: スタンプのタブに、6つのスタンプが名前の Button で並ぶ", async () => {
    const { user } = setup();
    await user.click(tabs()[4] as HTMLElement);
    const panel = within(dialog()).getByRole("tabpanel");
    for (const label of [
      "いいね",
      "了解",
      "ありがとう",
      "お疲れさまです",
      "確認します",
      "おめでとう",
    ])
      expect(within(panel).getByRole("button", { name: label })).toBeTruthy();
  });

  it("#138 AC-1（1-7 AC-2）: 「了解」を押すと onSelect に stamp と ok を渡す", async () => {
    const { user, onSelect } = setup();
    await user.click(tabs()[4] as HTMLElement);
    await user.click(screen.getByRole("button", { name: "了解" }));
    expect(onSelect).toHaveBeenCalledWith("stamp", "ok");
  });

  it("#138 AC-1: スタンプも Enter・Space で選べる", async () => {
    const { user, onSelect } = setup();
    await user.click(tabs()[4] as HTMLElement);
    const thanks = screen.getByRole("button", { name: "ありがとう" });
    thanks.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenLastCalledWith("stamp", "thanks");
  });

  it("#138 AC-1: 自分が付けているスタンプは aria-pressed=true", async () => {
    const { user } = setup([reaction("stamp", "ok", { mine: true })]);
    await user.click(tabs()[4] as HTMLElement);
    expect(
      screen.getByRole("button", { name: "了解" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen
        .getByRole("button", { name: "いいね" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });
});

describe("#138 AC-1（1-7 AC-4・U-4）20種類の上限", () => {
  it("#138 AC-1: 20種類に達していて、まだ付いていない種類は選べない（aria-disabled=true・onSelect を呼ばない）。理由を role=status に出す", async () => {
    const { user, onSelect } = setup(TWENTY);
    await user.click(tabs()[1] as HTMLElement);
    const first = cells()[0] as HTMLElement;
    expect(first.getAttribute("aria-disabled")).toBe("true");
    await user.click(first);
    first.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onSelect).not.toHaveBeenCalled();
    expect(within(dialog()).getByRole("status").textContent).toContain(
      "リアクションは20種類までです",
    );
  });

  it("#138 AC-1: すでに付いている種類は、20種類に達していても選べる", async () => {
    const { user, onSelect } = setup(TWENTY);
    const thumbs = cells().find((cell) => cell.textContent === "👍");
    expect(thumbs?.getAttribute("aria-disabled")).not.toBe("true");
    await user.click(thumbs as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith("emoji", "👍");
  });

  it("#138 AC-1: スタンプも、まだ付いていない種類は選べない（20種類に達しているとき）", async () => {
    const { user, onSelect } = setup(TWENTY);
    await user.click(tabs()[4] as HTMLElement);
    const ok = screen.getByRole("button", { name: "了解" });
    expect(ok.getAttribute("aria-disabled")).toBe("true");
    await user.click(ok);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("#138 AC-1: 20種類に達していない（19種類）ときは、選べて、status も出さない", async () => {
    const { user, onSelect } = setup(TWENTY.slice(0, 19));
    await user.click(tabs()[1] as HTMLElement);
    expect(cells()[0]?.getAttribute("aria-disabled")).not.toBe("true");
    expect(within(dialog()).queryByRole("status")).toBeNull();
    await user.click(cells()[0] as HTMLElement);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("#138 AC-1: 上限で選べないセルにも、フォーカスは移せる（disabled にしない）", async () => {
    const { user } = setup(TWENTY);
    await user.click(tabs()[1] as HTMLElement);
    expect(cells()[0]?.hasAttribute("disabled")).toBe(false);
  });
});

describe("#138 AC-1 閉じる（Esc・外のクリック）", () => {
  it("#138 AC-1: Esc で onClose を呼ぶ（絵文字のセルにフォーカスがあるときも）", async () => {
    const { user, onClose } = setup();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.tab();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("#138 AC-1: 枠の外のクリックで onClose を呼び、枠の中のクリック（タブ・セル）では呼ばない", async () => {
    const { user, onClose } = setup();
    await user.click(tabs()[1] as HTMLElement);
    await user.click(cells()[0] as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "ピッカーの外" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
