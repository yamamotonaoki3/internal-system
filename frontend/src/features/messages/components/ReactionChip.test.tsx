// #138 AC-1（1-7 AC-1・AC-3・AC-4）: ReactionChip — リアクション1種類のチップ（Button）。データは架空。
// 契約（計画「画面」の ReactionChip）：
//   <ReactionChip reaction canReact pending onToggle />
//   - 素の button ではなく共通の Button。見える文字は、絵文字ならその文字、スタンプなら日本語の名前（いいね など）と、件数。
//   - aria-pressed は reaction.reactedByMe。読み上げの名前（aria-label）と title は、describeReaction(reaction) と同じ文言（付けた人・件数・退職者）。
//   - 押すと onToggle(reaction) を1回呼ぶ（付ける・取り消すの判断は呼び出し側）。
//   - 書き込めないとき（canReact が偽）と送信中（pending が真）は、disabled にせず aria-disabled="true" にし（フォーカスは残る。読み上げで付けた人を聞ける）、押しても onToggle を呼ばない。
//   - 書き込めない部屋でも、チップ自体は出す（読み取り専用の表示）。
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { reaction, reactor } from "../../../test/reaction-handlers";
import { describeReaction } from "../reaction-label";
import { ReactionChip } from "./ReactionChip";

function setup(
  props: Partial<Parameters<typeof ReactionChip>[0]> = {},
  target = reaction("emoji", "👍", {
    others: [reactor(1), reactor(2, false)],
    mine: true,
  }),
) {
  const onToggle = vi.fn();
  render(
    <ReactionChip
      reaction={target}
      canReact
      pending={false}
      onToggle={onToggle}
      {...props}
    />,
  );
  const chip = screen.getByRole("button");
  return { chip, onToggle, user: userEvent.setup(), target };
}

describe("#138 AC-1（1-7 AC-1・AC-3）チップの表示", () => {
  it("#138 AC-1（1-7 AC-1）: 絵文字と件数を出す。自分が付けているときは aria-pressed が true", () => {
    const { chip } = setup();
    expect(chip.textContent).toContain("👍");
    expect(chip.textContent).toContain("3");
    expect(chip.getAttribute("aria-pressed")).toBe("true");
  });

  it("#138 AC-1（1-7 AC-3）: 自分が付けていないときは aria-pressed が false", () => {
    const { chip } = setup(
      {},
      reaction("emoji", "👍", { others: [reactor(1)] }),
    );
    expect(chip.getAttribute("aria-pressed")).toBe("false");
  });

  it("#138 AC-1（1-7 AC-2）: スタンプは日本語の名前と件数を出す", () => {
    const { chip } = setup(
      {},
      reaction("stamp", "ok", { others: [reactor(1), reactor(2)] }),
    );
    expect(chip.textContent).toContain("了解");
    expect(chip.textContent).toContain("2");
  });

  it("#138 AC-1（1-7 AC-3・U-5）: aria-label と title は、付けた人・件数・退職者の印を含む同じ文言（describeReaction）", () => {
    const { chip, target } = setup();
    const expected = describeReaction(target);
    expect(chip.getAttribute("aria-label")).toBe(expected);
    expect(chip.getAttribute("title")).toBe(expected);
    expect(expected).toContain("テストリアクション1");
    expect(expected).toContain("テストリアクション2（退職者）");
  });

  it("#138 AC-1（Q-93）: 50人を超える分は「ほか n 人」と読み上げる", () => {
    const users = Array.from({ length: 50 }, (_, i) => reactor(i + 1));
    const { chip } = setup(
      {},
      { ...reaction("emoji", "👏", { others: users }), count: 52 },
    );
    expect(chip.getAttribute("aria-label")).toContain("ほか 2 人");
  });

  it("#138 AC-1（ADR-0015）: 共通の Button（type=button）で、フォームを送信しない", () => {
    const { chip } = setup();
    expect(chip.getAttribute("type")).toBe("button");
  });
});

describe("#138 AC-1（1-7 AC-1・AC-3）チップの操作", () => {
  it("#138 AC-1: 押すと onToggle にそのリアクションを渡して1回呼ぶ", async () => {
    const { chip, onToggle, user, target } = setup();
    await user.click(chip);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(target);
  });

  it("#138 AC-1（キーボード）: Enter・Space でも押せる", async () => {
    const { chip, onToggle, user } = setup();
    chip.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it("#138 AC-1（U-8）: 書き込めないとき（canReact が偽）は aria-disabled=true（disabled にはしない）で、押しても onToggle を呼ばない。フォーカスはできる", async () => {
    const { chip, onToggle, user } = setup({ canReact: false });
    expect(chip.getAttribute("aria-disabled")).toBe("true");
    expect(chip.hasAttribute("disabled")).toBe(false);
    await user.click(chip);
    chip.focus();
    await user.keyboard("{Enter}");
    expect(document.activeElement).toBe(chip);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("#138 AC-1（二度押しの防止）: 送信中（pending）は aria-disabled=true で、押しても onToggle を呼ばない", async () => {
    const { chip, onToggle, user } = setup({ pending: true });
    expect(chip.getAttribute("aria-disabled")).toBe("true");
    await user.click(chip);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("#138 AC-1: 押せるときは aria-disabled を true にしない", () => {
    const { chip } = setup();
    expect(chip.getAttribute("aria-disabled")).not.toBe("true");
  });

  it("#138 AC-1（U-8）: 書き込めなくても、読み上げの名前（付けた人）は残る", () => {
    const { chip, target } = setup({ canReact: false });
    expect(chip.getAttribute("aria-label")).toBe(describeReaction(target));
  });
});
