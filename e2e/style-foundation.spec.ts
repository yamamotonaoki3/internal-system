// #171 AC-3・AC-4（デザインの土台）：フォーカスの見え方・キーボード操作・画面幅ごとの表示を、実ブラウザ（開発サーバー）で確かめる。
// 前提：pretest:e2e が流す e2e/seeds/login.sql（架空の利用者）。データはすべて架空。
// /setup は、他の spec（setup.spec.ts）とDBの状態を取り合わないよう、状態の確認と登録の API だけをこの spec の中で差し替える（架空の値）。
// 本番形（CSP の下で外部CSSだけが使われること）は e2e-prod/csp-style.spec.ts で確かめる。
import { readFileSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./console-guard";
import { allowSessionCheck401 } from "./session-console";

// フォーカスの色は、トークン（index.css の --color-focus）と同じであること。値はここに書き写さず CSS から読む
function readFocusColorRgb(): string {
  const css = readFileSync("frontend/src/styles/index.css", "utf8");
  const match = /--color-focus\s*:\s*#([0-9a-fA-F]{6})\s*;/.exec(css);
  if (match?.[1] === undefined)
    throw new Error("--color-focus が index.css に見つかりません");
  const hex = match[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

const FOCUS_RGB = readFocusColorRgb();

type FocusReport = {
  name: string;
  outlineStyle: string;
  outlineWidth: number;
  outlineOffset: number;
  outlineColor: string;
  box: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number };
  covered: boolean;
  clippedByAncestor: boolean;
};

// 今フォーカスのある要素の見え方を集める
async function reportFocus(page: Page): Promise<FocusReport> {
  return page.evaluate(() => {
    function accessibleName(el: HTMLElement): string {
      const aria = el.getAttribute("aria-label");
      if (aria !== null) return aria.trim();
      if (el instanceof HTMLInputElement && el.labels?.[0])
        return (el.labels[0].textContent ?? "").trim();
      return (el.textContent ?? "").trim();
    }
    function isClipped(el: HTMLElement, reach: number): boolean {
      const rect = el.getBoundingClientRect();
      for (
        let p = el.parentElement;
        p !== null && p !== document.body && p !== document.documentElement;
        p = p.parentElement
      ) {
        const ps = getComputedStyle(p);
        if (ps.overflowX === "visible" && ps.overflowY === "visible") continue;
        const pr = p.getBoundingClientRect();
        if (
          rect.left - reach < pr.left ||
          rect.right + reach > pr.right ||
          rect.top - reach < pr.top ||
          rect.bottom + reach > pr.bottom
        )
          return true;
      }
      return false;
    }
    const el = document.activeElement as HTMLElement;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const name = accessibleName(el);
    const top = document.elementFromPoint(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
    );
    const covered = !(top === el || (top !== null && el.contains(top)));
    // 輪郭は要素の外側 offset+width だけ出るので、祖先の overflow で切られないか
    const reach =
      parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth);
    const clipped = isClipped(el, reach);
    return {
      name,
      outlineStyle: style.outlineStyle,
      outlineWidth: parseFloat(style.outlineWidth),
      outlineOffset: parseFloat(style.outlineOffset),
      outlineColor: style.outlineColor,
      box: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      covered,
      clippedByAncestor: clipped,
    };
  });
}

function expectVisibleFocus(report: FocusReport): void {
  const label = `フォーカス中の要素「${report.name}」`;
  expect(report.outlineStyle, `${label}：輪郭がある`).not.toBe("none");
  expect(report.outlineWidth, `${label}：輪郭の太さ`).toBeGreaterThanOrEqual(2);
  expect(report.outlineOffset, `${label}：輪郭のすき間`).toBeGreaterThanOrEqual(
    2,
  );
  expect(report.outlineColor, `${label}：輪郭の色はトークンの focus`).toBe(
    FOCUS_RGB,
  );
  // 画面の外に出ない（輪郭の分の 5px を含めて横が画面内）
  expect(report.box.x - 5, `${label}：左`).toBeGreaterThanOrEqual(0);
  expect(
    report.box.x + report.box.width + 5,
    `${label}：右`,
  ).toBeLessThanOrEqual(report.viewport.width);
  // 他の要素に重ならない・祖先に切られない
  expect(report.covered, `${label}：他の要素に覆われていない`).toBe(false);
  expect(report.clippedByAncestor, `${label}：祖先に切られていない`).toBe(
    false,
  );
}

async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow, "横スクロールが出ない").toBeLessThanOrEqual(0);
}

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("要素の位置を取得できません");
  return box;
}

