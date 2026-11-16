// #138 AC-1（1-7 AC-3・Q-93）: ReactorsDialog — 「ほか n 人」の境界、開いたときの showModal、閉じる動きの順序、一覧の key。データは架空。
// ミューテーションの生き残り（ReactorsDialog.tsx の `count > users.length`・showModal・close）を検出するための補強。期待値は設計書（reactions.md）から書く：
//   - 付けた人は最大50人までしか届かない。count が届いた人数と同じなら「ほか n 人」は出さず、多いときだけ「ほか <差> 人」を出す。
//   - 開いたらネイティブの <dialog> を showModal() で開く（1回だけ）。閉じるときは、onClose を呼ぶ前に <dialog> 自身を閉じる（呼び出し側がフォーカスを戻せるように）。
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reaction, reactor } from "../../../test/reaction-handlers";
import { ReactorsDialog } from "./ReactorsDialog";

afterEach(() => vi.restoreAllMocks());

function setup(reactions: Parameters<typeof ReactorsDialog>[0]["reactions"]) {
  const onClose = vi.fn();
  const view = render(
    <ReactorsDialog reactions={reactions} onClose={onClose} />,
  );
  const dialog = screen.getByRole<HTMLDialogElement>("dialog", {
    name: "付けた人",
  });
  return { dialog, onClose, view, user: userEvent.setup() };
}

describe("#138 AC-1（Q-93）「ほか n 人」の境界", () => {
  it("#138 AC-1: count が届いた人数と同じ（全員分届いた）ときは、「ほか」を出さない", () => {
    const { dialog } = setup([
      reaction("emoji", "👍", { others: [reactor(1), reactor(2)] }),
    ]);
    expect(dialog.textContent).not.toContain("ほか");
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(2);
  });

  it("#138 AC-1: count が届いた人数より1人多いときは、「ほか 1 人」を1行だけ出す", () => {
    const users = [reactor(1), reactor(2)];
    const { dialog } = setup([
      { ...reaction("emoji", "👍", { others: users }), count: 3 },
    ]);
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(3);
    expect(within(dialog).getByText("ほか 1 人")).toBeTruthy();
  });

  it("#138 AC-1: 人数の差が「ほか n 人」の n になる（件数の足し算・引き算を取り違えない）", () => {
    const users = [reactor(1), reactor(2), reactor(3)];
    const { dialog } = setup([
      { ...reaction("emoji", "👍", { others: users }), count: 10 },
    ]);
    expect(within(dialog).getByText("ほか 7 人")).toBeTruthy();
    expect(dialog.textContent).toContain("10人");
  });

  it("#138 AC-1: 「ほか n 人」は、その種類の中だけに出る（ほかの種類には出さない）", () => {
    const { dialog } = setup([
      { ...reaction("emoji", "👍", { others: [reactor(1)] }), count: 4 },
      reaction("stamp", "ok", { others: [reactor(2)] }),
    ]);
    expect(within(dialog).getAllByText(/ほか/)).toHaveLength(1);
  });
});

describe("#138 AC-1 開く・閉じる", () => {
  it("#138 AC-1: 表示されたら showModal を1回だけ呼び、dialog が開く。再描画では呼び直さない", () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    const onClose = vi.fn();
    const reactions = [reaction("emoji", "👍", { others: [reactor(1)] })];
    const { rerender } = render(
      <ReactorsDialog reactions={reactions} onClose={onClose} />,
    );
    expect(showModal).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("dialog", { name: "付けた人" }).hasAttribute("open"),
    ).toBe(true);
    rerender(<ReactorsDialog reactions={[...reactions]} onClose={onClose} />);
    expect(showModal).toHaveBeenCalledTimes(1);
  });

  it("#138 AC-1: 「閉じる」では、onClose を呼ぶ前に dialog 自身を閉じる（open が外れている）", async () => {
    const seen: boolean[] = [];
    let dialogElement: HTMLDialogElement | null = null;
    const onClose = vi.fn(() => {
      seen.push(dialogElement?.hasAttribute("open") ?? true);
    });
    const { container } = render(
      <ReactorsDialog
        reactions={[reaction("emoji", "👍", { others: [reactor(1)] })]}
        onClose={onClose}
      />,
    );
    dialogElement = container.querySelector("dialog");
    expect(dialogElement?.hasAttribute("open")).toBe(true);
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "閉じる" }));
    expect(seen).toEqual([false]);
  });

  it("#138 AC-1: Esc（cancel）でも、onClose を呼ぶ前に dialog 自身を閉じる", () => {
    const seen: boolean[] = [];
    let dialogElement: HTMLDialogElement | null = null;
    const onClose = vi.fn(() => {
      seen.push(dialogElement?.hasAttribute("open") ?? true);
    });
    const { container } = render(
      <ReactorsDialog
        reactions={[reaction("emoji", "👍", { others: [reactor(1)] })]}
        onClose={onClose}
      />,
    );
    dialogElement = container.querySelector("dialog");
    dialogElement?.dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(seen).toEqual([false]);
  });

  it("#138 AC-1: 種類ごとの一覧は、同じ種類の key の重複で React の警告を出さない", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    setup([
      reaction("emoji", "👍", { others: [reactor(1)] }),
      reaction("emoji", "👏", { others: [reactor(2)] }),
      reaction("stamp", "ok", { others: [reactor(3)] }),
    ]);
    expect(error).not.toHaveBeenCalled();
  });
});
