// #137 AC-1（1-4 AC-1・AC-3）: 部屋のメッセージ（RoomMessages）の「返信 n 件」のボタンと、S-07（ThreadPane）の開閉・件数の反映。API は MSW。データは架空。
// 契約（実装前の仮置き。計画 plan-137 の「9. 画面」と改訂1の軽微3。実装者へ）：
//   RoomMessages は任意の props onOpenThread?: (parentMessageId: string) => void を受け取る。渡されたときだけ、各メッセージにスレッドのボタンを出す。
//     返信があるとき（replyCount が1以上）：見える文字は「返信 n 件」。読み上げの名前は「返信 n 件」で始まり、投稿者の表示名を含む（例「返信 2 件（テスト太郎の投稿）」）。
//     返信がないとき：見える文字は「返信」。読み上げの名前に投稿者の表示名と「返信」を含む（例「テスト太郎の投稿に返信する」）。
//     削除済みのメッセージは、返信が1件以上あるときだけボタンを出す（既存の返信を見られる）。返信がない削除済みには出さない。
//     ボタンを押すと onOpenThread(そのメッセージの ID) を呼ぶ。部屋の一覧に出るのは親だけ（返信は出ない）。
//   features/threads は useThreadParam を公開する：{ parentMessageId: string | null; open(id: string): void; close(): void }。
//     open は URL のクエリ ?thread=<ID> を付け（ほかのクエリは残す）、close は thread だけを外す。ThreadPane の閉じるボタンも close を使う。
//   スレッドを閉じたら、フォーカスは開いた「返信 n 件」のボタンへ戻る。
//   返信の投稿が成功したら、部屋の一覧のキャッシュの親の replyCount を setQueryData で 1 増やす（再読み込みなしで「返信 n+1 件」。他人の返信では増えない）。
//     実行中の2秒ごとの取得で巻き戻らない。
import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OTHER_AUTHOR,
  message,
  reply,
  respondMessages,
  respondReplies,
} from "../../test/message-handlers";
import { respondThreadReadOnly } from "../../test/thread-handlers";
import { renderInApp, respondSelf } from "../../test/thread-harness";
import { RoomMessages } from "../messages";
import { ThreadPane, useThreadParam } from "./index";

const ROOM = message(1).roomId;
const P1 = message(1, { body: "[E2E_TEST]返信が2件ある親", replyCount: 2 });
const P2 = message(2, { body: "[E2E_TEST]返信がない親", replyCount: 0 });
const P3 = message(3, { body: null, deleted: true, replyCount: 1 });
const P4 = message(4, { body: null, deleted: true, replyCount: 0 });
const replies1 = [
  reply(P1, 1, { author: OTHER_AUTHOR }),
  reply(P1, 2, { author: OTHER_AUTHOR }),
];

function RoomWithThread() {
  const thread = useThreadParam();
  return (
    <>
      <RoomMessages
        roomId={ROOM}
        canPost
        joined
        canModifyOwn
        onOpenThread={thread.open}
      />
      {thread.parentMessageId !== null && (
        <ThreadPane parentMessageId={thread.parentMessageId} />
      )}
    </>
  );
}

const log = () => screen.getByRole("log", { name: "メッセージ一覧" });
const rowWith = (text: string) => {
  const row = within(log())
    .getAllByRole("listitem")
    .find((li) => (li.textContent ?? "").includes(text));
  if (row === undefined) throw new Error(`「${text}」の行がありません`);
  return row;
};
const pane = () => screen.getByRole("region", { name: "スレッド" });
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  respondSelf();
  respondThreadReadOnly();
});