const SETUP_FIELDS = {
  companyName: "[E2E_TEST]テスト株式会社",
  departmentName: "[E2E_TEST]テスト部",
  loginId: "e2euser_style_001",
  legalName: "テスト太郎",
  email: "e2euser_style_001@example.com",
};

// /setup の状態の確認と登録を、この spec の中だけで差し替える（架空の値。DBは使わない）
async function mockSetup(page: Page, setupRequired: boolean): Promise<void> {
  await page.route("**/api/setup/status", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ setupRequired }),
    }),
  );
  await page.route("**/api/setup", (route) =>
    route.fulfill({
      status: 201,
      contentType: "application/json",
      headers: { "cache-control": "no-store" },
      body: JSON.stringify({
        user: {
          id: "01JTE2E0000000000000000999",
          loginId: SETUP_FIELDS.loginId,
          displayName: SETUP_FIELDS.legalName,
        },
        initialPassword: "TestPass123!abcd",
      }),
    }),
  );
}

test("#171 AC-3: /login で Tab を押すと、ユーザーID → パスワード → 表示 → ログイン の順に進み、どこでも輪郭が見える", async ({
  page,
}) => {
  allowSessionCheck401(page);
  await page.goto("/login");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("ログイン");

  const expected = ["ユーザーID", "パスワード", "パスワードを表示", "ログイン"];
  for (const name of expected) {
    await page.keyboard.press("Tab");
    const report = await reportFocus(page);
    expect(report.name).toBe(name);
    expectVisibleFocus(report);
  }
});

test("#171 AC-3: Shift+Tab で戻っても輪郭が見え、順序は逆になる", async ({
  page,
}) => {
  allowSessionCheck401(page);
  await page.goto("/login");
  await page.getByRole("button", { name: "ログイン" }).focus();
  await page.keyboard.press("Shift+Tab");
  const report = await reportFocus(page);
  expect(report.name).toBe("パスワードを表示");
  expectVisibleFocus(report);
});

test("#171 AC-3: 未入力で送信すると、最初のエラーの入力欄にフォーカスが移り、エラー文が見え、輪郭が見える", async ({
  page,
}) => {
  allowSessionCheck401(page);
  await page.goto("/login");
  await page.getByRole("button", { name: "ログイン" }).click();

  const loginId = page.getByLabel("ユーザーID", { exact: true });
  await expect(loginId).toBeFocused();
  await expect(loginId).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("ユーザーIDを入力してください")).toBeVisible();
  expectVisibleFocus(await reportFocus(page));
});

test("#171 AC-3: ユーザーIDだけ入力して送信すると、パスワード欄にフォーカスが移り、輪郭が見える", async ({
  page,
}) => {
  allowSessionCheck401(page);
  await page.goto("/login");
  await page
    .getByLabel("ユーザーID", { exact: true })
    .fill("e2euser_style_none");
  await page.getByRole("button", { name: "ログイン" }).click();

  await expect(page.getByLabel("パスワード", { exact: true })).toBeFocused();
  await expect(page.getByText("パスワードを入力してください")).toBeVisible();
  expectVisibleFocus(await reportFocus(page));
});

test("#171 AC-3: ログインに失敗すると、エラーが alert として見える位置に表示される", async ({
  page,
}) => {
  allowSessionCheck401(page);
  await page.goto("/login");
  await page
    .getByLabel("ユーザーID", { exact: true })
    .fill("e2euser_style_none");
  await page.getByLabel("パスワード", { exact: true }).fill("WrongPass123!");
  await page.getByRole("button", { name: "ログイン" }).click();

  const alert = page.getByRole("alert");
  await expect(alert).toContainText("ユーザーIDまたはパスワードが違います");
  await expect(alert).toBeInViewport();
});

