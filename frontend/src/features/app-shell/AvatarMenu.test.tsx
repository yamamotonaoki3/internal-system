// #121 AC-1：アバターメニュー（ネイティブ popover）。#130 で中身は プロフィール設定 → ステータス → パスワード変更 → ログアウト になった。ヘッダーのアバターと下部メニューの「自分」が、同じ1つの popover を開く。
// 本番は popoverTarget のブラウザ既定の動作で開閉する。jsdom には popover がないため、ここでは「属性・toggle イベントへの反応・中身・幅変更」までを確かめ、
// 実際の開閉・Tab順・Esc で閉じてボタンへ戻る・外側クリック・最前面は e2e/app-shell.spec.ts で確かめる。
// 公開形の仮定（契約）：
//  - ヘッダーのアバターのボタンの名前は「アカウントメニュー（{表示名}）」。下部メニューの「自分」のボタンの名前は「自分」
//  - どちらも popovertarget・aria-controls が popover の要素の id を指し、aria-expanded（toggle の newState で更新）を持つ
//  - popover の要素は popover="auto"。role="menu"・aria-haspopup は付けない
//  - 画面幅が 768px 以上に変わったら hidePopover を呼び、フォーカスがメニューの中・起動ボタンにあれば #main-content に移す
import { act, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireToggle,
  findHome,
  installDomStubs,
  renderApp,
  respondShellUser,
  SHELL_USER,
  type DomStubs,
} from "../../test/app-shell-harness";
import { respondProfileWorld } from "../../test/profile-handlers";
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
    // #130：ヘッダーのステータスも別の popover を持つため、数えるのはアバターメニューの要素だけにする（同じ id は1つ）
    expect(document.querySelectorAll(`[id="${panel.id}"]`)).toHaveLength(1);
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
    // #130：アバターメニューにステータスの切り替え（ボタン）が加わるため、ボタンの数ではなくログアウトが1つあることを確かめる
    expect(
      within(panel).getAllByRole("button", { name: "ログアウト" }),
    ).toHaveLength(1);
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

