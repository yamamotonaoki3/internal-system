// #138 AC-1（1-7 AC-1）: ReactionPicker — タブの矢印キーの移動と循環、外側のクリックで閉じる条件、リスナーの後始末、Esc の伝播。データは架空。
// ミューテーションの生き残り（ReactionPicker.tsx の nextTab・外側クリックの effect・Esc）を検出するための補強。期待値は設計書（reactions.md「画面の部品とキーボードの操作」）から書く：
//   - タブは ←→ で移動と同時に選び、端では反対側につながる（循環する）。
//   - 枠の外（開いたボタンを除く）のクリックで閉じる。枠の中・開いたボタンのクリックでは閉じない。
//   - 閉じた（アンマウントした）後は、外のクリックを監視しない。onClose が替わったら新しいものを呼ぶ。
//   - Esc は閉じ、親へ伝えない（呼び出し側の別の Esc の処理を動かさない）。
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReactionPicker } from "./ReactionPicker";

const dialog = () => screen.getByRole("dialog", { name: "リアクションを選ぶ" });
const tabs = () => within(dialog()).getAllByRole("tab");
const selectedIndex = () =>
  tabs().findIndex((tab) => tab.getAttribute("aria-selected") === "true");

function setup() {
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(
    <ReactionPicker reactions={[]} onSelect={vi.fn()} onClose={onClose} />,
  );
  return { onClose, user };
}

describe("#138 AC-1 タブの矢印キーの移動と循環", () => {
  it("#138 AC-1: 最後のタブ（スタンプ）で → を押すと、最初のタブ（よく使う）に戻り、フォーカスも移る", async () => {
    const { user } = setup();
    await user.keyboard("{End}");
    expect(selectedIndex()).toBe(4);
    await user.keyboard("{ArrowRight}");
    expect(selectedIndex()).toBe(0);
    expect(document.activeElement).toBe(tabs()[0]);
  });

  it("#138 AC-1: 最初のタブで ← を押すと、最後のタブ（スタンプ）につながり、フォーカスも移る", async () => {
    const { user } = setup();
    await user.keyboard("{ArrowLeft}");
    expect(selectedIndex()).toBe(4);
    expect(document.activeElement).toBe(tabs()[4]);
  });

  it("#138 AC-1: 途中のタブからの → は1つ先、← は1つ前へ移る（端への移動と取り違えない）", async () => {
    const { user } = setup();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(selectedIndex()).toBe(2);
    await user.keyboard("{ArrowRight}");
    expect(selectedIndex()).toBe(3);
    await user.keyboard("{ArrowLeft}");
    expect(selectedIndex()).toBe(2);
    await user.keyboard("{ArrowLeft}");
    expect(selectedIndex()).toBe(1);
  });

  it("#138 AC-1: 最後まで → を押し続けると、ちょうど1周して最初に戻る（5回で一周）", async () => {
    const { user } = setup();
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}");
    expect(selectedIndex()).toBe(4);
    await user.keyboard("{ArrowRight}");
    expect(selectedIndex()).toBe(0);
  });

  it("#138 AC-1: 移動に使ったキーの既定の動き（スクロールなど）は止める。関係ないキーは止めない", () => {
    setup();
    const first = tabs()[0] as HTMLElement;
    expect(fireEvent.keyDown(first, { key: "ArrowRight" })).toBe(false);
    expect(fireEvent.keyDown(tabs()[1] as HTMLElement, { key: "Home" })).toBe(
      false,
    );
    expect(fireEvent.keyDown(first, { key: "a" })).toBe(true);
    expect(selectedIndex()).toBe(0);
  });
});

