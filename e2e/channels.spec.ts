// #200 AC-1〜AC-4: 全体管理者が e2euser を発行 → その e2euser で初回ログイン（パスワード変更）→ サイドバーに全社連絡と自部署の専用チャンネル2つ
// → 「チャンネルを探す」→ 他部署の専用チャンネルに参加 → サイドバーに出る、までを実ブラウザで確かめる。
// データは架空（e2euser_chan_ 接頭辞・@example.com・[E2E_TEST]部署200）。前提のデータは e2e/seeds/channels.sql、後始末は channels-cleanup.sql。
// ログインの試行制限に当たらないよう、各利用者のログインは1回だけにする。
import { execFile } from "node:child_process";
import type { Browser, Page } from "@playwright/test";
import { expect, test } from "./console-guard";
import { roomLinkName } from "./room-link";
import { allowSessionCheck401 } from "./session-console";

const PASSWORD = "TestPass123!";
const NEW_PASSWORD = "Different456!";
const ISSUED = {
  loginId: "e2euser_chan_new01",
  legalName: "テスト太郎",
  email: "e2euser_chan_new01@example.com",
};
const DEPT_SALES_ID = "01JTE2E2000000000000000D01";
const SALES = "[E2E_TEST]部署200営業";
const SALES_ANNOUNCEMENT = "[E2E_TEST]部署200営業のお知らせ";
const DEV = "[E2E_TEST]部署200開発";
const DEV_ANNOUNCEMENT = "[E2E_TEST]部署200開発のお知らせ";

function seedFile(file: "channels.sql" | "channels-cleanup.sql") {
  return new Promise<string>((resolve, reject) => {
    execFile(
      process.execPath,
      ["scripts/db-local.ts", "test", "seed-file", `e2e/seeds/${file}`],
      { cwd: process.cwd(), windowsHide: true },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
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
  await seedFile("channels-cleanup.sql");
  await seedFile("channels.sql");
});
test.afterAll(async () => {
  const output = await seedFile("channels-cleanup.sql");
  // 後始末の後の残数がすべて 0 であること
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
});

test("#200 AC-1〜AC-4: 管理者が発行 → 発行した社員でログイン → サイドバーに全社連絡と自部署の専用2つ → 他部署の専用チャンネルに参加 → サイドバーに出る", async ({
  page,
  browser,
}) => {
  allowSessionCheck401(page);
  await login(page, "e2euser_chan_admin", PASSWORD);
  await expect(page).toHaveURL(/\/$/);

  // 管理者が、営業部の社員を発行する
  await page.goto("/accounts/new");
  await page.getByLabel(/社員ID/).fill(ISSUED.loginId);
  await page.getByLabel(/本名/).fill(ISSUED.legalName);
  await page.getByLabel(/メールアドレス$/).fill(ISSUED.email);
  await page
    .getByRole("combobox", { name: /所属部署/ })
    .selectOption(DEPT_SALES_ID);
  await page.getByRole("checkbox", { name: /会社が発行した/ }).check();
  const responsePromise = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname === "/api/admin/accounts",
  );
  await page.getByRole("button", { name: "登録する" }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const { initialPassword } = (await response.json()) as {
    initialPassword: string;
  };

  // 発行した社員でログインし、初回のパスワード変更を済ませる
  const origin = new URL(page.url()).origin;
  const issued = await newPage(browser, origin);
  try {
    await login(issued.page, ISSUED.loginId, initialPassword);
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

    // 閉じているドロワー（dialog）にも同じ項目があるため、サイドバー（メインメニュー）に絞る
    const mainMenu = issued.page.getByRole("navigation", {
      name: "メインメニュー",
    });
    // 発行のときに、全社連絡と自部署（営業）の専用チャンネル2つへ参加している
    await expect(
      mainMenu.getByRole("link", { name: roomLinkName("全社連絡") }),
    ).toBeVisible();
    await expect(
      mainMenu.getByRole("link", { name: roomLinkName(SALES) }),
    ).toBeVisible();
    await expect(
      mainMenu.getByRole("link", { name: roomLinkName(SALES_ANNOUNCEMENT) }),
    ).toBeVisible();
    // 他部署（開発）のチャンネルには、まだ参加していない
    await expect(
      mainMenu.getByRole("link", { name: roomLinkName(DEV) }),
    ).toHaveCount(0);

    // 「チャンネルを探す」から、他部署の専用チャンネルに参加する
    await mainMenu.getByRole("link", { name: "チャンネルを探す" }).click();
    await expect(issued.page).toHaveURL(/\/channels$/);
    await expect(
      issued.page.getByRole("heading", { name: "チャンネルを探す" }),
    ).toBeVisible();
    const main = issued.page.getByRole("main");
    await expect(
      main.getByRole("link", { name: DEV_ANNOUNCEMENT, exact: true }),
    ).toBeVisible();
    const joinResponse = issued.page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        /^\/api\/channels\/[^/]+\/join$/.test(new URL(r.url()).pathname),
    );
    await main
      .getByRole("button", { name: `${DEV}に参加する`, exact: true })
      .click();
    expect((await joinResponse).status()).toBe(200);

    // 参加すると、一覧は「参加済み」になり、サイドバーに出る
    await expect(
      main.getByRole("button", { name: `${DEV}に参加する`, exact: true }),
    ).toHaveCount(0);
    await expect(
      mainMenu.getByRole("link", { name: roomLinkName(DEV) }),
    ).toBeVisible();
    // 参加していないチャンネルは、サイドバーに出ない
    await expect(
      mainMenu.getByRole("link", { name: roomLinkName(DEV_ANNOUNCEMENT) }),
    ).toHaveCount(0);
  } finally {
    await issued.context.close();
  }
});

test("#200 AC-2: 未ログインで /channels を開くとログイン画面へ移り、一覧の API は401", async ({
  page,
}) => {
  allowSessionCheck401(page);
  await page.goto("/channels");
  await expect(page).toHaveURL(/\/login/);
  const res = await page.request.get("/api/channels");
  expect(res.status()).toBe(401);
});
