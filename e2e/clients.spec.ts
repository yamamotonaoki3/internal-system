// #192 AC-2・AC-3・AC-4・AC-5・AC-7: 架空の専用管理者で画面からAPIとDBまで確認する。
import { execFile } from "node:child_process";
import { expect, test } from "./console-guard";
import { allowSessionCheck401 } from "./session-console";

const PREFIX = "[E2E_CLIENT_192]";
const initialName = `${PREFIX}testclient_alpha`;
const changedName = `${PREFIX}testclient_renamed`;

function seedFile(file: "clients.sql" | "clients-cleanup.sql"): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ["scripts/db-local.ts", "test", "seed-file", `e2e/seeds/${file}`],
      { cwd: process.cwd(), windowsHide: true },
      (error) => {
        if (error) reject(error);
        else resolve();
      },
    );
  });
}

test.beforeAll(async () => {
  await seedFile("clients.sql");
});
test.afterAll(async () => {
  await seedFile("clients-cleanup.sql");
});

test("#192 AC-2・AC-3・AC-4・AC-5・AC-7: 管理者は画面で登録・部分検索・改名・無効化できる", async ({
  page,
}) => {
  allowSessionCheck401(page);
  await page.goto("/login");
  await page
    .getByLabel("ユーザーID", { exact: true })
    .fill("e2euser_client_admin");
  await page.getByLabel("パスワード", { exact: true }).fill("TestPass123!");
  await page.getByRole("button", { name: "ログイン" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/clients");
  await expect(page.getByRole("heading", { name: "取引先管理" })).toBeVisible();

  const internal = page.getByRole("row", { name: /INT.*社内/ });
  await expect(internal).toBeVisible();
  await expect(
    internal.getByRole("button", { name: "無効にする" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "取引先を登録" }).click();
  await page.getByRole("textbox", { name: "取引先コード" }).fill("EQA");
  await page.getByRole("textbox", { name: "取引先名" }).fill(initialName);
  await page.getByRole("button", { name: "登録", exact: true }).click();
  const created = page.getByRole("row", { name: /EQA/ });
  await expect(created).toContainText(initialName);

  await page
    .getByRole("searchbox", { name: "取引先を検索" })
    .fill("CLIENT_192");
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await expect(page.getByRole("row", { name: /EQA/ })).toBeVisible();

  await page
    .getByRole("row", { name: /EQA/ })
    .getByRole("button", { name: "名前を変更" })
    .click();
  await page.getByRole("textbox", { name: "取引先名" }).fill(changedName);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("row", { name: /EQA/ })).toContainText(
    changedName,
  );

  await page
    .getByRole("row", { name: /EQA/ })
    .getByRole("button", { name: "無効にする" })
    .click();
  await expect(page.getByRole("row", { name: /EQA/ })).toContainText("無効");
  await expect(
    page
      .getByRole("row", { name: /EQA/ })
      .getByRole("button", { name: "無効にする" }),
  ).toHaveCount(0);
});
