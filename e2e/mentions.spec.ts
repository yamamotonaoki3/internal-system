// #139 1-8 AC-1〜AC-3・3-2 AC-1〜AC-3・1-5 AC-7: 指名の投稿・通知・表示を実ブラウザで確認する。
// 架空データは e2e/seeds/mentions.sql、後始末は mentions-cleanup.sql。ほかのシードとID・prefixを分ける。
import { execFile } from "node:child_process";
import type { Browser, Page } from "@playwright/test";
import { expect, test } from "./console-guard";
import { allowSessionCheck401 } from "./session-console";

const PASSWORD = "TestPass123!";
const ROOM_ID = "01JTE2E1390000000000000C01";
const CHANNEL = `/channels/${ROOM_ID}`;

function seedFile(file: "mentions.sql" | "mentions-cleanup.sql") {
  return new Promise<string>((resolve, reject) => {
    execFile(
      process.execPath,
      ["scripts/db-local.ts", "test", "seed-file", `e2e/seeds/${file}`],
      { cwd: process.cwd(), windowsHide: true },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

async function login(browser: Browser, baseURL: string, loginId: string) {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  allowSessionCheck401(page);
  await page.goto("/login");
  await page.getByLabel("ユーザーID", { exact: true }).fill(loginId);
  await page.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  return { context, page };
}

async function selectMention(page: Page, query: string, department: string) {
  const box = page.getByRole("textbox", { name: "メッセージ" });
  await box.pressSequentially(query);
  const option = page.getByRole("option").filter({ hasText: department });
  await expect(option).toHaveCount(1);
  await option.click();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const output = await seedFile("mentions-cleanup.sql");
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
  await seedFile("mentions.sql");
});
test.afterAll(async () => {
  const output = await seedFile("mentions-cleanup.sql");
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
});

test("#139 1-8 AC-1・3-2 AC-1・1-5 AC-7: AがBを指名するとBだけにアプリ通知が届き、本文は強調されクリックできない", async ({
  browser,
  baseURL,
}) => {
  const origin = baseURL ?? "http://localhost:5173";
  const a = await login(browser, origin, "e2euser_mtn_a");
  const b = await login(browser, origin, "e2euser_mtn_b");
  const c = await login(browser, origin, "e2euser_mtn_c");
  try {
    await a.page.goto(CHANNEL);
    await expect(a.page.getByRole("log")).toBeVisible();
    const input = a.page.getByRole("textbox", { name: "メッセージ" });
    await input.fill("[E2E_TEST]確認をお願いします ");
    await selectMention(a.page, "@testuser_mtn_b", "[E2E_TEST]部署139");
    await a.page.getByRole("button", { name: "送信", exact: true }).click();
    await expect(a.page.getByRole("log")).toContainText("@testuser_mtn_b");
    await expect(input).toHaveValue("");
    const mark = a.page.getByRole("log").locator(".mention");
    await expect(mark).toHaveCount(1);
    await expect(mark).toContainText("@testuser_mtn_b");
    await expect(mark.locator("a, button")).toHaveCount(0);

    await expect(
      b.page.getByRole("banner").getByRole("link", { name: /^通知/ }),
    ).toContainText("1");
    await b.page.goto("/notifications");
    await expect(b.page.getByRole("main").getByRole("listitem")).toHaveCount(1);
    const ownList = await a.page.request.get("/api/me/notifications?limit=100");
    expect(ownList.status()).toBe(200);
    expect(((await ownList.json()) as { items: unknown[] }).items).toHaveLength(
      0,
    );
    const outsiderList = await c.page.request.get(
      "/api/me/notifications?limit=100",
    );
    expect(outsiderList.status()).toBe(200);
    expect(
      ((await outsiderList.json()) as { items: unknown[] }).items,
    ).toHaveLength(0);
  } finally {
    await a.context.close();
    await b.context.close();
    await c.context.close();
  }
});

test("#139 3-2 AC-1・AC-2: 非参加者Cを指名として保存しても通知せず、編集で普通の@を書いてもBへ通知しない", async ({
  browser,
  baseURL,
}) => {
  const origin = baseURL ?? "http://localhost:5173";
  const a = await login(browser, origin, "e2euser_mtn_a");
  const b = await login(browser, origin, "e2euser_mtn_b");
  const c = await login(browser, origin, "e2euser_mtn_c");
  try {
    const before = await b.page.request.get("/api/me/notifications?limit=100");
    const beforeCount = ((await before.json()) as { items: unknown[] }).items
      .length;
    await a.page.goto(CHANNEL);
    const input = a.page.getByRole("textbox", { name: "メッセージ" });
    await input.fill("[E2E_TEST]編集通知 ");
    await selectMention(a.page, "@testuser_mtn_c", "[E2E_TEST]部署139");
    await a.page.getByRole("button", { name: "送信", exact: true }).click();
    const row = a.page
      .getByRole("log")
      .getByRole("listitem")
      .filter({ hasText: "編集通知" });
    await expect(row.locator(".mention")).toContainText("@testuser_mtn_c");
    const outsiderList = await c.page.request.get(
      "/api/me/notifications?limit=100",
    );
    expect(
      ((await outsiderList.json()) as { items: unknown[] }).items,
    ).toHaveLength(0);

    await row.getByRole("button", { name: "編集" }).click();
    const edit = a.page.getByRole("textbox", { name: "メッセージの編集" });
    await edit.fill("[E2E_TEST]編集通知 @testuser_mtn_b");
    await a.page.getByRole("button", { name: "保存" }).click();
    await expect(row).toContainText("@testuser_mtn_b");
    // 普通の @ 文字列を入力しただけなら、Bへの通知は発生しない。
    const list = await b.page.request.get("/api/me/notifications?limit=100");
    expect(((await list.json()) as { items: unknown[] }).items).toHaveLength(
      beforeCount,
    );
  } finally {
    await a.context.close();
    await b.context.close();
    await c.context.close();
  }
});
