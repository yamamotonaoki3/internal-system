// #134 AC-2（1-5 AC-1〜AC-8）：メッセージの本文のマークダウンの表示を、画面からバックエンドまで通して確かめる。
// C がチャンネル（S-05）を開くと、記法（太字・斜体・取り消し線・箇条書き・番号・引用・コード・リンク）が整形され、
// 整形しない記法（見出し・表・画像・タスクリスト・区切り線・~1つ~）は書いたままの文字で出る。
// 本文に書いた HTML・スクリプト・javascript: のリンクは実行されず（dialog が起きない）、文字で出る。リンクは別のタブで開き、rel に noopener・noreferrer。
// 画面から投稿した HTML も、再読み込みせずに文字で出て、実行されない。
// 前提のデータは e2e/seeds/messages-edit.sql（C02 [E2E_TEST]部署134の記法・e2euser_edit134_c）。後始末は messages-edit-cleanup.sql（残数 0 を確かめる）。
// 外部のサイト（example.com）は開かない（リンクを押さない）。ログインは C の 1 回だけ。
import { execFile } from "node:child_process";
import type { Page } from "@playwright/test";
import { expect, test } from "./console-guard";
import { allowSessionCheck401 } from "./session-console";

const PASSWORD = "TestPass123!";
const CHANNEL_PATH = "/channels/01JTE2E1340000000000000C02";

function seedFile(file: "messages-edit.sql" | "messages-edit-cleanup.sql") {
  return new Promise<string>((resolve, reject) => {
    execFile(
      process.execPath,
      ["scripts/db-local.ts", "test", "seed-file", `e2e/seeds/${file}`],
      { cwd: process.cwd(), windowsHide: true },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

/** alert・confirm・prompt が開いたら記録して閉じる（開かないことを確かめる） */
function watchDialogs(page: Page): string[] {
  const opened: string[] = [];
  page.on("dialog", (dialog) => {
    opened.push(`${dialog.type()}: ${dialog.message()}`);
    void dialog.dismiss();
  });
  return opened;
}

test.beforeAll(async () => {
  await seedFile("messages-edit-cleanup.sql");
  await seedFile("messages-edit.sql");
});
test.afterAll(async () => {
  const output = await seedFile("messages-edit-cleanup.sql");
  // 後始末の後の残数がすべて 0 であること
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
});

test("#134 AC-2（1-5 AC-1〜AC-8）: 記法を整形し、整形しない記法・HTML・危険なリンクは文字で出し、スクリプトは実行されない。リンクは別のタブ・noopener・noreferrer", async ({
  page,
}) => {
  allowSessionCheck401(page);
  const dialogs = watchDialogs(page);
  await page.goto("/login");
  await page
    .getByLabel("ユーザーID", { exact: true })
    .fill("e2euser_edit134_c");
  await page.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto(CHANNEL_PATH);
  const log = page.getByRole("log");

  // 1-5 AC-2：整形する記法（マークダウンの部品の動的読み込みを待つ）
  await expect(log.locator("strong", { hasText: "記法の太字" })).toBeVisible();
  await expect(log.locator("em", { hasText: "記法の斜体" })).toBeVisible();
  await expect(log.locator("del", { hasText: "記法の取り消し" })).toBeVisible();
  await expect(log.locator("code", { hasText: "記法のコード" })).toBeVisible();
  await expect(
    log
      .getByRole("listitem")
      .filter({ hasText: "[E2E_TEST]箇条書き" })
      .locator(".markdown-body ul > li"),
  ).toHaveText(["記法の一つ目", "記法の二つ目"]);
  await expect(
    log
      .getByRole("listitem")
      .filter({ hasText: "[E2E_TEST]番号" })
      .locator(".markdown-body ol > li"),
  ).toHaveText(["記法の最初", "記法の次"]);
  await expect(
    log.locator("blockquote", { hasText: "記法の引用" }),
  ).toBeVisible();
  await expect(log.locator("pre code")).toContainText("const 記法 = 1");
  // 各行の本文は、固定のクラス markdown-body の外枠の中
  await expect(
    log.locator(".markdown-body strong", { hasText: "記法の太字" }),
  ).toHaveCount(1);

  // 1-5 AC-6：~1つ~ は取り消し線にしない
  await expect(log).toContainText("~記法の1つの波~");
  await expect(log.locator("del", { hasText: "記法の1つの波" })).toHaveCount(0);

  // 1-5 AC-1（U-5）：1回の改行は改行として出す
  const lines = log.getByRole("listitem").filter({ hasText: "記法の一行目" });
  await expect(lines.locator("br")).toHaveCount(1);
  await expect(lines).toContainText("記法の二行目");

  // 1-5 AC-4：リンク（記法つき・本文中の URL）は、別のタブ・noopener・noreferrer
  const link = log.getByRole("link", { name: "記法のリンク", exact: true });
  await expect(link).toHaveAttribute("href", /^https:\/\/example\.com\/?$/);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", /noopener/);
  await expect(link).toHaveAttribute("rel", /noreferrer/);
  const autolink = log.getByRole("link", {
    name: "https://example.org/page",
    exact: true,
  });
  await expect(autolink).toHaveAttribute("href", "https://example.org/page");
  await expect(autolink).toHaveAttribute("target", "_blank");
  await expect(autolink).toHaveAttribute("rel", /noopener/);
  await expect(autolink).toHaveAttribute("rel", /noreferrer/);

  // 1-5 AC-3・AC-4・AC-8：HTML・スクリプト・javascript: のリンクは、要素・リンクにせず文字で出す
  await expect(log).toContainText("<img src=x onerror=alert(1)>");
  await expect(log).toContainText("<script>alert(1)</script>");
  await expect(log).toContainText("[記法の危険なリンク](javascript:alert(1))");
  await expect(
    log.getByRole("link", { name: /記法の危険なリンク/ }),
  ).toHaveCount(0);
  await expect(log.locator("img, script, iframe, svg")).toHaveCount(0);
  await expect(log.locator('a[href^="javascript:" i]')).toHaveCount(0);

  // 1-5 AC-5・AC-6（U-4）：見出し・表・画像・タスクリスト・区切り線は、要素にせず書いたままの文字で出す
  await expect(log.locator("h1, h2, h3, h4, h5, h6")).toHaveCount(0);
  await expect(log.locator("table, input, hr")).toHaveCount(0);
  await expect(log).toContainText("# 記法の見出し");
  await expect(log).toContainText("| a | b |");
  await expect(log).toContainText("![記法の画像](https://example.com/a.png)");
  await expect(log).toContainText("[ ] 記法のタスク");

  // 本文の中に style 属性・利用者由来のクラスがない（外枠の markdown-body を除く）
  await expect(log.locator(".markdown-body [style]")).toHaveCount(0);
  await expect(log.locator(".markdown-body [class]")).toHaveCount(0);

  // 画面から投稿した HTML も、再読み込みせずに文字で出て、実行されない
  let loads = 0;
  page.on("load", () => {
    loads += 1;
  });
  await page
    .getByRole("textbox", { name: "メッセージ", exact: true })
    .fill("[E2E_TEST]<svg onload=alert(1)>画面から投稿した記法 **画面の太字**");
  await page.getByRole("button", { name: "送信", exact: true }).click();
  await expect(log).toContainText("<svg onload=alert(1)>画面から投稿した記法");
  await expect(log.locator("strong", { hasText: "画面の太字" })).toBeVisible();
  await expect(log.locator("svg")).toHaveCount(0);
  expect(loads).toBe(0);

  // 本文の HTML・スクリプトで、alert 等のダイアログが一度も開いていない
  expect(dialogs).toEqual([]);
});
