// #155（155-A）コードレビュー1回目の重大：資格を失った後、または取り直しに失敗した後に、取得済みのページの抜粋を画面に残さない
// （計画 4.5「再取得が失敗したら、前の結果を出さずにエラーを出す。複数ページの途中で資格を失っても、次のページの取得で前のページを残さない」・Issue AC-4）。
// 実装の方式（前のページを取り直す／捨てて1ページ目から、など）は決めず、画面に何が出るかで確かめる。
// 抜粋の中の一致は <mark> で強調されて要素が分かれるため、文字は画面全体の textContent のつながりで確かめる。
// 画面の契約は SearchPage.test.tsx の冒頭と同じ。データはすべて架空（[E2E_TEST]・testuser_）。
import { act, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installDomStubs,
  renderApp,
  respondShellUser,
  type DomStubs,
} from "../test/app-shell-harness";
import { respondSearchPages, searchItem } from "../test/search-handlers";
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
