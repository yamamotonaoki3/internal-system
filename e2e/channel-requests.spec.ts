// #131 AC-1〜AC-8・AC-10・AC-12〜AC-15（2-2）・3-4 AC-1〜AC-3：チャンネルの作成申請 → 通知 → 承認（再認証）・却下（理由つき）→ 申請者の S-10 と通知 →
// 承認したチャンネルに参加済み → 取り下げ、までを、メンバー・オーナー・全体管理者の 3 つのブラウザで画面からバックエンドまで通して確かめる。
// データを変える操作の後は、操作した本人の画面を再読み込みせずに、関係する表示が変わることを確かめる（ほかの人の変更を見るときだけ画面を開き直す）。
// 前提：e2e/seeds/channel-requests.sql（[E2E_TEST]部署131営業・そのオーナー e2euser_chreq_owner・一般社員 e2euser_chreq_member・全体管理者 e2euser_chreq_admin）。
// 後始末は e2e/seeds/channel-requests-cleanup.sql（社員ID e2euser_chreq_・部署名 [E2E_TEST]部署131・チャンネル名 E2E_TEST_chreq_ の識別子だけ。残数 0 を確かめる）。
// チャンネル名には [ ] を使えない（2-2 AC-13）ため E2E_TEST_chreq_ で始め、説明に [E2E_TEST] を付ける。
// ログインの試行制限に当たらないよう、ログインは 3 人で 1 回ずつ（計 3 回）だけにする。
// 画面の文言は frontend/src/pages/ChannelRequestPage.test.tsx・ChannelApprovalsPage.test.tsx の契約と同じ。
import { execFile } from "node:child_process";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./console-guard";
import { allowSessionCheck401 } from "./session-console";

const PASSWORD = "TestPass123!";
const DEPT_CHANNEL = "E2E_TEST_chreq_1";
const COMPANY_CHANNEL = "E2E_TEST_chreq_2";
const WITHDRAWN_CHANNEL = "E2E_TEST_chreq_3";
const REJECT_REASON = "[E2E_TEST]名前を見直してください";

function seedFile(
  file: "channel-requests.sql" | "channel-requests-cleanup.sql",
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
  allowSessionCheck401(page);
  await page.goto("/login");
  await page.getByLabel("ユーザーID", { exact: true }).fill(loginId);
  await page.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}

/** 2 つ目以降のブラウザ。console-guard の page と同じく、エラーレベルのコンソール出力と処理されなかった例外を集める */
async function guardedPage(browser: Browser, baseURL: string | undefined) {
  const context: BrowserContext = await browser.newContext({ baseURL });
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

const rowOf = (page: Page, name: string) =>
  page.getByRole("main").getByRole("listitem").filter({ hasText: name });

async function openApprovals(page: Page) {
  // 管理メニューの「承認」のまとまりは既定で閉じている。閉じたドロワーにも同じ項目があるため、メインメニューに絞る
  const nav = page.getByRole("navigation", { name: "メインメニュー" });
  await nav.locator("summary", { hasText: /^承認$/ }).click();
  await nav.getByRole("link", { name: "チャンネル承認", exact: true }).click();
  await expect(page).toHaveURL(/\/channel-approvals$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "チャンネル作成の承認" }),
  ).toBeVisible();
}

async function apply(
  page: Page,
  name: string,
  place: "自部署のチャンネル" | "会社直属のチャンネル",
  visibility: "公開" | "非公開",
) {
  const main = page.getByRole("main");
  await main
    .getByRole("combobox", { name: "作る場所" })
    .selectOption({ label: place });
  await main
    .getByRole("combobox", { name: "公開範囲" })
    .selectOption({ label: visibility });
  await main.getByRole("textbox", { name: "チャンネル名" }).fill(name);
  await main
    .getByRole("textbox", { name: "説明" })
    .fill(`[E2E_TEST]${name}の説明`);
  await main.getByRole("button", { name: "申請する", exact: true }).click();
  // 再読み込みせずに「自分の申請」に承認待ちで出る
  await expect(rowOf(page, name)).toContainText("承認待ち");
}

