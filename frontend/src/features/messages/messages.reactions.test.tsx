// #138 AC-1（1-7 AC-1〜AC-5）: 部屋のメッセージ（RoomMessages → MessageList → MessageItem → ReactionBar）でのリアクション。API は MSW。データは架空。
// 契約（計画「画面」「状態と反映」・手順7の「上位の部品のテスト」）：
//   canReact は、RoomMessages の canModifyOwn と同じ材料（部屋が許すとき）から RoomMessages → MessageList → MessageItem と渡す。投稿者は問わない（他人の投稿にも出る）。
//   削除済みの投稿には、操作もチップも出さない。
//   MessageItem は、本文の下に ReactionBar を置く。
//   - リアクションの操作が使えるとき（canReact）：各投稿（削除済みを除く）に、名前が「リアクションを付ける」で始まるボタン（aria-haspopup="dialog"・aria-expanded）を出す。
//     押すと ReactionPicker（role=dialog「リアクションを選ぶ」）が開く。開くのは同時に1つの投稿だけ。
//     1つ選ぶ・Esc・外のクリックで閉じ、フォーカスを開いたボタンに戻す。選ぶと、付いていなければ POST、自分が付けていれば DELETE（useToggleReaction）。
//   - チップ（ReactionChip）：付いている種類ごとに並べる。押すと付け外し。canReact が偽のときは aria-disabled（押しても送らない）。
//   - 「付けた人」ボタン（名前が「付けた人」で始まる）：リアクションが付いている投稿にだけ出す（スマートフォン用。jsdom には画面幅がないため常に DOM にある）。押すと ReactorsDialog（名前「付けた人」）を開く。
//   - 送信中はその投稿のチップを aria-disabled にし、二度押しは送らない。
//   - 成功したら、応答の集計でその投稿だけを書き換える（取り直さない）。拒否（409 など）は、role=alert にサーバーの文を出し、表示は変えず、取り直さない。
// 期待値は要件・計画から書く。データは架空（testuser_・[E2E_TEST]）。
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  OTHER_AUTHOR,
  message,
  respondMessages,
  type TestMessage,
} from "../../test/message-handlers";
import {
  reaction,
  reactor,
  respondReactions,
} from "../../test/reaction-handlers";
import { renderInApp, respondSelf } from "../../test/thread-harness";
import { RoomMessages } from "./index";

const ROOM = message(1).roomId;
const theirs = (n: number, overrides: Partial<TestMessage> = {}) =>
  message(n, {
    author: OTHER_AUTHOR,
    body: `[E2E_TEST]他人の投稿${n}`,
    ...overrides,
  });
const mine = (n: number, overrides: Partial<TestMessage> = {}) =>
  message(n, { body: `[E2E_TEST]自分の投稿${n}`, ...overrides });

function renderRoom(options: { canModifyOwn?: boolean } = {}) {
  respondSelf();
  return renderInApp(
    <RoomMessages
      roomId={ROOM}
      canPost
      joined
      canModifyOwn={options.canModifyOwn ?? true}
    />,
  );
}

const rows = () =>
  within(screen.getByRole("log"))
    .getAllByRole("listitem")
    .filter((li) => li.parentElement?.closest("li") === null);
async function rowWith(text: string): Promise<HTMLElement> {
  return waitFor(() => {
    const row = rows().find((li) => (li.textContent ?? "").includes(text));
    if (row === undefined) throw new Error(`「${text}」の行がありません`);
    return row;
  });
}
const addButton = (row: HTMLElement) =>
  within(row).queryByRole("button", { name: /^リアクションを付ける/ });
const picker = () =>
  screen.queryByRole("dialog", { name: "リアクションを選ぶ" });

