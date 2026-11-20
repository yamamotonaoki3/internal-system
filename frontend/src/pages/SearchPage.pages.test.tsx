// #155（155-A）コードレビュー1回目の重大への対応の後の、ページの読み方の確認（S-15）。
// 契約（統括の決定 2026-11-21・計画 4.5）：「さらに表示」は、前のページもその時点の資格で取り直す。取得の方式（要求の回数）は決めず、利用者に見えることで確かめる。
//   ・「さらに表示」の取得の最中は、古い行を出さず、読み込み中だけを出す。最中は「さらに表示」を押せない
//   ・条件（言葉・期間）を変えたら、見せるページ数は1に戻る（新しい条件の要求は1ページ分だけ）
//   ・3ページ目まで読むとき、各ページのカーソルは、同じ取り直しの中の直前のページの応答から作る
// 利用者の切り替えの後に前の利用者の結果を引き継がないことは、SearchPage.userSwitch.test.tsx が確かめる。
// 抜粋の文字は、強調の <mark> で要素が分かれるため、画面全体の textContent のつながりで確かめる。データはすべて架空（[E2E_TEST]・testuser_）。
import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authKeys } from "../features/auth";
import { respondLoggedOut, respondPublicStatus } from "../test/auth-handlers";
import {
  installDomStubs,
  renderApp,
  respondShellUser,
  type DomStubs,
} from "../test/app-shell-harness";
import {
  deferred,
  respondSearchPages,
  searchItem,
} from "../test/search-handlers";

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

const rowsIn = (main: HTMLElement) => within(main).queryAllByRole("listitem");

const excerpt = (n: number) => searchItem(n).excerpt;

describe("#155 AC-4 F-2 「さらに表示」の取得の最中", () => {
  it("#155 AC-4 F-2: 取得の最中は古い行を出さず読み込み中だけを出し、「さらに表示」を押せない。完了すると2ページ分が出る", async () => {
    const world = respondSearchPages([
      { items: [searchItem(1)], nextCursor: "CURSOR1" },
      { items: [searchItem(2)], nextCursor: null },
    ]);
    const { user } = renderApp("/search?q=見積書");
    const main = await pageMain();
    await waitFor(() => expect(bodyText()).toContain(excerpt(1)));
    const gate = deferred();
    world.hold = gate.promise;
    await user.click(within(main).getByRole("button", { name: "さらに表示" }));
    expect(await within(main).findByText("読み込み中です")).toBeDefined();
    expect(bodyText()).not.toContain(excerpt(1));
    const more = within(main).queryByRole("button", { name: "さらに表示" });
    expect(more === null || (more as HTMLButtonElement).disabled).toBe(true);
    gate.release();
    await waitFor(() => expect(rowsIn(main)).toHaveLength(2));
    expect(bodyText()).toContain(excerpt(1));
    expect(bodyText()).toContain(excerpt(2));
  });
});

describe("#155 AC-3 F-2 条件を変えたらページ数は1に戻る", () => {
  it("#155 AC-3 F-2: 3ページ読んだ後に言葉を変えると、新しい言葉の要求は1ページ分だけで、「さらに表示」が出る", async () => {
    const world = respondSearchPages([
      { items: [searchItem(1)], nextCursor: "C1" },
      { items: [searchItem(2)], nextCursor: "C2" },
      { items: [searchItem(3)], nextCursor: "C3" },
      { items: [searchItem(4)], nextCursor: null },
    ]);
    const { user } = renderApp("/search?q=見積書");
    const main = await pageMain();
    for (const expected of [2, 3]) {
      await waitFor(() => expect(rowsIn(main)).toHaveLength(expected - 1));
      await user.click(
        within(main).getByRole("button", { name: "さらに表示" }),
      );
    }
    await waitFor(() => expect(rowsIn(main)).toHaveLength(3));
    const before = world.requests.length;
    const input = within(main).getByRole("searchbox", { name: "検索する言葉" });
    await user.clear(input);
    await user.type(input, "請求書");
    await user.click(within(main).getByRole("button", { name: "検索" }));
    await waitFor(() =>
      expect(world.requests.slice(before).map((r) => r.q)).toEqual(["請求書"]),
    );
    const fresh = await pageMain();
    await waitFor(() => expect(rowsIn(fresh)).toHaveLength(1));
    expect(world.requests.slice(before)[0]?.cursor).toBeNull();
    expect(
      within(await pageMain()).getByRole("button", { name: "さらに表示" }),
    ).toBeDefined();
  });

  it("#155 AC-3 F-2: 2ページ読んだ後に期間を変えると、新しい条件の要求は1ページ分だけ", async () => {
    const world = respondSearchPages([
      { items: [searchItem(1)], nextCursor: "C1" },
      { items: [searchItem(2)], nextCursor: "C2" },
      { items: [searchItem(3)], nextCursor: null },
    ]);
    const { user } = renderApp("/search?q=見積書");
    const main = await pageMain();
    await waitFor(() => expect(rowsIn(main)).toHaveLength(1));
    await user.click(within(main).getByRole("button", { name: "さらに表示" }));
    await waitFor(() => expect(rowsIn(main)).toHaveLength(2));
    const before = world.requests.length;
    await user.click(within(main).getByText("絞り込み"));
    await user.type(within(main).getByLabelText("開始日"), "2026-11-01");
    await user.click(within(main).getByRole("button", { name: "検索" }));
    await waitFor(() => expect(world.requests.slice(before)).toHaveLength(1));
    expect(world.requests.slice(before)[0]).toMatchObject({
      from: "2026-11-01",
      cursor: null,
    });
    const fresh = await pageMain();
    await waitFor(() => expect(rowsIn(fresh)).toHaveLength(1));
  });
});

