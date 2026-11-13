// #238 AC-1〜AC-3（1-1 AC-3 の後半・C-74）: チャンネル（S-05）のメッセージ一覧で、無効化された投稿者に「退職者」を併記し、その名前からプロフィールカード・「DMを送る」を出さない。
// A でログインして S-05 を開く → 退職者の投稿は、投稿時点の表示名と「退職者」が出て、その行にボタン・リンク・「DMを送る」がない。今の表示名（users.display_name）は出ない
// → 有効な投稿者 B の行には「退職者」が出ない（表示は変わらない）。
// データを変える操作はないため、再読み込みの要否は問わない（開くだけ）。
// 前提のデータは e2e/seeds/messages-retired.sql（e2euser_ret238_・[E2E_TEST]部署238・@example.com）。後始末は messages-retired-cleanup.sql（識別子だけで消し、残数 0 を確かめる）。
// ログインの試行制限に当たらないよう、ログインは 1 回だけにする。
import { execFile } from "node:child_process";
import { expect, test } from "./console-guard";
import { allowSessionCheck401 } from "./session-console";

const PASSWORD = "TestPass123!";
const CHANNEL_PATH = "/channels/01JTE2E2380000000000000C01";
const POSTED_RETIRED_NAME = "E2E投稿時の元社員名";
const CURRENT_RETIRED_NAME = "E2E今の名前の退職者";
const ACTIVE_NAME = "E2E在職の投稿者B";

function seedFile(
  file: "messages-retired.sql" | "messages-retired-cleanup.sql",
) {
  return new Promise<string>((resolve, reject) => {
    execFile(
      process.execPath,
      ["scripts/db-local.ts", "test", "seed-file", `e2e/seeds/${file}`],
      { cwd: process.cwd(), windowsHide: true },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

test.beforeAll(async () => {
  await seedFile("messages-retired-cleanup.sql");
  await seedFile("messages-retired.sql");
});
test.afterAll(async () => {
  const output = await seedFile("messages-retired-cleanup.sql");
  // 後始末の後の残数がすべて 0 であること
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
});

test("#238 AC-1・AC-2・AC-3: 無効な投稿者の投稿に投稿時点の名前と「退職者」が出て、その行にボタン・リンク・「DMを送る」がない。有効な投稿者の行は変わらない", async ({
  page,
}) => {
  allowSessionCheck401(page);
  await page.goto("/login");
  await page.getByLabel("ユーザーID", { exact: true }).fill("e2euser_ret238_a");
  await page.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto(CHANNEL_PATH);

  const log = page.getByRole("log");
  await expect(log).toContainText("[E2E_TEST]無効な社員の投稿");
  await expect(log).toContainText("[E2E_TEST]在職者の投稿");

  // AC-1：退職者の行は、投稿時点の表示名と「退職者」。今の表示名は出ない
  const retiredRow = log
    .getByRole("listitem")
    .filter({ hasText: "[E2E_TEST]無効な社員の投稿" });
  await expect(retiredRow).toContainText(POSTED_RETIRED_NAME);
  await expect(retiredRow).toContainText("（退職者）");
  await expect(page.locator("body")).not.toContainText(CURRENT_RETIRED_NAME);

  // AC-2：その行に、ボタン・リンク・「DMを送る」がない
  await expect(retiredRow.getByRole("button")).toHaveCount(0);
  await expect(retiredRow.getByRole("link")).toHaveCount(0);
  await expect(retiredRow).not.toContainText(/DM ?を送る/);
  await expect(
    page.getByRole("button", { name: POSTED_RETIRED_NAME }),
  ).toHaveCount(0);

  // AC-3：有効な投稿者 B の行は、表示名だけで「退職者」が出ない
  const activeRow = log
    .getByRole("listitem")
    .filter({ hasText: "[E2E_TEST]在職者の投稿" });
  await expect(activeRow).toContainText(ACTIVE_NAME);
  await expect(activeRow).not.toContainText("退職者");
});
