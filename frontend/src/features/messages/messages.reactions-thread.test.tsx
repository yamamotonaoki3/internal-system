// #138 AC-2（1-4 AC-6）・AC-1（1-7 AC-5）: スレッド（S-07。ThreadReplies）でのリアクション。API は MSW。データは架空。
// 契約（計画「状態と反映」の「書き込めるか（canReact）」・指摘5・指摘6）：
//   canReact は、ThreadReplies が既に持つ data.joined && data.roomWritable から求め（replyBlockedReason から求めない）、親と返信に渡す。投稿者は問わない（他人の返信にも出る）。
//   削除済みの投稿（親・返信）には、操作もチップも出さない。親が削除済みでも、部屋に書き込めるなら、未削除の返信には出す。
//   返信へのリアクションは POST /api/messages/:返信のID/reactions。応答の集計で、その返信（親なら親）だけが書き換わる。
//   ボタン・チップ・ピッカーの形は messages.reactions.test.tsx の契約と同じ。
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
import { ThreadReplies } from "./index";

const thumbs = reaction("emoji", "👍", { others: [reactor(1)] });

type World = {
  joined?: boolean;
  roomWritable?: boolean;
  parentDeleted?: boolean;
  replyBlockedReason?: string | null;
  replyDeleted?: boolean;
};

function build(world: World = {}) {
  const parent = world.parentDeleted
    ? message(1, {
        body: null,
        deleted: true,
        replyCount: 2,
        author: OTHER_AUTHOR,
      })
    : message(1, {
        body: "[E2E_TEST]スレッドの親",
        replyCount: 2,
        author: OTHER_AUTHOR,
        reactions: [thumbs],
      });
  const first = reply(parent, 1, {
    body: "[E2E_TEST]他人の返信",
    author: OTHER_AUTHOR,
    reactions: [thumbs],
  });
  const second = world.replyDeleted
    ? reply(parent, 2, { body: null, deleted: true })
    : reply(parent, 2, { body: "[E2E_TEST]自分の返信" });
  respondSelf();
  const server = respondReplies({
    parent,
    replies: [first, second],
    joined: world.joined ?? true,
    roomWritable: world.roomWritable ?? true,
    replyBlockedReason:
      world.replyBlockedReason ??
      (world.parentDeleted ? "deleted_parent" : null),
  });
  const api = respondReactions({
    [parent.id]: [thumbs],
    [first.id]: [thumbs],
  });
  const view = renderInApp(<ThreadReplies parentMessageId={parent.id} />);
  return { ...view, server, api, parent, first, second };
}

const addButtons = () =>
  screen.queryAllByRole("button", { name: /^リアクションを付ける/ });
async function rowWith(text: string): Promise<HTMLElement> {
  return waitFor(() => {
    const row = screen
      .getAllByRole("listitem")
      .filter((li) => li.parentElement?.closest("li") === null)
      .find((li) => (li.textContent ?? "").includes(text));
    if (row === undefined) throw new Error(`「${text}」の行がありません`);
    return row;
  });
}

