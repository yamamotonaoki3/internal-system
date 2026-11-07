// #121 AC-1・AC-2（S-01 共通レイアウト）：サイドバー・ヘッダー・下部メニュー・ドロワー・アバターメニュー・スキップリンクを、実ブラウザ（Chromium）で確かめる。
// jsdom では確かめられないもの（メディアクエリによる表示の切り替え、<dialog> のフォーカスの閉じ込め、popover の外側クリック・Esc・フォーカスの戻り、画面幅の変更）はここで保証する。
// 前提：pretest:e2e が流す e2e/seeds/login.sql（架空の利用者 e2euser_login_001「テスト一郎」・002）。データはすべて架空。
// ログインは試行制限（15分に30回）があるため、ログイン後の画面を見るテストは、ワーカーごとに1回だけログインして Cookie を使い回す。
// ログアウトまで確かめるテストは、使い回す Cookie のセッションを失効させないよう、別にログインする。
import type { BrowserContext, Locator, Page } from "@playwright/test";
import { expect, test as guardedTest } from "./console-guard";
import { allowSessionCheck401 } from "./session-console";

const BASE_URL = "http://localhost:5173";
const PASSWORD = "TestPass123!";
const READY_USER = { loginId: "e2euser_login_001", displayName: "テスト一郎" };
const MUST_CHANGE_USER = { loginId: "e2euser_login_002" };
const AVATAR_NAME = `アカウントメニュー（${READY_USER.displayName}）`;
const DESKTOP_GUIDE =
  "サイドバーからチャンネルやダイレクトメッセージを選んでください。";
const MOBILE_GUIDE = "メニューからチャンネルやDMを選んでください。";

type AuthState = Awaited<ReturnType<BrowserContext["storageState"]>>;

async function login(page: Page, loginId: string) {
  await page.goto("/login");
  await page.getByLabel("ユーザーID", { exact: true }).fill(loginId);
  await page.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "ログイン" }).click();
}

// ログイン済みの Cookie をワーカーごとに1回だけ作る
const test = guardedTest.extend<object, { authState: AuthState }>({
  authState: [
    async ({ browser }, use) => {
      const context = await browser.newContext({ baseURL: BASE_URL });
      const page = await context.newPage();
      await login(page, READY_USER.loginId);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "ホーム",
      );
      const state = await context.storageState();
      await context.close();
      await use(state);
    },
    { scope: "worker" },
  ],
  storageState: async ({ authState }, use) => {
    await use(authState);
  },
});

// 未ログインの状態から始めるテスト（Cookie を使い回さない）
const anonymousTest = guardedTest;

const SIZES = {
  desktop: { width: 1280, height: 800 },
  tablet: { width: 768, height: 800 },
  mobile: { width: 360, height: 800 },
} as const;

async function openHome(page: Page, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("ホーム");
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow, "横スクロールが出ない").toBeLessThanOrEqual(0);
}

function mainNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "メインメニュー" });
}
function bottomNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "下部メニュー" });
}
function drawerOpener(page: Page): Locator {
  return page.getByRole("button", { name: "メニューを開く" });
}
function logoutButton(page: Page): Locator {
  return page.getByRole("button", { name: "ログアウト" });
}
// ドロワー（モーダルの dialog）の表示中は、背面が inert になり名前での検索から外れるため、includeHidden で探す
function drawerOpenerAlways(page: Page): Locator {
  return page.getByRole("button", {
    name: "メニューを開く",
    includeHidden: true,
  });
}

async function focusedInside(page: Page, selector: string): Promise<boolean> {
  return page.evaluate(
    (sel) => document.querySelector(sel)?.contains(document.activeElement),
    selector,
  ) as Promise<boolean>;
}

