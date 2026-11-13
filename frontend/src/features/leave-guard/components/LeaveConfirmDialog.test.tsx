// #239 AC-5（1-1 AC-4・C-82）：画面を離れる前の確認ダイアログ（LeaveConfirmDialog）そのもの。
// 契約（計画 plan-239 と改訂1〜5）：
//   <dialog> をモーダルとして開き（showModal）、名前は「入力した内容は失われます」。ボタンは「編集を続ける」「破棄して離れる」。
//   開いたときのフォーカスは「編集を続ける」。Esc（cancel イベント）はブラウザの既定の「閉じる」を止め、「編集を続ける」と同じ扱いにする。
// jsdom の showModal は共通の準備（test/setup.ts）の最小のスタブ（open 属性を付けるだけ）。
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LeaveConfirmDialog } from "./LeaveConfirmDialog";

const DIALOG_NAME = /入力した内容は失われます/;

afterEach(() => {
  vi.restoreAllMocks();
});

function renderDialog() {
  const onContinue = vi.fn();
  const onDiscard = vi.fn();
  render(<LeaveConfirmDialog onContinue={onContinue} onDiscard={onDiscard} />);
  const dialog = screen.getByRole<HTMLDialogElement>("dialog", {
    name: DIALOG_NAME,
  });
  return { dialog, onContinue, onDiscard };
}

describe("#239 AC-5 確認ダイアログ（LeaveConfirmDialog）", () => {
  it("#239 AC-5: 描画するとモーダルとして開く（showModal を1回呼び、open になる）", () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    const { dialog } = renderDialog();
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(showModal.mock.contexts[0]).toBe(dialog);
    expect(dialog.open).toBe(true);
  });

  it("#239 AC-5: 開いたときのフォーカスは「編集を続ける」", () => {
    renderDialog();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "編集を続ける" }),
    );
  });

  it("#239 AC-5: Esc（cancel イベント）は既定の閉じる動きを止め、「編集を続ける」と同じ扱いにする", () => {
    const { dialog, onContinue, onDiscard } = renderDialog();
    const cancel = new Event("cancel", { cancelable: true });
    fireEvent(dialog, cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();
    expect(dialog.open).toBe(true);
  });

  it("#239 AC-5: 「編集を続ける」は onContinue だけ、「破棄して離れる」は onDiscard だけを呼ぶ", async () => {
    const user = userEvent.setup();
    const { onContinue, onDiscard } = renderDialog();
    await user.click(screen.getByRole("button", { name: "編集を続ける" }));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "破棄して離れる" }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
