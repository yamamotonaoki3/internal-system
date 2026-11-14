// #137 AC-1（1-4 AC-4）: スレッド一覧 S-35（ThreadsPage・ThreadList）。API は MSW。時間は fake timers で進める。データは架空。
// 契約（実装前の仮置き。計画 plan-137 の「7. EP-3-08」「9. 画面」と改訂1〜3。実装者へ）：
//   pages/ThreadsPage.tsx が ThreadsPage を公開し、App.tsx の /threads（レイアウトルートの子）に登録する。
//   画面は h1「スレッド」と、features/threads の ThreadList（index.ts から公開。props なし。ルーターの中で使う）。?thread=<親ID> があれば同じ画面に ThreadPane（S-07）も出す。
//   ThreadList：GET /api/me/threads（limit は付けない。既定20件）。一覧は <ul aria-label="スレッド一覧"> の <li>。1行は、その行を開くリンク
//     （href は現在のパスに ?thread=<親ID> を付けたもの。行全体の名前に、部屋の名前・親の本文・未読の件数の読み上げを含む）。
//     行に出すもの：部屋（チャンネルは名前。DM は相手の表示名で、相手が無効なら「（退職者）」を併記）、親の本文（削除済みは「このメッセージは削除されました」）、
//     最後の返信の日時（<time dateTime={lastReplyAt}>）、返信の件数、未読の印と件数（UnreadCountBadge：1〜99 は数字、100 は「99+」。読み上げは「未読 n件」「未読 99件以上」。0 は何も出さない）。
//   4つの状態：読み込み中（role=status「読み込み中です」）／失敗（role=alert。0件とは出さない。次の取り直しで戻れば消える）／0件（「スレッドはまだありません」）／あり。
//   ページ送り：続きがあるときだけ「さらに表示」ボタン（cursor を付けて次を取り足す）。先頭から最大5ページ（THREAD_LIST_MAX_PAGES = 5。20件×5＝100件）まで。
//     5ページ読み込んでなお続きがあるときは「さらに表示」を出さず、「最近のスレッドを100件まで表示しています」を出す（続きがないときは出さない）。
//   取り直し：S-35 を開いている間、2秒ごとに、読み込み済みのすべてのページを先頭から取り直す（maxPages は使わない）。親の ID で重複を除く。
//   行を選ぶ（リンクを押す）と ?thread=<親ID> が付いて S-07 が開き、参加者として最新の返信を表示したらスレッドの既読が送られ、一覧の未読の印が再読み込みなしで消える。
import { act, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dmRoomId, partnerId, partnerName } from "../test/dm-handlers";
import { OTHER_AUTHOR, reply, respondReplies } from "../test/message-handlers";
import {
  respondMyThreads,
  threadItem,
  type TestThread,
} from "../test/thread-handlers";
import { server } from "../test/server";
import { renderInApp, respondSelf } from "../test/thread-harness";
import { ThreadsPage } from "./ThreadsPage";

const NOTICE = "最近のスレッドを100件まで表示しています";
const DELETED_TEXT = "このメッセージは削除されました";

/** n 番目のスレッド（親の本文は 2 桁にそろえ、部分一致で別の行に当たらないようにする） */
const item = (n: number, overrides: Parameters<typeof threadItem>[1] = {}) =>
  threadItem(n, {
    ...overrides,
    parent: {
      body: `[E2E_TEST]親${String(n).padStart(2, "0")}`,
      ...overrides.parent,
    },
  });
const many = (count: number): TestThread[] =>
  Array.from({ length: count }, (_, i) => item(i + 1));

