// #124 AC-1（3-4 AC-1〜AC-5 の土台）・AC-2：ヘッダーの通知（NotificationBell）・通知の一覧 S-14（/notifications、NotificationList）を、
// 利用者の操作に基づいて確かめる。API は MSW（test/notification-handlers.ts の状態つきの応答）。データは架空。
// 通知の種類は本 Issue では 0 件のため、行は任意の文字列の種類（test_kind）で作る。文言・移動先の対応表は NotificationList の views で差し替える。
// 公開形の仮定（契約。計画「通知を開いたときの移動先」「画面」）：
//  - features/notifications/index.ts が NotificationBell と NotificationList を公開する。NotificationList は props { views?: Record<string, { label; to(item) }> }（既定は NOTIFICATION_VIEWS）
//  - NotificationBell：リンク（href="/notifications"）。名前は「通知」で始まる。未読が 1〜99 件なら件数、100 件以上なら「99+」を中に出し、0 件なら件数の印を出さない。
//      名前（aria-label）にも件数を含める。未読数（GET /api/me/notifications/unread-count）を 2 秒ごとに取り、401/403 で取るのをやめる（500 などは続ける）
//  - S-14：h1「通知」。NotificationList は読み込み中は role="status"（「読み込み中」を含む）、失敗は role="alert"、0 件は「新しい通知はありません」、
//      あればリスト（listitem が 1 件 1 通知）。1 ページ目を 2 秒ごとに取り直す。「さらに表示」で nextCursor の続きを足す
//  - 1 件の表示：describeNotification の label（対応表に無い種類は「通知」）。移動先なしの未読には「既読にする」ボタン。
//      移動先ありの項目は、label を名前に含むボタン。押すと既読にしてから移動し、既読の失敗なら移動せず role="alert" を出す
//  - 「すべて既読にする」ボタン：押すと POST read-all。送信中は disabled。成功したら一覧と未読数を取り直す（ヘッダーの印が再読み込みなしで消える）
//  - 下部メニュー（スマホ幅）は features/app-shell/MobileNav.test.tsx、実ブラウザでの見え方は e2e/notifications.spec.ts
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  findHome,
  installDomStubs,
  renderApp,
  respondShellUser,
  type DomStubs,
} from "../../test/app-shell-harness";
import {
  notification,
  respondNotifications,
} from "../../test/notification-handlers";
import { server } from "../../test/server";
import { NotificationBell, NotificationList } from "./index";

function CurrentPath() {
  return <span data-testid="path">{useLocation().pathname}</span>;
}

function renderParts(parts: ReactNode, path = "/") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        {parts}
        <CurrentPath />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const currentPath = () => screen.getByTestId("path").textContent;
/** 新しい順に、n 件の未読を作る（ID は 1..n、先頭が最新） */
const unreadItems = (count: number) =>
  Array.from({ length: count }, (_v, i) => notification(count - i));
const bellLink = () => screen.findByRole("link", { name: /^通知/ });
const hasDigit = (text: string | null) => /\d/.test(text ?? "");

let stubs: DomStubs;
beforeEach(() => {
  stubs = installDomStubs();
});
afterEach(() => {
  stubs.restore();
  vi.useRealTimers();
});

