// #155（155-A）S-15：検索の結果を表示した状態・条件を変えた後・「さらに表示」の後に、console.error（React の警告を含む）が出ないこと。
// 画面のテストの共通の準備（test/setup.ts）は console.error を失敗にしないため、ここで個別に見張る（leave-guard の画面のテストと同じ決まり）。
// E2E（e2e/search.spec.ts）で、兄弟の要素に同じ key が付いた React の警告（Encountered two children with the same key）が出たことへの、再発の防止。
// 画面の契約は SearchPage.test.tsx の冒頭と同じ。データはすべて架空（[E2E_TEST]・testuser_）。
import { screen, waitFor, within } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import {
  installDomStubs,
  renderApp,
  respondShellUser,
  type DomStubs,
} from "../test/app-shell-harness";
import { respondSearchPages, searchItem } from "../test/search-handlers";

let stubs: DomStubs;
let consoleError: MockInstance<typeof console.error>;
beforeEach(() => {
  stubs = installDomStubs();
  respondShellUser();
  consoleError = vi.spyOn(console, "error");
});
afterEach(() => {
  consoleError.mockRestore();
  stubs.restore();
});

const errorMessages = () =>
  consoleError.mock.calls.map((args) => args.map(String).join(" "));

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

describe("#155 AC-1 F-2 検索の画面で console.error を出さない", () => {
  it("#155 AC-1 F-2: 結果の表示・言葉を変えた後・「さらに表示」の後に、console.error（React の警告を含む）が1件も出ない", async () => {
    respondSearchPages([
      { items: [searchItem(1)], nextCursor: "CURSOR1" },
      { items: [searchItem(2)], nextCursor: null },
    ]);
    const { user } = renderApp("/search?q=見積書");
    const main = await pageMain();
    await waitFor(() => expect(rowsIn(main)).toHaveLength(1));
    expect(errorMessages()).toEqual([]);

    // 言葉を変える（条件が変わり、結果の部品が作り直される）
    const input = within(main).getByRole("searchbox", { name: "検索する言葉" });
    await user.clear(input);
    await user.type(input, "請求書");
    await user.click(within(main).getByRole("button", { name: "検索" }));
    const afterChange = await pageMain();
    await waitFor(() => expect(rowsIn(afterChange)).toHaveLength(1));
    expect(errorMessages()).toEqual([]);

    // さらに表示
    await user.click(
      within(afterChange).getByRole("button", { name: "さらに表示" }),
    );
    await waitFor(() => expect(rowsIn(afterChange)).toHaveLength(2));
    expect(errorMessages()).toEqual([]);
  });
});