describe("#138 AC-1（1-7 AC-1・U-8）操作が出る・出ない", () => {
  it("#138 AC-1: 他人の投稿にも自分の投稿にも「リアクションを付ける」が出る（aria-haspopup=dialog・aria-expanded=false）", async () => {
    respondMessages([theirs(1), mine(2)]);
    renderRoom();
    for (const text of ["他人の投稿1", "自分の投稿2"]) {
      const button = addButton(await rowWith(text));
      expect(button).not.toBeNull();
      expect(button?.getAttribute("aria-haspopup")).toBe("dialog");
      expect(button?.getAttribute("aria-expanded")).toBe("false");
    }
  });

  it("#138 AC-1（U-8）: 部屋が許さないとき（canModifyOwn が偽）は「リアクションを付ける」を出さない。付いているチップは、押せない状態（aria-disabled）で出る", async () => {
    const { requests } = respondMessages([
      theirs(1, {
        reactions: [reaction("emoji", "👍", { others: [reactor(1)] })],
      }),
    ]);
    const api = respondReactions();
    const { user } = renderRoom({ canModifyOwn: false });
    const row = await rowWith("他人の投稿1");
    expect(addButton(row)).toBeNull();
    const chip = within(row).getByRole("button", {
      name: /テストリアクション1/,
    });
    expect(chip.getAttribute("aria-disabled")).toBe("true");
    await user.click(chip);
    expect(api.posts).toEqual([]);
    expect(api.deletes).toEqual([]);
    expect(requests.length).toBeGreaterThan(0);
  });

  it("#138 AC-1（U-7）: 削除済みの投稿には、操作もチップも出さない", async () => {
    respondMessages([theirs(1, { body: null, deleted: true }), theirs(2)]);
    renderRoom();
    const row = await rowWith("このメッセージは削除されました");
    expect(addButton(row)).toBeNull();
    expect(within(row).queryByRole("button", { name: /付けた人/ })).toBeNull();
    expect(addButton(await rowWith("他人の投稿2"))).not.toBeNull();
  });

  it("#138 AC-1: リアクションが付いていない投稿には、チップも「付けた人」も出ない", async () => {
    respondMessages([theirs(1)]);
    renderRoom();
    const row = await rowWith("他人の投稿1");
    expect(within(row).queryByRole("button", { name: /付けた人/ })).toBeNull();
    expect(within(row).queryAllByRole("button", { pressed: false })).toEqual(
      [],
    );
  });
});