describe("#124 AC-1 ヘッダーの通知（NotificationBell）の件数の印", () => {
  it("#124 AC-1（3-4 AC-1）: 未読が 0 件なら、/notifications へのリンクだけで、件数の印を出さない", async () => {
    const world = respondNotifications({ items: [] });
    renderParts(<NotificationBell />);
    const link = await bellLink();
    expect(link.getAttribute("href")).toBe("/notifications");
    await waitFor(() => expect(world.countRequests).toBeGreaterThanOrEqual(1));
    expect(hasDigit(link.textContent)).toBe(false);
    expect(hasDigit(link.getAttribute("aria-label"))).toBe(false);
  });

  it.each([
    [1, "1"],
    [5, "5"],
    [99, "99"],
  ])(
    "#124 AC-1（3-4 AC-1）: 未読が %i 件なら、印に「%s」を出し、読み上げの名前にも件数を含める",
    async (count, text) => {
      respondNotifications({ items: unreadItems(count) });
      renderParts(<NotificationBell />);
      const link = await bellLink();
      await waitFor(() => expect(link.textContent).toContain(text));
      expect(link.textContent).not.toContain("+");
      expect(link.getAttribute("aria-label") ?? link.textContent).toContain(
        text,
      );
    },
  );

  it.each([100, 150])(
    "#124 AC-1: 未読が %i 件なら、印は「99+」",
    async (count) => {
      respondNotifications({ items: unreadItems(count) });
      renderParts(<NotificationBell />);
      const link = await bellLink();
      await waitFor(() => expect(link.textContent).toContain("99+"));
    },
  );

  it("#124 AC-1: 既読の通知は数えない（印は未読の件数だけ）", async () => {
    respondNotifications({
      items: [
        notification(3),
        notification(2, { readAt: "2026-11-02T00:00:00.000Z" }),
        notification(1),
      ],
    });
    renderParts(<NotificationBell />);
    const link = await bellLink();
    await waitFor(() => expect(link.textContent).toContain("2"));
    expect(link.textContent).not.toContain("3");
  });
});

describe("#124 AC-1 ヘッダーの未読数の取得（2 秒ごと）", () => {
  it("#124 AC-1: 2 秒ごとに未読数を取り直し、再読み込みなしで新着の印が出る", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const world = respondNotifications({ items: [] });
    renderParts(<NotificationBell />);
    const link = await bellLink();
    await waitFor(() => expect(world.countRequests).toBeGreaterThanOrEqual(1));
    expect(hasDigit(link.textContent)).toBe(false);
    world.items.unshift(notification(2), notification(1));
    await vi.advanceTimersByTimeAsync(2500);
    await waitFor(() => expect(link.textContent).toContain("2"));
    expect(world.countRequests).toBeGreaterThanOrEqual(2);
  });

  it.each([401, 403])(
    "#124 AC-1: %i を受けたら、未読数を取るのをやめる（要求を重ねない）",
    async (status) => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      let requests = 0;
      server.use(
        http.get("/api/me/notifications/unread-count", () => {
          requests += 1;
          return HttpResponse.json(
            { code: "UNAUTHENTICATED", message: "ログインしてください" },
            { status },
          );
        }),
      );
      renderParts(<NotificationBell />);
      await bellLink();
      await waitFor(() => expect(requests).toBeGreaterThanOrEqual(1));
      await vi.advanceTimersByTimeAsync(500);
      const settled = requests;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(requests).toBe(settled);
    },
  );

  it("#124 AC-1: 一時的な失敗（500）では取るのをやめず、2 秒後にまた取る", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let requests = 0;
    server.use(
      http.get("/api/me/notifications/unread-count", () => {
        requests += 1;
        return HttpResponse.json(
          { code: "INTERNAL", message: "一時的なエラーです" },
          { status: 500 },
        );
      }),
    );
    renderParts(<NotificationBell />);
    await bellLink();
    await waitFor(() => expect(requests).toBeGreaterThanOrEqual(1));
    const first = requests;
    await vi.advanceTimersByTimeAsync(4500);
    expect(requests).toBeGreaterThan(first);
  });

  it("#124 AC-1（コードレビュー）: 一度 5 件を表示した後に取得が失敗（500）したら、古い「5」を出し続けず印を消す", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    respondNotifications({ items: unreadItems(5) });
    renderParts(<NotificationBell />);
    const link = await bellLink();
    await waitFor(() => expect(link.textContent).toContain("5"));
    server.use(
      http.get("/api/me/notifications/unread-count", () =>
        HttpResponse.json(
          { code: "INTERNAL", message: "一時的なエラーです" },
          { status: 500 },
        ),
      ),
    );
    await vi.advanceTimersByTimeAsync(2500);
    await waitFor(() => expect(hasDigit(link.textContent)).toBe(false));
    expect(hasDigit(link.getAttribute("aria-label"))).toBe(false);
  });

  it("#124 AC-1: 取得に失敗している間は、0 件のような誤った件数の印を出さない", async () => {
    server.use(
      http.get("/api/me/notifications/unread-count", () =>
        HttpResponse.json(
          { code: "INTERNAL", message: "一時的なエラーです" },
          { status: 500 },
        ),
      ),
    );
    renderParts(<NotificationBell />);
    const link = await bellLink();
    expect(hasDigit(link.textContent)).toBe(false);
  });
});