async function reauthenticate(page: Page) {
  const dialog = page.getByRole("dialog", { name: "再認証" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
  await dialog.getByRole("button", { name: "再認証" }).click();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await seedFile("channel-requests-cleanup.sql");
  await seedFile("channel-requests.sql");
});
test.afterAll(async () => {
  const output = await seedFile("channel-requests-cleanup.sql");
  // 後始末の後の残数がすべて 0 であること
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
});

test("#131 AC-1〜AC-8・AC-10・AC-12〜AC-15・3-4 AC-1〜AC-3: メンバーが部署と会社直属を申請（承認のメニューは出ない）→ オーナーが再認証して承認 → 全体管理者が理由つきで却下 → メンバーの S-10 と通知に結果が出て、承認したチャンネルに参加済み → 3 件目を取り下げると承認一覧から消え、通知は増えない", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const owner = await guardedPage(browser, baseURL);
  const admin = await guardedPage(browser, baseURL);
  try {
    await owner.page.setViewportSize({ width: 1280, height: 800 });
    await admin.page.setViewportSize({ width: 1280, height: 800 });

    // ---- メンバー：S-09 の「チャンネルを申請」から S-10 へ。部署（非公開）と会社直属（公開）を申請する ----
    await login(page, "e2euser_chreq_member");
    await page.goto("/channels");
    await page.getByRole("link", { name: "チャンネルを申請" }).click();
    await expect(page).toHaveURL(/\/channel-requests$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "チャンネル作成の申請" }),
    ).toBeVisible();
    // 2-2 AC-12：非公開をおすすめする案内と、案件の専用チャンネルの案内
    await expect(page.getByText(/非公開をおすすめします/)).toBeVisible();
    await apply(page, DEPT_CHANNEL, "自部署のチャンネル", "非公開");
    await apply(page, COMPANY_CHANNEL, "会社直属のチャンネル", "公開");
    // 2-2 AC-2：承認待ちの間はチャンネルの一覧に出ない
    const pendingList = await page.request.get("/api/channels?limit=100");
    expect(pendingList.status()).toBe(200);
    const pendingNames = (
      (await pendingList.json()) as { items: { name: string }[] }
    ).items.map((item) => item.name);
    expect(pendingNames).not.toContain(DEPT_CHANNEL);
    expect(pendingNames).not.toContain(COMPANY_CHANNEL);
    // 2-2 AC-7：一般社員には「チャンネル承認」のメニューが出ず、直接開いても承認一覧を出さない。審査一覧の API は 403
    await expect(
      page
        .getByRole("navigation", { name: "メインメニュー" })
        .getByRole("link", { name: "チャンネル承認", exact: true }),
    ).toHaveCount(0);
    const forbidden = await page.request.get("/api/channel-requests");
    expect(forbidden.status()).toBe(403);

    // ---- オーナー：ベルに 1 件（部署の申請だけ。3-4 AC-1・AC-3）。S-11 で再認証して承認する ----
    await login(owner.page, "e2euser_chreq_owner");
    await expect(headerBell(owner.page)).toContainText("1");
    await openApprovals(owner.page);
    await expect(rowOf(owner.page, DEPT_CHANNEL)).toContainText(
      "E2E申請メンバー",
    );
    // 会社直属の申請は、全体管理者でないオーナーには出ない（2-2 AC-7）
    await expect(rowOf(owner.page, COMPANY_CHANNEL)).toHaveCount(0);
    await rowOf(owner.page, DEPT_CHANNEL)
      .getByRole("button", { name: `${DEPT_CHANNEL}の申請を承認する` })
      .click();
    await reauthenticate(owner.page);
    // 再読み込みせずに承認待ちの一覧から消える
    await expect(rowOf(owner.page, DEPT_CHANNEL)).toHaveCount(0);

    // ---- 全体管理者：ベルに 1 件（会社直属の申請だけ）。S-11 で再認証 → 理由を入れて却下する ----
    await login(admin.page, "e2euser_chreq_admin");
    await expect(headerBell(admin.page)).toContainText("1");
    await openApprovals(admin.page);
    await expect(rowOf(admin.page, COMPANY_CHANNEL)).toBeVisible();
    // 任命されていない部署の一般社員の申請（承認済み）は、承認待ちに出ない
    await expect(rowOf(admin.page, DEPT_CHANNEL)).toHaveCount(0);
    await rowOf(admin.page, COMPANY_CHANNEL)
      .getByRole("button", { name: `${COMPANY_CHANNEL}の申請を却下する` })
      .click();
    await reauthenticate(admin.page);
    const reasonDialog = admin.page.getByRole("dialog", { name: "却下の理由" });
    await expect(reasonDialog).toBeVisible();
    // 空では確定できない（2-2 AC-4）
    await reasonDialog.getByRole("button", { name: "却下する" }).click();
    await expect(reasonDialog).toBeVisible();
    await reasonDialog
      .getByRole("textbox", { name: "理由" })
      .fill(REJECT_REASON);
    await reasonDialog.getByRole("button", { name: "却下する" }).click();
    await expect(rowOf(admin.page, COMPANY_CHANNEL)).toHaveCount(0);

    // ---- メンバー：ベルに 2 件（承認・却下。3-4 AC-2）。通知から S-10 を開くと、承認済みと却下・理由が出る ----
    await expect(headerBell(page)).toContainText("2");
    const notified = await page.request.get("/api/me/notifications?limit=100");
    expect(notified.status()).toBe(200);
    const kinds = (
      (await notified.json()) as { items: { kind: string }[] }
    ).items
      .map((item) => item.kind)
      .sort();
    expect(kinds).toEqual([
      "channel_request.approved",
      "channel_request.rejected",
    ]);
    await headerBell(page).click();
    await expect(page).toHaveURL(/\/notifications$/);
    await page
      .getByRole("main")
      .getByRole("button", { name: /チャンネルの作成の申請が却下されました/ })
      .click();
    await expect(page).toHaveURL(/\/channel-requests$/);
    await expect(rowOf(page, DEPT_CHANNEL)).toContainText("承認済み");
    const rejectedRow = rowOf(page, COMPANY_CHANNEL);
    await expect(rejectedRow).toContainText("却下");
    await expect(rejectedRow).toContainText(REJECT_REASON);

    // 承認の通知から、作られたチャンネルへ移る。申請者は参加済み（2-2 AC-14）
    await headerBell(page).click();
    await page
      .getByRole("main")
      .getByRole("button", { name: /チャンネルの作成の申請が承認されました/ })
      .click();
    await expect(page).toHaveURL(/\/channels\/[0-9A-HJKMNP-TV-Z]{26}$/);
    await expect(
      page.getByRole("heading", { level: 1, name: DEPT_CHANNEL }),
    ).toBeVisible();
    const channelId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
    const detail = await page.request.get(`/api/channels/${channelId}`);
    expect(detail.status()).toBe(200);
    expect(await detail.json()).toMatchObject({
      name: DEPT_CHANNEL,
      visibility: "private",
      joined: true,
    });

    // ---- メンバー：3 件目を申請 → オーナーの承認待ちに出る → S-10 で取り下げる（再読み込みなしで「取り下げ」）----
    await page.goto("/channels");
    await page.getByRole("link", { name: "チャンネルを申請" }).click();
    await apply(page, WITHDRAWN_CHANNEL, "自部署のチャンネル", "公開");
    await owner.page.goto("/channel-approvals");
    await expect(rowOf(owner.page, WITHDRAWN_CHANNEL)).toBeVisible();
    const ownerNotificationsBefore = (
      (await (
        await owner.page.request.get("/api/me/notifications?limit=100")
      ).json()) as {
        items: unknown[];
      }
    ).items.length;
    expect(ownerNotificationsBefore).toBe(2);

    await rowOf(page, WITHDRAWN_CHANNEL)
      .getByRole("button", { name: /取り下げ/ })
      .click();
    const withdrawDialog = page.getByRole("dialog", { name: "申請の取り下げ" });
    await expect(withdrawDialog).toBeVisible();
    await withdrawDialog.getByRole("button", { name: "取り下げる" }).click();
    await expect(rowOf(page, WITHDRAWN_CHANNEL)).toContainText("取り下げ");
    await expect(
      rowOf(page, WITHDRAWN_CHANNEL).getByRole("button", { name: /取り下げ/ }),
    ).toHaveCount(0);

    // オーナーの承認待ちから消え、取り下げの通知は届かない（利用者決定 A）
    await owner.page.goto("/channel-approvals");
    await expect(
      owner.page.getByRole("heading", {
        level: 1,
        name: "チャンネル作成の承認",
      }),
    ).toBeVisible();
    await expect(rowOf(owner.page, WITHDRAWN_CHANNEL)).toHaveCount(0);
    const ownerNotificationsAfter = (
      (await (
        await owner.page.request.get("/api/me/notifications?limit=100")
      ).json()) as {
        items: unknown[];
      }
    ).items.length;
    expect(ownerNotificationsAfter).toBe(ownerNotificationsBefore);
    expect(owner.errors, "オーナーの画面のコンソールのエラー").toEqual([]);
    expect(admin.errors, "全体管理者の画面のコンソールのエラー").toEqual([]);
  } finally {
    await owner.context.close();
    await admin.context.close();
  }
});
