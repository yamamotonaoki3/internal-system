// #143-b b-AC-1〜b-AC-3（2-6 AC-5①⑥・AC-6、S-38・S-39、C-124・C-132・C-142(5)、D-6）: チャンネル管理（S-39）とアーカイブ（S-38）の主な流れを、実ブラウザで確かめる。
// 部署 A のオーナー（e2euser_chmgmt_owner）が、サイドバーの管理メニュー「部署＞チャンネル管理」から S-39 を開き、自部署の参加していない非公開
// （E2E_TEST_chmgmt_private）が出て、他部署の非公開（E2E_TEST_chmgmt_other）が出ないことを見る → 名前で絞り込む → 行の「⋯」からアーカイブ（理由・再認証）
// → 完了の文 → 管理メニューの外の「アーカイブ」で S-38 を開き、行に理由が出る → 「復元」（再認証）→ 完了の文、行が消える → S-39 で「使用中」に戻っている。
// 一般の社員（e2euser_chmgmt_member）には入口が出ず、URL を直接開いても「ページが見つかりません」。
// 判定の順・存在の非開示の細部はバックエンドの結合のテスト（admin-channels.test.ts・admin-deleted-items.test.ts）、メニューの分岐は画面のテスト
// （pages/ChannelManagePage.test.tsx・pages/ArchivePage.test.tsx）で確かめるので、ここでは重ねない。
// 前提：e2e/seeds/channel-management.sql。後始末は e2e/seeds/channel-management-cleanup.sql（識別子だけ。残数 0 を確かめる）。
import { execFile } from "node:child_process";
import type { Locator, Page, Response } from "@playwright/test";
import { expect, test } from "./console-guard";
import { allowSessionCheck401 } from "./session-console";

const PASSWORD = "TestPass123!";
const ROOM = "01JTE2E143B000000000000C01";
const PRIVATE = "E2E_TEST_chmgmt_private";
const PUBLIC = "E2E_TEST_chmgmt_public";
const OTHER = "E2E_TEST_chmgmt_other";
const REASON = "[E2E_TEST]チャンネル管理の確認";

function seedFile(
  file: "channel-management.sql" | "channel-management-cleanup.sql",
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

/** main の中の、名前を含む行 */
function rowOf(page: Page, name: string): Locator {
  return page.getByRole("main").getByRole("row").filter({ hasText: name });
}

/** 再認証のダイアログが出たらパスワードを入れる（直前に再認証していれば出ない）。送った要求の応答を返す */
async function confirmWithReauth(page: Page, response: Promise<Response>) {
  const reauth = page.getByRole("dialog", { name: "再認証" });
  const first = await Promise.race([
    reauth.waitFor({ state: "visible" }).then(() => "reauth" as const),
    response.then(() => "sent" as const),
  ]);
  if (first === "reauth") {
    await reauth.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
    await reauth.getByRole("button", { name: "再認証" }).click();
  }
  return response;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const output = await seedFile("channel-management-cleanup.sql");
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
  await seedFile("channel-management.sql");
});
test.afterAll(async () => {
  const output = await seedFile("channel-management-cleanup.sql");
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
});

