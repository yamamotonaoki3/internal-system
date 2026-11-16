// #138 AC-1（1-7 AC-2・AC-4）: StampList — 6つのスタンプの並び。付けている印と、20種類の上限での押せる・押せないの境界。データは架空。
// ミューテーションの生き残り（StampList.tsx:23・25）を検出するための補強。期待値は設計書（reactions.md「20種類に達したとき」）から書く：
//   - 20種類に達したとき、まだ付いていない種類は選べない（aria-disabled="true"。onSelect を呼ばない）。すでに付いている種類は、20種類でも選べる（取り消す）。
//   - 20種類に達していなければ、新しい種類も選べる（aria-disabled を付けない）。
//   - 付けている印（aria-pressed）は、種類（スタンプ）と値（id）が両方同じ集計だけで決める。ほかの種類の集計に引きずられない。
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { reaction, reactor } from "../../../test/reaction-handlers";
import { StampList } from "./StampList";

function setup(
  reactions: Parameters<typeof StampList>[0]["reactions"],
  limitReached: boolean,
) {
  const onSelect = vi.fn();
  render(
    <StampList
      reactions={reactions}
      limitReached={limitReached}
      onSelect={onSelect}
    />,
  );
  return { onSelect, user: userEvent.setup() };
}
const stampButton = (name: string) => screen.getByRole("button", { name });

describe("#138 AC-1（AC-4）20種類の上限での境界", () => {
  it("#138 AC-1: 20種類に達しているとき、すでに付いているスタンプは選べる（aria-disabled を付けず、onSelect を呼ぶ）", async () => {
    const { user, onSelect } = setup(
      [reaction("stamp", "ok", { others: [reactor(1)], mine: true })],
      true,
    );
    expect(stampButton("了解").getAttribute("aria-disabled")).toBeNull();
    await user.click(stampButton("了解"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("ok");
  });

  it("#138 AC-1: 20種類に達しているとき、まだ付いていないスタンプは選べない（aria-disabled=true。onSelect を呼ばない）。付いているものとは別に判定する", async () => {
    const { user, onSelect } = setup(
      [reaction("stamp", "ok", { others: [reactor(1)] })],
      true,
    );
    expect(stampButton("ありがとう").getAttribute("aria-disabled")).toBe(
      "true",
    );
    expect(stampButton("了解").getAttribute("aria-disabled")).toBeNull();
    await user.click(stampButton("ありがとう"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("#138 AC-1: 20種類に達していなければ、まだ付いていない新しいスタンプも選べる（aria-disabled を付けず、onSelect を呼ぶ）", async () => {
    const { user, onSelect } = setup(
      [reaction("stamp", "ok", { others: [reactor(1)] })],
      false,
    );
    expect(stampButton("ありがとう").getAttribute("aria-disabled")).toBeNull();
    await user.click(stampButton("ありがとう"));
    expect(onSelect).toHaveBeenCalledWith("thanks");
  });

  it("#138 AC-1: 付いているものが何もなく、20種類に達していなければ、6つとも選べる", async () => {
    const { user, onSelect } = setup([], false);
    for (const name of [
      "いいね",
      "了解",
      "ありがとう",
      "お疲れさまです",
      "確認します",
      "おめでとう",
    ]) {
      expect(stampButton(name).getAttribute("aria-disabled")).toBeNull();
      await user.click(stampButton(name));
    }
    expect(onSelect).toHaveBeenCalledTimes(6);
  });
});

describe("#138 AC-1 付けている印は、種類と値の両方が同じ集計だけで決まる", () => {
  it("#138 AC-1: 絵文字の集計（先頭）があっても、スタンプの印はスタンプの集計だけで決まる", () => {
    setup(
      [
        reaction("emoji", "👍", { others: [reactor(1)], mine: true }),
        reaction("stamp", "ok", { others: [reactor(2)], mine: true }),
      ],
      false,
    );
    expect(stampButton("了解").getAttribute("aria-pressed")).toBe("true");
    expect(stampButton("いいね").getAttribute("aria-pressed")).toBe("false");
    expect(stampButton("ありがとう").getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("#138 AC-1: 値が同じ綴りの絵文字（種類が違う）の集計には引きずられない", () => {
    setup(
      [reaction("emoji", "ok", { others: [reactor(1)], mine: true })],
      true,
    );
    expect(stampButton("了解").getAttribute("aria-pressed")).toBe("false");
    // 種類が違うため「付いている」とは数えず、20種類のときは選べない
    expect(stampButton("了解").getAttribute("aria-disabled")).toBe("true");
  });

  it("#138 AC-1: 先頭のスタンプを付けていないとき、2番目以降の付けているスタンプの印を取り違えない", () => {
    setup(
      [
        reaction("stamp", "like", { others: [reactor(1)] }),
        reaction("stamp", "thanks", { others: [reactor(2)], mine: true }),
      ],
      false,
    );
    expect(stampButton("いいね").getAttribute("aria-pressed")).toBe("false");
    expect(stampButton("ありがとう").getAttribute("aria-pressed")).toBe("true");
  });
});
