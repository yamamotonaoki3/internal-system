// #155（155-A）コードレビュー1回目の重大：資格を失った後、または取り直しに失敗した後に、取得済みのページの抜粋を画面に残さない
// （計画 4.5「再取得が失敗したら、前の結果を出さずにエラーを出す。複数ページの途中で資格を失っても、次のページの取得で前のページを残さない」・Issue AC-4）。
// 実装の方式（前のページを取り直す／捨てて1ページ目から、など）は決めず、画面に何が出るかで確かめる。
// 抜粋の中の一致は <mark> で強調されて要素が分かれるため、文字は画面全体の textContent のつながりで確かめる。
// 画面の契約は SearchPage.test.tsx の冒頭と同じ。データはすべて架空（[E2E_TEST]・testuser_）。
import { act, screen, waitFor, within } from "@testing-library/react";
import type { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import {
  forgetCaseAfterLeave,
  forgetCaseContent,
} from "../features/cases/hooks/useCaseWrites";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installDomStubs,
  renderApp,
  respondShellUser,
  SHELL_USER,
  type DomStubs,
} from "../test/app-shell-harness";
import {
  deferred,
  respondSearchPages,
  searchItem,
  type SearchWorld,
} from "../test/search-handlers";
import { server } from "../test/server";

const CASE_EXCERPT = "[E2E_TEST]外された案件の抜粋本文";
const KEPT_EXCERPT = "[E2E_TEST]残る公開の抜粋本文";
const NEXT_EXCERPT = "[E2E_TEST]次の頁の抜粋本文";

const caseRow = searchItem(1, {
  excerpt: CASE_EXCERPT,
  roomKind: "case",
  roomId: "01JTESTROOM155000000000007",
  roomName: "QZA-261120-0007",
});
const keptRow = searchItem(2, { excerpt: KEPT_EXCERPT });
const nextRow = searchItem(3, { excerpt: NEXT_EXCERPT });

let stubs: DomStubs;
beforeEach(() => {
  stubs = installDomStubs();
  respondShellUser();
});
afterEach(() => {
  vi.restoreAllMocks();
  stubs.restore();
});

const bodyText = () => document.body.textContent ?? "";

async function pageMain(): Promise<HTMLElement> {
  const heading = await screen.findByRole("heading", {
    level: 1,
    name: "検索結果",
  });
  const found = heading.closest("main");
  if (found === null)
    throw new Error("検索結果の見出しが main の中にありません");
  return found;
}

const rowIds = (main: HTMLElement) =>
  within(main)
    .queryAllByRole("listitem")
    .map((row) => row.querySelector("a")?.getAttribute("href") ?? "");

async function showFirstPage() {
  const world = respondSearchPages([
    { items: [caseRow, keptRow], nextCursor: "CURSOR1" },
    { items: [nextRow], nextCursor: null },
  ]);
  const app = renderApp("/search?q=抜粋");
  const main = await pageMain();
  await waitFor(() => expect(bodyText()).toContain(CASE_EXCERPT));
  expect(bodyText()).toContain(KEPT_EXCERPT);
  return { world, app, main };
}

