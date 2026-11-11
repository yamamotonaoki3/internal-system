// #130 AC-1（0-4 AC-9・AC-10）・AC-2（6-1 AC-2・C-136）・AC-3（7-3 AC-4）: プロフィール設定・ヘッダーのステータス・社員一覧・プロフィールカードを、
// 画面からバックエンドまで通して確かめる。データを変える操作の後は、再読み込みせずに関係する表示が変わることを確かめる。
// 前提：e2e/seeds/profile.sql（e2euser_profile_admin（全体管理者）・e2euser_profile_member（一般社員）・部署「[E2E_TEST]部署130営業」）。
// カードの本名を確かめる社員（e2euser_profile_card）は、本名を正しく暗号化するため、全体管理者のセッションでアカウント発行の API から作る。
// 後始末は e2e/seeds/profile-cleanup.sql（社員ID e2euser_profile_・部署名 [E2E_TEST]部署130 の識別子だけ。残数 0 を確かめる文つき）。
// ログインの試行制限に当たらないよう、各テストのログインは利用者ごとに1回だけにする。
import { execFile } from "node:child_process";
import type { Browser, Page } from "@playwright/test";
import { expect, test } from "./console-guard";
import { allowSessionCheck401 } from "./session-console";

const PASSWORD = "TestPass123!";
const DEPT_ID = "01JTE2E0000000000000002130";
const MEMBER_NAME = "E2Eプロフィール社員";
const RENAMED = "E2E改名済み130";
const CARD = {
  loginId: "e2euser_profile_card",
  legalName: "テスト花子",
  displayName: "E2Eカード対象",
  email: "e2euser_profile_card@example.com",
};

function seedFile(file: "profile.sql" | "profile-cleanup.sql"): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ["scripts/db-local.ts", "test", "seed-file", `e2e/seeds/${file}`],
      { cwd: process.cwd(), windowsHide: true },
      (error) => (error ? reject(error) : resolve()),
    );
  });
}

async function login(page: Page, loginId: string) {
  allowSessionCheck401(page);
  await page.goto("/login");
  await page.getByLabel("ユーザーID", { exact: true }).fill(loginId);
  await page.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function newLoggedInPage(
  browser: Browser,
  baseURL: string,
  loginId: string,
) {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await login(page, loginId);
  return { context, page };
}

function headerStatusButton(page: Page) {
  return page.getByRole("banner").getByRole("button", { name: /ステータス/ });
}

async function openMembersFromSidebar(page: Page) {
  await page
    .getByRole("navigation", { name: "メインメニュー" })
    .getByRole("link", { name: "社員一覧", exact: true })
    .click();
  await expect(page).toHaveURL(/\/members$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "社員一覧" }),
  ).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await seedFile("profile-cleanup.sql");
  await seedFile("profile.sql");
});
test.afterAll(async () => {
  await seedFile("profile-cleanup.sql");
});

test("#130 AC-1（0-4 AC-9）・AC-2（6-1 AC-2）: S-19 で表示名を変えると、再読み込みせずにヘッダーのアバター・社員一覧の表示が変わる", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page, "e2euser_profile_member");
  await page
    .getByRole("button", { name: `アカウントメニュー（${MEMBER_NAME}）` })
    .click();
  await page.getByRole("link", { name: "プロフィール設定" }).click();
  await expect(page).toHaveURL(/\/profile$/);
  const name = page.getByRole("main").getByRole("textbox", { name: "表示名" });
  await expect(name).toHaveValue(MEMBER_NAME);
  await name.fill(RENAMED);
  await page.getByRole("button", { name: "表示名を保存" }).click();
  await expect(
    page.getByRole("button", { name: `アカウントメニュー（${RENAMED}）` }),
  ).toBeVisible();
  await openMembersFromSidebar(page);
  await expect(
    page.getByRole("main").getByRole("button", { name: RENAMED }),
  ).toBeVisible();
});