describe("#124 AC-1 共通レイアウトの中のヘッダーと S-14 への移動", () => {
  it("#124 AC-1: ヘッダー（banner）の通知は、ステータスのボタンより前（検索 → 通知 → ステータス → アバター）。件数も出る", async () => {
    respondShellUser();
    respondNotifications({ items: unreadItems(3) });
    renderApp("/");
    await findHome();
    const banner = within(await screen.findByRole("banner"));
    const bell = await banner.findByRole("link", { name: /^通知/ });
    const status = await banner.findByRole("button", { name: /ステータス/ });
    expect(
      bell.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    await waitFor(() => expect(bell.textContent).toContain("3"));
  });

  it("#124 AC-1（C-65）: ヘッダーの通知を押すと /notifications に直接移り、S-14（h1「通知」）が出る", async () => {
    respondShellUser();
    respondNotifications({ items: unreadItems(1) });
    const { user } = renderApp("/");
    await findHome();
    const banner = within(await screen.findByRole("banner"));
    await user.click(await banner.findByRole("link", { name: /^通知/ }));
    await waitFor(() => expect(currentPath()).toBe("/notifications"));
    await screen.findByRole("heading", { level: 1, name: "通知" });
  });

  it("#124 AC-1: /notifications で通知が 0 件なら、main に「新しい通知はありません」を出す", async () => {
    respondShellUser();
    respondNotifications({ items: [] });
    renderApp("/notifications");
    await screen.findByRole("heading", { level: 1, name: "通知" });
    const main = within(screen.getByRole("main"));
    expect(await main.findByText("新しい通知はありません")).toBeDefined();
  });

  it("#124 AC-1: /notifications で本人の通知（API の返したもの）が main の一覧に出る", async () => {
    respondShellUser();
    respondNotifications({ items: [notification(2), notification(1)] });
    renderApp("/notifications");
    await screen.findByRole("heading", { level: 1, name: "通知" });
    const main = within(screen.getByRole("main"));
    await waitFor(() => expect(main.getAllByRole("listitem")).toHaveLength(2));
  });
});

describe("#124 AC-1 通知の一覧（NotificationList）の 4 つの状態", () => {
  it("#124 AC-1: 読み込み中は role=status で「読み込み中」を出す", async () => {
    server.use(http.get("/api/me/notifications", () => new Promise(() => {})));
    renderParts(<NotificationList />);
    expect((await screen.findByRole("status")).textContent).toContain(
      "読み込み中",
    );
  });

  it("#124 AC-1: 0 件は「新しい通知はありません」", async () => {
    respondNotifications({ items: [] });
    renderParts(<NotificationList />);
    expect(await screen.findByText("新しい通知はありません")).toBeDefined();
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("#124 AC-1: 取得に失敗したら、0 件とは出さず role=alert を出す", async () => {
    server.use(
      http.get("/api/me/notifications", () =>
        HttpResponse.json(
          { code: "INTERNAL", message: "一時的なエラーが発生しました" },
          { status: 500 },
        ),
      ),
    );
    renderParts(<NotificationList />);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "一時的なエラーが発生しました",
    );
    expect(screen.queryByText("新しい通知はありません")).toBeNull();
  });

  it("#124 AC-2: ありのときは API の順（新しい順）に 1 件 1 listitem。対応表に無い種類は汎用の「通知」を出す", async () => {
    respondNotifications({
      items: [notification(3), notification(2), notification(1)],
    });
    renderParts(<NotificationList />);
    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(3);
    for (const entry of items) expect(entry.textContent).toContain("通知");
  });

  it("#124 AC-1: 1 ページ目を 2 秒ごとに取り直し、再読み込みなしで新着が先頭に出る", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const world = respondNotifications({ items: [notification(1)] });
    renderParts(<NotificationList />);
    await waitFor(() =>
      expect(screen.getAllByRole("listitem")).toHaveLength(1),
    );
    world.items.unshift(notification(2));
    await vi.advanceTimersByTimeAsync(2500);
    await waitFor(() =>
      expect(screen.getAllByRole("listitem")).toHaveLength(2),
    );
  });
});

describe("#124 AC-1 次のページ", () => {
  it("#124 AC-1: nextCursor があれば「さらに表示」で続きを足し、重複しない", async () => {
    const world = respondNotifications({
      items: unreadItems(21),
      pageSize: 20,
    });
    renderParts(<NotificationList />);
    await waitFor(() =>
      expect(screen.getAllByRole("listitem")).toHaveLength(20),
    );
    fireEvent.click(await screen.findByRole("button", { name: "さらに表示" }));
    await waitFor(() =>
      expect(screen.getAllByRole("listitem")).toHaveLength(21),
    );
    expect(
      world.listRequests.some(
        (url) => url.searchParams.get("cursor") === "c20",
      ),
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "さらに表示" })).toBeNull();
  });

  it("#124 AC-1（コードレビュー）: 「さらに表示」で 2 ページ目を読み込んだ後は、2 秒経っても一覧の取り直しをしない（ヘッダーの未読数は取り続ける）", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const world = respondNotifications({
      items: unreadItems(21),
      pageSize: 20,
    });
    renderParts(
      <>
        <NotificationBell />
        <NotificationList />
      </>,
    );
    await waitFor(() =>
      expect(screen.getAllByRole("listitem")).toHaveLength(20),
    );
    fireEvent.click(await screen.findByRole("button", { name: "さらに表示" }));
    await waitFor(() =>
      expect(screen.getAllByRole("listitem")).toHaveLength(21),
    );
    const listBefore = world.listRequests.length;
    const countBefore = world.countRequests;
    await vi.advanceTimersByTimeAsync(5000);
    expect(world.listRequests.length).toBe(listBefore);
    expect(world.countRequests).toBeGreaterThan(countBefore);
  });

  it("#124 AC-1: 続きがなければ「さらに表示」を出さない", async () => {
    respondNotifications({ items: unreadItems(3) });
    renderParts(<NotificationList />);
    await screen.findAllByRole("listitem");
    expect(screen.queryByRole("button", { name: "さらに表示" })).toBeNull();
  });
});