describe("#155 AC-3 F-2 3ページ目までのカーソル", () => {
  it("#155 AC-3 F-2: 3ページ目まで読むとき、各ページのカーソルは同じ取り直しの中の直前のページの応答から作る", async () => {
    const world = respondSearchPages([
      { items: [searchItem(1)], nextCursor: "C1" },
      { items: [searchItem(2)], nextCursor: "C2" },
      { items: [searchItem(3)], nextCursor: null },
    ]);
    const { user } = renderApp("/search?q=見積書");
    const main = await pageMain();
    await waitFor(() => expect(rowsIn(main)).toHaveLength(1));
    await user.click(within(main).getByRole("button", { name: "さらに表示" }));
    await waitFor(() => expect(rowsIn(main)).toHaveLength(2));
    // 次の取り直しでは、1ページ目・2ページ目の応答のカーソルが変わる
    world.pages = new Map([
      [null, { items: [searchItem(1)], nextCursor: "C1X" }],
      ["C1X", { items: [searchItem(2)], nextCursor: "C2X" }],
      ["C2X", { items: [searchItem(3)], nextCursor: null }],
    ]);
    const before = world.requests.length;
    await user.click(within(main).getByRole("button", { name: "さらに表示" }));
    await waitFor(() => expect(rowsIn(main)).toHaveLength(3));
    expect(world.requests.slice(before).map((r) => r.cursor)).toEqual([
      null,
      "C1X",
      "C2X",
    ]);
    for (const n of [1, 2, 3]) expect(bodyText()).toContain(excerpt(n));
    expect(
      within(main).queryByRole("button", { name: "さらに表示" }),
    ).toBeNull();
  });
});

describe("#155 AC-4 F-8 画面を離れたときの片付けの範囲（ミューテーション診断の生き残り）", () => {
  it("#155 AC-4 F-8: 検索の画面を離れても、片付けるのは検索の結果だけで、セッションなどほかのキャッシュは残る", async () => {
    respondSearchPages([{ items: [searchItem(1)], nextCursor: null }]);
    const { user, client } = renderApp("/search?q=見積書");
    const main = await pageMain();
    await waitFor(() => expect(rowsIn(main)).toHaveLength(1));
    expect(client.getQueryData(authKeys.session)).toBeDefined();
    await user.click(
      within(screen.getByRole("banner")).getByRole("link", {
        name: "internal-system",
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { level: 1, name: "検索結果" }),
      ).toBeNull(),
    );
    expect(client.getQueryData(authKeys.session)).toBeDefined();
    await waitFor(() =>
      expect(client.getQueryCache().findAll({ queryKey: ["search"] })).toEqual(
        [],
      ),
    );
  });

  it("#155 AC-4 F-8: 未ログインのまま /search を開いても、検索の API を呼ばない", async () => {
    respondLoggedOut();
    respondPublicStatus();
    const world = respondSearchPages([
      { items: [searchItem(1)], nextCursor: null },
    ]);
    renderApp("/search?q=見積書");
    await screen.findByRole("button", { name: "ログイン" });
    expect(world.requests).toEqual([]);
  });
});
