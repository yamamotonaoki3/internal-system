// #136 AC-1（1-2 AC-5・AC-6）: サイドバーの DM の欄（DmSection）と、DM の一覧の画面 /dms（DmList）。API は MSW。データは架空。
// 契約（実装前の仮置き。引き継ぎに明記）：
//   <DmSection linkClassName onNavigate? /> と <DmList /> を features/dms/index.ts から公開する（DmSection の props は JoinedChannelsSection と同じ形）。
//   DmSection：見出しの文字「ダイレクトメッセージ」、名前に「新しいDM」を含む /dms/new へのリンク、/dms へのリンク、DM ごとに /dms/:roomId へのリンク（名前は相手の表示名）。
//   DmList：DM ごとに /dms/:roomId へのリンク（名前は相手の表示名）と、名前に「新しいDM」を含む /dms/new へのリンク。
//   どちらも：相手が無効なら、リンクの中に「退職者」を併記する。roomId が重なる項目は1つだけ出す。「さらに表示」で続きを足す。
//   4つの状態：読み込み中は role=status（「読み込み中」）、失敗は role=alert（枠全体は壊さない）、0件は「ありません」を含む文。
//   投稿・開始のあと、再読み込みせずに並び・項目が変わる（dmKeys の invalidate）。投稿が 409（相手が無効）のときも、一覧（サイドバー・/dms）を取り直す。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import {
  dmDetail,
  dmItem,
  dmRoomId,
  partnerId,
  partnerName,
  respondDmPosts,
  respondDms,
} from "../../test/dm-handlers";
import { respondMessages } from "../../test/message-handlers";
import { server } from "../../test/server";
import { DmList, DmSection, DmView } from "./index";

function renderWith(children: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>,
  );
  return { user, client };
}

const sidebar = () =>
  screen.findByRole("navigation", { name: "テスト用サイドバー" });

function renderSection() {
  return renderWith(
    <nav aria-label="テスト用サイドバー">
      <DmSection linkClassName={() => ""} />
    </nav>,
  );
}

const dmLinks = (scope: HTMLElement) =>
  within(scope)
    .queryAllByRole("link")
    .filter((link) => /^\/dms\/(?!new$)/.test(link.getAttribute("href") ?? ""));

const retired = (n: number) =>
  dmItem(n, {
    partner: {
      id: partnerId(n),
      displayName: partnerName(n),
      isActive: false,
      status: null,
    },
  });