describe("#138 AC-1（1-7 AC-1・AC-2）ピッカーで付ける", () => {
  it("#138 AC-1（1-7 AC-1）: 「リアクションを付ける」でピッカーが開き（aria-expanded=true）、絵文字を選ぶと POST し、チップ（件数1・aria-pressed=true）が出て、ピッカーが閉じてフォーカスがボタンに戻る", async () => {
    respondMessages([theirs(1)]);
    const api = respondReactions();
    const { user } = renderRoom();
    const row = await rowWith("他人の投稿1");
    const button = addButton(row) as HTMLElement;
    await user.click(button);
    expect(picker()).not.toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const cell = within(picker() as HTMLElement)
      .getAllByRole("button")
      .find((b) => b.textContent === "👍") as HTMLElement;
    await user.click(cell);
    await waitFor(() =>
      expect(
        within(row).getByRole("button", { pressed: true }).textContent,
      ).toContain("👍"),
    );
    expect(api.posts).toEqual([
      { messageId: theirs(1).id, kind: "emoji", value: "👍" },
    ]);
    const chip = within(row).getByRole("button", { pressed: true });
    expect(chip.textContent).toContain("1");
    expect(picker()).toBeNull();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);
  });

  it("#138 AC-1（1-7 AC-2）: 「了解」のスタンプ（スタンプのタブ）を選ぶと、stamp・ok を POST し、チップに「了解」と件数が出る", async () => {
    respondMessages([theirs(1)]);
    const api = respondReactions();
    const { user } = renderRoom();
    const row = await rowWith("他人の投稿1");
    await user.click(addButton(row) as HTMLElement);
    await user.click(
      within(picker() as HTMLElement).getByRole("tab", { name: "スタンプ" }),
    );
    await user.click(
      within(picker() as HTMLElement).getByRole("button", { name: "了解" }),
    );
    await waitFor(() =>
      expect(
        within(row).getByRole("button", { pressed: true }).textContent,
      ).toContain("了解"),
    );
    expect(api.posts).toEqual([
      { messageId: theirs(1).id, kind: "stamp", value: "ok" },
    ]);
  });

  it("#138 AC-1: ピッカーで、すでに自分が付けている種類を選ぶと、取り消し（DELETE）になる", async () => {
    respondMessages([
      theirs(1, {
        reactions: [
          reaction("emoji", "👍", { mine: true, others: [reactor(1)] }),
        ],
      }),
    ]);
    const api = respondReactions({
      [theirs(1).id]: [
        reaction("emoji", "👍", { mine: true, others: [reactor(1)] }),
      ],
    });
    const { user } = renderRoom();
    const row = await rowWith("他人の投稿1");
    await user.click(addButton(row) as HTMLElement);
    const cell = within(picker() as HTMLElement)
      .getAllByRole("button")
      .find((b) => b.textContent === "👍") as HTMLElement;
    expect(cell.getAttribute("aria-pressed")).toBe("true");
    await user.click(cell);
    await waitFor(() => expect(api.deletes).toHaveLength(1));
    expect(api.posts).toEqual([]);
    await waitFor(() =>
      expect(
        within(row).getByRole("button", { pressed: false }).textContent,
      ).toContain("1"),
    );
  });

  it("#138 AC-1: Esc で閉じ、フォーカスを開いたボタンに戻す。何も送らない", async () => {
    respondMessages([theirs(1)]);
    const api = respondReactions();
    const { user } = renderRoom();
    const button = addButton(await rowWith("他人の投稿1")) as HTMLElement;
    await user.click(button);
    await user.keyboard("{Escape}");
    expect(picker()).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(api.posts).toEqual([]);
  });

  it("#138 AC-1: 枠の外のクリックで閉じる（何も送らない）", async () => {
    respondMessages([theirs(1)]);
    const api = respondReactions();
    const { user } = renderRoom();
    const row = await rowWith("他人の投稿1");
    await user.click(addButton(row) as HTMLElement);
    expect(picker()).not.toBeNull();
    await user.click(within(row).getByText("[E2E_TEST]他人の投稿1"));
    expect(picker()).toBeNull();
    expect(api.posts).toEqual([]);
  });
});

