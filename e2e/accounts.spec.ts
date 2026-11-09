// #199 AC-1・AC-3・AC-5・AC-6: 全体管理者が画面からアカウントを発行し、発行したアカウントで初回ログイン → 変更の強制 → 一覧に出るまで。
// データは架空（e2euser_account_ 接頭辞・@example.com・テスト太郎・[E2E_TEST]）。後始末は accounts-cleanup.sql。
// ログインの試行制限に当たらないよう、各利用者のログインは1回だけにし、管理者のセッションの Cookie を使い回す。
import { execFile } from "node:child_process";
import type { Browser, Page } from "@playwright/test";
import { expect, test } from "./console-guard";
import { allowSessionCheck401 } from "./session-console";

const PASSWORD = "TestPass123!";
const NEW_PASSWORD = "Different456!";
const ISSUED = {
  loginId: "e2euser_account_new01",
  legalName: "テスト太郎",
  email: "e2euser_account_new01@example.com",
};
const DEPT_ID = "01JTE2E1990000000000000D01";

function seedFile(file: "accounts.sql" | "accounts-cleanup.sql") {
  return new Promise<void>((resolve, reject) => {
    execFile(
      process.execPath,
      ["scripts/db-local.ts", "test", "seed-file", `e2e/seeds/${file}`],
      { cwd: process.cwd(), windowsHide: true },
      (error) => (error ? reject(error) : resolve()),
    );
  });
}

async function login(page: Page, loginId: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("ユーザーID", { exact: true }).fill(loginId);
  await page.getByLabel("パスワード", { exact: true }).fill(password);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
}

async function newPage(browser: Browser, baseURL: string) {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  allowSessionCheck401(page);
  return { context, page };
}

test.beforeAll(async () => {
  await seedFile("accounts-cleanup.sql");
  await seedFile("accounts.sql");
});
test.afterAll(async () => {
  await seedFile("accounts-cleanup.sql");
});

test("#199 AC-1・AC-3・AC-5・AC-6: 管理者が発行 → 初期パスワードを一度だけ表示 → 発行したアカウントでログインすると変更を強制 → 一覧に出る", async ({
  page,
  browser,
}) => {
  allowSessionCheck401(page);
  await login(page, "e2euser_account_admin", PASSWORD);
  await expect(page).toHaveURL(/\/$/);

  // メニューから S-22 → S-23
  // 閉じているドロワー（dialog）にも同じ項目があるため、サイドバー（メインメニュー）に絞る
  const mainMenu = page.getByRole("navigation", { name: "メインメニュー" });
  await mainMenu.getByText("アカウント", { exact: true }).click();
  await mainMenu.getByRole("link", { name: "アカウント管理" }).click();
  await expect(page).toHaveURL(/\/accounts$/);
  await expect(
    page.getByRole("heading", { name: "アカウント管理" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "新規登録" }).click();
  await expect(page).toHaveURL(/\/accounts\/new$/);

  await page.getByLabel(/社員ID/).fill(ISSUED.loginId);
  await page.getByLabel(/本名/).fill(ISSUED.legalName);
  await expect(page.getByLabel(/表示名/)).toHaveValue(ISSUED.legalName);
  await page.getByLabel(/メールアドレス$/).fill(ISSUED.email);
  await page.getByRole("combobox", { name: /所属部署/ }).selectOption(DEPT_ID);
  await page.getByRole("checkbox", { name: /会社が発行した/ }).check();

  const responsePromise = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname === "/api/admin/accounts",
  );
  await page.getByRole("button", { name: "登録する" }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const created = (await response.json()) as { initialPassword: string };
  const initialPassword = created.initialPassword;

  await expect(
    page.getByRole("heading", { name: "登録が完了しました" }),
  ).toBeVisible();
  await expect(page.getByText(initialPassword, { exact: true })).toBeVisible();
  // 端末に保存しない
  const stored = await page.evaluate(() =>
    JSON.stringify({ ...window.localStorage, ...window.sessionStorage }),
  );
  expect(stored).not.toContain(initialPassword);
  expect(stored).not.toContain(ISSUED.email);

  await page.getByRole("button", { name: "一覧へ戻る" }).click();
  await expect(page).toHaveURL(/\/accounts$/);
  await expect(page.getByText(/登録しました/)).toBeVisible();
  await expect(page.getByText(initialPassword)).toHaveCount(0);
  const row = page.getByRole("row", { name: new RegExp(ISSUED.loginId) });
  await expect(row).toContainText(ISSUED.email);
  await expect(row).toContainText("[E2E_TEST]アカウント発行部");

  // 発行したアカウントでログイン → 初回変更の強制
  const origin = new URL(page.url()).origin;
  const issued = await newPage(browser, origin);
  try {
    await login(issued.page, ISSUED.loginId, initialPassword);
    await expect(
      issued.page.getByLabel("現在のパスワード", { exact: true }),
    ).toBeVisible();
    expect(
      await (await issued.page.request.get("/api/auth/session")).json(),
    ).toMatchObject({ mustChangePassword: true });
    await issued.page
      .getByLabel("現在のパスワード", { exact: true })
      .fill(initialPassword);
    await issued.page
      .getByLabel("新しいパスワード", { exact: true })
      .fill(NEW_PASSWORD);
    await issued.page
      .getByLabel("新しいパスワード（確認）", { exact: true })
      .fill(NEW_PASSWORD);
    await issued.page
      .getByRole("button", { name: "パスワードを変更", exact: true })
      .click();
    await expect(issued.page).toHaveURL(/\/$/);
  } finally {
    await issued.context.close();
  }

  // 管理者の Cookie を使い回して一覧を読み直す
  await page.reload();
  await expect(
    page.getByRole("row", { name: new RegExp(ISSUED.loginId) }),
  ).toBeVisible();
});

test("#199 AC-1: 一般社員には管理メニューが出ず、/accounts は開けず、API は403", async ({
  page,
}) => {
  allowSessionCheck401(page);
  await login(page, "e2euser_account_member", PASSWORD);
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: "アカウント管理" })).toHaveCount(
    0,
  );
  await page.goto("/accounts");
  await expect(
    page.getByRole("heading", { name: "ページが見つかりません" }),
  ).toBeVisible();
  const res = await page.request.get("/api/admin/accounts");
  expect(res.status()).toBe(403);
});