describe("#136 AC-1（1-2 AC-5）DmSection（サイドバーの DM の欄）", () => {
  it("#136 AC-1（1-2 AC-5）: 見出し・「新しいDM」（/dms/new）・一覧（/dms）へのリンクと、DM ごとのリンクを出す", async () => {
    respondDms({ items: [dmItem(1), dmItem(2)] });
    renderSection();
    const nav = await sidebar();
    await within(nav).findByRole("link", { name: partnerName(1) });
    expect(within(nav).getByText("ダイレクトメッセージ")).toBeDefined();
    expect(
      within(nav)
        .getByRole("link", { name: /新しいDM/ })
        .getAttribute("href"),
    ).toBe("/dms/new");
    expect(
      within(nav)
        .getAllByRole("link")
        .some((link) => link.getAttribute("href") === "/dms"),
    ).toBe(true);
    expect(dmLinks(nav).map((link) => link.getAttribute("href"))).toEqual([
      `/dms/${dmRoomId(1)}`,
      `/dms/${dmRoomId(2)}`,
    ]);
  });

  it("#136 AC-1（1-2 AC-6）: 相手が無効な DM は「退職者」を併記する。有効な相手には併記しない", async () => {
    respondDms({ items: [dmItem(1), retired(2)] });
    renderSection();
    const nav = await sidebar();
    const retiredLink = await within(nav).findByRole("link", {
      name: new RegExp(partnerName(2)),
    });
    expect(retiredLink.textContent).toContain("退職者");
    const active = within(nav).getByRole("link", {
      name: new RegExp(partnerName(1)),
    });
    expect(active.textContent).not.toContain("退職者");
  });

  it("#136 AC-1（1-2 AC-5）: ページをまたいで同じ roomId が来ても1つだけ出す", async () => {
    const world = respondDms({
      items: [dmItem(1), dmItem(2), dmItem(3)],
      pageSize: 2,
    });
    // 2ページ目に、1ページ目の roomId が重なって入る（最終活動順のカーソルで起こりうる）
    server.use(
      http.get("/api/dms", ({ request }) => {
        const url = new URL(request.url);
        world.listRequests.push(url);
        return url.searchParams.get("cursor") === null
          ? HttpResponse.json({
              items: [dmItem(1), dmItem(2)],
              nextCursor: "c2",
            })
          : HttpResponse.json({
              items: [dmItem(2), dmItem(3)],
              nextCursor: null,
            });
      }),
    );
    const { user } = renderSection();
    const nav = await sidebar();
    await within(nav).findByRole("link", { name: partnerName(2) });
    await user.click(within(nav).getByRole("button", { name: "さらに表示" }));
    await within(nav).findByRole("link", { name: partnerName(3) });
    expect(dmLinks(nav).map((link) => link.getAttribute("href"))).toEqual([
      `/dms/${dmRoomId(1)}`,
      `/dms/${dmRoomId(2)}`,
      `/dms/${dmRoomId(3)}`,
    ]);
  });

  it("#136 AC-1（1-2 AC-5）: 0件なら「ありません」を含む文を出し、「新しいDM」は出す", async () => {
    respondDms({ items: [] });
    renderSection();
    const nav = await sidebar();
    expect(await within(nav).findByText(/ありません/)).toBeDefined();
    expect(within(nav).getByRole("link", { name: /新しいDM/ })).toBeDefined();
    expect(dmLinks(nav)).toHaveLength(0);
  });

  it("#136 AC-1（1-2 AC-5）: 取得に失敗したら欄の中に role=alert を出し、0件とは出さない", async () => {
    server.use(
      http.get("/api/dms", () =>
        HttpResponse.json(
          { code: "INTERNAL", message: "一時的なエラーが発生しました" },
          { status: 500 },
        ),
      ),
    );
    renderSection();
    const nav = await sidebar();
    expect((await within(nav).findByRole("alert")).textContent).toContain(
      "一時的なエラーが発生しました",
    );
    expect(within(nav).queryByText(/ありません/)).toBeNull();
  });

  it("#136 AC-1（1-2 AC-5）: 読み込み中は role=status で「読み込み中」を出す（読み上げられる）", async () => {
    server.use(http.get("/api/dms", () => new Promise(() => {})));
    renderSection();
    const nav = await sidebar();
    expect((await within(nav).findByRole("status")).textContent).toContain(
      "読み込み中",
    );
  });

  it("#136 即時反映: DM で投稿すると、再読み込みせずにサイドバーの並びが変わる（最終活動の新しい順）", async () => {
    const world = respondDms({
      items: [dmItem(1), dmItem(2)],
      details: [dmDetail(2)],
    });
    const messages = respondMessages([]);
    respondDmPosts(world, messages);
    renderWith(
      <>
        <nav aria-label="テスト用サイドバー">
          <DmSection linkClassName={() => ""} />
        </nav>
        <DmView roomId={dmRoomId(2)} />
      </>,
    );
    const nav = await sidebar();
    await within(nav).findByRole("link", { name: partnerName(2) });
    expect(dmLinks(nav).map((l) => l.getAttribute("href"))).toEqual([
      `/dms/${dmRoomId(1)}`,
      `/dms/${dmRoomId(2)}`,
    ]);
    const input = await screen.findByRole("textbox", { name: "メッセージ" });
    fireEvent.change(input, { target: { value: "[E2E_TEST]並びが変わる" } });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    await waitFor(() =>
      expect(dmLinks(nav).map((l) => l.getAttribute("href"))).toEqual([
        `/dms/${dmRoomId(2)}`,
        `/dms/${dmRoomId(1)}`,
      ]),
    );
  });

  it("#136 AC-3（C-168(2)）・即時反映: DM の投稿が 409（相手が無効になった）なら、詳細だけでなく DM の一覧も取り直し、再読み込みせずにサイドバーに「退職者」が出る", async () => {
    const world = respondDms({
      items: [dmItem(1), dmItem(2)],
      details: [dmDetail(2)],
    });
    respondMessages([]);
    server.use(
      http.post("/api/rooms/:roomId/messages", () => {
        // サーバー側では、この時点で相手（2）が無効になっている
        world.details.set(
          dmRoomId(2),
          dmDetail(2, {
            partner: { isActive: false, status: null },
            canPost: false,
          }),
        );
        world.items = world.items.map((item) =>
          item.roomId === dmRoomId(2)
            ? {
                ...item,
                partner: { ...item.partner, isActive: false, status: null },
              }
            : item,
        );
        return HttpResponse.json(
          { code: "CONFLICT", message: "送信できませんでした" },
          { status: 409 },
        );
      }),
    );
    renderWith(
      <>
        <nav aria-label="テスト用サイドバー">
          <DmSection linkClassName={() => ""} />
        </nav>
        <DmView roomId={dmRoomId(2)} />
      </>,
    );
    const nav = await sidebar();
    const link = await within(nav).findByRole("link", {
      name: partnerName(2),
    });
    expect(link.textContent).not.toContain("退職者");
    const before = world.listRequests.length;
    const input = await screen.findByRole("textbox", { name: "メッセージ" });
    fireEvent.change(input, { target: { value: "[E2E_TEST]届かない" } });
    fireEvent.click(screen.getByRole("button", { name: "送信" }));
    await waitFor(() =>
      expect(world.listRequests.length).toBeGreaterThan(before),
    );
    await waitFor(() =>
      expect(
        within(nav).getByRole("link", { name: new RegExp(partnerName(2)) })
          .textContent,
      ).toContain("退職者"),
    );
  });
});

