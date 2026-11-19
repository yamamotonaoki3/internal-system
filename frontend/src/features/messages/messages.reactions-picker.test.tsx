// #138 AC-1（1-7 AC-1・U-8）・AC-2（1-4 AC-6）: ピッカーの開閉の出し分け（MessageItem・MessageList・ThreadReplies）。API は MSW。データは架空。
// ミューテーションの生き残り（MessageItem.tsx:103・108、MessageList.tsx:42、ThreadReplies.tsx:122・123）を検出するための補強。期待値は設計書（reactions.md「画面の部品とキーボードの操作」）から書く：
//   - canReact を渡さないとき（既定）は、「リアクションを付ける」を出さない（表示の制御。付いているチップは読み取り専用で出す）。
//   - ピッカーは最初は閉じている。「リアクションを付ける」で開き、もう一度押すと閉じる。開けるのは同時に1つの投稿だけ。
//   - スレッドの親の投稿でも、同じように開閉できる。親と返信を通して、開いているピッカーは同時に1つ。
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  OTHER_AUTHOR,
  message,
  reply,
  respondReplies,
} from "../../test/message-handlers";
import {
  reaction,
  reactor,
  respondReactions,
} from "../../test/reaction-handlers";
import { renderInApp, respondSelf } from "../../test/thread-harness";
import { MessageItem } from "./components/MessageItem";
import { MessageList } from "./components/MessageList";
import { ThreadReplies } from "./index";

const thumbs = reaction("emoji", "👍", { others: [reactor(1)] });
const addButtons = () =>
  screen.queryAllByRole("button", { name: /^リアクションを付ける/ });
const pickers = () =>
  screen.queryAllByRole("dialog", { name: "リアクションを選ぶ" });

describe("#138 AC-1（U-8）MessageItem：canReact を渡さないとき・ピッカーの最初の状態", () => {
  it("#138 AC-1: canReact を渡さないと、「リアクションを付ける」を出さない。付いているチップは読み取り専用（aria-disabled）で出す", () => {
    respondSelf();
    renderInApp(
      <ul>
        <MessageItem
          message={message(1, { reactions: [thumbs] })}
          retired={false}
          canModify={false}
        />
      </ul>,
    );
    expect(addButtons()).toEqual([]);
    expect(
      screen
        .getByRole("button", { name: /^👍 / })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("#138 AC-1: canReact が真で、開閉の状態を渡さないとき、ピッカーは最初は閉じている（aria-expanded=false）。押すと開き、もう一度押すと閉じる", async () => {
    respondSelf();
    const { user } = renderInApp(
      <ul>
        <MessageItem
          message={message(1)}
          retired={false}
          canModify={false}
          canReact
        />
      </ul>,
    );
    expect(pickers()).toEqual([]);
    expect(addButtons()[0]?.getAttribute("aria-expanded")).toBe("false");
    await user.click(addButtons()[0] as HTMLElement);
    expect(pickers()).toHaveLength(1);
    expect(addButtons()[0]?.getAttribute("aria-expanded")).toBe("true");
    await user.click(addButtons()[0] as HTMLElement);
    expect(pickers()).toEqual([]);
    expect(addButtons()[0]?.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("#138 AC-1（U-8）MessageList：canReact の既定と、同時に1つだけ開く", () => {
  const list = [message(1), message(2, { body: "[E2E_TEST]2件目の投稿" })];

  it("#138 AC-1: canReact を渡さないと、どの投稿にも「リアクションを付ける」を出さない", () => {
    respondSelf();
    renderInApp(<MessageList messages={list} isPending={false} error={null} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(addButtons()).toEqual([]);
  });

  it("#138 AC-1: canReact が真のとき、どの投稿もピッカーは最初は閉じている。1つの投稿で開くと、別の投稿で開けば前のは閉じる（同時に1つ）", async () => {
    respondSelf();
    const { user } = renderInApp(
      <MessageList messages={list} isPending={false} error={null} canReact />,
    );
    expect(addButtons()).toHaveLength(2);
    expect(pickers()).toEqual([]);
    await user.click(addButtons()[0] as HTMLElement);
    expect(pickers()).toHaveLength(1);
    await user.click(addButtons()[1] as HTMLElement);
    expect(pickers()).toHaveLength(1);
    expect(addButtons()[0]?.getAttribute("aria-expanded")).toBe("false");
    expect(addButtons()[1]?.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("#138 AC-2（1-4 AC-6）ThreadReplies：親の投稿でもピッカーを開閉できる", () => {
  function build() {
    const parent = message(1, {
      body: "[E2E_TEST]スレッドの親",
      replyCount: 1,
      author: OTHER_AUTHOR,
    });
    const first = reply(parent, 1, { body: "[E2E_TEST]最初の返信" });
    respondSelf();
    respondReplies({
      parent,
      replies: [first],
      joined: true,
      roomWritable: true,
      replyBlockedReason: null,
      caseRoom: false,
    });
    respondReactions({});
    return renderInApp(<ThreadReplies parentMessageId={parent.id} />);
  }
  const parentRow = () =>
    waitFor(() => {
      const row = screen
        .getAllByRole("listitem")
        .find((li) => (li.textContent ?? "").includes("スレッドの親"));
      if (row === undefined) throw new Error("親の行がありません");
      return row;
    });

  it("#138 AC-2: 親の「リアクションを付ける」を押すと開き（aria-expanded=true）、もう一度押すと閉じる。最初は閉じている", async () => {
    const { user } = build();
    const row = await parentRow();
    const button = () =>
      within(row).getByRole("button", { name: /^リアクションを付ける/ });
    expect(pickers()).toEqual([]);
    expect(button().getAttribute("aria-expanded")).toBe("false");
    await user.click(button());
    expect(pickers()).toHaveLength(1);
    expect(button().getAttribute("aria-expanded")).toBe("true");
    expect(
      within(row).getByRole("dialog", { name: "リアクションを選ぶ" }),
    ).toBeTruthy();
    await user.click(button());
    expect(pickers()).toEqual([]);
    expect(button().getAttribute("aria-expanded")).toBe("false");
  });

  it("#138 AC-2: 親で開いているとき、返信のピッカーを開くと親のは閉じる（親と返信を通して同時に1つ）。返信側を閉じる操作もできる", async () => {
    const { user } = build();
    const row = await parentRow();
    const parentButton = within(row).getByRole("button", {
      name: /^リアクションを付ける/,
    });
    await user.click(parentButton);
    expect(pickers()).toHaveLength(1);
    const replyButton = addButtons().find((button) => button !== parentButton);
    expect(replyButton).toBeDefined();
    await user.click(replyButton as HTMLElement);
    expect(pickers()).toHaveLength(1);
    expect(parentButton.getAttribute("aria-expanded")).toBe("false");
    expect(replyButton?.getAttribute("aria-expanded")).toBe("true");
    await user.click(parentButton);
    expect(pickers()).toHaveLength(1);
    expect(parentButton.getAttribute("aria-expanded")).toBe("true");
    expect(replyButton?.getAttribute("aria-expanded")).toBe("false");
  });
});