test("#171 AC-3: /setup の登録が成功すると、見出し「登録が完了しました」にフォーカスが移り、輪郭が見える", async ({
  page,
}) => {
  allowSessionCheck401(page);
  await mockSetup(page, true);
  await page.goto("/setup");

  await page
    .getByLabel(/セットアップ用のトークン/)
    .fill("e2e-dummy-token-".padEnd(43, "0"));
  await page.getByLabel(/会社名/).fill(SETUP_FIELDS.companyName);
  await page.getByLabel(/部署名/).fill(SETUP_FIELDS.departmentName);
  await page.getByLabel(/社員ID/).fill(SETUP_FIELDS.loginId);
  await page.getByLabel(/本名/).fill(SETUP_FIELDS.legalName);
  await page.getByLabel(/メールアドレス$/).fill(SETUP_FIELDS.email);
  await page
    .getByRole("checkbox", {
      name: /会社が発行した自分のメールアドレスだと確認しました/,
    })
    .check();
  await page.getByRole("button", { name: "登録する" }).click();

  const heading = page.getByRole("heading", { name: "登録が完了しました" });
  await expect(heading).toBeFocused();
  // マウスで送信した後でも、移動先が分かるよう輪郭を出す
  expectVisibleFocus(await reportFocus(page));
});

test("#171 AC-3: /setup の入力フォームを Tab で進んでも、各欄の輪郭が見える", async ({
  page,
}) => {
  allowSessionCheck401(page);
  await mockSetup(page, true);
  await page.goto("/setup");
  await expect(page.getByLabel(/会社名/)).toBeVisible();

  // 「登録する」に達するまで進む（要素数を書き写さない）。止まらないときの上限は30
  let reachedSubmit = false;
  for (let i = 0; i < 30 && !reachedSubmit; i += 1) {
    await page.keyboard.press("Tab");
    const report = await reportFocus(page);
    expectVisibleFocus(report);
    reachedSubmit = report.name === "登録する";
  }
  expect(reachedSubmit, "Tab で「登録する」に達する").toBe(true);
});

for (const width of [360, 767, 768, 1280]) {
  test(`#171 AC-4: 画面幅 ${width}px で、/login と /setup に横スクロールが出ない`, async ({
    page,
  }) => {
    allowSessionCheck401(page);
    await mockSetup(page, true);
    await page.setViewportSize({ width, height: 800 });

    await page.goto("/login");
    await expect(page.getByRole("button", { name: "ログイン" })).toBeVisible();
    await expectNoHorizontalScroll(page);

    await page.goto("/setup");
    await expect(page.getByRole("button", { name: "登録する" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
}

for (const width of [360, 767]) {
  test(`#171 AC-4: 画面幅 ${width}px では、主操作（ログイン・登録する）の高さが44px以上`, async ({
    page,
  }) => {
    allowSessionCheck401(page);
    await mockSetup(page, true);
    await page.setViewportSize({ width, height: 800 });

    await page.goto("/login");
    const login = page.getByRole("button", { name: "ログイン" });
    expect((await boxOf(login)).height).toBeGreaterThanOrEqual(44);

    await page.goto("/setup");
    const register = page.getByRole("button", { name: "登録する" });
    expect((await boxOf(register)).height).toBeGreaterThanOrEqual(44);
  });
}

for (const width of [768, 1280]) {
  test(`#171 AC-4: 画面幅 ${width}px では、ログインのパネルは画面より狭く、/setup のパネルより狭い`, async ({
    page,
  }) => {
    allowSessionCheck401(page);
    await mockSetup(page, true);
    await page.setViewportSize({ width, height: 800 });

    await page.goto("/login");
    await expect(page.getByRole("main")).toBeVisible();
    const loginWidth = (await boxOf(page.getByRole("main"))).width;

    await page.goto("/setup");
    await expect(page.getByRole("main")).toBeVisible();
    const setupWidth = (await boxOf(page.getByRole("main"))).width;

    expect(loginWidth).toBeLessThan(width);
    expect(loginWidth).toBeLessThan(setupWidth);
  });
}

test("#171 AC-4: 画面幅 360px で、ログイン画面の文字が切れない（要素が画面の幅からはみ出さない）", async ({
  page,
}) => {
  allowSessionCheck401(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "ログイン" })).toBeVisible();

  const overflowing = await page.evaluate(() =>
    [...document.querySelectorAll("main *")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.left < 0 || r.right > window.innerWidth);
      })
      .map((el) => el.tagName),
  );
  expect(overflowing).toEqual([]);
});