describe("#124 AC-1 既読にする（移動先なし）", () => {
  it("#124 AC-1（3-4 AC-5）: 「既読にする」を押すと、その 1 件を既読にし、再読み込みなしで未読の印が消える。行は残る", async () => {
    const world = respondNotifications({
      items: [notification(2), notification(1)],
    });
    renderParts(<NotificationList />);
    const buttons = await screen.findAllByRole("button", {
      name: "既読にする",
    });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[0] as HTMLElement);
    await waitFor(() => expect(world.readPosts).toEqual([notification(2).id]));
    await waitFor(() =>
      expect(
        screen.getAllByRole("button", { name: "既読にする" }),
      ).toHaveLength(1),
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("#124 AC-1: 既読済みの通知には「既読にする」を出さない", async () => {
    respondNotifications({
      items: [notification(1, { readAt: "2026-11-02T00:00:00.000Z" })],
    });
    renderParts(<NotificationList />);
    await screen.findAllByRole("listitem");
    expect(screen.queryByRole("button", { name: "既読にする" })).toBeNull();
  });

  it("#124 AC-1: 既読に失敗したら role=alert で知らせ、未読のまま残す", async () => {
    const world = respondNotifications({ items: [notification(1)] });
    world.failNextRead = {
      status: 500,
      body: { code: "INTERNAL", message: "一時的なエラーが発生しました" },
    };
    renderParts(<NotificationList />);
    fireEvent.click(await screen.findByRole("button", { name: "既読にする" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "一時的なエラーが発生しました",
    );
    expect(screen.getByRole("button", { name: "既読にする" })).toBeDefined();
  });
});

describe("#124 AC-1・AC-2 通知を開く（対応表の移動先）", () => {
  const views = {
    test_kind: {
      label: "テストの通知",
      to: (item: { targetId: string | null }) => `/target/${item.targetId}`,
    },
  };

  it("#124 AC-2（C-65）: 対応表の文言を出し、押すと既読にしてから対応表の移動先へ移る", async () => {
    const world = respondNotifications({ items: [notification(1)] });
    renderParts(<NotificationList views={views} />);
    const open = await screen.findByRole("button", { name: /テストの通知/ });
    fireEvent.click(open);
    await waitFor(() =>
      expect(currentPath()).toBe(`/target/${notification(1).targetId}`),
    );
    expect(world.readPosts).toEqual([notification(1).id]);
  });

  it("#124 AC-2: 既読に失敗したら移動せず、role=alert でエラーを出す", async () => {
    const world = respondNotifications({ items: [notification(1)] });
    world.failNextRead = {
      status: 500,
      body: { code: "INTERNAL", message: "一時的なエラーが発生しました" },
    };
    renderParts(<NotificationList views={views} />);
    fireEvent.click(
      await screen.findByRole("button", { name: /テストの通知/ }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "一時的なエラーが発生しました",
    );
    expect(currentPath()).toBe("/");
  });

  it("#124 AC-2: 対応表にない種類の通知は、差し替えた対応表があっても汎用の「通知」で、移動しない", async () => {
    respondNotifications({
      items: [notification(1, { kind: "test_other_kind" })],
    });
    renderParts(<NotificationList views={views} />);
    const entry = await screen.findByRole("listitem");
    expect(entry.textContent).not.toContain("テストの通知");
    expect(entry.textContent).toContain("通知");
    expect(currentPath()).toBe("/");
  });
});

describe("#124 AC-1 すべて既読にする", () => {
  it("#124 AC-1: 押すと POST read-all を 1 回送り、一覧もヘッダーの未読数も取り直されて、再読み込みなしで印が消える", async () => {
    const world = respondNotifications({ items: unreadItems(3) });
    renderParts(
      <>
        <NotificationBell />
        <NotificationList />
      </>,
    );
    const bell = await bellLink();
    await waitFor(() => expect(bell.textContent).toContain("3"));
    fireEvent.click(
      await screen.findByRole("button", { name: "すべて既読にする" }),
    );
    await waitFor(() => expect(world.readAllPosts).toBe(1));
    await waitFor(() => expect(hasDigit(bell.textContent)).toBe(false));
    await waitFor(() =>
      expect(
        screen.queryAllByRole("button", { name: "既読にする" }),
      ).toHaveLength(0),
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("#124 AC-1: 送信中は押せず（disabled）、続けて押しても POST は 1 回だけ", async () => {
    const world = respondNotifications({ items: unreadItems(2) });
    let release: () => void = () => {};
    world.holdReadAll = new Promise<void>((resolve) => {
      release = resolve;
    });
    renderParts(<NotificationList />);
    const button = await screen.findByRole("button", {
      name: "すべて既読にする",
    });
    fireEvent.click(button);
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "すべて既読にする",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true),
    );
    fireEvent.click(screen.getByRole("button", { name: "すべて既読にする" }));
    release();
    await waitFor(() => expect(world.readAllPosts).toBe(1));
  });

  it("#124 AC-1: 失敗したら role=alert で知らせ、未読の表示を変えない", async () => {
    respondNotifications({ items: unreadItems(2) });
    server.use(
      http.post("/api/me/notifications/read-all", () =>
        HttpResponse.json(
          { code: "INTERNAL", message: "一時的なエラーが発生しました" },
          { status: 500 },
        ),
      ),
    );
    renderParts(<NotificationList />);
    fireEvent.click(
      await screen.findByRole("button", { name: "すべて既読にする" }),
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "一時的なエラーが発生しました",
    );
    expect(screen.getAllByRole("button", { name: "既読にする" })).toHaveLength(
      2,
    );
  });
});
