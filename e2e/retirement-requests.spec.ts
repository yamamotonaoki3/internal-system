// #128（128-c）0-1 AC-20・3-4 AC-1〜3・C-177（U-3・U-8）: オーナーが S-20 で退職処理を申請 → 全体管理者に通知 → 通知から S-22 の申請のタブを開き、
// 再認証して無効化 → 申請が完了になり、オーナーに通知が届いて自分の申請で「完了」になる、の主な流れを1本だけ確かめる。
// 判定の順・SQL の条件・応答の形・宛先の細部は backend のテスト、画面の部品は frontend のテストで確かめる。
// データは架空（e2euser_retire_ 接頭辞・@example.com・[E2E_TEST]）。後始末は retirement-requests-cleanup.sql。
import { execFile } from "node:child_process";
import type { Browser, Page } from "@playwright/test";
import { expect, test } from "./console-guard";
import { allowSessionCheck401 } from "./session-console";

const PASSWORD = "TestPass123!";
const OWNER = "e2euser_retire_owner";
const ADMIN = "e2euser_retire_admin";
const TARGET_DISPLAY = "testuser_retire_target";
const TARGET_ID = "01JTE2E128C00000000000A003";
const SUBMITTED =
  "全体管理者へ退職処理を申請しました。処理が完了するまで社員は有効です";

function seedFile(
  file: "retirement-requests.sql" | "retirement-requests-cleanup.sql",
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

async function login(page: Page, loginId: string) {
  await page.goto("/login");
  await page.getByLabel("ユーザーID", { exact: true }).fill(loginId);
  await page.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}

// 別のコンテキストのページは console-guard の fixture の外のため、同じ監視をここで付ける（accounts-lifecycle.spec.ts と同じ書き方）。
// 許可するのは、未ログインのセッションの確認の 401 だけ。終了時に errors が空であることを確かめる
async function newPage(browser: Browser, baseURL: string) {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  const errors: string[] = [];
  const allowed =
    /Failed to load resource: the server responded with a status of 401/;
  page.on("console", (m) => {
    if (m.type() === "error" && !allowed.test(m.text())) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  return { context, page, errors };
}

const headerBell = (page: Page) =>
  page.getByRole("banner").getByRole("link", { name: /^通知/ });

test.beforeAll(async () => {
  const output = await seedFile("retirement-requests-cleanup.sql");
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
  await seedFile("retirement-requests.sql");
});
test.afterAll(async () => {
  const output = await seedFile("retirement-requests-cleanup.sql");
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
});

test("#128 0-1 AC-20・3-4 AC-1〜3: オーナーが S-20 で申請 → 全体管理者が通知から S-22 で確認して無効化 → 申請が完了になり、オーナーに通知が届く", async ({
  page,
  browser,
}) => {
  allowSessionCheck401(page);

  // ---- オーナー：S-20 の行から申請する（再認証は求めない。0-5）。申請しただけでは社員は一覧に残る ----
  await login(page, OWNER);
  await page.goto("/members");
  await expect(
    page.getByRole("heading", { level: 1, name: "社員一覧" }),
  ).toBeVisible();
  // ほかの spec のデータに左右されないよう、表示名で絞ってから行を探す
  const main = page.getByRole("main");
  await main.getByLabel("表示名で検索").fill(TARGET_DISPLAY);
  await main.getByRole("button", { name: "検索", exact: true }).click();
  const targetRow = page
    .getByRole("main")
    .getByRole("row")
    .filter({ hasText: TARGET_DISPLAY });
  const submitted = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname === "/api/retirement-requests",
  );
  await targetRow.getByRole("button", { name: /退職処理を申請/ }).click();
  const confirm = page.getByRole("dialog", { name: /退職処理の申請/ });
  await expect(confirm).toContainText(TARGET_DISPLAY);
  await confirm.getByRole("button", { name: "申請する" }).click();
  expect((await submitted).status()).toBe(201);
  await expect(page.getByRole("dialog", { name: "再認証" })).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: SUBMITTED }),
  ).toBeVisible();
  await expect(targetRow).toBeVisible();
  // 社員一覧のリンクから、自分の申請の一覧へ行ける（取り下げの入口）
  await main.getByRole("link", { name: "自分の退職処理の申請" }).click();
  await expect(page).toHaveURL(/\/retirement-requests\/mine$/);
  await expect(
    page.getByRole("row").filter({ hasText: TARGET_DISPLAY }),
  ).toContainText("申請中");

  // ---- 全体管理者：通知から S-22 の申請のタブを開き、再認証して無効化する ----
  const origin = new URL(page.url()).origin;
  const admin = await newPage(browser, origin);
  try {
    await login(admin.page, ADMIN);
    await headerBell(admin.page).click();
    await expect(admin.page).toHaveURL(/\/notifications$/);
    await admin.page
      .getByRole("main")
      .getByRole("button", { name: /退職処理の申請が届きました/ })
      .click();
    await expect(admin.page).toHaveURL(/\/accounts\?tab=retirement-requests$/);
    const requestRow = admin.page
      .getByRole("row")
      .filter({ hasText: TARGET_DISPLAY });
    await expect(requestRow).toContainText("[E2E_TEST]128c退職申請部署");
    await expect(requestRow).toContainText("testuser_retire_owner");
    await requestRow.getByRole("button", { name: /無効化/ }).click();
    const dialog = admin.page.getByRole("dialog", { name: /無効化/ });
    await expect(dialog).toContainText(TARGET_DISPLAY);
    await dialog.getByRole("button", { name: "無効化する" }).click();
    const reauth = admin.page.getByRole("dialog", { name: "再認証" });
    await reauth.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
    const deactivated = admin.page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname ===
          `/api/admin/accounts/${TARGET_ID}/deactivate`,
    );
    await reauth.getByRole("button", { name: "再認証", exact: true }).click();
    expect((await deactivated).status()).toBe(204);
    await expect(
      admin.page.getByRole("status").filter({ hasText: "無効化しました" }),
    ).toBeVisible();
    // 完了した申請は申請中の一覧から消える
    await expect(requestRow).toHaveCount(0);
    expect(admin.errors, "コンソールのエラー・処理されなかった例外").toEqual(
      [],
    );
  } finally {
    await admin.context.close();
  }

  // ---- オーナー：完了の通知が届き、自分の申請で「完了」になる。対象は社員一覧から消える ----
  await page.reload();
  await headerBell(page).click();
  await expect(page).toHaveURL(/\/notifications$/);
  await page
    .getByRole("main")
    .getByRole("button", { name: /退職処理の申請が完了しました/ })
    .click();
  await expect(page).toHaveURL(/\/retirement-requests\/mine$/);
  await expect(
    page.getByRole("row").filter({ hasText: TARGET_DISPLAY }),
  ).toContainText("完了");
  await page.goto("/members");
  await expect(
    page.getByRole("heading", { level: 1, name: "社員一覧" }),
  ).toBeVisible();
  await expect(
    page.getByRole("main").getByRole("row").filter({ hasText: TARGET_DISPLAY }),
  ).toHaveCount(0);
});