const list = () => screen.getByRole("list", { name: "スレッド一覧" });
const rows = () => within(list()).getAllByRole("listitem");
const linkOf = (n: number) => {
  const label = `[E2E_TEST]親${String(n).padStart(2, "0")}`;
  const link = within(list())
    .getAllByRole("link")
    .find((l) => (l.textContent ?? "").includes(label));
  if (link === undefined)
    throw new Error(`「${label}」の行のリンクがありません`);
  return link;
};
const hasLink = (n: number) => {
  const label = `[E2E_TEST]親${String(n).padStart(2, "0")}`;
  return within(list())
    .queryAllByRole("link")
    .some((l) => (l.textContent ?? "").includes(label));
};
const orderOfParents = () =>
  within(list())
    .getAllByRole("link")
    .map((l) => /親(\d\d)/.exec(l.textContent ?? "")?.[1]);
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const moreButton = () => screen.queryByRole("button", { name: "さらに表示" });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  respondSelf();
});
afterEach(() => {
  vi.useRealTimers();
});

function renderPage(path = "/threads") {
  return renderInApp(<ThreadsPage />, { path, fakeTimers: true });
}

describe("#137 AC-1（1-4 AC-4）S-35 の4つの状態", () => {
  it("#137 AC-1（1-4 AC-4）: 見出し h1「スレッド」を出す", async () => {
    respondMyThreads([item(1)]);
    renderPage();
    expect(
      screen.getByRole("heading", { level: 1, name: "スレッド" }),
    ).toBeDefined();
    await screen.findByRole("list", { name: "スレッド一覧" });
  });

  it("#137 AC-1（1-4 AC-4）: 読み込み中は「読み込み中です」（role=status）を出す", async () => {
    respondMyThreads([item(1)]);
    renderPage();
    expect(screen.getByRole("status").textContent).toBe("読み込み中です");
    await screen.findByRole("list", { name: "スレッド一覧" });
    expect(screen.queryByText("読み込み中です")).toBeNull();
  });

  it("#137 AC-1（1-4 AC-4）: 0件のときは「スレッドはまだありません」を出す", async () => {
    respondMyThreads([]);
    renderPage();
    expect(await screen.findByText("スレッドはまだありません")).toBeDefined();
    expect(moreButton()).toBeNull();
  });

  it("#137 AC-1（1-4 AC-4）: 失敗したときは role=alert に出し、0件とは出さない。次の取り直しで戻れば、エラーが消えて一覧が出る", async () => {
    const world = respondMyThreads([item(1)]);
    world.failList = { status: 500, times: 1 };
    renderPage();
    await screen.findByRole("alert");
    expect(screen.queryByText("スレッドはまだありません")).toBeNull();
    expect(screen.queryByRole("list", { name: "スレッド一覧" })).toBeNull();
    await advance(2500);
    await screen.findByRole("list", { name: "スレッド一覧" });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("#137 AC-1（1-4 AC-4）一覧の行", () => {
  it("#137 AC-1: 部屋の名前・親の本文・最後の返信の日時を出し、最後の返信が新しい順に並べる（サーバーの並びのまま）", async () => {
    respondMyThreads([
      item(2, {
        room: {
          kind: "channel",
          id: "01JTESTROOM00000000000T002",
          name: "[E2E_TEST]営業の部屋",
        },
        lastReplyAt: "2026-11-13T09:00:00.000Z",
      }),
      item(1, { lastReplyAt: "2026-11-12T09:00:00.000Z" }),
    ]);
    renderPage();
    await screen.findByRole("list", { name: "スレッド一覧" });
    expect(orderOfParents()).toEqual(["02", "01"]);
    const first = rows()[0] as HTMLElement;
    expect(first.textContent).toContain("[E2E_TEST]営業の部屋");
    expect(first.textContent).toContain("[E2E_TEST]親02");
    const time = first.querySelector("time");
    expect(time?.getAttribute("datetime")).toBe("2026-11-13T09:00:00.000Z");
    expect(
      (rows()[1] as HTMLElement)
        .querySelector("time")
        ?.getAttribute("datetime"),
    ).toBe("2026-11-12T09:00:00.000Z");
  });

  it("#137 AC-1: DM のスレッドは相手の表示名を出し、相手が無効なら「（退職者）」を併記する", async () => {
    respondMyThreads([
      item(1, {
        room: {
          kind: "direct",
          id: dmRoomId(1),
          partner: {
            id: partnerId(1),
            displayName: partnerName(1),
            isActive: true,
          },
        },
      }),
      item(2, {
        room: {
          kind: "direct",
          id: dmRoomId(2),
          partner: {
            id: partnerId(2),
            displayName: partnerName(2),
            isActive: false,
          },
        },
      }),
    ]);
    renderPage();
    await screen.findByRole("list", { name: "スレッド一覧" });
    expect(linkOf(1).textContent).toContain(partnerName(1));
    expect(linkOf(1).textContent).not.toContain("（退職者）");
    expect(linkOf(2).textContent).toContain(partnerName(2));
    expect(linkOf(2).textContent).toContain("（退職者）");
  });

  it("#137 AC-1（1-4 AC-2）: 親が削除済みでも出し、本文の代わりに「このメッセージは削除されました」を出す", async () => {
    respondMyThreads([
      threadItem(1, { parent: { body: null, deleted: true } }),
    ]);
    renderPage();
    await screen.findByRole("list", { name: "スレッド一覧" });
    expect(rows()[0]?.textContent).toContain(DELETED_TEXT);
  });

  it.each([
    [0, null, null],
    [1, "1", "未読 1件"],
    [3, "3", "未読 3件"],
    [99, "99", "未読 99件"],
    [100, "99+", "未読 99件以上"],
  ])(
    "#137 AC-1（1-4 AC-4）: 未読 %i 件は、印「%s」と読み上げ「%s」（0 は何も出さない。色だけに頼らず文字で出す）",
    async (count, mark, spoken) => {
      respondMyThreads([item(1, { unreadCount: count })]);
      renderPage();
      await screen.findByRole("list", { name: "スレッド一覧" });
      const row = rows()[0] as HTMLElement;
      if (mark === null || spoken === null) {
        expect(row.textContent).not.toContain("未読");
        expect(within(row).queryByText(/^\d+\+?$/)).toBeNull();
        return;
      }
      const visible = within(row).getByText(mark, { exact: true });
      expect(visible.closest("[aria-hidden='true']")).not.toBeNull();
      expect(within(row).getByText(spoken, { exact: true })).toBeDefined();
      expect(linkOf(1).textContent).toContain(spoken);
    },
  );

  it("#137 AC-1（1-4 AC-4）: 99件では「99+」を出さず、100件で初めて「99+」になる", async () => {
    respondMyThreads([
      item(1, { unreadCount: 99 }),
      item(2, { unreadCount: 100 }),
    ]);
    renderPage();
    await screen.findByRole("list", { name: "スレッド一覧" });
    // サーバーの並びどおり、rows()[0] が99件（親01）、rows()[1] が100件（親02）
    expect(within(rows()[0] as HTMLElement).queryByText("99+")).toBeNull();
    expect(within(rows()[0] as HTMLElement).getByText("99")).toBeDefined();
    expect(within(rows()[1] as HTMLElement).getByText("99+")).toBeDefined();
  });
});

describe("#137 AC-1（1-4 AC-4）ページ送りと上限（改訂3）", () => {
  it("#137 AC-1: 続きがあるときだけ「さらに表示」を出し、押すと cursor を付けて次を取り足す。続きがなくなったら消える", async () => {
    const world = respondMyThreads(many(3), { pageSize: 2 });
    const { user } = renderPage();
    await screen.findByRole("list", { name: "スレッド一覧" });
    expect(rows()).toHaveLength(2);
    expect(world.listRequests[0]?.searchParams.has("cursor")).toBe(false);
    await user.click(moreButton() as HTMLElement);
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(world.listRequests.some((u) => u.searchParams.has("cursor"))).toBe(
      true,
    );
    expect(orderOfParents()).toEqual(["01", "02", "03"]);
    expect(moreButton()).toBeNull();
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it("#137 AC-1: 続きがないとき（1ページに収まる）は「さらに表示」を出さない", async () => {
    respondMyThreads(many(2));
    renderPage();
    await screen.findByRole("list", { name: "スレッド一覧" });
    expect(moreButton()).toBeNull();
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it("#137 AC-1: 次のページの取得に失敗したら、読み込み済みの行は残し、role=alert に出す", async () => {
    const world = respondMyThreads(many(3), { pageSize: 2 });
    const { user } = renderPage();
    await screen.findByRole("list", { name: "スレッド一覧" });
    world.failList = { status: 500, times: 1 };
    await user.click(moreButton() as HTMLElement);
    await screen.findByRole("alert");
    expect(rows()).toHaveLength(2);
  });

  it("#137 AC-1: 先頭から5ページ（100件）まで読み込み、続きがあっても「さらに表示」を出さず、「最近のスレッドを100件まで表示しています」を出す", async () => {
    respondMyThreads(many(12), { pageSize: 2 });
    const { user } = renderPage();
    await screen.findByRole("list", { name: "スレッド一覧" });
    for (let page = 2; page <= 5; page += 1) {
      expect(screen.queryByText(NOTICE)).toBeNull();
      await user.click(moreButton() as HTMLElement);
      await waitFor(() => expect(rows()).toHaveLength(page * 2));
    }
    expect(moreButton()).toBeNull();
    expect(screen.getByText(NOTICE)).toBeDefined();
  });

  it("#137 AC-1: ちょうど5ページで終わる（続きがない）ときは、案内を出さない", async () => {
    respondMyThreads(many(10), { pageSize: 2 });
    const { user } = renderPage();
    await screen.findByRole("list", { name: "スレッド一覧" });
    for (let page = 2; page <= 5; page += 1) {
      await user.click(moreButton() as HTMLElement);
      await waitFor(() => expect(rows()).toHaveLength(page * 2));
    }
    expect(moreButton()).toBeNull();
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it("#137 AC-1: 上限に達した後、読み込み済みの範囲の外のスレッドに返信が付いて先頭へ動いても、表示から抜けず、先頭に出る", async () => {
    const world = respondMyThreads(many(12), { pageSize: 2 });
    const { user } = renderPage();
    await screen.findByRole("list", { name: "スレッド一覧" });
    for (let page = 2; page <= 5; page += 1) {
      await user.click(moreButton() as HTMLElement);
      await waitFor(() => expect(rows()).toHaveLength(page * 2));
    }
    expect(hasLink(11)).toBe(false);
    world.bump(item(11).parent.id);
    await advance(2500);
    await waitFor(() => expect(hasLink(11)).toBe(true));
    expect(orderOfParents()[0]).toBe("11");
    expect(screen.getByText(NOTICE)).toBeDefined();
  });
});

describe("#137 AC-1（1-4 AC-4）2秒ごとの取り直し（改訂2・3）", () => {
  it("#137 AC-1: 読み込み済みのすべてのページを取り直し、2ページ目の項目の未読件数の変化（並びは変わらない）が2秒後に反映される", async () => {
    const world = respondMyThreads(many(4), { pageSize: 2 });
    const { user } = renderPage();
    await screen.findByRole("list", { name: "スレッド一覧" });
    await user.click(moreButton() as HTMLElement);
    await waitFor(() => expect(rows()).toHaveLength(4));
    expect(within(linkOf(3)).queryByText("未読 4件")).toBeNull();
    world.setUnread(item(3).parent.id, 4);
    const before = world.listRequests.length;
    await advance(2500);
    await waitFor(() =>
      expect(
        within(linkOf(3)).getByText("未読 4件", { exact: true }),
      ).toBeDefined(),
    );
    // 先頭のページと2ページ目の両方を取り直した（cursor なしと cursor あり）
    const after = world.listRequests.slice(before);
    expect(after.some((u) => !u.searchParams.has("cursor"))).toBe(true);
    expect(after.some((u) => u.searchParams.has("cursor"))).toBe(true);
    expect(orderOfParents()).toEqual(["01", "02", "03", "04"]);
  });

  it("#137 AC-1: ページの間に返信が挟まって並びが変わっても、親の ID で重複を除き、返信の付いたスレッドが先頭に出る", async () => {
    const world = respondMyThreads(many(6), { pageSize: 2 });
    const { user } = renderPage();
    await screen.findByRole("list", { name: "スレッド一覧" });
    await user.click(moreButton() as HTMLElement);
    await waitFor(() => expect(rows()).toHaveLength(4));
    // 2ページ目にいたスレッド（親04）に返信が付いて先頭へ動く
    world.bump(item(4).parent.id);
    await advance(2500);
    await waitFor(() => expect(orderOfParents()[0]).toBe("04"));
    const parents = orderOfParents();
    expect(new Set(parents).size).toBe(parents.length);
  });

  it("#137 AC-1: 画面を離れたら取り直しは止まる", async () => {
    const world = respondMyThreads(many(2));
    const view = renderPage();
    await screen.findByRole("list", { name: "スレッド一覧" });
    view.unmount();
    const stopped = world.listRequests.length;
    await advance(8000);
    expect(world.listRequests).toHaveLength(stopped);
  });
});

describe("#137 AC-1（1-4 AC-3・AC-4）行を選ぶと S-07 が開く", () => {
  it("#137 AC-1: 行のリンクは ?thread=<親ID> を指し、押すと同じ画面で S-07 が開く", async () => {
    const parent = item(1, { unreadCount: 2 }).parent;
    respondMyThreads([item(1, { unreadCount: 2 })]);
    respondReplies({
      parent,
      replies: [
        reply(parent, 1, { author: OTHER_AUTHOR }),
        reply(parent, 2, { author: OTHER_AUTHOR }),
      ],
    });
    const { user } = renderPage();
    await screen.findByRole("list", { name: "スレッド一覧" });
    expect(linkOf(1).getAttribute("href")).toBe(`/threads?thread=${parent.id}`);
    await user.click(linkOf(1));
    expect(screen.getByTestId("url").textContent).toBe(
      `/threads?thread=${parent.id}`,
    );
    const pane = await screen.findByRole("region", { name: "スレッド" });
    await within(pane).findByRole("log", { name: "返信一覧" });
    expect(within(pane).getByText("[E2E_TEST]返信1")).toBeDefined();
    // 一覧は開いたまま
    expect(screen.getByRole("list", { name: "スレッド一覧" })).toBeDefined();
  });

  it("#137 AC-1: 開くと、最新の返信の ID でスレッドの既読が送られ、一覧の未読の印と件数が再読み込みなしで消える", async () => {
    const parent = item(1, { unreadCount: 2 }).parent;
    const world = respondMyThreads([
      item(1, { unreadCount: 2 }),
      item(2, { unreadCount: 5 }),
    ]);
    respondReplies({
      parent,
      replies: [
        reply(parent, 1, { author: OTHER_AUTHOR }),
        reply(parent, 2, { author: OTHER_AUTHOR }),
      ],
    });
    const { user } = renderPage();
    await screen.findByRole("list", { name: "スレッド一覧" });
    expect(within(linkOf(1)).getByText("未読 2件")).toBeDefined();
    await user.click(linkOf(1));
    await waitFor(() => expect(world.puts).toHaveLength(1));
    expect(world.puts[0]).toEqual({
      parentMessageId: parent.id,
      lastReadMessageId: reply(parent, 2).id,
    });
    await advance(2500);
    await waitFor(() =>
      expect(within(linkOf(1)).queryByText("未読 2件")).toBeNull(),
    );
    expect(linkOf(1).textContent).not.toContain("未読");
    // 開いていない別のスレッドの未読は変わらない
    expect(within(linkOf(2)).getByText("未読 5件")).toBeDefined();
  });

  it("#137 AC-1: S-07 を閉じると ?thread= が外れて S-07 が消え、フォーカスは開いた行のリンクへ戻る", async () => {
    const parent = item(1).parent;
    respondMyThreads([item(1)]);
    respondReplies({
      parent,
      replies: [reply(parent, 1, { author: OTHER_AUTHOR })],
    });
    const { user } = renderPage();
    await screen.findByRole("list", { name: "スレッド一覧" });
    const opener = linkOf(1);
    await user.click(opener);
    const pane = await screen.findByRole("region", { name: "スレッド" });
    await within(pane).findByRole("log", { name: "返信一覧" });
    await user.click(
      within(pane).getByRole("button", { name: "スレッドを閉じる" }),
    );
    expect(screen.getByTestId("url").textContent).toBe("/threads");
    expect(screen.queryByRole("region", { name: "スレッド" })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(linkOf(1)));
    expect(linkOf(1)).toBe(opener);
  });

  it("#137 AC-1: ?thread=<親ID> のあるアドレスを開くと、一覧と S-07 が最初から出る", async () => {
    const parent = item(1).parent;
    respondMyThreads([item(1)]);
    respondReplies({
      parent,
      replies: [reply(parent, 1, { author: OTHER_AUTHOR })],
    });
    renderPage(`/threads?thread=${parent.id}`);
    await screen.findByRole("list", { name: "スレッド一覧" });
    await within(
      await screen.findByRole("region", { name: "スレッド" }),
    ).findByText("[E2E_TEST]返信1");
  });

  it("#137 AC-1（1-4 AC-3・AC-4）: /threads で S-07 から返信したら、次の2秒を待たずにすぐスレッド一覧を取り直し、新しく関わったスレッドと「返信 n 件」・並びが反映される", async () => {
    const world = respondMyThreads([item(1)]);
    // 開くスレッド（親02）はまだ一覧にない。返信すると、自分が返信したスレッドとして先頭に加わる
    const fresh = item(2, { parent: { replyCount: 1 } });
    const other = reply(fresh.parent, 1, { author: OTHER_AUTHOR });
    respondReplies({ parent: fresh.parent, replies: [other] });
    const onPost = ({ request }: { request: Request }) => {
      if (
        request.method === "POST" &&
        new URL(request.url).pathname ===
          `/api/messages/${fresh.parent.id}/replies`
      )
        world.add({
          ...fresh,
          parent: { ...fresh.parent, replyCount: 2 },
          lastReplyAt: "2026-11-14T09:00:00.000Z",
        });
    };
    server.events.on("response:mocked", onPost);
    // 既読の送信（成功すると一覧を取り直す）を止めておき、返信そのものの成功だけで取り直されることを確かめる
    let releaseRead = () => {};
    const readHeld = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    server.use(
      http.put("/api/messages/:messageId/thread-read-position", async () => {
        await readHeld;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    try {
      const { user } = renderPage(`/threads?thread=${fresh.parent.id}`);
      await screen.findByRole("list", { name: "スレッド一覧" });
      const pane = await screen.findByRole("region", { name: "スレッド" });
      await within(pane).findByRole("log", { name: "返信一覧" });
      expect(hasLink(2)).toBe(false);
      const before = world.listRequests.length;
      await user.type(
        within(pane).getByRole("textbox", { name: "返信" }),
        "[[E2E_TEST]一覧から返信する",
      );
      await user.click(within(pane).getByRole("button", { name: "送信" }));
      // タイマーを進めない：返信の成功の直後の取り直しだけで反映される
      await waitFor(() => expect(hasLink(2)).toBe(true));
      expect(world.listRequests.length).toBeGreaterThan(before);
      expect(linkOf(2).textContent).toContain("返信 2 件");
      expect(orderOfParents()).toEqual(["02", "01"]);
    } finally {
      releaseRead();
      server.events.removeListener("response:mocked", onPost);
    }
  });
});