describe("#138 AC-1 開くのは同時に1つ", () => {
  it("#138 AC-1: 別の投稿のボタンを押すと、先に開いていたピッカーは閉じ、開いているのは1つだけ", async () => {
    respondMessages([theirs(1), theirs(2)]);
    const { user } = renderRoom();
    const first = addButton(await rowWith("他人の投稿1")) as HTMLElement;
    const second = addButton(await rowWith("他人の投稿2")) as HTMLElement;
    await user.click(first);
    await user.click(second);
    expect(
      screen.getAllByRole("dialog", { name: "リアクションを選ぶ" }),
    ).toHaveLength(1);
    expect(first.getAttribute("aria-expanded")).toBe("false");
    expect(second.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("#138 AC-1（1-7 AC-3・AC-4）チップで付け外し・二度押し・別のタブ", () => {
  it("#138 AC-1（1-7 AC-3）: 付いているチップ（自分は付けていない）を押すと POST し、件数が2になり aria-pressed=true になる", async () => {
    respondMessages([
      theirs(1, {
        reactions: [reaction("emoji", "👍", { others: [reactor(1)] })],
      }),
    ]);
    const api = respondReactions({
      [theirs(1).id]: [reaction("emoji", "👍", { others: [reactor(1)] })],
    });
    const { user } = renderRoom();
    const row = await rowWith("他人の投稿1");
    await user.click(within(row).getByRole("button", { pressed: false }));
    await waitFor(() =>
      expect(
        within(row).getByRole("button", { pressed: true }).textContent,
      ).toContain("2"),
    );
    expect(api.posts).toHaveLength(1);
  });

  it("#138 AC-1（1-7 AC-3）: 自分が付けているチップを押すと DELETE で取り消し、件数が減る（最後の1人ならチップが消える）", async () => {
    const mineOnly = reaction("emoji", "👍", { mine: true });
    respondMessages([theirs(1, { reactions: [mineOnly] })]);
    const api = respondReactions({ [theirs(1).id]: [mineOnly] });
    const { user } = renderRoom();
    const row = await rowWith("他人の投稿1");
    await user.click(within(row).getByRole("button", { pressed: true }));
    await waitFor(() =>
      expect(within(row).queryByRole("button", { pressed: true })).toBeNull(),
    );
    expect(api.deletes).toEqual([
      { messageId: theirs(1).id, kind: "emoji", value: "👍" },
    ]);
    expect(within(row).queryByRole("button", { pressed: false })).toBeNull();
  });

  it("#138 AC-1（二度押しの防止）: 送信中の連打は、要求を1回だけ送る。送信中のチップは aria-disabled=true", async () => {
    const existing = reaction("emoji", "👍", { others: [reactor(1)] });
    respondMessages([theirs(1, { reactions: [existing] })]);
    let release = () => {};
    const api = respondReactions({ [theirs(1).id]: [existing] });
    api.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { user } = renderRoom();
    const row = await rowWith("他人の投稿1");
    const chip = within(row).getByRole("button", { pressed: false });
    await user.click(chip);
    await waitFor(() =>
      expect(chip.getAttribute("aria-disabled")).toBe("true"),
    );
    await user.click(chip);
    await user.click(chip);
    release();
    await waitFor(() =>
      expect(within(row).getByRole("button", { pressed: true })).toBeTruthy(),
    );
    expect(api.posts).toHaveLength(1);
  });

  it("#138 AC-1（U-12）: 別のタブですでに付けた後（画面の表示は古い）にチップを押しても、サーバーの最新の集計の表示になる（件数が増えすぎない）", async () => {
    // 画面の一覧は「自分は付けていない・1人」。サーバーでは別のタブですでに自分が付けた（2人）
    respondMessages([
      theirs(1, {
        reactions: [reaction("emoji", "👍", { others: [reactor(1)] })],
      }),
    ]);
    respondReactions({
      [theirs(1).id]: [
        reaction("emoji", "👍", { others: [reactor(1)], mine: true }),
      ],
    });
    const { user } = renderRoom();
    const row = await rowWith("他人の投稿1");
    await user.click(within(row).getByRole("button", { pressed: false }));
    await waitFor(() =>
      expect(
        within(row).getByRole("button", { pressed: true }).textContent,
      ).toContain("2"),
    );
    expect(
      within(row).queryByRole("button", { pressed: true })?.textContent,
    ).not.toContain("3");
  });

  it("#138 AC-1（U-12）: 別のタブですでに外した後（画面の表示は古い）に取り消しても、サーバーの最新の集計（0件）になる", async () => {
    const stale = reaction("emoji", "👍", { mine: true });
    respondMessages([theirs(1, { reactions: [stale] })]);
    respondReactions({ [theirs(1).id]: [] });
    const { user } = renderRoom();
    const row = await rowWith("他人の投稿1");
    await user.click(within(row).getByRole("button", { pressed: true }));
    await waitFor(() =>
      expect(within(row).queryByRole("button", { pressed: true })).toBeNull(),
    );
  });
});

describe("#138 AC-1（1-7 AC-4）上限・拒否", () => {
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

  it("#138 AC-1（1-7 AC-4）: 20種類に達した投稿のピッカーでは、新しい種類を選べず、理由が出る（送らない）", async () => {
    respondMessages([theirs(1, { reactions: TWENTY })]);
    const api = respondReactions();
    const { user } = renderRoom();
    const row = await rowWith("他人の投稿1");
    await user.click(addButton(row) as HTMLElement);
    await user.click(
      within(picker() as HTMLElement).getByRole("tab", { name: "スタンプ" }),
    );
    await user.click(
      within(picker() as HTMLElement).getByRole("button", { name: "了解" }),
    );
    expect(api.posts).toEqual([]);
    expect(
      within(picker() as HTMLElement).getByRole("status").textContent,
    ).toContain("リアクションは20種類までです");
  });

  it("#138 AC-1（U-12）: 拒否（409）は、role=alert にサーバーの文を出し、表示は変えず、取り直しの要求（一覧の GET）を増やさない", async () => {
    const existing = reaction("emoji", "👍", { others: [reactor(1)] });
    const server = respondMessages([theirs(1, { reactions: [existing] })]);
    const api = respondReactions({ [theirs(1).id]: [existing] });
    api.failNext = {
      status: 409,
      code: "CONFLICT",
      message: "このメッセージはすでに削除されています",
    };
    const { user } = renderRoom();
    const row = await rowWith("他人の投稿1");
    const before = server.requests.length;
    await user.click(within(row).getByRole("button", { pressed: false }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "このメッセージはすでに削除されています",
    );
    expect(
      within(row).getByRole("button", { pressed: false }).textContent,
    ).toContain("1");
    expect(server.requests.length).toBe(before);
  });

  it.each([
    [403, "FORBIDDEN", "このチャンネルには参加していません"],
    [404, "NOT_FOUND", "チャンネルが見つかりません"],
  ])(
    "#138 AC-1（U-8）: %i の拒否も、サーバーの文を role=alert に出し、取り直さない",
    async (status, code, text) => {
      const server = respondMessages([theirs(1)]);
      const api = respondReactions();
      api.failNext = { status, code, message: text };
      const { user } = renderRoom();
      const row = await rowWith("他人の投稿1");
      const before = server.requests.length;
      await user.click(addButton(row) as HTMLElement);
      await user.click(
        within(picker() as HTMLElement)
          .getAllByRole("button")
          .find((b) => b.textContent === "👍") as HTMLElement,
      );
      expect((await screen.findByRole("alert")).textContent).toContain(text);
      expect(server.requests.length).toBe(before);
    },
  );
});

describe("#138 AC-1（1-7 AC-3・U-5・U-6）付けた人の表示", () => {
  const withRetired = reaction("emoji", "👍", {
    others: [reactor(1), reactor(2, false)],
  });

  it("#138 AC-1（U-5・U-6）: チップの読み上げの名前と title に、付けた人と「（退職者）」が出る", async () => {
    respondMessages([theirs(1, { reactions: [withRetired] })]);
    renderRoom();
    const row = await rowWith("他人の投稿1");
    const chip = within(row).getByRole("button", { pressed: false });
    expect(chip.getAttribute("aria-label")).toContain("テストリアクション1");
    expect(chip.getAttribute("aria-label")).toContain(
      "テストリアクション2（退職者）",
    );
    expect(chip.getAttribute("title")).toBe(chip.getAttribute("aria-label"));
  });

  it("#138 AC-1（U-5）: 「付けた人」ボタンで一覧（ダイアログ）が開き、名前と「（退職者）」が出る。閉じるとフォーカスがボタンに戻る", async () => {
    respondMessages([theirs(1, { reactions: [withRetired] })]);
    const { user } = renderRoom();
    const row = await rowWith("他人の投稿1");
    const button = within(row).getByRole("button", { name: /^付けた人/ });
    await user.click(button);
    const dialog = screen.getByRole("dialog", { name: "付けた人" });
    expect(
      within(dialog).getByText(/テストリアクション2（退職者）/),
    ).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "閉じる" }));
    expect(screen.queryByRole("dialog", { name: "付けた人" })).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("#138 AC-1（U-8）: 書き込めない部屋でも「付けた人」は開ける（読み取り専用の表示）", async () => {
    respondMessages([theirs(1, { reactions: [withRetired] })]);
    const { user } = renderRoom({ canModifyOwn: false });
    const row = await rowWith("他人の投稿1");
    await user.click(within(row).getByRole("button", { name: /^付けた人/ }));
    expect(screen.getByRole("dialog", { name: "付けた人" })).toBeTruthy();
  });
});
