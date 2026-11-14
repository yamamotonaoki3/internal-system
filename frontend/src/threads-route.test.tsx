// #137 AC-1（1-4 AC-4）: /threads のルートと、サイドバーの固定リンク「スレッド」。App を通して描画する（枠 AppShell のサイドバーを含む）。API は MSW。データは架空。
// 契約（実装前の仮置き。計画 plan-137 の「9. 画面」・Skill project-rules の共通レイアウト。実装者へ）：
//   - /threads は S-35（pages/ThreadsPage。h1「スレッド」とスレッド一覧）。App.tsx のレイアウトルートの子として登録する
//   - サイドバー（nav「メインメニュー」）の固定リンクに「スレッド」（/threads）を、navigation.ts の primaryNavItems の1か所だけに足す（権限の条件は付けない）
//   - /threads にいる間は、そのリンクに aria-current="page" が付く
//   - サイドバーに、未読の合計の件数は出さない（#240 で検討）。下部メニューは変えない
import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installDomStubs,
  renderApp,
  respondShellUser,
  type DomStubs,
} from "./test/app-shell-harness";
import { respondMyThreads, threadItem } from "./test/thread-handlers";

let stubs: DomStubs;
beforeEach(() => {
  stubs = installDomStubs();
  respondShellUser();
});
afterEach(() => {
  stubs.restore();
});

const menu = () => screen.findByRole("navigation", { name: "メインメニュー" });
const path = () => screen.getByTestId("path").textContent;

describe("#137 AC-1（1-4 AC-4）/threads とサイドバーの「スレッド」", () => {
  it("#137 AC-1（1-4 AC-4）: /threads は S-35（h1「スレッド」とスレッド一覧）を出す", async () => {
    respondMyThreads([
      threadItem(1, { parent: { body: "[E2E_TEST]ルートの親" } }),
    ]);
    renderApp("/threads");
    await screen.findByRole("heading", { level: 1, name: "スレッド" });
    const main = screen.getByRole("main");
    expect(
      await within(main).findByRole("list", { name: "スレッド一覧" }),
    ).toBeDefined();
    expect(within(main).getByText(/\[E2E_TEST\]ルートの親/)).toBeDefined();
  });

  it("#137 AC-1（1-4 AC-4）: サイドバーの固定リンクに「スレッド」（/threads）がある", async () => {
    respondMyThreads([]);
    renderApp("/");
    const link = within(await menu()).getByRole("link", { name: "スレッド" });
    expect(link.getAttribute("href")).toBe("/threads");
  });

  it("#137 AC-1（1-4 AC-4）: サイドバーの「スレッド」を選ぶと /threads へ進み、そのリンクに aria-current=page が付く", async () => {
    respondMyThreads([]);
    const { user } = renderApp("/");
    await user.click(
      within(await menu()).getByRole("link", { name: "スレッド" }),
    );
    await waitFor(() => expect(path()).toBe("/threads"));
    await screen.findByRole("heading", { level: 1, name: "スレッド" });
    expect(
      within(await menu())
        .getByRole("link", { name: "スレッド" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });

  it("#137 AC-1（1-4 AC-4）: サイドバーのリンクに、未読の合計の件数は出さない（#240 で検討）", async () => {
    respondMyThreads([threadItem(1, { unreadCount: 7 })]);
    renderApp("/");
    const link = within(await menu()).getByRole("link", { name: "スレッド" });
    expect(link.textContent?.trim()).toBe("スレッド");
  });
});