// #130 AC-2（6-1 AC-2・C-79）：アバターメニューの項目の並びは プロフィール → ステータス → パスワード変更 → ログアウト（docs/design/app-shell.md）。
describe("#130 AC-2 AvatarMenu の項目", () => {
  const follows = (a: Node, b: Node) =>
    (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

  it("#130 AC-2（6-1 AC-2・C-79）: プロフィール設定（/profile）→ ステータス（5種類）→ パスワードを変更 → ログアウト の順に並ぶ", async () => {
    const { panel } = await renderMenu();
    const profile = within(panel).getByRole("link", {
      name: "プロフィール設定",
    });
    expect(profile.getAttribute("href")).toBe("/profile");
    const statusButtons = ["在席", "外出", "欠席", "休暇", "会議中"].map(
      (label) => within(panel).getByRole("button", { name: new RegExp(label) }),
    );
    const password = within(panel).getByRole("link", {
      name: "パスワードを変更",
    });
    const logout = within(panel).getByRole("button", { name: "ログアウト" });
    const first = statusButtons[0];
    const last = statusButtons[statusButtons.length - 1];
    if (first === undefined || last === undefined)
      throw new Error("ステータスのボタンがありません");
    expect(follows(profile, first)).toBe(true);
    expect(follows(last, password)).toBe(true);
    expect(follows(password, logout)).toBe(true);
  });

  it("#130 AC-2（6-1 AC-2・P-7）: ヘッダーのステータスとアバターメニューは、どちらも popover=auto（同時に1つだけ開く）", async () => {
    const { panel } = await renderMenu();
    const banner = screen.getByRole("banner");
    const statusTrigger = within(banner).getByRole("button", {
      name: /ステータス/,
    });
    const statusPanelId = statusTrigger.getAttribute("popovertarget");
    expect(statusPanelId).not.toBeNull();
    expect(statusPanelId).not.toBe(panel.id);
    const statusPanel = document.getElementById(statusPanelId ?? "");
    expect(statusPanel?.getAttribute("popover")).toBe("auto");
    expect(panel.getAttribute("popover")).toBe("auto");
    // 一方を開くと、もう一方の aria-expanded は false のまま
    fireToggle(statusPanel as HTMLElement, "open");
    await waitFor(() =>
      expect(statusTrigger.getAttribute("aria-expanded")).toBe("true"),
    );
    expect(
      screen
        .getByRole("button", { name: AVATAR_NAME })
        .getAttribute("aria-expanded"),
    ).toBe("false");
  });
});

// #229 AC-1：メニューの中のリンクで画面を移ると、popover を閉じる（開閉の実際の動作は e2e/app-shell.spec.ts）。
// jsdom では hidePopover はスタブ。実ブラウザが hidePopover の後に出す toggle（newState=closed）は fireToggle で模す。
describe("#229 AC-1 画面遷移でアバターメニューを閉じる", () => {
  it("#229 AC-1: 開いて「プロフィール設定」で /profile へ移ると、hidePopover が呼ばれ、aria-expanded が false になる", async () => {
    const { user, avatar, panel } = await renderMenu();
    fireToggle(panel, "open");
    await waitFor(() =>
      expect(avatar.getAttribute("aria-expanded")).toBe("true"),
    );
    expect(stubs.hidePopover).not.toHaveBeenCalled();
    await user.click(
      within(panel).getByRole("link", { name: "プロフィール設定" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("path").textContent).toBe("/profile"),
    );
    await waitFor(() => expect(stubs.hidePopover).toHaveBeenCalledTimes(1));
    fireToggle(panel, "closed");
    await waitFor(() =>
      expect(avatar.getAttribute("aria-expanded")).toBe("false"),
    );
  });

  it("#229 AC-1: 開いて「パスワードを変更」で /password へ移ると、hidePopover が呼ばれ、aria-expanded が false になる", async () => {
    const { user, avatar, panel } = await renderMenu();
    fireToggle(panel, "open");
    await waitFor(() =>
      expect(avatar.getAttribute("aria-expanded")).toBe("true"),
    );
    await user.click(
      within(panel).getByRole("link", { name: "パスワードを変更" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("path").textContent).toBe("/password"),
    );
    await waitFor(() => expect(stubs.hidePopover).toHaveBeenCalledTimes(1));
    fireToggle(panel, "closed");
    await waitFor(() =>
      expect(avatar.getAttribute("aria-expanded")).toBe("false"),
    );
  });

  it("#229 AC-1: 遷移して閉じるとき、メニュー内にあったフォーカスは #main-content に移る", async () => {
    const { user, panel } = await renderMenu();
    fireToggle(panel, "open");
    await user.click(
      within(panel).getByRole("link", { name: "プロフィール設定" }),
    );
    await waitFor(() => expect(stubs.hidePopover).toHaveBeenCalled());
    expect(document.activeElement).toBe(screen.getByRole("main"));
  });

  it("#229 AC-1: 場所が変わらない操作（ステータスの切り替え）では閉じない", async () => {
    const world = respondProfileWorld();
    const { user, panel } = await renderMenu();
    fireToggle(panel, "open");
    await user.click(within(panel).getByRole("button", { name: /外出/ }));
    await waitFor(() => expect(world.patchBodies).toHaveLength(1));
    expect(screen.getByTestId("path").textContent).toBe("/");
    expect(stubs.hidePopover).not.toHaveBeenCalled();
  });

  it("#229 AC-1: 場所が変わっていない初回表示では、popover が開いて見えても hidePopover を呼ばない（場所の変化だけで閉じる）", async () => {
    // pathname の比較を外すと、初回表示の effect が開いている popover を閉じてしまう。開いた状態を :popover-open で模して確かめる
    const originalMatches = Element.prototype.matches;
    const spy = vi
      .spyOn(Element.prototype, "matches")
      .mockImplementation(function (this: Element, selector: string) {
        return selector === ":popover-open"
          ? true
          : originalMatches.call(this, selector);
      });
    try {
      await renderMenu();
      expect(stubs.hidePopover).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("#229 AC-1: 開いていないときの画面遷移では hidePopover を呼ばない", async () => {
    const { user, panel } = await renderMenu();
    // popover が閉じていても、リンクは DOM にあり操作できる（jsdom）
    await user.click(
      within(panel).getByRole("link", { name: "プロフィール設定" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("path").textContent).toBe("/profile"),
    );
    expect(stubs.hidePopover).not.toHaveBeenCalled();
  });
});
