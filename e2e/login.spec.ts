// #120 AC-1（0-2 AC-1・AC-2・AC-7、0-3 AC-5 の印）：S-02 ログイン・ログアウトを、画面からバックエンドまで通して確かめる。
// 前提：pretest:e2e がテスト用DBを作り直し、e2e/seeds/login.sql（架空の利用者 e2euser_login_001・002、パスワード TestPass123!）を流す。
// データはすべて架空。後始末は e2e/seeds/login-cleanup.sql（e2euser_ の識別子）で行う。
import type { Page } from "@playwright/test";
import { expect, test } from "./console-guard";
import { allowSessionCheck401 } from "./session-console";

const PASSWORD = "TestPass123!";
const READY_USER = { loginId: "e2euser_login_001", displayName: "テスト一郎" };
const MUST_CHANGE_USER = { loginId: "e2euser_login_002" };

async function login(page: Page, loginId: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("ユーザーID", { exact: true }).fill(loginId);
  await page.getByLabel("パスワード", { exact: true }).fill(password);
  await page.getByRole("button", { name: "ログイン" }).click();
}

test("#120 AC-1（0-2 AC-1・AC-2）: ログインすると「ようこそ、{表示名}さん」、ログアウトすると /login へ移り、戻る操作でも画面が見られない", async ({
  page,
}) => {
  allowSessionCheck401(page);
  await login(page, READY_USER.loginId, PASSWORD);
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByText(`ようこそ、${READY_USER.displayName}さん`),
  ).toBeVisible();

  // #121（利用者の承認済みの変更 N-1）：ログアウトはアバターメニュー（表示名のボタン）の中に移った。開いてから押す。確かめる内容は変えない
  await page
    .getByRole("button", {
      name: `アカウントメニュー（${READY_USER.displayName}）`,
    })
    .click();
  await page.getByRole("button", { name: "ログアウト" }).click();
  await expect(page).toHaveURL(/\/login$/);

  // ログイン・ログアウトの遷移は履歴を置き換えるため、戻る・進むの行き先は前提にしない。
  // アプリの中に留まる限り、どこへ移っても「ようこそ」は出ず、保護された画面には /login が出ることを確かめる
  for (const move of [() => page.goBack(), () => page.goForward()]) {
    await move();
    if (page.url().startsWith("http://localhost:5173")) {
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByText(/ようこそ、/)).toHaveCount(0);
    }
  }

  // ログアウト後に直接 / を開くと /login
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText(/ようこそ、/)).toHaveCount(0);

  // ログアウト後は、保護された API も使えない
  const response = await page.request.get("/api/sample-users");
  expect(response.status()).toBe(401);
});

test("#120 AC-1（0-2 AC-7）: 誤ったパスワードでは「ユーザーIDまたはパスワードが違います」を出し、ログインしない", async ({
  page,
}) => {
  allowSessionCheck401(page);
  await login(page, READY_USER.loginId, "WrongPass999!");
  await expect(
    page.getByText("ユーザーIDまたはパスワードが違います"),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test("#123 0-3 AC-5: 初回パスワードの利用者は、変更フォームとログアウトが出て、業務のAPIは403 PASSWORD_CHANGE_REQUIRED", async ({
  page,
}) => {
  allowSessionCheck401(page);
  await login(page, MUST_CHANGE_USER.loginId, PASSWORD);
  await expect(
    page.getByLabel("現在のパスワード", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "ログアウト" })).toBeVisible();
  await expect(page.getByText(/ようこそ、/)).toHaveCount(0);

  const response = await page.request.get("/api/sample-users");
  expect(response.status()).toBe(403);
  expect((await response.json()) as { code: string }).toMatchObject({
    code: "PASSWORD_CHANGE_REQUIRED",
  });
});

test("#120 AC-1（D-4）: 手元の http://localhost でも、ログインの Cookie が保存され、次の要求で送られる", async ({
  page,
  context,
}) => {
  allowSessionCheck401(page);
  await login(page, READY_USER.loginId, PASSWORD);
  await expect(
    page.getByText(`ようこそ、${READY_USER.displayName}さん`),
  ).toBeVisible();

  const cookies = await context.cookies();
  const session = cookies.find((cookie) => cookie.name === "__Host-session");
  expect(session, "__Host-session の Cookie が保存されていない").toBeDefined();
  expect(session?.httpOnly).toBe(true);
  expect(session?.secure).toBe(true);
  expect(session?.sameSite).toBe("Lax");
  expect(session?.path).toBe("/");

  // 画面の JavaScript からは読めない（HttpOnly）
  const visibleToScript = await page.evaluate(() => document.cookie);
  expect(visibleToScript).not.toContain("__Host-session");

  // 同じブラウザの次の要求で送られ、セッションとして認められる
  const response = await page.request.get("/api/auth/session");
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({
    user: { displayName: READY_USER.displayName },
    mustChangePassword: false,
  });
});
