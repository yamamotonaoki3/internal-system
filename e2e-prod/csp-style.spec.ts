// #171 AC-1・AC-3：本番形（ビルド済みの成果物 + public/_headers の CSP）で、CSS が外部ファイルとして読み込まれ、
// style 要素・style 属性・CSP 違反が無いことを確かめる。前提：playwright.prod.config.ts の webServer（npm run build の後の preview）。
// ログインの確認には e2e/seeds/login.sql の架空の利用者を使う（DB の準備は package.json の test:e2e:prod の前処理）。データはすべて架空。
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { allowConsoleError, expect, test } from "../e2e/console-guard";
import { allowSessionCheck401 } from "../e2e/session-console";
import type { SessionInfo } from "../frontend/src/features/auth/api/auth-api";

function readPrimaryRgb(): string {
  const css = readFileSync("frontend/src/styles/index.css", "utf8");
  const match = /--color-primary\s*:\s*#([0-9a-fA-F]{6})\s*;/.exec(css);
  if (match?.[1] === undefined)
    throw new Error("--color-primary が index.css に見つかりません");
  const hex = match[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

const PRIMARY_RGB = readPrimaryRgb();

// コンソールのエラー・例外の監視は console-guard の test が全テストで行う。意図して起きるエラーは、起きるテストの中だけで許可する（console のメッセージには URL が含まれないため、状態コードで絞る）。
// /login は未ログインのセッション確認（GET /api/auth/session）が仕様どおり 401 を返す。/setup はセッションを確認しないので許可しない
function allowIntended401(page: Page, path: string): void {
  if (path === "/login") allowSessionCheck401(page);
}

// vite preview はビルド成果物の設定だけを読むため、ログインの試行制限の鍵が渡らず、ログインが 503 になる。CSP 検証に限り、ログイン失敗を確認するテストの中だけで許可する（ログインの成否は e2e/login.spec.ts が確かめる）
function allowLogin503(page: Page): void {
  allowConsoleError(
    page,
    /Failed to load resource: the server responded with a status of 503/,
    "本番形の配信（vite preview）ではログインの試行制限の鍵が渡らず、ログインが 503 を返すため",
  );
}

// CSP 違反（securitypolicyviolation）を集める。console のエラーは console-guard が見る
async function watchCsp(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __cspViolations: string[] };
    w.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      w.__cspViolations.push(`${e.violatedDirective}: ${e.blockedURI}`);
    });
  });
}

async function expectNoInlineStyle(page: Page, when: string): Promise<void> {
  const counts = await page.evaluate(() => ({
    styleElements: document.querySelectorAll("style").length,
    styleAttributes: document.querySelectorAll("[style]").length,
  }));
  expect(counts.styleElements, `${when}：style 要素が0`).toBe(0);
  expect(counts.styleAttributes, `${when}：style 属性が0`).toBe(0);
}

async function expectNoCspViolation(page: Page, when: string): Promise<void> {
  const violations = await page.evaluate(
    () => (window as unknown as { __cspViolations: string[] }).__cspViolations,
  );
  expect(violations, `${when}：securitypolicyviolation`).toEqual([]);
}

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
          id: "01JTE2E0000000000000000998",
          loginId: "e2euser_style_001",
          displayName: "テスト太郎",
        },
        initialPassword: "TestPass123!abcd",
      }),
    }),
  );
}

for (const path of ["/login", "/setup"]) {
  test(`#171 AC-1: ${path} のHTML応答に CSP があり、style-src 'self' を含み 'unsafe-inline' を含まない`, async ({
    page,
  }) => {
    allowIntended401(page, path);
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    const csp = response?.headers()["content-security-policy"];
    expect(csp, "Content-Security-Policy ヘッダー").toBeDefined();
    expect(csp).toContain("style-src 'self'");
    expect(csp).not.toContain("'unsafe-inline'");
  });

  test(`#171 AC-1: ${path} のCSSは、同一オリジンの /assets/*.css の外部ファイルで、200・text/css で応答する`, async ({
    page,
    baseURL,
  }) => {
    allowIntended401(page, path);
    await page.goto(path);
    const hrefs = await page.evaluate(() =>
      [...document.querySelectorAll('link[rel="stylesheet"]')].map(
        (link) => (link as HTMLLinkElement).href,
      ),
    );
    expect(hrefs.length, "stylesheet の link が1つ以上ある").toBeGreaterThan(0);
    for (const href of hrefs) {
      const url = new URL(href);
      expect(url.origin).toBe(new URL(baseURL ?? "").origin);
      expect(url.pathname).toMatch(/^\/assets\/.+\.css$/);
      const response = await page.request.get(href);
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toContain("text/css");
    }
  });
}

test("#171 AC-1: /login を開いた後・ログインに失敗した後も、style 要素・style 属性が0で、CSP違反がない", async ({
  page,
}) => {
  allowSessionCheck401(page);
  allowLogin503(page);
  await watchCsp(page);
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "ログイン" })).toBeVisible();
  await expectNoInlineStyle(page, "画面を開いた後");

  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page.getByText("ユーザーIDを入力してください")).toBeVisible();
  await expectNoInlineStyle(page, "入力エラーの後");

  await page
    .getByLabel("ユーザーID", { exact: true })
    .fill("e2euser_style_none");
  await page.getByLabel("パスワード", { exact: true }).fill("WrongPass123!");
  // 文言・ステータスは問わない。vite preview はビルド成果物の設定だけを読むため、ログインの試行制限の鍵が渡らず、ログインは 503 になる。
  // ログインの成否・文言は、開発サーバー用 E2E（e2e/login.spec.ts）が確かめる。ここは失敗の表示の後も画面内スタイル・CSP違反が無いことだけを見る
  const loginResponse = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/auth/login",
  );
  await page.getByRole("button", { name: "ログイン" }).click();
  await loginResponse;
  await expect(page.locator("form").getByRole("alert")).toBeVisible();
  await expectNoInlineStyle(page, "ログイン失敗の後");
  await expectNoCspViolation(page, "ログイン画面");
});

