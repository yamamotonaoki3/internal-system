// #138 コードレビュー1回目（軽微）: 同じ親の投稿が、部屋の一覧（RoomMessages）とスレッド（ThreadReplies）の両方に出ているとき、
// 送信中の状態は同じ投稿の両方の表示で共有され、応答の順が入れ替わっても、両方の表示は最後にサーバーの最新の集計になる。
// 契約（観測できる振る舞い）：
//   - 一方の表示でその投稿のリアクションを押して送信中のあいだ、もう一方の表示の同じ投稿のチップも aria-disabled="true"（押しても送らない）。
//     別の投稿のチップは影響を受けない。
//   - 送信が終わると、両方の表示のチップが、サーバーの最新の集計（件数・aria-pressed）になる。
//   - 同じ投稿への要求は、1つ目の応答が届くまで、2つ目が送られない（送信中に別の種類を押しても、送られるのは1つ目だけ）。
// API は MSW（応答を、テストが release するまで返さない模擬）。データは架空。
import { screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  OTHER_AUTHOR,
  message,
  reply,
  respondMessages,
  respondReplies,
} from "../../test/message-handlers";
import {
  reaction,
  reactor,
  respondReactionsHeld,
} from "../../test/reaction-handlers";
import { renderInApp, respondSelf } from "../../test/thread-harness";
import { RoomMessages, ThreadReplies } from "./index";

const THUMBS = reaction("emoji", "👍", { others: [reactor(1)] });
const CLAP = reaction("emoji", "👏", { others: [reactor(2)] });
const PARENT = message(1, {
  body: "[E2E_TEST]共有する親",
  author: OTHER_AUTHOR,
  replyCount: 1,
  reactions: [THUMBS, CLAP],
});
const OTHER = message(2, {
  body: "[E2E_TEST]別の投稿",
  author: OTHER_AUTHOR,
  reactions: [THUMBS],
});
const REPLY = reply(PARENT, 1, {
  body: "[E2E_TEST]スレッドの返信",
  author: OTHER_AUTHOR,
});

function render() {
  respondSelf();
  respondMessages([PARENT, OTHER]);
  respondReplies({ parent: PARENT, replies: [REPLY] });
  const api = respondReactionsHeld({
    [PARENT.id]: [THUMBS, CLAP],
    [OTHER.id]: [THUMBS],
  });
  const view = renderInApp(
    <>
      <RoomMessages roomId={PARENT.roomId} canPost joined canModifyOwn />
      <ThreadReplies parentMessageId={PARENT.id} />
    </>,
  );
  return { ...view, api };
}

/** 部屋の一覧の中の行 */
async function roomRow(text: string): Promise<HTMLElement> {
  const log = await screen.findByRole("log", { name: "メッセージ一覧" });
  return waitFor(() => {
    const row = within(log)
      .getAllByRole("listitem")
      .find((li) => (li.textContent ?? "").includes(text));
    if (row === undefined) throw new Error(`部屋の「${text}」の行がありません`);
    return row;
  });
}
/** スレッドの枠の親の行（部屋の一覧の外） */
async function threadParentRow(): Promise<HTMLElement> {
  const log = await screen.findByRole("log", { name: "メッセージ一覧" });
  return waitFor(() => {
    const row = screen
      .getAllByRole("listitem")
      .find(
        (li) =>
          (li.textContent ?? "").includes("[E2E_TEST]共有する親") &&
          !log.contains(li),
      );
    if (row === undefined) throw new Error("スレッドの親の行がありません");
    return row;
  });
}
const chipsOf = (row: HTMLElement) =>
  within(row).getAllByRole("button", { pressed: false });
const chipWith = (row: HTMLElement, text: string) =>
  within(row)
    .getAllByRole("button")
    .find(
      (b) =>
        b.hasAttribute("aria-pressed") && (b.textContent ?? "").includes(text),
    ) as HTMLElement;

describe("#138 コードレビュー1回目（軽微）同じ投稿の表示どうしで共有される", () => {
  it("#138 AC-1: 一方で押して送信中のあいだ、もう一方の同じ投稿のチップも aria-disabled=true。別の投稿のチップは押せる", async () => {
    const { user, api } = render();
    const inRoom = await roomRow("共有する親");
    const inThread = await threadParentRow();
    const other = await roomRow("別の投稿");
    await user.click(chipWith(inRoom, "👍"));
    await waitFor(() => expect(api.requests).toHaveLength(1));
    await waitFor(() => {
      for (const chip of chipsOf(inThread))
        expect(chip.getAttribute("aria-disabled")).toBe("true");
    });
    expect(chipWith(other, "👍").getAttribute("aria-disabled")).not.toBe(
      "true",
    );
    // 送信中に、もう一方の表示で別の種類を押しても、要求は増えない（1つ目の応答が届くまで送られない）
    await user.click(chipWith(inThread, "👏"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(api.requests).toHaveLength(1);
    api.requests[0]?.release();
    await waitFor(() =>
      expect(chipWith(inThread, "👍").getAttribute("aria-disabled")).not.toBe(
        "true",
      ),
    );
  });

  it("#138 AC-1: 部屋側とスレッド側で別の種類を続けて押し、応答を後から返した方から先に届けても、両方の表示の最後はサーバーの最新の集計（件数・aria-pressed）になる", async () => {
    const { user, api } = render();
    const inRoom = await roomRow("共有する親");
    const inThread = await threadParentRow();
    await user.click(chipWith(inRoom, "👍"));
    await waitFor(() => expect(api.requests).toHaveLength(1));
    await user.click(chipWith(inThread, "👏"));
    for (let round = 0; round < 10; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const waiting = api.requests.filter((r) => !r.released);
      if (waiting.length === 0) break;
      waiting.at(-1)?.release();
    }
    const latest = api.reactions.get(PARENT.id) ?? [];
    await waitFor(() => {
      for (const row of [inRoom, inThread])
        for (const entry of latest) {
          const chip = chipWith(row, entry.value);
          expect(chip.getAttribute("aria-pressed")).toBe(
            String(entry.reactedByMe),
          );
          expect(chip.textContent).toContain(String(entry.count));
        }
    });
    // 押した種類は、少なくとも最初の1つ（👍）が、両方の表示で押した状態になっている
    expect(chipWith(inRoom, "👍").getAttribute("aria-pressed")).toBe("true");
    expect(chipWith(inThread, "👍").getAttribute("aria-pressed")).toBe("true");
  });
});