/** ウィンドウに戻った（フォーカスの取り直しの契機） */
async function refocus() {
  await act(async () => {
    window.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

describe("#155 AC-4 F-8 資格を失った後の「さらに表示」", () => {
  it("#155 AC-4 F-8: 案件から外された後に「さらに表示」を押すと、完了した時点で外された案件の抜粋が画面のどこにもなく、残りの行と次のページの行が重複・欠落なく出る", async () => {
    const { world, app, main } = await showFirstPage();
    // サーバーの側で、その案件から外された状態に変える（以後、1ページ目からその行が消え、次のページも 200）
    world.pages.set(null, { items: [keptRow], nextCursor: "CURSOR1" });
    await app.user.click(
      within(main).getByRole("button", { name: "さらに表示" }),
    );
    await waitFor(() => expect(bodyText()).toContain(NEXT_EXCERPT));
    await waitFor(() => expect(bodyText()).not.toContain(CASE_EXCERPT));
    expect(bodyText()).toContain(KEPT_EXCERPT);
    const hrefs = rowIds(main);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs).toEqual([
      `/channels/${keptRow.roomId}?thread=${keptRow.messageId}`,
      `/channels/${nextRow.roomId}?thread=${nextRow.messageId}`,
    ]);
    expect(
      within(main).queryByRole("button", { name: "さらに表示" }),
    ).toBeNull();
  });

  it("#155 AC-4 F-8: 「さらに表示」が 403 で拒否されたら、取得済みの抜粋を残さず、失敗の文言と再試行を出す", async () => {
    const { world, app, main } = await showFirstPage();
    world.fail = { status: 403, times: 10 };
    await app.user.click(
      within(main).getByRole("button", { name: "さらに表示" }),
    );
    expect(await within(main).findByRole("alert")).toBeDefined();
    expect(within(main).getByRole("button", { name: "再試行" })).toBeDefined();
    expect(bodyText()).not.toContain(CASE_EXCERPT);
    expect(bodyText()).not.toContain(KEPT_EXCERPT);
  });
});

describe("#155 AC-4 F-8 結果が出ている状態からの取り直しの失敗", () => {
  for (const [label, fail] of [
    ["500", { status: 500 }],
    ["403", { status: 403 }],
  ] as const)
    it(`#155 AC-4 F-8: ウィンドウに戻ったときの取り直しが ${label} で失敗したら、前の抜粋を画面のどこにも出さず、失敗の文言と再試行を出す`, async () => {
      const { world, main } = await showFirstPage();
      world.fail = { status: fail.status, times: 10 };
      const before = world.requests.length;
      await refocus();
      await waitFor(() =>
        expect(world.requests.length).toBeGreaterThan(before),
      );
      expect(await within(main).findByRole("alert")).toBeDefined();
      expect(
        within(main).getByRole("button", { name: "再試行" }),
      ).toBeDefined();
      expect(bodyText()).not.toContain(CASE_EXCERPT);
      expect(bodyText()).not.toContain(KEPT_EXCERPT);
    });

  it("#155 AC-4 F-8: ウィンドウに戻ったときの取り直しが通信の失敗になったら、前の抜粋を画面のどこにも出さず、失敗の文言と再試行を出す", async () => {
    const { world, main } = await showFirstPage();
    let failed = 0;
    server.use(
      http.get("/api/search/messages", () => {
        failed += 1;
        return HttpResponse.error();
      }),
    );
    await refocus();
    await waitFor(() => expect(failed).toBeGreaterThan(0));
    expect(await within(main).findByRole("alert")).toBeDefined();
    expect(bodyText()).not.toContain(CASE_EXCERPT);
    expect(bodyText()).not.toContain(KEPT_EXCERPT);
    void world;
  });
});

// ---- コードレビュー2回目 ----

describe("#155 AC-4 F-8 検索の画面を表示中に、案件の資格の後片付けが走ったとき（重大）", () => {
  // 後片付けは、退出の mutation の onSuccess（useRemoveCaseParticipant。画面が生きているかに依らず定義の側で走る）と、
  // useCaseAccessLoss の、画面を離れた後に届いた確認の結果（forgetCaseAfterLeave／forgetCaseContent）から呼ばれる。
  // どちらも、検索の画面を表示している間に起こりうる（退出の要求を保留したまま検索へ移る／確認の応答の前に検索へ移る）。
  // ここでは、その最後の一歩（後片付けの関数の呼び出し）を、検索の画面を表示した状態で起こす。
  const CASE_ID = "01JTESTCASE155000000000007";
  for (const [label, run] of [
    [
      "退出の後片付け（forgetCaseAfterLeave）",
      (client: QueryClient, userId: string) =>
        forgetCaseAfterLeave(client, userId, CASE_ID),
    ],
    [
      "中身の後片付け（forgetCaseContent）",
      (client: QueryClient, userId: string) =>
        forgetCaseContent(client, userId, CASE_ID),
    ],
  ] as const)
    it(`#155 AC-4 F-8: ${label}が走ると、外された案件の抜粋が画面のどこにもなくなり、取り直した結果（いまの資格で見える行）だけが出る`, async () => {
      const { world, app } = await showFirstPage();
      // サーバーの側では、もう外されている（取り直しの応答は、その案件の行を含まない）
      world.pages = new Map([[null, { items: [keptRow], nextCursor: null }]]);
      const before = world.requests.length;
      await act(async () => {
        await run(app.client, SHELL_USER.id);
      });
      await waitFor(() => expect(bodyText()).not.toContain(CASE_EXCERPT));
      await waitFor(() =>
        expect(world.requests.length).toBeGreaterThan(before),
      );
      await waitFor(() => expect(bodyText()).toContain(KEPT_EXCERPT));
      expect(bodyText()).not.toContain(CASE_EXCERPT);
    });
});

describe("#155 AC-4 F-8 途中のページだけが失敗したとき（軽微）", () => {
  for (const status of [500, 403])
    it(`#155 AC-4 F-8: 1ページ目は成功・2ページ目だけ ${String(status)} のとき、「さらに表示」の後に、古い行も途中の結果も出さず、失敗の文言と再試行を出す。再試行は1ページ目から始まる`, async () => {
      const { world, app, main } = await showFirstPage();
      server.use(
        http.get("/api/search/messages", ({ request }) => {
          if (new URL(request.url).searchParams.get("cursor") !== "CURSOR1")
            return undefined;
          world.requests.push({
            q: null,
            roomId: null,
            from: null,
            to: null,
            cursor: "CURSOR1",
            limit: null,
          });
          return HttpResponse.json(
            { code: "ERROR", message: "エラーが発生しました" },
            { status },
          );
        }),
      );
      await app.user.click(
        within(main).getByRole("button", { name: "さらに表示" }),
      );
      expect(await within(main).findByRole("alert")).toBeDefined();
      expect(world.requests.at(-1)?.cursor).toBe("CURSOR1");
      expect(bodyText()).not.toContain(CASE_EXCERPT);
      expect(bodyText()).not.toContain(KEPT_EXCERPT);
      expect(bodyText()).not.toContain(NEXT_EXCERPT);
      const before = world.requests.length;
      await app.user.click(
        within(main).getByRole("button", { name: "再試行" }),
      );
      await waitFor(() =>
        expect(world.requests.length).toBeGreaterThan(before),
      );
      expect(world.requests[before]?.cursor).toBeNull();
    });
});

const rowsIn = (main: HTMLElement) => within(main).queryAllByRole("listitem");

describe("#155 AC-3 F-2 取り消された取得は、残りのページを取りにいかない（軽微）", () => {
  async function threePagesWithHeldRefetch() {
    const world = respondSearchPages([
      {
        items: [searchItem(11, { excerpt: "[E2E_TEST]頁一" })],
        nextCursor: "P1",
      },
      {
        items: [searchItem(12, { excerpt: "[E2E_TEST]頁二" })],
        nextCursor: "P2",
      },
      {
        items: [searchItem(13, { excerpt: "[E2E_TEST]頁三" })],
        nextCursor: "P3",
      },
      {
        items: [searchItem(14, { excerpt: "[E2E_TEST]頁四" })],
        nextCursor: null,
      },
    ]);
    const app = renderApp("/search?q=頁");
    const main = await pageMain();
    await waitFor(() => expect(rowsIn(main)).toHaveLength(1));
    await app.user.click(
      within(main).getByRole("button", { name: "さらに表示" }),
    );
    await waitFor(() => expect(rowsIn(main)).toHaveLength(2));
    // 3ページ目までの取り直しを始め、その1ページ目の応答を保留する。保留した要求の中断（signal）を観測できるようにする
    const gate = deferred();
    const held: { arrived: boolean; aborted: boolean } = {
      arrived: false,
      aborted: false,
    };
    // 保留した要求の通信（Axios の XMLHttpRequest）が中断されたかを見張る
    const urls = new WeakMap<XMLHttpRequest, string>();
    const open = XMLHttpRequest.prototype.open;
    const abort = XMLHttpRequest.prototype.abort;
    vi.spyOn(XMLHttpRequest.prototype, "open").mockImplementation(function (
      this: XMLHttpRequest,
      ...args: Parameters<XMLHttpRequest["open"]>
    ) {
      urls.set(this, String(args[1]));
      return (open as (...a: unknown[]) => void).apply(this, args);
    });
    vi.spyOn(XMLHttpRequest.prototype, "abort").mockImplementation(function (
      this: XMLHttpRequest,
    ) {
      const url = new URL(urls.get(this) ?? "/", "http://localhost");
      if (
        url.pathname === "/api/search/messages" &&
        url.searchParams.get("q") === "頁" &&
        url.searchParams.get("cursor") === null
      )
        held.aborted = true;
      abort.call(this);
    });
    server.use(
      http.get("/api/search/messages", async ({ request }) => {
        const url = new URL(request.url);
        if (
          held.arrived ||
          url.searchParams.get("q") !== "頁" ||
          url.searchParams.get("cursor") !== null
        )
          return undefined;
        held.arrived = true;
        await gate.promise;
        return undefined;
      }),
    );
    const before = world.requests.length;
    await app.user.click(
      within(main).getByRole("button", { name: "さらに表示" }),
    );
    await waitFor(() => expect(held.arrived).toBe(true));
    return { world, app, main, gate, before, held };
  }

  const oldContinued = (world: SearchWorld, from: number) =>
    world.requests.slice(from).filter((r) => r.q === "頁" && r.cursor !== null);

  it("#155 AC-3 F-2: 取り直しの途中で言葉を変えたら、保留を解いた後に、古い言葉の2ページ目以降の要求が出ない", async () => {
    const { world, app, main, gate, before, held } =
      await threePagesWithHeldRefetch();
    const input = within(main).getByRole("searchbox", { name: "検索する言葉" });
    await app.user.clear(input);
    await app.user.type(input, "別語");
    await app.user.click(within(main).getByRole("button", { name: "検索" }));
    await waitFor(() =>
      expect(world.requests.some((r) => r.q === "別語")).toBe(true),
    );
    // 古い取得が中断されたこと（保留中の要求の通信の abort）を観測してから、保留を解く。中断されていれば、続きのページの要求は出ようがない
    await waitFor(() => expect(held.aborted).toBe(true));
    gate.release();
    expect(oldContinued(world, before)).toEqual([]);
  });

  it("#155 AC-3 F-2: 取り直しの途中で画面を離れたら、保留を解いた後に、古い条件の2ページ目以降の要求が出ない", async () => {
    const { world, app, before, gate, held } =
      await threePagesWithHeldRefetch();
    await app.user.click(
      within(screen.getByRole("banner")).getByRole("link", {
        name: "internal-system",
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { level: 1, name: "検索結果" }),
      ).toBeNull(),
    );
    // 古い取得が中断されたこと（保留中の要求の通信の abort）を観測してから、保留を解く。中断されていれば、続きのページの要求は出ようがない
    await waitFor(() => expect(held.aborted).toBe(true));
    gate.release();
    expect(oldContinued(world, before)).toEqual([]);
  });
});