test("#130 AC-2（6-1 AC-2・C-136）: ヘッダーで「外出」＋戻り予定を選ぶと、再読み込みせずに社員一覧・カードが変わり、別の利用者の一覧にも反映される", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page, "e2euser_profile_member");
  const statusButton = headerStatusButton(page);
  await expect(statusButton).toContainText("在席");
  await statusButton.click();
  const panelId = await statusButton.getAttribute("popovertarget");
  const panel = page.locator(`[id="${panelId ?? ""}"]`);
  await expect(panel).toBeVisible();
  // 戻り予定は「1年以内」に収める：実行時刻の2日後の 15:30（端末の時刻帯の datetime-local の値）
  const returnDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const returnLocal = `${returnDate.getFullYear()}-${pad(returnDate.getMonth() + 1)}-${pad(returnDate.getDate())}T15:30`;
  await panel.getByLabel("戻り予定").fill(returnLocal);
  await panel.getByRole("button", { name: /外出/ }).click();
  await expect(statusButton).toContainText("外出");

  await openMembersFromSidebar(page);
  const ownRow = page.getByRole("row", { name: new RegExp(RENAMED) });
  await expect(ownRow).toContainText("外出");
  await ownRow.getByRole("button", { name: RENAMED }).click();
  const card = page
    .locator("[popover]:popover-open")
    .filter({ hasText: "閉じる" });
  await expect(card).toContainText("外出");
  await card.getByRole("button", { name: "閉じる" }).click();

  // 別の利用者でログインして一覧を開くと、反映されている
  const other = await newLoggedInPage(
    browser,
    baseURL ?? "",
    "e2euser_profile_admin",
  );
  try {
    await openMembersFromSidebar(other.page);
    await expect(
      other.page.getByRole("row", { name: new RegExp(RENAMED) }),
    ).toContainText("外出");
  } finally {
    await other.context.close();
  }
});

test("#130 AC-3（7-3 AC-4）・AC-1（0-4 AC-10）: 一覧の表示名を押すとカードに本名が出て、Esc で閉じるとフォーカスが表示名に戻る", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page, "e2euser_profile_admin");
  const origin = new URL(page.url()).origin;
  // 本名を正しく暗号化した社員を、アカウント発行の API で作る（再認証が要る）
  const reauth = await page.request.post("/api/auth/reauthenticate", {
    headers: { Origin: origin },
    data: { password: PASSWORD },
  });
  expect(reauth.status()).toBe(200);
  const created = await page.request.post("/api/admin/accounts", {
    headers: { Origin: origin },
    data: {
      loginId: CARD.loginId,
      legalName: CARD.legalName,
      displayName: CARD.displayName,
      email: CARD.email,
      emailConfirmed: true,
      departmentId: DEPT_ID,
    },
  });
  expect(created.status()).toBe(201);

  await openMembersFromSidebar(page);
  const main = page.getByRole("main");
  await main.getByLabel("部署").selectOption(DEPT_ID);
  const trigger = main.getByRole("button", {
    name: CARD.displayName,
    exact: true,
  });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const card = page
    .locator("[popover]:popover-open")
    .filter({ hasText: "閉じる" });
  await expect(card).toContainText(CARD.legalName);
  await expect(card).toContainText("[E2E_TEST]部署130営業");
  await expect(card).toContainText("在席");
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  await expect(trigger).toBeFocused();
  // 一覧の表には本名を出さない
  await expect(main.getByRole("table")).not.toContainText(CARD.legalName);
});

test("#130 AC-2（C-136・P-7）: ヘッダーのステータスとアバターメニューは同時に1つだけ開く", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page, "e2euser_profile_admin");
  const statusButton = headerStatusButton(page);
  await statusButton.click();
  const statusPanel = page.locator(
    `[id="${(await statusButton.getAttribute("popovertarget")) ?? ""}"]`,
  );
  await expect(statusPanel).toBeVisible();
  await page
    .getByRole("button", {
      name: "アカウントメニュー（E2Eプロフィール管理者）",
    })
    .click();
  await expect(page.getByRole("button", { name: "ログアウト" })).toBeVisible();
  await expect(statusPanel).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(statusButton).toHaveAttribute("aria-expanded", "false");
});

test("#130 AC-2（C-136）: スマホ幅（375px）でもヘッダーにステータスの丸を出し、文字は隠すが読み上げの名前に残す", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await login(page, "e2euser_profile_admin");
  const statusButton = headerStatusButton(page);
  await expect(statusButton).toBeVisible();
  await expect(statusButton).toHaveAccessibleName(/在席/);
  const box = await statusButton.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(0);
  // 見た目の文字は隠す（読み上げ用に残した文字は、幅が1px以下に縮められている）
  const labelWidth = await statusButton
    .getByText("在席", { exact: true })
    .evaluate((element) => element.getBoundingClientRect().width);
  expect(labelWidth).toBeLessThanOrEqual(1);
});