describe("#138 AC-1 Esc", () => {
  it("#138 AC-1: Esc は onClose を呼び、親の要素へは伝えない", () => {
    const onClose = vi.fn();
    const parentKeyDown = vi.fn();
    render(
      // 親の Esc の処理が動かないことを確かめるための外枠
      <div onKeyDown={parentKeyDown}>
        <ReactionPicker reactions={[]} onSelect={vi.fn()} onClose={onClose} />
      </div>,
    );
    fireEvent.keyDown(dialog(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(parentKeyDown).not.toHaveBeenCalled();
    fireEvent.keyDown(dialog(), { key: "a" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(parentKeyDown).toHaveBeenCalledTimes(1);
  });
});

describe("#138 AC-1 外側のクリックで閉じる条件", () => {
  afterEach(() => vi.restoreAllMocks());

  function withTrigger(
    options: { triggerRef?: "attached" | "empty" | "none" } = {},
  ) {
    const onClose = vi.fn();
    const triggerRef = createRef<HTMLButtonElement>();
    const mode = options.triggerRef ?? "attached";
    const view = render(
      <div>
        <button type="button">ピッカーの外</button>
        <button type="button" ref={mode === "attached" ? triggerRef : null}>
          リアクションを付ける（ボタン）
        </button>
        <ReactionPicker
          reactions={[]}
          onSelect={vi.fn()}
          onClose={onClose}
          triggerRef={mode === "none" ? undefined : triggerRef}
        />
      </div>,
    );
    return { onClose, view };
  }

  it("#138 AC-1: 枠の外の要素の mousedown で onClose を呼ぶ", () => {
    const { onClose } = withTrigger();
    fireEvent.mouseDown(screen.getByRole("button", { name: "ピッカーの外" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("#138 AC-1: 開いたボタン（triggerRef）の mousedown では閉じない（ボタン自身が開閉を切り替える）", () => {
    const { onClose } = withTrigger();
    fireEvent.mouseDown(
      screen.getByRole("button", { name: "リアクションを付ける（ボタン）" }),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("#138 AC-1: 枠の中の要素（タブ）の mousedown では閉じない", () => {
    const { onClose } = withTrigger();
    fireEvent.mouseDown(tabs()[1] as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("#138 AC-1: triggerRef の中身がまだ無い（current が null）ときも、外のクリックで閉じ、例外を出さない", () => {
    const { onClose } = withTrigger({ triggerRef: "empty" });
    fireEvent.mouseDown(screen.getByRole("button", { name: "ピッカーの外" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("#138 AC-1: triggerRef を渡さなくても、外のクリックで閉じる", () => {
    const { onClose } = withTrigger({ triggerRef: "none" });
    fireEvent.mouseDown(screen.getByRole("button", { name: "ピッカーの外" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("#138 AC-1: 要素ではない対象（window）の mousedown は無視し、閉じず、例外も出さない", () => {
    const { onClose } = withTrigger();
    const onError = vi.fn();
    const targets: EventTarget[] = [];
    const record = (event: Event) => {
      if (event.target !== null) targets.push(event.target);
    };
    document.addEventListener("mousedown", record);
    window.addEventListener("error", onError);
    try {
      // 対象が要素でないイベント（target が window）を、document のリスナーへ届ける
      const event = new MouseEvent("mousedown");
      Object.defineProperty(event, "target", { value: window });
      document.dispatchEvent(event);
    } finally {
      window.removeEventListener("error", onError);
    }
    document.removeEventListener("mousedown", record);
    // 届いた対象は window（Node ではない）だった
    expect(targets).toEqual([window]);
    expect(onClose).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});

describe("#138 AC-1 外側のクリックの監視の後始末", () => {
  it("#138 AC-1: 閉じた（アンマウントした）後の外のクリックでは onClose を呼ばない（リスナーを外す）", () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <ReactionPicker reactions={[]} onSelect={vi.fn()} onClose={onClose} />,
    );
    const remove = vi.spyOn(document, "removeEventListener");
    unmount();
    expect(remove).toHaveBeenCalledWith("mousedown", expect.any(Function));
    fireEvent.mouseDown(document.body);
    expect(onClose).not.toHaveBeenCalled();
    remove.mockRestore();
  });

  it("#138 AC-1: onClose が替わったら、外のクリックでは新しい onClose だけを呼ぶ（古いものは呼ばない）", () => {
    const oldClose = vi.fn();
    const newClose = vi.fn();
    const { rerender } = render(
      <ReactionPicker reactions={[]} onSelect={vi.fn()} onClose={oldClose} />,
    );
    rerender(
      <ReactionPicker reactions={[]} onSelect={vi.fn()} onClose={newClose} />,
    );
    fireEvent.mouseDown(document.body);
    expect(oldClose).not.toHaveBeenCalled();
    expect(newClose).toHaveBeenCalledTimes(1);
  });

  it("#138 AC-1: 再描画（集計の更新）では、開いたときに移したフォーカスを先頭のタブへ奪い返さない", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <ReactionPicker reactions={[]} onSelect={vi.fn()} onClose={onClose} />,
    );
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(document.activeElement).toBe(tabs()[2]);
    rerender(
      <ReactionPicker reactions={[]} onSelect={vi.fn()} onClose={onClose} />,
    );
    expect(document.activeElement).toBe(tabs()[2]);
  });
});