describe("#136 AC-1（1-2 AC-5・AC-6）DmList（/dms）", () => {
  it("#136 AC-1（1-2 AC-5）: DM ごとのリンクと「新しいDM」（/dms/new）を出す", async () => {
    respondDms({ items: [dmItem(1), dmItem(2)] });
    renderWith(<DmList />);
    const link = await screen.findByRole("link", { name: partnerName(1) });
    expect(link.getAttribute("href")).toBe(`/dms/${dmRoomId(1)}`);
    expect(
      screen.getByRole("link", { name: /新しいDM/ }).getAttribute("href"),
    ).toBe("/dms/new");
  });

  it("#136 AC-1（1-2 AC-6）: 相手が無効な DM は「退職者」を併記する", async () => {
    respondDms({ items: [retired(2)] });
    renderWith(<DmList />);
    const link = await screen.findByRole("link", {
      name: new RegExp(partnerName(2)),
    });
    expect(link.textContent).toContain("退職者");
  });

  it("#136 AC-1（1-2 AC-5）: 「さらに表示」で続きを足し、同じ roomId は1つだけ出す", async () => {
    const world = respondDms({ items: [] });
    server.use(
      http.get("/api/dms", ({ request }) => {
        const url = new URL(request.url);
        world.listRequests.push(url);
        return url.searchParams.get("cursor") === null
          ? HttpResponse.json({
              items: [dmItem(1), dmItem(2)],
              nextCursor: "c2",
            })
          : HttpResponse.json({
              items: [dmItem(1), dmItem(3)],
              nextCursor: null,
            });
      }),
    );
    const { user } = renderWith(<DmList />);
    await screen.findByRole("link", { name: partnerName(2) });
    await user.click(screen.getByRole("button", { name: "さらに表示" }));
    await screen.findByRole("link", { name: partnerName(3) });
    expect(screen.getAllByRole("link", { name: partnerName(1) })).toHaveLength(
      1,
    );
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "さらに表示" })).toBeNull(),
    );
  });

  it("#136 AC-1（1-2 AC-5）: DM ごとのリンクには、リンクとして見える見た目の指定（クラス）が付く（何も付けず素の表示にしない）", async () => {
    respondDms({ items: [dmItem(1)] });
    renderWith(<DmList />);
    const link = await screen.findByRole("link", { name: partnerName(1) });
    expect(link.className.trim()).not.toBe("");
  });

  it("#136 AC-1（1-2 AC-5）: 0件なら「ありません」を含む文を出す", async () => {
    respondDms({ items: [] });
    renderWith(<DmList />);
    expect(await screen.findByText(/ありません/)).toBeDefined();
  });

  it("#136 AC-1（1-2 AC-5）: 取得に失敗したら role=alert を出し、0件とは出さない", async () => {
    server.use(
      http.get("/api/dms", () =>
        HttpResponse.json(
          { code: "INTERNAL", message: "一時的なエラーが発生しました" },
          { status: 500 },
        ),
      ),
    );
    renderWith(<DmList />);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "一時的なエラーが発生しました",
    );
    expect(screen.queryByText(/ありません/)).toBeNull();
  });

  it("#136 AC-1（1-2 AC-5）: 読み込み中は role=status で「読み込み中」を出す（読み上げられる）", async () => {
    server.use(http.get("/api/dms", () => new Promise(() => {})));
    renderWith(<DmList />);
    expect((await screen.findByRole("status")).textContent).toContain(
      "読み込み中",
    );
  });
});
