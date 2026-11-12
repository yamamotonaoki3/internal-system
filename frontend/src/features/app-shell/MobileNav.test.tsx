// #121 AC-1：MobileNav（下部メニュー。md未満で表示）。ホーム・「DM」（#136）・「通知」（#124）・「自分」。「自分」は、アバターメニューを開く。
// 公開形の仮定：nav の名前は「下部メニュー」。ホームは link（aria-current）、「自分」は button（popovertarget でアバターメニュー本体を指す）。
// jsdom はメディアクエリを適用しないため、md以上でも DOM にある。表示の切り替えは E2E（e2e/app-shell.spec.ts）で確かめる。
import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installDomStubs,
  renderApp,
  respondShellUser,
  type DomStubs,
} from "../../test/app-shell-harness";

let stubs: DomStubs;
beforeEach(() => {
  stubs = installDomStubs();
});
afterEach(() => {
  stubs.restore();
});

describe("#121 AC-1 MobileNav", () => {
  it("#121 AC-1・#124 AC-1・#136 AC-1（1-2 AC-4）: 下部メニューには、ホーム・DM・通知のリンクと「自分」のボタンだけがある（動かない仮項目を置かない）", async () => {
    respondShellUser();
    renderApp("/");
    const nav = within(
      await screen.findByRole("navigation", { name: "下部メニュー" }),
    );
    // #124・#136：ホーム → DM → 通知 → 「自分」の順。通知は S-14（/notifications）へのリンク
    const links = nav.getAllByRole("link");
    expect(links).toHaveLength(3);
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      "ホーム",
      "DM",
      "通知",
    ]);
    expect(nav.getAllByRole("button")).toHaveLength(1);
    const home = nav.getByRole("link", { name: "ホーム" });
    expect(home.getAttribute("href")).toBe("/");
    expect(home.getAttribute("aria-current")).toBe("page");
    const notifications = nav.getByRole("link", { name: "通知" });
    expect(notifications.getAttribute("href")).toBe("/notifications");
    expect(notifications.getAttribute("aria-current")).toBeNull();
    // #136：DM は DM の一覧（/dms）へのリンク
    const dms = nav.getByRole("link", { name: "DM" });
    expect(dms.getAttribute("href")).toBe("/dms");
    expect(dms.getAttribute("aria-current")).toBeNull();
  });

  it("#121 AC-1: 「自分」は最後の項目で、アバターメニューの本体（popover）を指す", async () => {
    respondShellUser();
    renderApp("/");
    const navElement = await screen.findByRole("navigation", {
      name: "下部メニュー",
    });
    const nav = within(navElement);
    const self = nav.getByRole("button", { name: "自分" });
    expect(navElement.textContent?.trim().endsWith("自分")).toBe(true);
    const panel = screen
      .getByRole("button", { name: "ログアウト" })
      .closest("[popover]");
    expect(panel).not.toBeNull();
    expect(self.getAttribute("popovertarget")).toBe(panel?.id);
    expect(self.getAttribute("aria-controls")).toBe(panel?.id);
    expect(self.getAttribute("aria-expanded")).toBe("false");
  });
});
