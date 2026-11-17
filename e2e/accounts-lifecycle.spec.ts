// #128（128-a）0-1 AC-9・AC-14: 全体管理者が S-22 で社員を無効化 → 対象はログインできない → 再有効化 → 一時パスワードでログインすると変更を求められる。
// 画面をまたぐ主な流れだけを確かめる（判定・SQL の条件・応答の形は backend のテスト、画面の部品は frontend のテスト）。
// #128（128-b）0-1 AC-16・AC-17: 異動の主な流れ（実ブラウザでの一連の流れだけ）を2本目に置く。
// データは架空（e2euser_deact_ 接頭辞・@example.com・[E2E_TEST]）。後始末は accounts-lifecycle-cleanup.sql。
import { execFile } from "node:child_process";
import type { Browser, Page } from "@playwright/test";
import { expect, test } from "./console-guard";
import { roomLinkName } from "./room-link";
import { allowSessionCheck401 } from "./session-console";

const PASSWORD = "TestPass123!";
const TARGET = "e2euser_deact_target";
const TARGET_DISPLAY = "testuser_deact_target";
const DEPT_ID = "01JTE2E1280000000000000D01";
// #128（128-b）部署異動の対象と異動先（シードで旧部署 D01 の専用2つと全社連絡に参加させている）
const MOVER = "e2euser_deact_mover";
const MOVER_DISPLAY = "testuser_deact_mover";
const OLD_DEPT_NAME = "[E2E_TEST]128部署";
const NEW_DEPT_ID = "01JTE2E1280000000000000D02";
const NEW_DEPT_NAME = "[E2E_TEST]128異動先";

function seedFile(
  file: "accounts-lifecycle.sql" | "accounts-lifecycle-cleanup.sql",
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

async function login(page: Page, loginId: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("ユーザーID", { exact: true }).fill(loginId);
  await page.getByLabel("パスワード", { exact: true }).fill(password);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
}

// 別のコンテキストのページは console-guard の fixture の外のため、同じ監視をここで付ける（channel-invite.spec.ts と同じ書き方）。
// 許可するのは、未ログインのセッションの確認と、無効な社員のログインの拒否の 401 だけ。終了時に errors が空であることを確かめる
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

test.beforeAll(async () => {
  const output = await seedFile("accounts-lifecycle-cleanup.sql");
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
  await seedFile("accounts-lifecycle.sql");
});
test.afterAll(async () => {
  const output = await seedFile("accounts-lifecycle-cleanup.sql");
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
});

test("#128 AC-9・AC-14: 管理者が無効化 → 対象はログインできない → 再有効化 → 一時パスワードでログインすると変更を求められる", async ({
  page,
  browser,
}) => {
  allowSessionCheck401(page);
  await login(page, "e2euser_deact_admin", PASSWORD);
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/accounts");
  await expect(
    page.getByRole("heading", { name: "アカウント管理" }),
  ).toBeVisible();

  // 無効化：確認 → 再認証 → 実行
  const row = () => page.getByRole("row", { name: new RegExp(TARGET) });
  await row()
    .getByRole("button", { name: /無効化/ })
    .click();
  const confirm = page.getByRole("dialog", { name: /無効化/ });
  await expect(confirm).toContainText(TARGET_DISPLAY);
  await confirm.getByRole("button", { name: "無効化する" }).click();
  const reauth = page.getByRole("dialog", { name: "再認証" });
  await reauth.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
  const deactivated = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname.endsWith("/deactivate"),
  );
  await reauth.getByRole("button", { name: "再認証", exact: true }).click();
  expect((await deactivated).status()).toBe(204);
  await expect(
    page.getByRole("status").filter({ hasText: "無効化しました" }),
  ).toBeVisible();
  await expect(row()).toContainText("無効");
  await expect(row().getByRole("button", { name: /再有効化/ })).toBeVisible();

  // 対象はログインできない
  const origin = new URL(page.url()).origin;
  const refused = await newPage(browser, origin);
  try {
    await login(refused.page, TARGET, PASSWORD);
    await expect(refused.page).toHaveURL(/\/login/);
    await expect(
      refused.page.getByText("ユーザーIDまたはパスワードが違います"),
    ).toBeVisible();
    expect(refused.errors, "コンソールのエラー・処理されなかった例外").toEqual(
      [],
    );
  } finally {
    await refused.context.close();
  }

  // 再有効化：部署を選ぶ → 実行（再認証は期限内）→ 一時パスワードを一度だけ表示
  await row()
    .getByRole("button", { name: /再有効化/ })
    .click();
  const dialog = page.getByRole("dialog", { name: /再有効化/ });
  await dialog
    .getByRole("combobox", { name: /所属部署/ })
    .selectOption(DEPT_ID);
  const reactivated = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname.endsWith("/reactivate"),
  );
  await dialog.getByRole("button", { name: "再有効化する" }).click();
  const response = await reactivated;
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const { initialPassword } = (await response.json()) as {
    initialPassword: string;
  };
  await expect(
    dialog.getByText(initialPassword, { exact: false }),
  ).toBeVisible();
  const stored = await page.evaluate(() =>
    JSON.stringify({ ...window.localStorage, ...window.sessionStorage }),
  );
  expect(stored.includes(initialPassword)).toBe(false);
  await dialog.getByRole("button", { name: "閉じる" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "再有効化しました" }),
  ).toBeVisible();
  await expect(page.getByText(initialPassword)).toHaveCount(0);
  await expect(row().getByRole("button", { name: /無効化/ })).toBeVisible();

  // 一時パスワードでログイン → 変更を求められる
  const returned = await newPage(browser, origin);
  try {
    await login(returned.page, TARGET, initialPassword);
    await expect(
      returned.page.getByLabel("現在のパスワード", { exact: true }),
    ).toBeVisible();
    expect(
      await (await returned.page.request.get("/api/auth/session")).json(),
    ).toMatchObject({ mustChangePassword: true });
    expect(returned.errors, "コンソールのエラー・処理されなかった例外").toEqual(
      [],
    );
  } finally {
    await returned.context.close();
  }
});

