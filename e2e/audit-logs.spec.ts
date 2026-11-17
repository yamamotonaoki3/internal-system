// #156 0-6 AC-1〜AC-6・S-25: 全体管理者が管理メニューから監査ログを開き、操作者・操作の種類で絞り込み、「さらに読み込む」で続きを見て、狭い画面でも横にはみ出さずに読める。
// 一般メンバーには、メニューに項目が出ず、URL を直接開いても見つからない表示で、API も 403。管理者が検索すると、閲覧の記録（audit_log.view）が一覧に出る。
// 判定の順・SQL の条件・応答の形・名前の解決の細部は backend のテスト、画面の部品は frontend のテストで確かめる。ここは実ブラウザ・実際のセッションの応答を通した主な流れだけ。
// データは架空（e2euser_audit_ 接頭辞・@example.com・[E2E_TEST]）。シードは audit-logs.sql、後始末は audit-logs-cleanup.sql（識別子だけで消し、残数 0 を確かめる）。
import { execFile } from "node:child_process";
import type { Page } from "@playwright/test";
import { expect, test } from "./console-guard";
import { allowSessionCheck401 } from "./session-console";

const PASSWORD = "TestPass123!";
const ADMIN = "e2euser_audit_admin";
const MEMBER = "e2euser_audit_member";
const ACTOR_DISPLAY = "testuser_audit_actor";
const TARGET_DISPLAY = "testuser_audit_target";
const ADMIN_DISPLAY = "testuser_audit_admin";

function seedFile(file: "audit-logs.sql" | "audit-logs-cleanup.sql") {
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

/** 表のデータ行（見出し行を除く）。狭い画面のカード形式でも使えるよう、表示名を含む要素を数える */
const dataRows = (page: Page) =>
  page
    .getByRole("main")
    .getByRole("row")
    .filter({ hasNot: page.getByRole("columnheader") });

test.beforeAll(async () => {
  const output = await seedFile("audit-logs-cleanup.sql");
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
  await seedFile("audit-logs.sql");
});
test.afterAll(async () => {
  const output = await seedFile("audit-logs-cleanup.sql");
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
});

test("#156 0-6 AC-1〜AC-6: 全体管理者がメニューから開き、操作者・種類で絞り込み、続きを読み込み、狭い幅でも読める。自分の閲覧が記録される", async ({
  page,
}) => {
  allowSessionCheck401(page);
  await login(page, ADMIN);

  // ---- メニュー（管理＞マスタ・記録＞監査ログ）から開く ----
  const menuLink = page.getByRole("link", { name: "監査ログ", exact: true });
  if (!(await menuLink.first().isVisible()))
    await page.getByText("マスタ・記録", { exact: true }).first().click();
  await menuLink.first().click();
  await expect(page).toHaveURL(/\/audit-logs$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "監査ログ" }),
  ).toBeVisible();

  // 先頭は一番新しい記録（シードは 2031 年）。操作した人・種類・対象・結果・日本時間の日時が文字で出る
  const first = dataRows(page).first();
  await expect(first).toContainText(ACTOR_DISPLAY);
  await expect(first).toContainText("アカウント登録");
  await expect(first).toContainText("失敗");
  await expect(first).toContainText("validation_error");
  await expect(first).toContainText("2031-03-04 10:00:29");
  // アカウント登録の失敗は、対象の社員を示さない
  await expect(first).not.toContainText(TARGET_DISPLAY);

  // ---- 操作した人で絞り込む（行の「この人で絞り込む」）→ 29件（20 + さらに読み込む で 9）----
  await first.getByRole("button", { name: /この人で絞り込む/ }).click();
  // 表の各行のセルにも表示名があるため、絞り込みのフォームの中の「操作した人：○○」の表示だけを、全文一致で探す
  await expect(
    page
      .getByRole("form", { name: "絞り込み" })
      .getByText(`操作した人：${ACTOR_DISPLAY}`, { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "絞り込む", exact: true }).click();
  await expect(dataRows(page)).toHaveCount(20);
  await page.getByRole("button", { name: "さらに読み込む" }).click();
  await expect(dataRows(page)).toHaveCount(29);
  await expect(
    page.getByRole("button", { name: "さらに読み込む" }),
  ).toHaveCount(0);

  // ---- 操作の種類で絞り込む（アカウント登録：成功3件と失敗1件）----
  await page.getByLabel("操作の種類").selectOption("account.create");
  await page.getByRole("button", { name: "絞り込む", exact: true }).click();
  await expect(dataRows(page)).toHaveCount(4);
  await expect(dataRows(page).filter({ hasText: "失敗" })).toHaveCount(1);
  await expect(dataRows(page).filter({ hasText: "成功" })).toHaveCount(3);

  // ---- 結果で絞り込む（失敗）----
  await page.getByLabel("結果").selectOption("failure");
  await page.getByRole("button", { name: "絞り込む", exact: true }).click();
  await expect(dataRows(page)).toHaveCount(1);

  // ---- 狭い幅：横にはみ出さず、内容が読める（カード形式）----
  await page.setViewportSize({ width: 375, height: 800 });
  await expect(page.getByText(ACTOR_DISPLAY).first()).toBeVisible();
  await expect(page.getByText("validation_error").first()).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, "横にはみ出していない").toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1280, height: 720 });

  // ---- 変更・削除・書き出しの操作はない ----
  const labels = await page
    .getByRole("main")
    .getByRole("button")
    .allTextContents();
  for (const label of labels)
    expect(label).not.toMatch(
      /削除|編集|変更|書き出|エクスポート|ダウンロード|CSV/,
    );

  // ---- 自分の閲覧が記録され、一覧に出る（操作 audit_log.view。操作者は管理者）----
  await page
    .getByRole("button", { name: "操作した人の絞り込みを外す" })
    .click();
  await page.getByLabel("結果").selectOption("");
  await page.getByLabel("操作の種類").selectOption("audit_log.view");
  await page.getByRole("button", { name: "絞り込む", exact: true }).click();
  const viewRow = dataRows(page).first();
  await expect(viewRow).toContainText(ADMIN_DISPLAY);
  await expect(viewRow).toContainText("監査ログの閲覧");
  await expect(viewRow).toContainText("成功");
});

test("#156 0-6 AC-1: 一般メンバーは、メニューに監査ログが出ず、URL を直接開いても見つからない表示で、API も 403 になる", async ({
  page,
}) => {
  allowSessionCheck401(page);
  await login(page, MEMBER);
  await expect(
    page.getByRole("link", { name: "監査ログ", exact: true }),
  ).toHaveCount(0);

  await page.goto("/audit-logs");
  await expect(
    page.getByRole("heading", { name: "ページが見つかりません" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: "監査ログ" }),
  ).toHaveCount(0);

  const origin = new URL(page.url()).origin;
  const response = await page.request.post("/api/admin/audit-logs/search", {
    data: {},
    headers: { Origin: origin },
  });
  expect(response.status()).toBe(403);
  expect(await response.json()).not.toHaveProperty("items");
});
