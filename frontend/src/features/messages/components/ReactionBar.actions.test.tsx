// #138 AC-1（1-7 AC-1・AC-2・AC-3・AC-5）・AC-2（1-4 AC-6）: ReactionBar — 付ける・外すの方向、送信中の扱い、何も描画しない条件、閉じた後のフォーカス。API は MSW。データは架空。
// ミューテーションの生き残り（ReactionBar.tsx:48・53・56・57・60・66・91・106）を検出するための補強。期待値は設計書（reactions.md「処理の流れ（画面）」）から書く：
//   - 押した時点の画面の表示で、付けていれば取り消し（DELETE）、付けていなければ付ける（POST）。複数の種類があっても、押した種類の状態で決める。
//     種類（kind）と値（value）の両方が同じものを探す（同じ値でも絵文字とスタンプは別の種類）。
//   - 送信中（pending）は、ピッカーで選んでも送らない（選んだら閉じる）。
//   - リアクションがなく、付けられない（canReact が偽）ときは何も描画しない。
//   - ピッカーを閉じたら、フォーカスを開いたボタンに戻す。「付けた人」の一覧を閉じたら、一覧を外し、フォーカスを「付けた人」ボタンに戻す。
import { screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { message } from "../../../test/message-handlers";
import {
  reaction,
  reactor,
  respondReactions,
} from "../../../test/reaction-handlers";
import { renderInApp, respondSelf } from "../../../test/thread-harness";
import type { RoomMessage } from "../api/message-api";
import { ReactionBar } from "./ReactionBar";

afterEach(() => vi.restoreAllMocks());

function Harness({
  target,
  canReact = true,
}: {
  target: RoomMessage;
  canReact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid="host">
      <ReactionBar
        message={target}
        canReact={canReact}
        pickerOpen={open}
        onPickerOpenChange={setOpen}
      />
    </div>
  );
}

function setup(
  reactions: RoomMessage["reactions"],
  options: { canReact?: boolean } = {},
) {
  respondSelf();
  const target = message(1, { reactions });
  const api = respondReactions({ [target.id]: reactions });
  const view = renderInApp(
    <Harness target={target} canReact={options.canReact} />,
  );
  return { ...view, api, target };
}

const addButton = () =>
  screen.getByRole("button", { name: /^リアクションを付ける/ });
const picker = () =>
  screen.queryByRole("dialog", { name: "リアクションを選ぶ" });
const chip = (pattern: RegExp) => screen.getByRole("button", { name: pattern });
const cell = (char: string) => {
  const found = within(screen.getByRole("grid"))
    .getAllByRole("button")
    .find((button) => button.textContent === char);
  if (found === undefined) throw new Error(`${char} のセルがありません`);
  return found;
};

const thumbsNotMine = reaction("emoji", "👍", { others: [reactor(1)] });
const partyMine = reaction("emoji", "🎉", {
  others: [reactor(2)],
  mine: true,
});
const thumbsMine = reaction("emoji", "👍", {
  others: [reactor(1)],
  mine: true,
});
const partyNotMine = reaction("emoji", "🎉", { others: [reactor(2)] });

describe("#138 AC-1（1-7 AC-1）複数の種類があるとき、押した種類の状態で付ける・外すを決める", () => {
  it("#138 AC-1: 2番目の種類を自分が付けているとき、ピッカーでそれを選ぶと取り消す（DELETE。先頭の種類の状態で決めない）", async () => {
    const { user, api, target } = setup([thumbsNotMine, partyMine]);
    await user.click(addButton());
    await user.click(cell("🎉"));
    await waitFor(() => expect(api.deletes).toHaveLength(1));
    expect(api.deletes).toEqual([
      { messageId: target.id, kind: "emoji", value: "🎉" },
    ]);
    expect(api.posts).toEqual([]);
  });

  it("#138 AC-1: 先頭の種類を自分が付けていて、2番目を付けていないとき、2番目をピッカーで選ぶと付ける（POST）", async () => {
    const { user, api, target } = setup([thumbsMine, partyNotMine]);
    await user.click(addButton());
    await user.click(cell("🎉"));
    await waitFor(() => expect(api.posts).toHaveLength(1));
    expect(api.posts).toEqual([
      { messageId: target.id, kind: "emoji", value: "🎉" },
    ]);
    expect(api.deletes).toEqual([]);
  });

  it("#138 AC-1: 付いていない種類を選ぶと付ける（POST）。付けている先頭の種類を選ぶと取り消す（DELETE）", async () => {
    const { user, api, target } = setup([thumbsMine, partyNotMine]);
    await user.click(addButton());
    await user.click(cell("👍"));
    await waitFor(() => expect(api.deletes).toHaveLength(1));
    expect(api.deletes).toEqual([
      { messageId: target.id, kind: "emoji", value: "👍" },
    ]);
  });

  it("#138 AC-1: 2番目のチップを押すと、その種類の状態で決める（自分が付けている → DELETE）", async () => {
    const { user, api, target } = setup([thumbsNotMine, partyMine]);
    await user.click(chip(/^🎉 /));
    await waitFor(() => expect(api.deletes).toHaveLength(1));
    expect(api.deletes).toEqual([
      { messageId: target.id, kind: "emoji", value: "🎉" },
    ]);
    expect(api.posts).toEqual([]);
  });

  it("#138 AC-1: 値が同じでも種類（絵文字とスタンプ）が違うものは別。スタンプ ok を付けているとき、同じ綴りの絵文字 ok の状態で決めない", async () => {
    const emojiOk = reaction("emoji", "ok", { others: [reactor(1)] });
    const stampOk = reaction("stamp", "ok", {
      others: [reactor(2)],
      mine: true,
    });
    const { user, api, target } = setup([emojiOk, stampOk]);
    await user.click(chip(/^了解 /));
    await waitFor(() => expect(api.deletes).toHaveLength(1));
    expect(api.deletes).toEqual([
      { messageId: target.id, kind: "stamp", value: "ok" },
    ]);
    expect(api.posts).toEqual([]);
  });

  it("#138 AC-1: 種類が同じ（スタンプ）で値が違うものは別。2番目のスタンプ ok を付けているとき、先頭のスタンプ like の状態で決めない（スタンプのタブから選ぶ）", async () => {
    const like = reaction("stamp", "like", { others: [reactor(1)] });
    const ok = reaction("stamp", "ok", { others: [reactor(2)], mine: true });
    const { user, api, target } = setup([like, ok]);
    await user.click(addButton());
    await user.click(screen.getByRole("tab", { name: "スタンプ" }));
    await user.click(
      within(screen.getByRole("tabpanel")).getByRole("button", {
        name: "了解",
      }),
    );
    await waitFor(() => expect(api.deletes).toHaveLength(1));
    expect(api.deletes).toEqual([
      { messageId: target.id, kind: "stamp", value: "ok" },
    ]);
    expect(api.posts).toEqual([]);
  });
});

describe("#138 AC-1 送信中（pending）の扱い", () => {
  it("#138 AC-1: 送信中にピッカーで別の種類を選んでも、送らない（選んだピッカーは閉じる）。応答が来たあとも、送った要求は最初の1件だけ", async () => {
    const { user, api } = setup([thumbsNotMine]);
    let release: () => void = () => {};
    api.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await user.click(chip(/^👍 /));
    await waitFor(() => expect(api.posts).toHaveLength(1));
    await waitFor(() =>
      expect(chip(/^👍 /).getAttribute("aria-disabled")).toBe("true"),
    );
    await user.click(addButton());
    await user.click(cell("🎉"));
    expect(picker()).toBeNull();
    // 送信中の間、少し待っても要求は増えない
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(api.posts).toHaveLength(1);
    release();
    await waitFor(() =>
      expect(chip(/^👍 /).getAttribute("aria-disabled")).toBeNull(),
    );
    expect(api.posts).toHaveLength(1);
    expect(api.deletes).toEqual([]);
  });

  it("#138 AC-1: 送信中でなければ、ピッカーで選ぶと送る（上の「送らない」が常に送らない実装でないことの確認）", async () => {
    const { user, api, target } = setup([thumbsNotMine]);
    await user.click(addButton());
    await user.click(cell("🎉"));
    await waitFor(() => expect(api.posts).toHaveLength(1));
    expect(api.posts).toEqual([
      { messageId: target.id, kind: "emoji", value: "🎉" },
    ]);
  });
});

describe("#138 AC-1 何も描画しない条件・一覧の key・読み上げの名前", () => {
  it("#138 AC-1: リアクションがなく、付けられない（canReact が偽）ときは、何も描画しない", () => {
    setup([], { canReact: false });
    expect(screen.getByTestId("host").childElementCount).toBe(0);
  });

  it("#138 AC-1: リアクションがなくても、付けられるときは「リアクションを付ける」を描画する。「付けた人」は出さない", () => {
    setup([]);
    expect(addButton()).toBeTruthy();
    expect(screen.queryByRole("button", { name: /付けた人/ })).toBeNull();
  });

  it("#138 AC-1: リアクションがあれば、付けられなくても描画する（読み取り専用。「リアクションを付ける」は出さない）", () => {
    setup([thumbsNotMine], { canReact: false });
    expect(chip(/^👍 /)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /^リアクションを付ける/ }),
    ).toBeNull();
  });

  it("#138 AC-1: 複数の種類を並べても、React の key の重複の警告を出さない", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    setup([
      thumbsNotMine,
      partyMine,
      reaction("stamp", "ok", { others: [reactor(3)] }),
    ]);
    expect(error).not.toHaveBeenCalled();
  });

  it("#138 AC-1: 「付けた人」ボタンの名前に、投稿者の表示名が入る（読み上げ）", () => {
    setup([thumbsNotMine]);
    expect(
      screen.getByRole("button", { name: "付けた人（テスト太郎の投稿）" }),
    ).toBeTruthy();
  });
});