for (const [label, size] of [
  ["1280px（パソコン）", SIZES.desktop],
  ["768px（パソコン表示の境界）", SIZES.tablet],
] as const) {
  test(`#121 AC-1: ${label}では、サイドバー・ヘッダー・アバターが出て、メニューボタンと下部メニューは出ない`, async ({
    page,
  }) => {
    await openHome(page, size);
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(mainNav(page)).toBeVisible();
    await expect(
      mainNav(page).getByRole("link", { name: "ホーム" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(
      page.getByText(`ようこそ、${READY_USER.displayName}さん`),
    ).toBeVisible();
    await expect(page.getByText(DESKTOP_GUIDE)).toBeVisible();
    // 両方の文言が DOM にあり、CSS で出し分ける。要素は存在してよいが、見えてはいけない
    await expect(page.getByText(MOBILE_GUIDE)).not.toBeVisible();
    await expect(page.getByRole("button", { name: AVATAR_NAME })).toBeVisible();
    await expect(drawerOpener(page)).toHaveCount(0);
    await expect(bottomNav(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "自分" })).toHaveCount(0);
    // ログアウトは画面に直接は出ない
    await expect(logoutButton(page)).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });
}

test("#121 AC-1: 360px（スマホ）では、サイドバーが出ず、下部メニューとメニューボタンが出て、横スクロールがない", async ({
  page,
}) => {
  await openHome(page, SIZES.mobile);
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(mainNav(page)).toHaveCount(0);
  await expect(bottomNav(page)).toBeVisible();
  await expect(
    bottomNav(page).getByRole("link", { name: "ホーム" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    bottomNav(page).getByRole("button", { name: "自分" }),
  ).toBeVisible();
  await expect(drawerOpener(page)).toBeVisible();
  await expect(page.getByRole("button", { name: AVATAR_NAME })).toHaveCount(0);
  await expect(page.getByText(MOBILE_GUIDE)).toBeVisible();
  await expect(page.getByText(DESKTOP_GUIDE)).not.toBeVisible();
  await expect(logoutButton(page)).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});

for (const width of [360, 767, 768, 1280]) {
  test(`#121 AC-1: 画面幅 ${width}px で、ログイン後のホームに横スクロールが出ない（ドロワー・アバターメニューを開いても）`, async ({
    page,
  }) => {
    await openHome(page, { width, height: 800 });
    await expectNoHorizontalScroll(page);
    if (width < 768) {
      await drawerOpener(page).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expectNoHorizontalScroll(page);
    } else {
      await page.getByRole("button", { name: AVATAR_NAME }).click();
      await expect(logoutButton(page)).toBeVisible();
      await expectNoHorizontalScroll(page);
    }
  });
}

test("#121 AC-1: パソコン幅のアバターメニュー：Enter で開く → Tab でログアウトへ → Esc で閉じてアバターのボタンに戻る", async ({
  page,
}) => {
  await openHome(page, SIZES.desktop);
  const avatar = page.getByRole("button", { name: AVATAR_NAME });
  await expect(avatar).toHaveAttribute("aria-expanded", "false");
  await avatar.focus();
  await page.keyboard.press("Enter");
  await expect(logoutButton(page)).toBeVisible();
  await expect(avatar).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "パスワードを変更" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(logoutButton(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(logoutButton(page)).toHaveCount(0);
  await expect(avatar).toHaveAttribute("aria-expanded", "false");
  await expect(avatar).toBeFocused();
});

test("#121 AC-1: スマホ幅の「自分」：Enter で開く → Tab でログアウトへ → Esc で閉じて「自分」に戻る", async ({
  page,
}) => {
  await openHome(page, SIZES.mobile);
  const self = bottomNav(page).getByRole("button", { name: "自分" });
  await self.focus();
  await page.keyboard.press("Enter");
  await expect(logoutButton(page)).toBeVisible();
  await expect(self).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "パスワードを変更" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(logoutButton(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(logoutButton(page)).toHaveCount(0);
  await expect(self).toHaveAttribute("aria-expanded", "false");
  await expect(self).toBeFocused();
});

test("#121 AC-1: アバターメニューの外側をクリックすると閉じる（パソコン幅・スマホ幅）", async ({
  page,
}) => {
  await openHome(page, SIZES.desktop);
  await page.getByRole("button", { name: AVATAR_NAME }).click();
  await expect(logoutButton(page)).toBeVisible();
  await page.getByRole("heading", { level: 1 }).click();
  await expect(logoutButton(page)).toHaveCount(0);

  await page.setViewportSize(SIZES.mobile);
  await bottomNav(page).getByRole("button", { name: "自分" }).click();
  await expect(logoutButton(page)).toBeVisible();
  await page.getByRole("heading", { level: 1 }).click();
  await expect(logoutButton(page)).toHaveCount(0);
});

test("#121 AC-1: アバターメニューは、ヘッダー・サイドバー・本文より手前に出る（最前面）", async ({
  page,
}) => {
  await openHome(page, SIZES.desktop);
  await page.getByRole("button", { name: AVATAR_NAME }).click();
  const logout = logoutButton(page);
  await expect(logout).toBeVisible();
  const covered = await logout.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const top = document.elementFromPoint(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
    );
    return !(top === el || (top !== null && el.contains(top)));
  });
  expect(covered, "ログアウトが他の要素に覆われていない").toBe(false);
});

anonymousTest(
  "#121 AC-1: パソコン幅でアバターメニューからログアウトすると /login へ移り、レイアウトは出ない",
  async ({ page }) => {
    allowSessionCheck401(page);
    await page.setViewportSize(SIZES.desktop);
    await login(page, READY_USER.loginId);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("ホーム");
    await page.getByRole("button", { name: AVATAR_NAME }).click();
    await logoutButton(page).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("banner")).toHaveCount(0);
    await expect(page.getByRole("navigation")).toHaveCount(0);
  },
);

anonymousTest(
  "#121 AC-1: スマホ幅で「自分」からログアウトすると /login へ移る",
  async ({ page }) => {
    allowSessionCheck401(page);
    await page.setViewportSize(SIZES.mobile);
    await login(page, READY_USER.loginId);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("ホーム");
    await bottomNav(page).getByRole("button", { name: "自分" }).click();
    await logoutButton(page).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("banner")).toHaveCount(0);
  },
);

test("#121 AC-1: ドロワー：メニューボタンで開き、閉じるボタンにフォーカスが移り、閉じるボタンで閉じてメニューボタンに戻る", async ({
  page,
}) => {
  await openHome(page, SIZES.mobile);
  const opener = drawerOpener(page);
  await expect(opener).toHaveAttribute("aria-expanded", "false");
  await opener.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(drawerOpenerAlways(page)).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  const close = dialog.getByRole("button", { name: /閉じる/ });
  await expect(close).toBeFocused();
  await expect(dialog.getByRole("link", { name: "ホーム" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(dialog.getByRole("button", { name: "ログアウト" })).toHaveCount(
    0,
  );
  await close.click();
  await expect(dialog).toHaveCount(0);
  await expect(opener).toHaveAttribute("aria-expanded", "false");
  await expect(opener).toBeFocused();
});

test("#121 AC-1: ドロワーを開いている間、Tab / Shift+Tab のフォーカスは dialog の中を循環し、外に出ない", async ({
  page,
}) => {
  await openHome(page, SIZES.mobile);
  await drawerOpener(page).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const seen = new Set<string>();
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press("Tab");
    expect(await focusedInside(page, "dialog"), `Tab ${i + 1}回目`).toBe(true);
    seen.add(
      await page.evaluate(() => document.activeElement?.textContent ?? ""),
    );
  }
  for (let i = 0; i < 6; i += 1) {
    await page.keyboard.press("Shift+Tab");
    expect(await focusedInside(page, "dialog"), `Shift+Tab ${i + 1}回目`).toBe(
      true,
    );
  }
  expect(seen.size, "dialog の中の複数の要素を巡る").toBeGreaterThanOrEqual(2);
});

test("#121 AC-1: ドロワーを開いている間、背面の要素は押せない", async ({
  page,
}) => {
  await openHome(page, SIZES.mobile);
  await drawerOpener(page).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  // 背面の下部メニュー「自分」の中心にある最前面の要素が、「自分」ではない（dialog の backdrop 等が受ける）
  const self = page.getByRole("button", { name: "自分", includeHidden: true });
  const covered = await self.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const top = document.elementFromPoint(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
    );
    return !(top === el || (top !== null && el.contains(top)));
  });
  expect(covered, "背面の「自分」は押せない").toBe(true);
  // 背面の要素はキーボードでも到達できない
  await expect(self).not.toBeFocused();
});

test("#121 AC-1: ドロワー：Esc で閉じて、メニューボタンにフォーカスが戻り、もう一度開ける", async ({
  page,
}) => {
  await openHome(page, SIZES.mobile);
  const opener = drawerOpener(page);
  await opener.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(opener).toHaveAttribute("aria-expanded", "false");
  await expect(opener).toBeFocused();

  await opener.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: /閉じる/ }),
  ).toBeFocused();
});

test("#121 AC-1: ドロワー：backdrop（外側）のクリックで閉じ、内側の余白のクリックでは閉じない", async ({
  page,
}) => {
  await openHome(page, SIZES.mobile);
  const opener = drawerOpener(page);
  await opener.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // 内側の余白（dialog の下端に近い、操作部品のない場所）のクリックでは閉じない
  const box = await dialog.boundingBox();
  if (box === null) throw new Error("dialog の位置を取得できません");
  await page.mouse.click(box.x + 4, box.y + box.height - 4);
  await expect(dialog).toBeVisible();

  // backdrop：画面の右端（ドロワーの外）をクリックする
  const x = SIZES.mobile.width - 3;
  const y = SIZES.mobile.height / 2;
  const target = await page.evaluate(
    ([px, py]) => document.elementFromPoint(px ?? 0, py ?? 0)?.tagName,
    [x, y],
  );
  expect(target, "画面の右端にドロワーの外側（backdrop）がある").toBe("DIALOG");
  await page.mouse.click(x, y);
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("#121 AC-1: ドロワー：項目（ホーム）を選ぶと閉じる", async ({ page }) => {
  await openHome(page, SIZES.mobile);
  await drawerOpener(page).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("link", { name: "ホーム" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
  await expect(drawerOpener(page)).toHaveAttribute("aria-expanded", "false");
});

test("#121 AC-1: 767px でドロワーを開いたまま 768px にすると閉じ、フォーカスは本文（main）に移り、767px に戻しても閉じたまま", async ({
  page,
}) => {
  await openHome(page, { width: 767, height: 800 });
  await drawerOpener(page).click();
  await expect(page.getByRole("dialog")).toBeVisible();

  await page.setViewportSize({ width: 768, height: 800 });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("#main-content")).toBeFocused();
  await expect(mainNav(page)).toBeVisible();

  await page.setViewportSize({ width: 767, height: 800 });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("#main-content")).toBeFocused();
});

test("#121 AC-1: アバターメニューを開いたまま 768px の境界を越えると閉じ、フォーカスは失われず本文（main）に移る（768→767）", async ({
  page,
}) => {
  await openHome(page, { width: 768, height: 800 });
  const avatar = page.getByRole("button", { name: AVATAR_NAME });
  await avatar.focus();
  await page.keyboard.press("Enter");
  await expect(logoutButton(page)).toBeVisible();

  await page.setViewportSize({ width: 767, height: 800 });
  await expect(logoutButton(page)).toHaveCount(0);
  await expect(page.locator("#main-content")).toBeFocused();
});

test("#121 AC-1: 「自分」のメニューを開いたまま 768px の境界を越えると閉じ、フォーカスは失われず本文（main）に移る（767→768）", async ({
  page,
}) => {
  await openHome(page, { width: 767, height: 800 });
  const self = bottomNav(page).getByRole("button", { name: "自分" });
  await self.focus();
  await page.keyboard.press("Enter");
  await expect(logoutButton(page)).toBeVisible();

  await page.setViewportSize({ width: 768, height: 800 });
  await expect(logoutButton(page)).toHaveCount(0);
  await expect(page.locator("#main-content")).toBeFocused();
});

test("#121 AC-1: キーボード：最初の Tab でスキップリンクが見え、Enter で本文（main）にフォーカスが移る", async ({
  page,
}) => {
  await openHome(page, SIZES.desktop);
  const skip = page.getByRole("link", { name: "本文へ移動" });
  await page.keyboard.press("Tab");
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
});

test("#121 AC-1: キーボード：Tab で最後まで進めても、フォーカスされたすべての操作部品（スキップリンク・ロゴ・アバター・ホーム）の輪郭が見える", async ({
  page,
}) => {
  await openHome(page, SIZES.desktop);
  const seen: string[] = [];
  // フォーカスがページの外（body）に出るまで、上限12回まで進める。部品の数は書き写さない
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      if (el === document.body) return null;
      const style = getComputedStyle(el);
      return {
        name: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim(),
        outlineStyle: style.outlineStyle,
        outlineWidth: parseFloat(style.outlineWidth),
      };
    });
    if (info === null) break;
    seen.push(info.name);
    expect(info.outlineStyle, `「${info.name}」の輪郭`).not.toBe("none");
    expect(info.outlineWidth, `「${info.name}」の輪郭の太さ`).toBeGreaterThan(
      0,
    );
  }
  expect(seen[0]).toBe("本文へ移動");
  expect(seen).toContain(AVATAR_NAME);
  expect(seen).toContain("ホーム");
});

anonymousTest(
  "#121 AC-2: 未ログインで / を開くと /login へ移り、レイアウト（ヘッダー・メニュー）は出ない",
  async ({ page }) => {
    allowSessionCheck401(page);
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "ログイン",
    );
    await expect(page.getByRole("banner")).toHaveCount(0);
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await expect(page.getByRole("main")).toHaveCount(1);
  },
);

anonymousTest(
  "#121 AC-2: パスワード変更待ちの利用者には、レイアウトが出ず、見出しとログアウトが直接出る",
  async ({ page }) => {
    allowSessionCheck401(page);
    await login(page, MUST_CHANGE_USER.loginId);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "パスワードの変更が必要です",
      }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("banner")).toHaveCount(0);
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await expect(logoutButton(page)).toBeVisible();
    await expectNoHorizontalScroll(page);
  },
);