describe("#137 AC-1（1-4 AC-1）「返信 n 件」のボタン", () => {
  it("#137 AC-1: 返信があるメッセージには「返信 n 件」のボタンを出し、読み上げの名前に件数と投稿者を含める", async () => {
    respondMessages([P1]);
    renderInApp(<RoomWithThread />);
    await screen.findByText("[E2E_TEST]返信が2件ある親");
    const button = within(rowWith("返信が2件ある親")).getByRole("button", {
      name: /^返信 2 件.*テスト太郎/,
    });
    expect(button.textContent).toContain("返信 2 件");
  });

  it("#137 AC-1: 返信がないメッセージには、投稿者を名前に含む「返信」のボタンを出す（スレッドを始める入口）", async () => {
    respondMessages([P2]);
    renderInApp(<RoomWithThread />);
    await screen.findByText("[E2E_TEST]返信がない親");
    const button = within(rowWith("返信がない親")).getByRole("button", {
      name: /テスト太郎.*返信/,
    });
    expect(button.textContent?.trim()).toBe("返信");
  });

  it("#137 AC-1（1-4 AC-2）: 削除済みのメッセージは、返信が1件以上あるときだけボタンを出す", async () => {
    respondMessages([P3, P4]);
    renderInApp(<RoomWithThread />);
    await waitFor(() =>
      expect(
        screen.getAllByText("このメッセージは削除されました"),
      ).toHaveLength(2),
    );
    const [withReplies, withoutReplies] =
      within(log()).getAllByRole("listitem");
    expect(
      within(withReplies as HTMLElement).getByRole("button", {
        name: /^返信 1 件/,
      }),
    ).toBeDefined();
    expect(
      within(withoutReplies as HTMLElement).queryByRole("button", {
        name: /返信/,
      }),
    ).toBeNull();
  });

  it("#137 AC-1: onOpenThread を渡さない部屋では、ボタンを出さない（既存の使い方を変えない）", async () => {
    respondMessages([P1]);
    renderInApp(<RoomMessages roomId={ROOM} canPost joined />);
    await screen.findByText("[E2E_TEST]返信が2件ある親");
    expect(screen.queryByRole("button", { name: /返信/ })).toBeNull();
  });
});