describe("#138 AC-1 閉じた後のフォーカスの戻り先", () => {
  it("#138 AC-1: ピッカーで1つ選んで閉じたら、フォーカスは「リアクションを付ける」ボタンに戻る", async () => {
    const { user } = setup([thumbsNotMine]);
    await user.click(addButton());
    await user.click(cell("🎉"));
    expect(picker()).toBeNull();
    expect(document.activeElement).toBe(addButton());
  });

  it("#138 AC-1: ピッカーを Esc で閉じたら、フォーカスは「リアクションを付ける」ボタンに戻る", async () => {
    const { user } = setup([thumbsNotMine]);
    await user.click(addButton());
    await user.keyboard("{Escape}");
    expect(picker()).toBeNull();
    expect(document.activeElement).toBe(addButton());
  });

  it("#138 AC-1: 「付けた人」の一覧を閉じたら、一覧を外し、フォーカスは「付けた人」ボタンに戻る", async () => {
    const { user } = setup([thumbsNotMine]);
    const open = screen.getByRole("button", { name: /^付けた人/ });
    await user.click(open);
    const dialog = screen.getByRole("dialog", { name: "付けた人" });
    await user.click(within(dialog).getByRole("button", { name: "閉じる" }));
    expect(screen.queryByRole("dialog", { name: "付けた人" })).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /^付けた人/ }),
    );
  });
});