test("#143-b b-AC-1・b-AC-2: オーナーが管理メニューから S-39 を開き、自部署だけが出て、絞り込み → アーカイブ（再認証）→ S-38 で理由を見て復元（再認証）→ S-39 で使用中に戻る", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page, "e2euser_chmgmt_owner");

  // ---- 管理メニュー「部署＞チャンネル管理」から S-39 を開く ----
  const menuLink = page.getByRole("link", {
    name: "チャンネル管理",
    exact: true,
  });
  if (!(await menuLink.first().isVisible()))
    await page.getByText("部署", { exact: true }).first().click();
  await menuLink.first().click();
  await expect(page).toHaveURL(/\/channel-management$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "チャンネル管理" }),
  ).toBeVisible();

  // ---- 自部署の参加していない非公開・公開・専用が出て、他部署の非公開は出ない ----
  await expect(rowOf(page, PRIVATE)).toBeVisible();
  await expect(rowOf(page, PRIVATE)).toContainText("非公開");
  await expect(rowOf(page, PUBLIC)).toBeVisible();
  await expect(rowOf(page, "[E2E_TEST]chmgmt部署Aのお知らせ")).toContainText(
    "お知らせ専用",
  );
  await expect(rowOf(page, OTHER)).toHaveCount(0);
  await expect(rowOf(page, "[E2E_TEST]chmgmt部署B")).toHaveCount(0);

  // ---- 名前で絞り込む（「検索」で確定） ----
  await page.getByLabel("名前で検索", { exact: true }).fill("chmgmt_priv");
  // #155：ヘッダーにもメッセージの検索のボタン「検索」があるため、画面の本文（main）の中に絞って押す
  await page
    .getByRole("main")
    .getByRole("button", { name: "検索", exact: true })
    .click();
  await expect(rowOf(page, PUBLIC)).toHaveCount(0);
  await expect(rowOf(page, PRIVATE)).toBeVisible();

  // ---- 行の「⋯」→「アーカイブ」→ 理由 → 再認証 → 完了の文（詳細へは移らない） ----
  await rowOf(page, PRIVATE)
    .getByRole("button", { name: `${PRIVATE}の操作`, exact: true })
    .click();
  await page
    .getByRole("menu")
    .getByRole("menuitem", { name: "アーカイブ", exact: true })
    .click();
  const archive = page.getByRole("dialog", {
    name: `チャンネル「${PRIVATE}」をアーカイブしますか`,
  });
  await expect(archive).toBeVisible();
  await archive.getByLabel(/理由/).fill(REASON);
  const archived = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname === `/api/channels/${ROOM}/delete`,
  );
  await archive
    .getByRole("button", { name: "アーカイブ", exact: true })
    .click();
  expect((await confirmWithReauth(page, archived)).status()).toBe(200);
  await expect(
    page.getByText(`チャンネル「${PRIVATE}」をアーカイブしました`),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/channel-management$/);
  await expect(rowOf(page, PRIVATE)).toContainText("アーカイブ中");

  // ---- 管理メニューの外の「アーカイブ」から S-38 を開き、行に理由が出る ----
  await page
    .getByRole("link", { name: "アーカイブ", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/archive$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "アーカイブ" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "アーカイブしたチャンネル" }),
  ).toBeVisible();
  await expect(rowOf(page, PRIVATE)).toContainText(REASON);
  await expect(rowOf(page, PRIVATE)).toContainText("E2Eチャンネル管理オーナー");

  // ---- 「復元」→ 再認証 → 完了の文、行が消える ----
  await rowOf(page, PRIVATE)
    .getByRole("button", { name: "復元", exact: true })
    .click();
  const restore = page.getByRole("dialog", {
    name: `チャンネル「${PRIVATE}」を復元しますか`,
  });
  await expect(restore).toBeVisible();
  const restored = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname === `/api/channels/${ROOM}/restore`,
  );
  await restore.getByRole("button", { name: "復元", exact: true }).click();
  expect((await confirmWithReauth(page, restored)).status()).toBe(200);
  await expect(
    page.getByText(`チャンネル「${PRIVATE}」を復元しました`),
  ).toBeVisible();
  await expect(rowOf(page, PRIVATE)).toHaveCount(0);

  // ---- S-39 に戻ると、「使用中」で絞り込んだ一覧に出る ----
  await page.goto("/channel-management");
  await page.getByLabel("状態", { exact: true }).selectOption({
    label: "使用中",
  });
  await page.getByLabel("名前で検索", { exact: true }).fill("chmgmt_priv");
  // #155：ヘッダーにもメッセージの検索のボタン「検索」があるため、画面の本文（main）の中に絞って押す
  await page
    .getByRole("main")
    .getByRole("button", { name: "検索", exact: true })
    .click();
  await expect(rowOf(page, PRIVATE)).toContainText("使用中");
});

test("#143-b b-AC-3（2-6 AC-5①）: 一般の社員には入口が出ず、URL を直接開いても「ページが見つかりません」", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page, "e2euser_chmgmt_member");
  await expect(
    page.getByRole("link", { name: "チャンネルを探す", exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "チャンネル管理", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "アーカイブ", exact: true }),
  ).toHaveCount(0);
  for (const path of ["/channel-management", "/archive"]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: "ページが見つかりません" }),
    ).toBeVisible();
  }
});