describe("#137 AC-1（1-4 AC-3）S-07 を開く・閉じる", () => {
  it("#137 AC-1: 「返信 n 件」を押すと URL に ?thread=<親ID> が付き、S-07 が開いて見出しにフォーカスが移る", async () => {
    respondMessages([P1]);
    respondReplies({ parent: P1, replies: replies1 });
    const { user } = renderInApp(<RoomWithThread />, {
      path: "/channels/room",
    });
    await screen.findByText("[E2E_TEST]返信が2件ある親");
    expect(screen.queryByRole("region", { name: "スレッド" })).toBeNull();
    await user.click(
      within(rowWith("返信が2件ある親")).getByRole("button", {
        name: /^返信 2 件/,
      }),
    );
    expect(screen.getByTestId("url").textContent).toBe(
      `/channels/room?thread=${P1.id}`,
    );
    await within(pane()).findByRole("log", { name: "返信一覧" });
    expect(document.activeElement).toBe(
      within(pane()).getByRole("heading", { name: "スレッド" }),
    );
  });

  it("#137 AC-1: 閉じると URL から thread が外れ、S-07 が消え、フォーカスは開いた「返信 n 件」のボタンへ戻る", async () => {
    respondMessages([P1]);
    respondReplies({ parent: P1, replies: replies1 });
    const { user } = renderInApp(<RoomWithThread />, {
      path: "/channels/room",
    });
    await screen.findByText("[E2E_TEST]返信が2件ある親");
    const opener = within(rowWith("返信が2件ある親")).getByRole("button", {
      name: /^返信 2 件/,
    });
    await user.click(opener);
    await within(pane()).findByRole("log", { name: "返信一覧" });
    await user.click(
      within(pane()).getByRole("button", { name: "スレッドを閉じる" }),
    );
    expect(screen.getByTestId("url").textContent).toBe("/channels/room");
    expect(screen.queryByRole("region", { name: "スレッド" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("#137 AC-1: URL に ?thread=<親ID> がある状態で部屋を開くと、最初から S-07 が開く", async () => {
    respondMessages([P1]);
    respondReplies({ parent: P1, replies: replies1 });
    renderInApp(<RoomWithThread />, { path: `/channels/room?thread=${P1.id}` });
    await within(
      await screen.findByRole("region", { name: "スレッド" }),
    ).findByRole("log", { name: "返信一覧" });
  });

  it("#137 AC-1: 別のメッセージの「返信」を押すと、S-07 はそのスレッドに替わる", async () => {
    respondMessages([P1, P2]);
    respondReplies({ parent: P1, replies: replies1 });
    respondReplies({ parent: P2, replies: [] });
    const { user } = renderInApp(<RoomWithThread />, {
      path: "/channels/room",
    });
    await screen.findByText("[E2E_TEST]返信が2件ある親");
    await user.click(
      within(rowWith("返信が2件ある親")).getByRole("button", {
        name: /^返信 2 件/,
      }),
    );
    await within(pane()).findByRole("log", { name: "返信一覧" });
    await user.click(
      within(rowWith("返信がない親")).getByRole("button", { name: /返信/ }),
    );
    await screen.findByText("まだ返信はありません");
    expect(screen.getByTestId("url").textContent).toBe(
      `/channels/room?thread=${P2.id}`,
    );
  });
});

describe("#137 AC-1（1-4 AC-3）自分の返信の後の replyCount（改訂1の軽微3）", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("#137 AC-1: 部屋に既存のキャッシュがあり、新しい通常の投稿がなくても、自分の返信の後に親の件数が増え、2秒ごとの取得で巻き戻らない", async () => {
    const room = respondMessages([P1]);
    respondReplies({ parent: P1, replies: replies1 });
    const { user } = renderInApp(<RoomWithThread />, {
      path: `/channels/room?thread=${P1.id}`,
      fakeTimers: true,
    });
    await within(
      await screen.findByRole("region", { name: "スレッド" }),
    ).findByRole("log", { name: "返信一覧" });
    expect(
      within(rowWith("返信が2件ある親")).getByRole("button", {
        name: /^返信 2 件/,
      }),
    ).toBeDefined();
    await user.type(
      within(pane()).getByRole("textbox", { name: "返信" }),
      "[[E2E_TEST]自分の返信",
    );
    await user.click(within(pane()).getByRole("button", { name: "送信" }));
    await waitFor(() =>
      expect(
        within(rowWith("返信が2件ある親")).getByRole("button", {
          name: /^返信 3 件/,
        }),
      ).toBeDefined(),
    );
    // 実行中の2秒ごとの取得（親は再取得されない）で巻き戻らず、通常の投稿が増えても 3 件のまま
    room.messages.push(message(9, { body: "[E2E_TEST]別の人の通常の投稿" }));
    await advance(2500);
    await screen.findByText("[E2E_TEST]別の人の通常の投稿");
    await advance(2500);
    expect(
      within(rowWith("返信が2件ある親")).getByRole("button", {
        name: /^返信 3 件/,
      }),
    ).toBeDefined();
  });

  it("#137 AC-1: 返信できなかった（失敗した）ときは、件数を増やさない", async () => {
    respondMessages([P1]);
    const state = respondReplies({ parent: P1, replies: replies1 });
    state.failNextPost = { status: 500, code: "INTERNAL" };
    const { user } = renderInApp(<RoomWithThread />, {
      path: `/channels/room?thread=${P1.id}`,
      fakeTimers: true,
    });
    await within(
      await screen.findByRole("region", { name: "スレッド" }),
    ).findByRole("log", { name: "返信一覧" });
    await user.type(
      within(pane()).getByRole("textbox", { name: "返信" }),
      "[[E2E_TEST]失敗する返信",
    );
    await user.click(within(pane()).getByRole("button", { name: "送信" }));
    await within(pane()).findByRole("alert");
    expect(
      within(rowWith("返信が2件ある親")).getByRole("button", {
        name: /^返信 2 件/,
      }),
    ).toBeDefined();
  });
});