test("#171 AC-1: /setup の入力フォーム・登録完了・完了済みの各状態で、style 要素・style 属性が0で、CSP違反がない", async ({
  page,
}) => {
  await watchCsp(page);
  await mockSetup(page, true);
  await page.goto("/setup");
  await expect(page.getByRole("button", { name: "登録する" })).toBeVisible();
  await expectNoInlineStyle(page, "入力フォーム");

  await page
    .getByLabel(/セットアップ用のトークン/)
    .fill("e2e-dummy-token-".padEnd(43, "0"));
  await page.getByLabel(/会社名/).fill("[E2E_TEST]テスト株式会社");
  await page.getByLabel(/部署名/).fill("[E2E_TEST]テスト部");
  await page.getByLabel(/社員ID/).fill("e2euser_style_001");
  await page.getByLabel(/本名/).fill("テスト太郎");
  await page
    .getByLabel(/メールアドレス$/)
    .fill("e2euser_style_001@example.com");
  await page
    .getByRole("checkbox", {
      name: /会社が発行した自分のメールアドレスだと確認しました/,
    })
    .check();
  await page.getByRole("button", { name: "登録する" }).click();
  await expect(
    page.getByRole("heading", { name: "登録が完了しました" }),
  ).toBeVisible();
  await expectNoInlineStyle(page, "登録完了");

  await page.unroute("**/api/setup/status");
  await mockSetup(page, false);
  await page.goto("/setup");
  await expect(page.getByText(/完了しています/)).toBeVisible();
  await expectNoInlineStyle(page, "完了済み");
  await expectNoCspViolation(page, "セットアップ画面");
});

test("#171 AC-1: ビルド済みのCSSが適用され、主ボタンの背景色がトークンの primary と同じ", async ({
  page,
}) => {
  allowSessionCheck401(page);
  await page.goto("/login");
  const button = page.getByRole("button", { name: "ログイン" });
  await expect(button).toBeVisible();
  await expect(button).toHaveCSS("background-color", PRIMARY_RGB);
});

// #121 AC-1：ログイン後の画面（共通レイアウト）も、本番形（CSP の下）で style 要素・style 属性が 0 で、CSP 違反がない。
// 本番形（vite preview）ではログインが 503 になりログインできないため、セッションの確認（GET /api/auth/session）の応答だけをこのテストの中で差し替える（架空の利用者。DBは使わない）。
// ドロワー（dialog）とアバターメニュー（popover）は、開いた状態でも確かめる。
async function mockLoggedIn(page: Page): Promise<void> {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "cache-control": "no-store" },
      body: JSON.stringify({
        user: {
          id: "01JTE2E0000000000000000997",
          displayName: "テスト一郎",
          loginId: "e2euser_style_997",
        },
        permissions: [],
        mustChangePassword: false,
        reauthenticatedAt: null,
      } satisfies SessionInfo),
    }),
  );
  // サイドバーの「参加中のチャンネル」が呼ぶ一覧（?joined=true を含む）。空の一覧を返す（実際の応答の形：items と nextCursor）
  await page.route(/\/api\/channels(\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "cache-control": "no-store" },
      body: JSON.stringify({ items: [], nextCursor: null }),
    }),
  );
  // #130：ヘッダーのステータスボタンが呼ぶ自分のプロフィール。在席の架空の値を返す（frontend/src/test/server.ts の既定の応答と同じ形）
  await page.route("**/api/me/profile", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "cache-control": "no-store" },
      body: JSON.stringify({
        id: "01JTE2E0000000000000000997",
        loginId: "e2euser_style_997",
        displayName: "テスト一郎",
        legalName: "テスト一郎",
        email: "e2euser_style_997@example.com",
        extension: null,
        jobTitle: null,
        department: null,
        status: { kind: "available", returnAt: null, message: null },
      }),
    }),
  );
}

test("#121 AC-1: ログイン後の画面（パソコン幅）は、アバターメニューを開いても style 要素・style 属性が0で、CSP違反がない", async ({
  page,
}) => {
  await watchCsp(page);
  await mockLoggedIn(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("ホーム");
  await expect(
    page.getByRole("navigation", { name: "メインメニュー" }),
  ).toBeVisible();
  await expectNoInlineStyle(page, "ログイン後の画面");

  await page
    .getByRole("button", { name: "アカウントメニュー（テスト一郎）" })
    .click();
  await expect(page.getByRole("button", { name: "ログアウト" })).toBeVisible();
  await expectNoInlineStyle(page, "アバターメニューを開いた後");
  await expectNoCspViolation(page, "ログイン後の画面（パソコン幅）");
});

test("#121 AC-1: ログイン後の画面（スマホ幅）は、ドロワーを開いても style 要素・style 属性が0で、CSP違反がない", async ({
  page,
}) => {
  await watchCsp(page);
  await mockLoggedIn(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("ホーム");
  await expect(
    page.getByRole("navigation", { name: "下部メニュー" }),
  ).toBeVisible();
  await expectNoInlineStyle(page, "ログイン後の画面");

  await page.getByRole("button", { name: "メニューを開く" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expectNoInlineStyle(page, "ドロワーを開いた後");
  await expectNoCspViolation(page, "ログイン後の画面（スマホ幅）");
});
