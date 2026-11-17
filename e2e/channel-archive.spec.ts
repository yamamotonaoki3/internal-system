// #143-a a-AC-1・a-AC-2・a-AC-3・a-AC-5・a-AC-6（2-6 AC-5・AC-6、3-4 AC-5、C-131）: チャンネルの管理の主な流れを、実ブラウザで確かめる。
// 部署のオーナー（e2euser_charch_owner）が S-05 のヘッダーの「⋯」から名前を変え（再読み込みなしで見出しが変わる）、アーカイブ（理由と再認証）すると、
// 参加者（e2euser_charch_member）はチャンネルを開けず投稿できない。参加者の通知の一覧に理由つきの通知が出て、押すと「このチャンネルはアーカイブされました」。
// 復元（入口の S-38・S-39 は #143-b のため、ここでは API）すると、参加者は再びチャンネルを開いて投稿できる。
// 判定の順・存在の非開示・各経路の 404 の細部はバックエンドのテスト（channels.manage.test.ts・channels.archive-effects.test.ts）、
// メニュー・ダイアログの分岐は frontend/src/features/channels/channel-manage.test.tsx で確かめるので、ここでは重ねない。
// 前提：e2e/seeds/channel-archive.sql（[E2E_TEST]部署143アーカイブ・オーナー・参加者・公開の通常のチャンネル E2E_TEST_charch_1。版は 1）。
// 後始末は e2e/seeds/channel-archive-cleanup.sql（識別子だけ。残数 0 を確かめる）。画面の文言は channel-manage.test.tsx の契約と同じ。
import { execFile } from "node:child_process";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { allowConsoleError, expect, test } from "./console-guard";
import { allowSessionCheck401 } from "./session-console";

const PASSWORD = "TestPass123!";
const ROOM = "01JTE2E0000000000000008143";
const BEFORE = "E2E_TEST_charch_1";
const AFTER = "E2E_TEST_charch_2";
const REASON = "[E2E_TEST]統合のため";

function seedFile(file: "channel-archive.sql" | "channel-archive-cleanup.sql") {
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

/** 2 つ目のブラウザ。アーカイブ中の 404 の読み込みだけを許し、ほかのエラーレベルのコンソール出力と処理されなかった例外を集める */
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

async function openMenu(page: Page, channelName: string) {
  await page
    .getByRole("button", { name: `${channelName}の操作`, exact: true })
    .click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const output = await seedFile("channel-archive-cleanup.sql");
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
  await seedFile("channel-archive.sql");
});
test.afterAll(async () => {
  const output = await seedFile("channel-archive-cleanup.sql");
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
});

