// #121 AC-1：Drawer（スマホ幅のメニュー。ネイティブ <dialog> を showModal() で開く）。
// jsdom には showModal がなく、フォーカスの閉じ込め・inert・Esc の既定処理・backdrop もない。ここでは、スタブ（showModal / close が open 属性を付け外しし、close イベントを出す）の範囲で
// 「開閉の状態・イベントへの反応・フォーカスの戻り先・aria」を確かめる。フォーカスの循環・背面のクリック不可・Esc・backdrop は e2e/app-shell.spec.ts で確かめる。
// 公開形の仮定（契約）：
//  - ヘッダーの開くボタン：名前「メニューを開く」。aria-expanded（開いている間 true）・aria-controls=dialog の id
//  - dialog：開いている間だけ role=dialog。名前に「メニュー」を含む（aria-labelledby）。中に nav と、名前に「閉じる」を含むボタン。中にログアウトは置かない
//  - 閉じる契機：Esc（cancel→close）・閉じるボタン・backdrop クリック（クリックの対象が dialog 自身のときだけ。中身はラッパーで覆う）・項目の選択
//  - 閉じたら開いたボタンへフォーカスを戻す（一度だけ）。画面幅が 768px 以上に変わって閉じたときは #main-content へ
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  findHome,
  installDomStubs,
  pressEscapeOn,
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

async function renderDrawer() {
  respondShellUser();
  const rendered = renderApp("/");
  await findHome();
  const opener = screen.getByRole("button", { name: "メニューを開く" });
  return { ...rendered, opener };
}

function dialogElement(): HTMLDialogElement {
  const dialog = document.querySelector("dialog");
  if (dialog === null) throw new Error("dialog が見つかりません");
  return dialog;
}

