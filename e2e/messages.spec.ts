// #201 AC-4: 同じチャンネル（S-05）を別々のブラウザコンテキストで開いた2人が、再読み込みなしで（2秒間隔のポーリングで）互いの投稿を見る。
// page.reload を呼ばない。expect の既定の待ちで足り、待ち時間は延ばさない。
// データは架空（e2euser_msg_ 接頭辞・@example.com・[E2E_TEST]部署201）。前提のデータは e2e/seeds/messages.sql、後始末は messages-cleanup.sql。
// ログインの試行制限に当たらないよう、各利用者のログインは1回だけにする。
import { execFile } from "node:child_process";
import type { Browser, Page } from "@playwright/test";
import { expect, test } from "./console-guard";
import { allowSessionCheck401 } from "./session-console";

const PASSWORD = "TestPass123!";
const CHANNEL_PATH = "/channels/01JTE2E3000000000000000C01";

function seedFile(file: "messages.sql" | "messages-cleanup.sql") {
  return new Promise<string>((resolve, reject) => {
    execFile(
      process.execPath,
      ["scripts/db-local.ts", "test", "seed-file", `e2e/seeds/${file}`],
      { cwd: process.cwd(), windowsHide: true },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

async function openChannelAs(
  browser: Browser,
  baseURL: string,
  loginId: string,
) {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  allowSessionCheck401(page);
  await page.goto("/login");
  await page.getByLabel("ユーザーID", { exact: true }).fill(loginId);
  await page.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto(CHANNEL_PATH);
  await expect(page.getByRole("log")).toBeVisible();
  return { context, page };
}

async function postMessage(page: Page, text: string) {
  await page.getByRole("textbox", { name: "メッセージ" }).fill(text);
  await page.getByRole("button", { name: "送信", exact: true }).click();
}

test.beforeAll(async () => {
  await seedFile("messages-cleanup.sql");
  await seedFile("messages.sql");
});
test.afterAll(async () => {
  const output = await seedFile("messages-cleanup.sql");
  // 後始末の後の残数がすべて 0 であること
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
});

test("#201 AC-4: 2人が同じチャンネルを開き、互いの投稿が再読み込みなしに表示される（Enter は改行、Ctrl+Enter で送信も確かめる）", async ({
  browser,
  baseURL,
}) => {
  const origin = baseURL ?? "http://localhost:5173";
  const a = await openChannelAs(browser, origin, "e2euser_msg_a");
  const b = await openChannelAs(browser, origin, "e2euser_msg_b");
  try {
    // A が送信ボタンで投稿 → A の画面にも、B の画面にも（再読み込みなしで）出る
    await postMessage(a.page, "[E2E_TEST]AからBへ");
    await expect(a.page.getByRole("log")).toContainText("[E2E_TEST]AからBへ");
    await expect(b.page.getByRole("log")).toContainText("[E2E_TEST]AからBへ");
    await expect(
      a.page.getByRole("textbox", { name: "メッセージ" }),
    ).toHaveValue("");

    // B が Ctrl+Enter で投稿 → A の画面に出る。Enter だけでは送られず改行になる
    const boxB = b.page.getByRole("textbox", { name: "メッセージ" });
    await boxB.fill("[E2E_TEST]BからA");
    await boxB.press("Enter");
    await expect(boxB).toHaveValue("[E2E_TEST]BからA\n");
    await boxB.press("Control+Enter");
    await expect(a.page.getByRole("log")).toContainText("[E2E_TEST]BからA");
    await expect(b.page.getByRole("log")).toContainText("[E2E_TEST]BからA");

    // 古い順に並ぶ（表示名の違う2人の投稿が、投稿の順に並ぶ）
    const text = (await a.page.getByRole("log").innerText()) ?? "";
    expect(text.indexOf("[E2E_TEST]AからBへ")).toBeLessThan(
      text.indexOf("[E2E_TEST]BからA"),
    );
  } finally {
    await a.context.close();
    await b.context.close();
  }
});