test("#143 a-AC-1・a-AC-2・a-AC-3・a-AC-5・a-AC-6: オーナーが「⋯」から名前を変えてアーカイブ（再認証）→ 参加者は開けず通知で理由を見る → 復元で再び投稿できる", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const member = await guardedPage(browser, baseURL);
  try {
    await member.page.setViewportSize({ width: 1280, height: 800 });
    await login(page, "e2euser_charch_owner");
    await login(member.page, "e2euser_charch_member");

    // ---- オーナー：S-05 の「⋯」→「名前・説明を編集」で名前を変える（再認証なし。再読み込みなしで見出しが変わる） ----
    await page.goto(`/channels/${ROOM}`);
    await expect(
      page.getByRole("heading", { level: 1, name: BEFORE }),
    ).toBeVisible();
    const menu = await openMenu(page, BEFORE);
    await menu.getByRole("menuitem", { name: "名前・説明を編集" }).click();
    const edit = page.getByRole("dialog", { name: /編集/ });
    await expect(edit).toBeVisible();
    await edit.getByLabel(/名前/).fill(AFTER);
    const patched = page.waitForResponse(
      (r) =>
        r.request().method() === "PATCH" &&
        new URL(r.url()).pathname === `/api/channels/${ROOM}`,
    );
    await edit.getByRole("button", { name: "保存", exact: true }).click();
    expect((await patched).status()).toBe(200);
    await expect(edit).toBeHidden();
    await expect(
      page.getByRole("heading", { level: 1, name: AFTER }),
    ).toBeVisible();

    // ---- オーナー：「⋯」→「アーカイブ」→ 理由 → 再認証 → /channels へ移り「アーカイブしました」 ----
    allowConsoleError(
      page,
      /Failed to load resource: the server responded with a status of 404/,
      "アーカイブの直後に、取り直したチャンネルの詳細が 404（アーカイブ中は誰にも見えない）になりうるため",
    );
    const menu2 = await openMenu(page, AFTER);
    await menu2.getByRole("menuitem", { name: "アーカイブ" }).click();
    const archive = page.getByRole("dialog", {
      name: `チャンネル「${AFTER}」をアーカイブしますか`,
    });
    await expect(archive).toBeVisible();
    await archive.getByLabel(/理由/).fill(REASON);
    await archive
      .getByRole("button", { name: "アーカイブ", exact: true })
      .click();
    const reauth = page.getByRole("dialog", { name: "再認証" });
    await expect(reauth).toBeVisible();
    await reauth.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
    const archived = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname === `/api/channels/${ROOM}/delete`,
    );
    await reauth.getByRole("button", { name: "再認証" }).click();
    expect((await archived).status()).toBe(200);
    await expect(page).toHaveURL(/\/channels$/);
    await expect(page.getByText("アーカイブしました")).toBeVisible();

    // ---- 参加者：チャンネルを開けず、投稿もできない ----
    await member.page.goto(`/channels/${ROOM}`);
    await expect(
      member.page.getByText("チャンネルが見つかりません"),
    ).toBeVisible();
    await expect(
      member.page.getByRole("textbox", { name: "メッセージ" }),
    ).toHaveCount(0);
    const origin = new URL(member.page.url()).origin;
    const post = await member.page.request.post(`/api/rooms/${ROOM}/messages`, {
      headers: { Origin: origin },
      data: { body: "[E2E_TEST]アーカイブ中の投稿" },
    });
    expect(post.status()).toBe(404);

    // ---- 参加者：通知に理由つきで届き、押すと移らずに「このチャンネルはアーカイブされました」 ----
    await member.page
      .getByRole("banner")
      .getByRole("link", { name: /^通知/ })
      .click();
    await expect(member.page).toHaveURL(/\/notifications$/);
    const notice = member.page.getByRole("main").getByRole("button", {
      name: new RegExp(
        `参加しているチャンネルがアーカイブされました（理由：${REASON.replace(/[[\]]/g, "\\$&")}）`,
      ),
    });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("（アーカイブされました）");
    await notice.click();
    await expect(
      member.page.getByText("このチャンネルはアーカイブされました"),
    ).toBeVisible();
    await expect(member.page).toHaveURL(/\/notifications$/);

    // ---- オーナー：復元（入口の画面は #143-b。ここでは API で再認証して復元する。版はシードの 1 → 名前の変更 2 → アーカイブ 3） ----
    const ownerOrigin = new URL(page.url()).origin;
    const reauthenticated = await page.request.post(
      "/api/auth/reauthenticate",
      {
        headers: { Origin: ownerOrigin },
        data: { password: PASSWORD },
      },
    );
    expect(reauthenticated.status()).toBe(200);
    const restored = await page.request.post(`/api/channels/${ROOM}/restore`, {
      headers: { Origin: ownerOrigin },
      data: { version: 3 },
    });
    expect(restored.status()).toBe(200);

    // ---- 参加者：再び開けて、画面から投稿できる ----
    await member.page.goto(`/channels/${ROOM}`);
    await expect(
      member.page.getByRole("heading", { level: 1, name: AFTER }),
    ).toBeVisible();
    const text = "[E2E_TEST]復元後の投稿";
    await member.page.getByRole("textbox", { name: "メッセージ" }).fill(text);
    await member.page
      .getByRole("button", { name: "送信", exact: true })
      .click();
    await expect(member.page.getByRole("main").getByText(text)).toBeVisible();

    expect(member.errors).toEqual([]);
  } finally {
    await member.context.close();
  }
});
