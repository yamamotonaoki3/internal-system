// #138 AC-1（1-7 AC-3・U-5）: ReactorsDialog — スマートフォン用の「付けた人」の一覧。データは架空。
// 契約（計画「画面」の ReactorsDialog。DeleteMessageDialog と同じ <dialog> の書き方）：
//   <ReactorsDialog reactions onClose />。表示されたらネイティブの <dialog>（名前「付けた人」）を showModal() で開き、外れるときに close() する。
//   種類ごとに、表示（絵文字の文字・スタンプの名前）と件数、付けた人の表示名を並べる。無効な社員には「（退職者）」を付ける。
//   50人を超える分は「ほか n 人」を付ける。「閉じる」ボタンで onClose を呼ぶ。Esc（cancel イベント）は既定の閉じる動きを止めて onClose を呼ぶ。
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { reaction, reactor } from "../../../test/reaction-handlers";
import { ReactorsDialog } from "./ReactorsDialog";

function setup(reactions: Parameters<typeof ReactorsDialog>[0]["reactions"]) {
  const onClose = vi.fn();
  render(<ReactorsDialog reactions={reactions} onClose={onClose} />);
  const dialog = screen.getByRole<HTMLDialogElement>("dialog", {
    name: "付けた人",
  });
  return { dialog, onClose, user: userEvent.setup() };
}

describe("#138 AC-1（1-7 AC-3・U-5）付けた人の一覧", () => {
  it("#138 AC-1（U-5）: 種類ごとに、表示・件数・付けた人の表示名を出す", () => {
    const { dialog } = setup([
      reaction("emoji", "👍", { others: [reactor(1), reactor(2)] }),
      reaction("stamp", "ok", { others: [reactor(3)] }),
    ]);
    const text = dialog.textContent ?? "";
    expect(text).toContain("👍");
    expect(text).toContain("了解");
    for (const name of [
      "テストリアクション1",
      "テストリアクション2",
      "テストリアクション3",
    ])
      expect(within(dialog).getByText(new RegExp(name))).toBeTruthy();
  });

  it("#138 AC-1（U-5・U-6）: 退職者の名前には「（退職者）」を付け、有効な人には付けない", () => {
    const { dialog } = setup([
      reaction("emoji", "👍", { others: [reactor(1), reactor(2, false)] }),
    ]);
    expect(
      within(dialog).getByText(/テストリアクション2（退職者）/),
    ).toBeTruthy();
    expect(
      within(dialog).queryByText(/テストリアクション1（退職者）/),
    ).toBeNull();
  });

  it("#138 AC-1（Q-93）: 50人を超える分は「ほか n 人」と出す", () => {
    const users = Array.from({ length: 50 }, (_, i) => reactor(i + 1));
    const { dialog } = setup([
      { ...reaction("emoji", "👏", { others: users }), count: 53 },
    ]);
    expect(dialog.textContent).toMatch(/ほか\s*3\s*人/);
  });

  it("#138 AC-1: 自分が付けた分も、付けた人に含めて出す", () => {
    const { dialog } = setup([
      reaction("emoji", "👍", { others: [reactor(1)], mine: true }),
    ]);
    expect(within(dialog).getAllByText(/testuser_001/).length).toBeGreaterThan(
      0,
    );
  });
});

describe("#138 AC-1 閉じる", () => {
  it("#138 AC-1: 「閉じる」ボタンで onClose を呼ぶ", async () => {
    const { dialog, onClose, user } = setup([
      reaction("emoji", "👍", { others: [reactor(1)] }),
    ]);
    await user.click(within(dialog).getByRole("button", { name: "閉じる" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("#138 AC-1: Esc（cancel イベント）は既定の動きを止め、onClose を呼ぶ", () => {
    const { dialog, onClose } = setup([
      reaction("emoji", "👍", { others: [reactor(1)] }),
    ]);
    const proceeded = fireEvent(
      dialog,
      new Event("cancel", { cancelable: true }),
    );
    expect(proceeded).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("#138 AC-1: 外れる（アンマウント）ときに dialog を閉じる（open 属性が外れる）", () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <ReactorsDialog
        reactions={[reaction("emoji", "👍", { others: [reactor(1)] })]}
        onClose={onClose}
      />,
    );
    const dialog = screen.getByRole<HTMLDialogElement>("dialog", {
      name: "付けた人",
    });
    const close = vi.spyOn(dialog, "close");
    unmount();
    expect(close).toHaveBeenCalled();
  });
});