describe("#121 AC-1 Drawer", () => {
  it("#121 AC-1: 初めは閉じていて（dialog は見えない）、開くボタンは aria-expanded=false・aria-controls が dialog を指す", async () => {
    const { opener } = await renderDrawer();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener.getAttribute("aria-expanded")).toBe("false");
    expect(opener.getAttribute("aria-controls")).toBe(dialogElement().id);
    expect(dialogElement().id).not.toBe("");
  });

  it("#121 AC-1: 開くボタンを押すと dialog が開き、aria-expanded が true になり、フォーカスは閉じるボタンに移る", async () => {
    const { user, opener } = await renderDrawer();
    await user.click(opener);
    const dialog = await screen.findByRole("dialog", { name: /メニュー/ });
    expect(opener.getAttribute("aria-expanded")).toBe("true");
    const close = within(dialog).getByRole("button", { name: /閉じる/ });
    await waitFor(() => expect(document.activeElement).toBe(close));
  });

  it("#121 AC-1: dialog の中に nav（ホーム。aria-current=page）があり、ログアウトは置かない", async () => {
    const { user, opener } = await renderDrawer();
    await user.click(opener);
    const dialog = within(await screen.findByRole("dialog"));
    const nav = within(dialog.getByRole("navigation"));
    const home = nav.getByRole("link", { name: "ホーム" });
    expect(home.getAttribute("aria-current")).toBe("page");
    expect(dialog.queryByRole("button", { name: "ログアウト" })).toBeNull();
  });

  it("#121 AC-1: 閉じるボタンで閉じ、aria-expanded が false に戻り、フォーカスが開いたボタンに戻る", async () => {
    const { user, opener } = await renderDrawer();
    await user.click(opener);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /閉じる/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(opener.getAttribute("aria-expanded")).toBe("false");
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("#121 AC-1: Esc（cancel→close）で閉じ、フォーカスが開いたボタンに戻る", async () => {
    const { user, opener } = await renderDrawer();
    await user.click(opener);
    await screen.findByRole("dialog");
    pressEscapeOn(dialogElement());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(opener.getAttribute("aria-expanded")).toBe("false");
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("#121 AC-1: 通常の終了では、開いたボタンへのフォーカス復帰は一度だけ行う", async () => {
    const { user, opener } = await renderDrawer();
    await user.click(opener);
    await screen.findByRole("dialog");
    const focus = vi.spyOn(opener, "focus");
    pressEscapeOn(dialogElement());
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("#121 AC-1: close イベントが遅れて届く間に、利用者が別の有効な要素（ロゴのリンク）へフォーカスを移していたら、開いたボタンへ引き戻さない", async () => {
    const { user, opener } = await renderDrawer();
    await user.click(opener);
    const dialog = await screen.findByRole("dialog");
    stubs.deferCloseEvents(true);
    await user.click(within(dialog).getByRole("button", { name: /閉じる/ }));
    await waitFor(() =>
      expect(dialogElement().hasAttribute("open")).toBe(false),
    );
    const logo = within(screen.getByRole("banner"))
      .getAllByRole("link")
      .find((link) => link.getAttribute("href") === "/");
    if (logo === undefined) throw new Error("ロゴのリンクが見つかりません");
    act(() => logo.focus());
    stubs.flushCloseEvents();
    await waitFor(() =>
      expect(opener.getAttribute("aria-expanded")).toBe("false"),
    );
    expect(document.activeElement).toBe(logo);
  });

  it("#121 AC-1: backdrop のクリック（対象が dialog 自身）で閉じる", async () => {
    const { user, opener } = await renderDrawer();
    await user.click(opener);
    await screen.findByRole("dialog");
    fireEvent.click(dialogElement());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("#121 AC-1: 中身（ラッパーの内側・nav）のクリックでは閉じない", async () => {
    const { user, opener } = await renderDrawer();
    await user.click(opener);
    const dialog = await screen.findByRole("dialog");
    const nav = within(dialog).getByRole("navigation");
    fireEvent.click(nav);
    fireEvent.click(nav.parentElement ?? nav);
    expect(screen.getByRole("dialog")).toBeDefined();
    expect(opener.getAttribute("aria-expanded")).toBe("true");
  });

  it("#121 AC-1: 項目（ホーム）を選ぶと閉じる", async () => {
    const { user, opener } = await renderDrawer();
    await user.click(opener);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("link", { name: "ホーム" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(opener.getAttribute("aria-expanded")).toBe("false");
  });

  it("#121 AC-1: 閉じたあとでも、もう一度開ける", async () => {
    const { user, opener } = await renderDrawer();
    await user.click(opener);
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: /閉じる/,
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await user.click(opener);
    expect(await screen.findByRole("dialog")).toBeDefined();
    expect(opener.getAttribute("aria-expanded")).toBe("true");
  });

  it("#121 AC-1: 開いたまま画面幅が 768px 以上に変わると閉じ、フォーカスは開いたボタンではなく #main-content に移る。767px に戻しても閉じたまま", async () => {
    const { user, opener } = await renderDrawer();
    await user.click(opener);
    await screen.findByRole("dialog");
    const focus = vi.spyOn(opener, "focus");
    stubs.setDesktop(true);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("main")),
    );
    expect(focus).not.toHaveBeenCalled();
    stubs.setDesktop(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("main"));
  });

  it("#121 AC-1: 幅変更で閉じた後、遅れて届く close より前に利用者が別の有効な要素（ロゴのリンク）へ移したフォーカスは、main へ奪わない", async () => {
    const { user, opener } = await renderDrawer();
    await user.click(opener);
    await screen.findByRole("dialog");
    stubs.deferCloseEvents(true);
    stubs.setDesktop(true);
    await waitFor(() =>
      expect(dialogElement().hasAttribute("open")).toBe(false),
    );
    const logo = within(screen.getByRole("banner"))
      .getAllByRole("link")
      .find((link) => link.getAttribute("href") === "/");
    if (logo === undefined) throw new Error("ロゴのリンクが見つかりません");
    act(() => logo.focus());
    stubs.flushCloseEvents();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(logo);
    expect(document.activeElement).not.toBe(screen.getByRole("main"));
  });
});
