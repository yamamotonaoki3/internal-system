// #150（150-A）5-1 AC-9・AC-10・AC-11、3-3 AC-1、画面 S-17：案件の終了・再開と、その通知の主な流れを、画面からバックエンドまで通して確かめる（実ブラウザ）。
// 流れ：参加者 A が S-17 で「案件を終了」→ 確認 → 終了（保存の完了を待つ）→ A の画面に帯「終了した案件・アーカイブ（読み取り専用）」が出て、入力欄が消える
//   → 別のブラウザの参加者 B の通知に「参加している案件が終了しました」→ 押すと S-17（読み取り専用）→ B が「案件を再開」→ 確認 → 再開（保存の完了を待つ）
//   → A の通知に「参加している案件が再開されました」→ 押すと S-17 で、また投稿できる。
// 判定の順・認可・同時の操作は backend の結合・DB・Service のテスト、画面の分岐は frontend/src/pages/CaseCloseReopen.test.tsx で確かめ、ここでは重ねない。
// 前提：e2e/seeds/case-close.sql（[E2E_TEST]部署150A・e2euser_case150_a／_b（両方とも案件の参加者）・取引先 テスト商事終了 [E2E_TEST]（QKC）・
//   進行中の案件 QKC-261118-0001「[E2E_TEST] 終了の確認」）。案件の状態を変えるため、毎回 seed で作り直す（前の実行の案件を使い回さない）。
//   後始末は e2e/seeds/case-close-cleanup.sql（識別子だけ。残数 0 を確かめる）。この E2E の利用者・案件は、ほかの spec と共有しない。
// ログインの試行制限に当たらないよう、ログインは利用者ごとに1回だけにする（それぞれ別のブラウザのコンテキスト）。
import { execFile } from "node:child_process";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./console-guard";
import { allowSessionCheck401 } from "./session-console";

const PASSWORD = "TestPass123!";
const CASE_ID = "01JTE2E00000000000V0011150";
const CLOSED_BANNER = "終了した案件・アーカイブ（読み取り専用）";
const CLOSED_NOTICE = "参加している案件が終了しました";
const REOPENED_NOTICE = "参加している案件が再開されました";
const POST_TEXT = "[E2E_TEST]150再開の後の投稿";

function run(args: readonly string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile(
      process.execPath,
      [...args],
      { cwd: process.cwd(), windowsHide: true },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

const seedFile = (file: "case-close.sql" | "case-close-cleanup.sql") =>
  run(["scripts/db-local.ts", "test", "seed-file", `e2e/seeds/${file}`]);

type Signed = { context: BrowserContext; page: Page };

async function signIn(
  browser: Browser,
  baseURL: string | undefined,
  loginId: string,
): Promise<Signed> {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  allowSessionCheck401(page);
  await page.goto("/login");
  await page.getByLabel("ユーザーID", { exact: true }).fill(loginId);
  await page.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  return { context, page };
}

const main = (page: Page) => page.getByRole("main");
const messageBox = (page: Page) =>
  main(page).getByRole("textbox", { name: "メッセージ" });

/** 確認のダイアログで確定し、POST の応答（保存の完了）を待つ */
async function confirmStatusChange(
  page: Page,
  kind: "close" | "reopen",
): Promise<void> {
  const labels =
    kind === "close"
      ? { open: "案件を終了", dialog: "案件の終了", confirm: "終了する" }
      : { open: "案件を再開", dialog: "案件の再開", confirm: "再開する" };
  await main(page)
    .getByRole("button", { name: labels.open, exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: labels.dialog });
  await expect(dialog).toBeVisible();
  // 150-B：再開のダイアログは、参加者を選ぶ段階 →「確認へ」→ 確かめる段階 →「再開する」（ここでは選び直さない）
  if (kind === "reopen")
    await dialog.getByRole("button", { name: "確認へ", exact: true }).click();
  const saved = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname === `/api/cases/${CASE_ID}/${kind}`,
  );
  await dialog
    .getByRole("button", { name: labels.confirm, exact: true })
    .click();
  expect((await saved).status()).toBe(200);
  await expect(dialog).toHaveCount(0);
}

/** 通知の一覧（S-08）を開き、文言の通知を押す */
async function openNotice(page: Page, text: string) {
  await page.goto("/");
  await page.getByRole("banner").getByRole("link", { name: /^通知/ }).click();
  await expect(page).toHaveURL(/\/notifications$/);
  await main(page)
    .getByRole("button", { name: new RegExp(text) })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`/cases/${CASE_ID}$`));
}

let a: Signed | undefined;
let b: Signed | undefined;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser, baseURL }) => {
  await seedFile("case-close-cleanup.sql");
  await seedFile("case-close.sql");
  a = await signIn(browser, baseURL, "e2euser_case150_a");
  b = await signIn(browser, baseURL, "e2euser_case150_b");
});

test.afterAll(async () => {
  for (const opened of [a, b]) await opened?.context.close();
  const output = await seedFile("case-close-cleanup.sql");
  expect(output).toContain("remaining_users");
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
});

test("#150 5-1 AC-9・AC-10・AC-11・3-3 AC-1: 参加者 A が終了すると、B に通知が届き、B が通知から開いて再開すると、A に再開の通知が届き、また投稿できる", async () => {
  const pa = (a as Signed).page;
  const pb = (b as Signed).page;

  // ---- A：終了 ----
  await pa.goto(`/cases/${CASE_ID}`);
  await expect(messageBox(pa)).toBeVisible();
  await confirmStatusChange(pa, "close");
  await expect(main(pa).getByText("案件を終了しました")).toBeVisible();
  await expect(main(pa).getByText(CLOSED_BANNER)).toBeVisible();
  await expect(messageBox(pa)).toHaveCount(0);
  await expect(
    main(pa).getByRole("button", { name: "案件を再開", exact: true }),
  ).toBeVisible();

  // ---- B：終了の通知から S-17 を開き、再開する（A の保存の完了の後に確かめる） ----
  await openNotice(pb, CLOSED_NOTICE);
  await expect(main(pb).getByText(CLOSED_BANNER)).toBeVisible();
  await expect(messageBox(pb)).toHaveCount(0);
  await confirmStatusChange(pb, "reopen");
  await expect(main(pb).getByText("案件を再開しました")).toBeVisible();
  await expect(messageBox(pb)).toBeVisible();
  await expect(main(pb).getByText(CLOSED_BANNER)).toHaveCount(0);

  // ---- A：再開の通知から開き、投稿できる ----
  await openNotice(pa, REOPENED_NOTICE);
  await expect(main(pa).getByText(CLOSED_BANNER)).toHaveCount(0);
  await messageBox(pa).fill(POST_TEXT);
  await main(pa).getByRole("button", { name: "送信", exact: true }).click();
  await expect(
    main(pa).getByRole("log", { name: "メッセージ一覧" }),
  ).toContainText(POST_TEXT);
});