describe("#138 AC-2（1-4 AC-6）S-07：書き込めるとき（joined かつ roomWritable）", () => {
  it("#138 AC-2: 親と、他人の返信・自分の返信のどれにも「リアクションを付ける」が出る", async () => {
    build();
    await rowWith("スレッドの親");
    expect(addButtons()).toHaveLength(3);
  });

  it("#138 AC-2（1-4 AC-6）: 他人の返信に付けると、その返信のリアクションとして POST し、その返信のチップだけが更新される（親は変わらない）", async () => {
    const { user, api, first } = build();
    const row = await rowWith("他人の返信");
    const parentRow = await rowWith("スレッドの親");
    const parentChipBefore = within(parentRow).getByRole("button", {
      pressed: false,
    }).textContent;
    await user.click(within(row).getByRole("button", { pressed: false }));
    await waitFor(() =>
      expect(
        within(row).getByRole("button", { pressed: true }).textContent,
      ).toContain("2"),
    );
    expect(api.posts).toEqual([
      { messageId: first.id, kind: "emoji", value: "👍" },
    ]);
    expect(
      within(parentRow).getByRole("button", { pressed: false }).textContent,
    ).toBe(parentChipBefore);
  });

  it("#138 AC-2: 自分の返信にも、ピッカーから付けられる", async () => {
    const { user, api, second } = build();
    const row = await rowWith("自分の返信");
    await user.click(
      within(row).getByRole("button", { name: /^リアクションを付ける/ }),
    );
    const picker = screen.getByRole("dialog", { name: "リアクションを選ぶ" });
    await user.click(
      within(picker)
        .getAllByRole("button")
        .find((b) => b.textContent === "👍") as HTMLElement,
    );
    await waitFor(() =>
      expect(within(row).getByRole("button", { pressed: true })).toBeTruthy(),
    );
    expect(api.posts).toEqual([
      { messageId: second.id, kind: "emoji", value: "👍" },
    ]);
  });

  it("#138 AC-2（親）: 親の投稿のチップを押すと親の ID で POST し、親のチップが更新される", async () => {
    const { user, api, parent } = build();
    const row = await rowWith("スレッドの親");
    await user.click(within(row).getByRole("button", { pressed: false }));
    await waitFor(() =>
      expect(
        within(row).getByRole("button", { pressed: true }).textContent,
      ).toContain("2"),
    );
    expect(api.posts).toEqual([
      { messageId: parent.id, kind: "emoji", value: "👍" },
    ]);
  });

  it("#138 AC-2: 返信のリアクションの拒否（409）は、文言を role=alert に出し、取り直さない", async () => {
    const { user, api, server } = build();
    api.failNext = {
      status: 409,
      code: "CONFLICT",
      message: "リアクションは20種類までです",
    };
    const row = await rowWith("他人の返信");
    const before = server.requests.length;
    await user.click(within(row).getByRole("button", { pressed: false }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "リアクションは20種類までです",
    );
    expect(server.requests.length).toBe(before);
  });
});

describe("#138 AC-2（指摘5）S-07：書き込めない部屋では出ない（親が削除済み × 部屋の状態）", () => {
  it.each([
    [
      "参加していない（公開チャンネルを読んでいるだけ）",
      { joined: false, replyBlockedReason: "not_joined" },
    ],
    [
      "読み取り専用（部署が無効）",
      { roomWritable: false, replyBlockedReason: "read_only" },
    ],
    [
      "DM の相手が無効",
      { roomWritable: false, replyBlockedReason: "partner_inactive" },
    ],
  ] as const)(
    "#138 AC-2: %s のとき、親にも返信にも「リアクションを付ける」を出さない。付いているチップは押せない（aria-disabled）",
    async (_label, world) => {
      const { user, api } = build(world);
      const row = await rowWith("他人の返信");
      expect(addButtons()).toHaveLength(0);
      const chip = within(row).getByRole("button", { pressed: false });
      expect(chip.getAttribute("aria-disabled")).toBe("true");
      await user.click(chip);
      expect(api.posts).toEqual([]);
    },
  );

  it("#138 AC-2（C-59）: 親が削除済みで、部屋に書き込めるとき：削除済みの親には出さず、未削除の返信には出す", async () => {
    build({ parentDeleted: true });
    const row = await rowWith("他人の返信");
    await waitFor(() => expect(addButtons().length).toBeGreaterThan(0));
    const parentRow = await rowWith("このメッセージは削除されました");
    expect(
      within(parentRow).queryByRole("button", {
        name: /^リアクションを付ける/,
      }),
    ).toBeNull();
    expect(
      within(row).queryByRole("button", { name: /^リアクションを付ける/ }),
    ).not.toBeNull();
    expect(addButtons()).toHaveLength(2);
  });

  it("#138 AC-2: 親が削除済みで、読み取り専用の部屋では、どこにも出さない", async () => {
    build({
      parentDeleted: true,
      roomWritable: false,
      replyBlockedReason: "deleted_parent",
    });
    const row = await rowWith("他人の返信");
    expect(addButtons()).toHaveLength(0);
    expect(
      within(row)
        .getByRole("button", { pressed: false })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("#138 AC-2: 親が削除済みで、参加していないときも、どこにも出さない", async () => {
    build({
      parentDeleted: true,
      joined: false,
      replyBlockedReason: "deleted_parent",
    });
    const row = await rowWith("他人の返信");
    expect(addButtons()).toHaveLength(0);
    expect(
      within(row)
        .getByRole("button", { pressed: false })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("#138 AC-2（U-7）: 削除済みの返信には出さない（親・ほかの返信には出る）", async () => {
    build({ replyDeleted: true });
    await rowWith("他人の返信");
    await waitFor(() => expect(addButtons()).toHaveLength(2));
    const deletedRow = await rowWith("このメッセージは削除されました");
    expect(
      within(deletedRow).queryByRole("button", {
        name: /^リアクションを付ける/,
      }),
    ).toBeNull();
  });

  it("#138 AC-2: 返信できない理由（replyBlockedReason）が部屋の理由でなく deleted_parent だけなら、書き込める部屋として出す（理由から求めない）", async () => {
    // joined・roomWritable がどちらも真なので、replyBlockedReason に別の値があっても出る
    build({ replyBlockedReason: "deleted_parent" });
    await rowWith("他人の返信");
    await waitFor(() => expect(addButtons()).toHaveLength(3));
  });
});
