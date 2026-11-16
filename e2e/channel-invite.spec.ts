// #135 AC-1（2-5 AC-1・AC-5）・#132 AC-2（2-4 AC-1〜AC-3）: e2euser_chinv_a が参加する非公開チャンネルに e2euser_chinv_b を招待する主な流れを、実ブラウザで確かめる。
// 招待の前は B のサイドバーに出ず、URL を開いても「チャンネルが見つかりません」。A が S-12 で選択 → 再認証 → 確定画面 → 確定すると、
// A の参加者の表示が再読み込みなしで増え、B のサイドバーに出て、通知が届き、通知からチャンネルを開ける。
// 判定の順・存在の非開示の細部はバックエンドのテスト（channels.invite.test.ts ほか）で確かめるので、ここでは重ねない。
// 前提：e2e/seeds/channel-invite.sql（[E2E_TEST]部署135招待・オーナー e2euser_chinv_owner・A・B）。非公開チャンネルは申請→承認の API で作る。
// 後始末は e2e/seeds/channel-invite-cleanup.sql（識別子だけ。残数 0 を確かめる）。ログインは 3 人で 1 回ずつ。
// 画面の文言は frontend/src/features/channels/channel-invite.test.tsx の契約と同じ。
import { execFile } from "node:child_process";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./console-guard";
import { roomLinkName } from "./room-link";
import { allowSessionCheck401 } from "./session-console";

const PASSWORD = "TestPass123!";
const CHANNEL = "E2E_TEST_invite_1";
const B_NAME = "E2E招待B";

function seedFile(file: "channel-invite.sql" | "channel-invite-cleanup.sql") {
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
  allowSessionCheck401(page);
  await page.goto("/login");
  await page.getByLabel("ユーザーID", { exact: true }).fill(loginId);
  await page.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}

/** 2 つ目以降のブラウザ。エラーレベルのコンソール出力と処理されなかった例外を集める */
async function guardedPage(browser: Browser, baseURL: string | undefined) {
  const context: BrowserContext = await browser.newContext({ baseURL });
  const page = await context.newPage();
  const errors: string[] = [];
  const allowed =
    /Failed to load resource: the server responded with a status of 40[14]/;
  page.on("console", (m) => {
    if (m.type() === "error" && !allowed.test(m.text())) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  return { context, page, errors };
}

const mainMenu = (page: Page) =>
  page.getByRole("navigation", { name: "メインメニュー" });

/** A が申請し、オーナーが再認証して承認する（API）。作られた非公開チャンネルの ID を返す */
async function createPrivateChannel(a: Page, owner: Page): Promise<string> {
  const origin = new URL(a.url()).origin;
  const created = await a.request.post("/api/channel-requests", {
    headers: { Origin: origin },
    data: {
      scope: "department",
      name: CHANNEL,
      description: `[E2E_TEST]${CHANNEL}の説明`,
      visibility: "private",
    },
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  const reauth = await owner.request.post("/api/auth/reauthenticate", {
    headers: { Origin: origin },
    data: { password: PASSWORD },
  });
  expect(reauth.status()).toBe(200);
  const approved = await owner.request.post(
    `/api/channel-requests/${id}/approve`,
    { headers: { Origin: origin } },
  );
  expect(approved.status()).toBe(200);
  const { channelId } = (await approved.json()) as { channelId: string };
  return channelId;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const output = await seedFile("channel-invite-cleanup.sql");
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
  await seedFile("channel-invite.sql");
});
test.afterAll(async () => {
  const output = await seedFile("channel-invite-cleanup.sql");
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
});

test("#135 AC-1（2-5 AC-1・AC-5）・#132 AC-2（2-4 AC-1〜AC-3）: 招待の前は B に見えない → A が選択・再認証・確定で招待 → A の参加者が増え、B のサイドバーに出て通知が届く", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const owner = await guardedPage(browser, baseURL);
  const b = await guardedPage(browser, baseURL);
  try {
    await owner.page.setViewportSize({ width: 1280, height: 800 });
    await b.page.setViewportSize({ width: 1280, height: 800 });

    await login(page, "e2euser_chinv_a");
    await login(owner.page, "e2euser_chinv_owner");
    const channelId = await createPrivateChannel(page, owner.page);

    // ---- 招待の前：B のサイドバーに出ず、URL を開いても見つからない（2-4 AC-1） ----
    await login(b.page, "e2euser_chinv_b");
    await expect(
      mainMenu(b.page).getByRole("link", { name: roomLinkName(CHANNEL) }),
    ).toHaveCount(0);
    await b.page.goto(`/channels/${channelId}`);
    await expect(b.page.getByText("チャンネルが見つかりません")).toBeVisible();

    // ---- A：S-05 の「招待」→ 選択 → 再認証 → 確定画面 → 確定 ----
    await page.goto(`/channels/${channelId}`);
    await expect(
      page.getByRole("heading", { level: 1, name: CHANNEL }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /参加者（1人）/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: "招待", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "チャンネルに招待" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("表示名で検索").fill(B_NAME);
    await dialog.getByRole("button", { name: "検索", exact: true }).click();
    await dialog.getByRole("button", { name: `${B_NAME} さんを招待` }).click();
    const reauth = page.getByRole("dialog", { name: "再認証" });
    await expect(reauth).toBeVisible();
    await reauth.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
    await reauth.getByRole("button", { name: "再認証" }).click();
    const confirm = page.getByRole("dialog", { name: "招待の確認" });
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText(B_NAME);
    await expect(confirm).toContainText(CHANNEL);
    const invited = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname === `/api/channels/${channelId}/invitations`,
    );
    await confirm.getByRole("button", { name: "確定", exact: true }).click();
    expect((await invited).status()).toBe(201);
    // 再読み込みせずに、参加者に B が出る
    await expect(
      page.getByRole("heading", { name: /参加者（2人）/ }),
    ).toBeVisible();
    await expect(page.getByRole("main").getByText(B_NAME)).toBeVisible();

    // ---- B：開き直すと、サイドバーに出て、通知から開ける（2-4 AC-2・Q4） ----
    await b.page.goto("/");
    await expect(
      mainMenu(b.page).getByRole("link", { name: roomLinkName(CHANNEL) }),
    ).toBeVisible();
    await b.page
      .getByRole("banner")
      .getByRole("link", { name: /^通知/ })
      .click();
    await expect(b.page).toHaveURL(/\/notifications$/);
    await b.page
      .getByRole("main")
      .getByRole("button", { name: /追加/ })
      .first()
      .click();
    await expect(b.page).toHaveURL(new RegExp(`/channels/${channelId}$`));
    await expect(
      b.page.getByRole("heading", { level: 1, name: CHANNEL }),
    ).toBeVisible();

    expect(owner.errors).toEqual([]);
    expect(b.errors).toEqual([]);
  } finally {
    await owner.context.close();
    await b.context.close();
  }
});
