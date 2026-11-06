// #121 AC-1：アバターメニュー（ネイティブ popover。中身はログアウトのみ）。ヘッダーのアバターと下部メニューの「自分」が、同じ1つの popover を開く。
// 本番は popoverTarget のブラウザ既定の動作で開閉する。jsdom には popover がないため、ここでは「属性・toggle イベントへの反応・中身・幅変更」までを確かめ、
// 実際の開閉・Tab順・Esc で閉じてボタンへ戻る・外側クリック・最前面は e2e/app-shell.spec.ts で確かめる。
// 公開形の仮定（契約）：
//  - ヘッダーのアバターのボタンの名前は「アカウントメニュー（{表示名}）」。下部メニューの「自分」のボタンの名前は「自分」
//  - どちらも popovertarget・aria-controls が popover の要素の id を指し、aria-expanded（toggle の newState で更新）を持つ
//  - popover の要素は popover="auto"。role="menu"・aria-haspopup は付けない
//  - 画面幅が 768px 以上に変わったら hidePopover を呼び、フォーカスがメニューの中・起動ボタンにあれば #main-content に移す
import { act, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  fireToggle,
  findHome,
  installDomStubs,
  renderApp,
  respondShellUser,
  SHELL_USER,
  type DomStubs,
} from "../../test/app-shell-harness";
import { respondLoggedOut } from "../../test/auth-handlers";
import { server } from "../../test/server";

let stubs: DomStubs;
beforeEach(() => {
  stubs = installDomStubs();
});
afterEach(() => {
  stubs.restore();
});

const AVATAR_NAME = `アカウントメニュー（${SHELL_USER.displayName}）`;

async function renderMenu() {
  respondShellUser();
  const rendered = renderApp("/");
  await findHome();
  const avatar = screen.getByRole("button", { name: AVATAR_NAME });
  const self = screen.getByRole("button", { name: "自分" });
  const logout = screen.getByRole("button", { name: "ログアウト" });
  const panel = logout.closest<HTMLElement>("[popover]");
  if (panel === null) throw new Error("popover の要素が見つかりません");
  return { ...rendered, avatar, self, logout, panel };
}

describe("#121 AC-1 AvatarMenu", () => {
  it("#121 AC-1: popover 属性（auto）の要素で、ヘッダーのアバターと「自分」の両方が同じ要素を指す", async () => {
    const { avatar, self, panel } = await renderMenu();
    expect(panel.getAttribute("popover")).toBe("auto");
    expect(panel.id).not.toBe("");
    for (const trigger of [avatar, self]) {
      expect(trigger.getAttribute("popovertarget")).toBe(panel.id);
      expect(trigger.getAttribute("aria-controls")).toBe(panel.id);
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
    }
    expect(document.querySelectorAll("[popover]")).toHaveLength(1);
  });

  it("#121 AC-1: role=menu・aria-haspopup は付けない（矢印キーの約束を作らない）", async () => {
    const { avatar, self, panel } = await renderMenu();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(panel.getAttribute("role")).not.toBe("menu");
    expect(avatar.getAttribute("aria-haspopup")).toBeNull();
    expect(self.getAttribute("aria-haspopup")).toBeNull();
  });

  it("#123 0-3 AC-1: popover に変更画面へのリンクとログアウトを出す", async () => {
    const { panel } = await renderMenu();
    expect(panel.querySelectorAll("button")).toHaveLength(1);
    const change = screen.getByRole("link", { name: "パスワードを変更" });
    expect(change.getAttribute("href")).toBe("/password");
    expect(panel.contains(change)).toBe(true);
  });

  it("#121 AC-1: toggle（newState=open）で、両方の起動ボタンの aria-expanded が true になり、closed で false に戻る", async () => {
    const { avatar, self, panel } = await renderMenu();
    fireToggle(panel, "open");
    await waitFor(() => {
      expect(avatar.getAttribute("aria-expanded")).toBe("true");
      expect(self.getAttribute("aria-expanded")).toBe("true");
    });
    fireToggle(panel, "closed");
    await waitFor(() => {
      expect(avatar.getAttribute("aria-expanded")).toBe("false");
      expect(self.getAttribute("aria-expanded")).toBe("false");
    });
  });

  it("#121 AC-1: アバターメニューのログアウトを押すと、ログアウトを送り /login へ移る", async () => {
    let calls = 0;
    server.use(
      http.post("/api/auth/logout", () => {
        calls += 1;
        respondLoggedOut();
        return new HttpResponse(null, { status: 204 });
      }),
      http.get("/api/health", () =>
        HttpResponse.json({ status: "ok", appEnv: "test" }),
      ),
      http.get("/api/setup/status", () =>
        HttpResponse.json({ setupRequired: false }),
      ),
    );
    const { user, logout, client } = await renderMenu();
    await user.click(logout);
    await waitFor(() =>
      expect(screen.getByTestId("path").textContent).toBe("/login"),
    );
    expect(calls).toBe(1);
    // /login の取得（health・setup/status）が終わるまで待ち、次のテストに通信を持ち越さない
    expect(await screen.findByLabelText("ユーザーID")).toBeDefined();
    await waitFor(() => expect(client.isFetching()).toBe(0));
  });

  it("#121 AC-1: 開いたまま画面幅が 768px 以上に変わると、popover を閉じ、メニュー内にあったフォーカスは #main-content に移る", async () => {
    const { logout, panel } = await renderMenu();
    fireToggle(panel, "open");
    act(() => logout.focus());
    expect(document.activeElement).toBe(logout);
    stubs.setDesktop(true);
    await waitFor(() => expect(stubs.hidePopover).toHaveBeenCalled());
    expect(document.activeElement).toBe(screen.getByRole("main"));
  });

  it("#121 AC-1: 開いたまま画面幅が 768px 以上に変わると、非表示になる起動ボタン（自分）にあったフォーカスも #main-content に移る", async () => {
    const { self, panel } = await renderMenu();
    fireToggle(panel, "open");
    act(() => self.focus());
    stubs.setDesktop(true);
    await waitFor(() => expect(stubs.hidePopover).toHaveBeenCalled());
    expect(document.activeElement).toBe(screen.getByRole("main"));
  });
});
