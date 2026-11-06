// #123専用seedを使用し、共有loginシナリオの利用者のpasswordを変更しない。
import type { Page } from "@playwright/test";
import { expect, test } from "./console-guard";
import { allowSessionCheck401 } from "./session-console";

const ORIGINAL = "TestPass123!";
const NEXT = "Different456!";

async function login(page: Page, loginId: string, password = ORIGINAL) {
  await page.goto("/login");
  await page.getByLabel("ユーザーID", { exact: true }).fill(loginId);
  await page.getByLabel("パスワード", { exact: true }).fill(password);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
}

async function fillChange(page: Page, confirmation = NEXT) {
  await page.getByLabel("現在のパスワード", { exact: true }).fill(ORIGINAL);
  await page.getByLabel("新しいパスワード", { exact: true }).fill(NEXT);
  await page
    .getByLabel("新しいパスワード（確認）", { exact: true })
    .fill(confirmation);
}

test("#123 0-3 AC-1/4/10/11: S04で不一致を送信せず、変更すると現session維持・別session失効・新passwordで再login", async ({
  page,
  browser,
}) => {
  allowSessionCheck401(page);
  await login(page, "e2euser_password_001");
  await expect(
    page.getByText("ようこそ、testuser_password_001さん"),
  ).toBeVisible();
  const originalCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === "__Host-session",
  )?.value;
  const other = await browser.newContext({
    baseURL: new URL(page.url()).origin,
  });
  try {
    const otherPage = await other.newPage();
    allowSessionCheck401(otherPage);
    await login(otherPage, "e2euser_password_001");
    await expect(
      otherPage.getByText("ようこそ、testuser_password_001さん"),
    ).toBeVisible();

    await page
      .getByRole("button", {
        name: "アカウントメニュー（testuser_password_001）",
      })
      .click();
    await page.getByRole("link", { name: "パスワードを変更" }).click();
    await expect(page).toHaveURL(/\/password$/);
    await expect(page.getByRole("banner")).toBeVisible();
    await page.screenshot({ path: "reports/123-s04.png", fullPage: true });
    await fillChange(page, "Mismatch789!");
    const sent: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "PUT" &&
        request.url().endsWith("/api/me/password")
      )
        sent.push(request.url());
    });
    await page
      .getByRole("button", { name: "パスワードを変更", exact: true })
      .click();
    await expect(
      page.getByLabel("新しいパスワード（確認）", { exact: true }),
    ).toHaveAttribute("aria-invalid", "true");
    expect(sent).toHaveLength(0);
    await page.screenshot({
      path: "reports/123-s04-validation.png",
      fullPage: true,
    });
    await page
      .getByLabel("新しいパスワード（確認）", { exact: true })
      .fill(NEXT);
    for (const label of [
      "現在のパスワード",
      "新しいパスワード",
      "新しいパスワード（確認）",
    ]) {
      const field = page.getByLabel(label, { exact: true });
      await expect(field).toHaveAttribute("type", "password");
      const fieldContainer = page.locator("div.mb-4").filter({ has: field });
      await expect(fieldContainer).toHaveCount(1);
      await fieldContainer
        .getByRole("button", { name: "パスワードを表示", exact: true })
        .click();
      await expect(field).toHaveAttribute("type", "text");
      await fieldContainer
        .getByRole("button", { name: "パスワードを隠す", exact: true })
        .click();
      await expect(field).toHaveAttribute("type", "password");
    }
    await page
      .getByRole("button", { name: "パスワードを変更", exact: true })
      .click();
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByText("ようこそ、testuser_password_001さん"),
    ).toBeVisible();
    expect(sent).toHaveLength(1);
    expect(
      (await page.context().cookies()).find(
        (cookie) => cookie.name === "__Host-session",
      )?.value,
    ).toBe(originalCookie);
    expect((await page.request.get("/api/auth/session")).status()).toBe(200);
    expect((await otherPage.request.get("/api/auth/session")).status()).toBe(
      401,
    );
    await page
      .getByRole("button", {
        name: "アカウントメニュー（testuser_password_001）",
      })
      .click();
    await page.getByRole("button", { name: "ログアウト" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await login(page, "e2euser_password_001", ORIGINAL);
    await expect(
      page.getByText("ユーザーIDまたはパスワードが違います"),
    ).toBeVisible();
    await login(page, "e2euser_password_001", NEXT);
    await expect(
      page.getByText("ようこそ、testuser_password_001さん"),
    ).toBeVisible();
  } finally {
    await other.close();
  }
});

test("#123 0-3 AC-5: S03は未知URLでも枠なし、初回変更成功で即時にホームへ進む", async ({
  page,
}) => {
  allowSessionCheck401(page);
  await login(page, "e2euser_password_002");
  await expect(
    page.getByLabel("現在のパスワード", { exact: true }),
  ).toBeVisible();
  await page.goto("/unknown-password-test");
  await expect(
    page.getByLabel("現在のパスワード", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("banner")).toHaveCount(0);
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "ログアウト" })).toBeVisible();
  await page.screenshot({ path: "reports/123-s03.png", fullPage: true });
  await fillChange(page);
  await page
    .getByRole("button", { name: "パスワードを変更", exact: true })
    .click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByText("ようこそ、testuser_password_002さん"),
  ).toBeVisible();
  expect(
    await (await page.request.get("/api/auth/session")).json(),
  ).toMatchObject({ mustChangePassword: false });
  await expect(page.getByRole("banner")).toBeVisible();
});