test("#128 AC-16・AC-17: 管理者が社員を別の部署へ異動 → 完了のメッセージ → 一覧の部署が変わる → 異動した社員のサイドバーに新部署の専用チャンネルが出て、旧部署の専用チャンネルが出ない", async ({
  page,
  browser,
}) => {
  allowSessionCheck401(page);
  await login(page, "e2euser_deact_admin", PASSWORD);
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/accounts");
  const row = () => page.getByRole("row", { name: new RegExp(MOVER) });
  await expect(row()).toContainText(OLD_DEPT_NAME);

  // 異動：異動先を選ぶ → 実行 → 再認証（前のテストとは別のセッションのため、ここで求められる）
  await row().getByRole("button", { name: "異動", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /異動/ });
  await expect(dialog).toContainText(MOVER_DISPLAY);
  await dialog
    .getByRole("combobox", { name: /異動先の部署/ })
    .selectOption(NEW_DEPT_ID);
  await dialog.getByRole("button", { name: "異動する" }).click();
  const reauth = page.getByRole("dialog", { name: "再認証" });
  await reauth.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
  const transferred = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname.endsWith("/transfer"),
  );
  await reauth.getByRole("button", { name: "再認証", exact: true }).click();
  expect((await transferred).status()).toBe(204);
  await expect(
    page.getByRole("status").filter({ hasText: "異動しました" }),
  ).toBeVisible();
  await expect(page.getByRole("dialog", { name: /異動/ })).toHaveCount(0);
  await expect(row()).toContainText(NEW_DEPT_NAME);
  await expect(row()).not.toContainText(OLD_DEPT_NAME);

  // 異動した社員のサイドバー（参加しているチャンネル）
  const origin = new URL(page.url()).origin;
  const moved = await newPage(browser, origin);
  try {
    await login(moved.page, MOVER, PASSWORD);
    await expect(moved.page).toHaveURL(/\/$/);
    const mainMenu = moved.page.getByRole("navigation", {
      name: "メインメニュー",
    });
    await expect(
      mainMenu.getByRole("link", { name: roomLinkName(NEW_DEPT_NAME) }),
    ).toBeVisible();
    await expect(
      mainMenu.getByRole("link", {
        name: roomLinkName(`${NEW_DEPT_NAME}のお知らせ`),
      }),
    ).toBeVisible();
    await expect(
      mainMenu.getByRole("link", { name: roomLinkName(OLD_DEPT_NAME) }),
    ).toHaveCount(0);
    await expect(
      mainMenu.getByRole("link", {
        name: roomLinkName(`${OLD_DEPT_NAME}のお知らせ`),
      }),
    ).toHaveCount(0);
    expect(moved.errors, "コンソールのエラー・処理されなかった例外").toEqual(
      [],
    );
  } finally {
    await moved.context.close();
  }
});
