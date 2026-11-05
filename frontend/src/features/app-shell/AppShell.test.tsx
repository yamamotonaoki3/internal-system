// #121 AC-1・AC-2：AppShell（ログイン後の枠）。App を通して描画し、MSW で testuser_001 のログイン済みを返す。
// jsdom はメディアクエリを適用しないため、パソコン用（サイドバー）とスマホ用（下部メニュー・メニューボタン）の両方が DOM に出る。
// 公開形の仮定（契約）：
//  - header（banner）／ nav「メインメニュー」（サイドバー）／ nav「下部メニュー」／ main（1つ。id="main-content"・tabindex="-1"）
//  - 先頭のスキップリンク「本文へ移動」（href="#main-content"。DOM の最初のフォーカス可能な要素）
//  - 現在のページのリンクに aria-current="page"
//  - ログアウトのボタンはアバターメニュー（popover 属性の要素）の中にだけあり、画面に直接は出ない
import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  findHome,
  installDomStubs,
  renderApp,
  respondShellUser,
  SHELL_USER,
  type DomStubs,
} from "../../test/app-shell-harness";
import {
  respondLoggedOut,
  respondPublicStatus,
} from "../../test/auth-handlers";

let stubs: DomStubs;
beforeEach(() => {
  stubs = installDomStubs();
});
afterEach(() => {
  stubs.restore();
});

describe("#121 AC-1 AppShell（ログイン済み）", () => {
  it("#121 AC-1: ランドマーク header（banner）・main（1つ）・nav「メインメニュー」「下部メニュー」が出る", async () => {
    respondShellUser();
    renderApp("/");
    expect(await screen.findByRole("banner")).toBeDefined();
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(
      screen.getByRole("navigation", { name: "メインメニュー" }),
    ).toBeDefined();
    expect(
      screen.getByRole("navigation", { name: "下部メニュー" }),
    ).toBeDefined();
  });

  it("#121 AC-1: main の中に h1「ホーム」がちょうど1つあり、画面全体でも h1 は1つ", async () => {
    respondShellUser();
    renderApp("/");
    const main = await findHome();
    const headings = within(main).getAllByRole("heading", { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]?.textContent).toBe("ホーム");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("#121 AC-1: main の中に「ようこそ、testuser_001さん」を出す", async () => {
    respondShellUser();
    renderApp("/");
    const main = await findHome();
    expect(
      within(main).getByText(`ようこそ、${SHELL_USER.displayName}さん`),
    ).toBeDefined();
  });

  it("#121 AC-1: 案内文言は、画面幅で出し分ける2通り（パソコン用・スマホ用）が DOM にある", async () => {
    respondShellUser();
    renderApp("/");
    const main = await findHome();
    expect(
      within(main).getByText(
        "サイドバーからチャンネルやダイレクトメッセージを選んでください。",
      ),
    ).toBeDefined();
    expect(
      within(main).getByText("メニューからチャンネルやDMを選んでください。"),
    ).toBeDefined();
  });

  it("#121 AC-1: 現在のページ（ホーム）のリンクに aria-current=page が付く（サイドバー・下部メニューとも）", async () => {
    respondShellUser();
    renderApp("/");
    const side = within(
      await screen.findByRole("navigation", { name: "メインメニュー" }),
    );
    const home = side.getByRole("link", { name: "ホーム" });
    expect(home.getAttribute("href")).toBe("/");
    expect(home.getAttribute("aria-current")).toBe("page");
    const bottom = within(
      screen.getByRole("navigation", { name: "下部メニュー" }),
    );
    expect(
      bottom.getByRole("link", { name: "ホーム" }).getAttribute("aria-current"),
    ).toBe("page");
  });

  it("#121 AC-1: ヘッダーにロゴのリンク（/）がある", async () => {
    respondShellUser();
    renderApp("/");
    const banner = within(await screen.findByRole("banner"));
    const links = banner.getAllByRole("link");
    expect(links.some((l) => l.getAttribute("href") === "/")).toBe(true);
  });

  it("#121 AC-1: スキップリンク「本文へ移動」が #main-content を指し、最初のフォーカス先になる", async () => {
    respondShellUser();
    const { user } = renderApp("/");
    await findHome();
    const skip = screen.getByRole("link", { name: "本文へ移動" });
    expect(skip.getAttribute("href")).toBe("#main-content");
    const main = screen.getByRole("main");
    expect(main.id).toBe("main-content");
    expect(main.getAttribute("tabindex")).toBe("-1");
    await user.tab();
    expect(document.activeElement).toBe(skip);
  });

  it("#121 AC-1: ログアウトは画面に直接は出ず、アバターメニュー（popover）の中に1つだけある", async () => {
    respondShellUser();
    renderApp("/");
    await findHome();
    const logouts = screen.getAllByRole("button", { name: "ログアウト" });
    expect(logouts).toHaveLength(1);
    expect(logouts[0]?.closest("[popover]")).not.toBeNull();
    const main = screen.getByRole("main");
    expect(
      within(main).queryByRole("button", { name: "ログアウト" }),
    ).toBeNull();
  });

  it("#121 AC-1: 一般の利用者（権限なし）には「管理」を出さない", async () => {
    respondShellUser();
    renderApp("/");
    await findHome();
    expect(screen.queryByText("管理")).toBeNull();
  });
});

describe("#121 AC-2 AppShell（未ログイン・変更待ち）", () => {
  it("#121 AC-2: 未ログインなら /login へ移り、サイドバー・ヘッダー（banner）・メニューは出ない", async () => {
    respondLoggedOut();
    respondPublicStatus();
    renderApp("/");
    await waitFor(() =>
      expect(screen.getByTestId("path").textContent).toBe("/login"),
    );
    expect(await screen.findByLabelText("ユーザーID")).toBeDefined();
    expect(screen.queryByRole("banner")).toBeNull();
    expect(screen.queryAllByRole("navigation")).toHaveLength(0);
    expect(screen.queryByText(/ようこそ、/)).toBeNull();
  });

  it("#121 AC-2: パスワードの変更が必要な利用者には、レイアウト（banner・navigation）を出さず、h1 と main が1つずつ", async () => {
    respondShellUser(true);
    renderApp("/");
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "パスワードの変更が必要です",
      }),
    ).toBeDefined();
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.queryByRole("banner")).toBeNull();
    expect(screen.queryAllByRole("navigation")).toHaveLength(0);
    expect(screen.queryByText(/ようこそ、/)).toBeNull();
    expect(screen.getByRole("button", { name: "ログアウト" })).toBeDefined();
    expect(screen.getByTestId("path").textContent).toBe("/");
  });
});
