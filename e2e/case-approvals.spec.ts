// #146（146-B）5-3 AC-2・AC-3・AC-6、5-1 AC-6・AC-7・AC-18、画面 S-29：案件作成の承認一覧の主な流れを、画面からバックエンドまで通して確かめる。
// 流れ：担当部署のオーナーがメニュー「承認＞案件承認」から S-29 を開く → 承認する（再認証なし）→ 案件番号つきの案件と案件専用チャンネルができ、
//   申請者とオーナーが参加している（DB の件数で確かめる）→ もう1件を理由つきで却下する → 「却下」の絞り込みで理由が見える。
//   メンバーのメニューには「案件承認」が出ず、自分の申請に承認済み・却下（理由つき）が出る。
// データを変える操作の後は、再読み込みせずに、関係する表示（承認待ちの一覧）が変わることを確かめる。
// 判定の順・応答の形・入力の検査・採番の細部は、下の層（DB・結合・画面の部品のテスト）で確かめ、ここでは重ねない。
// 前提：e2e/seeds/case-approvals.sql（[E2E_TEST]部署146B・そのオーナー e2euser_caseapp_owner・一般社員 e2euser_caseapp_member・
//   取引先 テスト商事承認 [E2E_TEST]（QKF）・メンバーの審査中の申請2件）。確認は e2e/seeds/case-approvals-check.sql（読み取りだけ）。
//   後始末は e2e/seeds/case-approvals-cleanup.sql（識別子だけ。残数 0 を確かめる）。
// ログインの試行制限に当たらないよう、ログインは利用者ごとに1回だけにする。画面の文言は frontend/src/pages/CaseApprovalsPage.test.tsx の契約と同じ。
import { execFile } from "node:child_process";
import type { Page } from "@playwright/test";
import { expect, test } from "./console-guard";
import { allowSessionCheck401 } from "./session-console";

const PASSWORD = "TestPass123!";
const APPROVE_TITLE = "[E2E_TEST]承認する案件";
const REJECT_TITLE = "[E2E_TEST]却下する案件";
const REJECT_REASON = "[E2E_TEST]担当部署を見直してください";

function seedFile(
  file:
    | "case-approvals.sql"
    | "case-approvals-check.sql"
    | "case-approvals-cleanup.sql",
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

const cardOf = (page: Page, title: string) =>
  page.getByRole("main").getByRole("listitem").filter({ hasText: title });

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await seedFile("case-approvals-cleanup.sql");
  await seedFile("case-approvals.sql");
});
test.afterAll(async () => {
  const output = await seedFile("case-approvals-cleanup.sql");
  // 後始末の後の残数がすべて 0 であること
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
});

test("#146 5-3 AC-2・AC-3・AC-6・5-1 AC-6・AC-7・AC-18: 担当部署のオーナーが S-29 から承認すると案件と専用チャンネルができて申請者が参加し、もう1件を理由つきで却下できる", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page, "e2euser_caseapp_owner");

  // 管理メニュー「承認＞案件承認」から開く。「承認」のまとまりは既定で閉じている。閉じたドロワーにも同じ項目があるため、メインメニューに絞る
  const nav = page.getByRole("navigation", { name: "メインメニュー" });
  await nav.locator("summary", { hasText: /^承認$/ }).click();
  await nav.getByRole("link", { name: "案件承認", exact: true }).click();
  await expect(page).toHaveURL(/\/case-approvals$/);
  const main = page.getByRole("main");
  await expect(
    main.getByRole("heading", { level: 1, name: "案件作成の承認" }),
  ).toBeVisible();
  await expect(cardOf(page, APPROVE_TITLE)).toHaveCount(1);
  await expect(cardOf(page, REJECT_TITLE)).toHaveCount(1);

  // 承認（再認証のダイアログは出ない。C-81）
  await cardOf(page, APPROVE_TITLE)
    .getByRole("button", { name: `${APPROVE_TITLE}の申請を承認する` })
    .click();
  const approveDialog = page.getByRole("dialog", { name: "案件の作成の承認" });
  await expect(approveDialog).toBeVisible();
  await approveDialog
    .getByRole("button", { name: "承認する", exact: true })
    .click();
  await expect(approveDialog).toBeHidden();
  await expect(page.getByRole("dialog", { name: "再認証" })).toHaveCount(0);
  await expect(cardOf(page, APPROVE_TITLE)).toHaveCount(0);

  // 案件番号つきの案件・非公開の案件専用チャンネル・申請者とオーナーの参加ができている（画面がまだない #147 の代わりに DB で数える）
  const checked = await seedFile("case-approvals-check.sql");
  expect(checked).toMatch(/"check_case_count":\s*1\b/);
  expect(checked).toMatch(/"check_channel_count":\s*1\b/);
  expect(checked).toMatch(/"check_member_count":\s*2\b/);

  // 却下（理由のダイアログ）
  await cardOf(page, REJECT_TITLE)
    .getByRole("button", { name: `${REJECT_TITLE}の申請を却下する` })
    .click();
  const rejectDialog = page.getByRole("dialog", { name: "却下の理由" });
  await rejectDialog.getByRole("textbox", { name: "理由" }).fill(REJECT_REASON);
  await rejectDialog
    .getByRole("button", { name: "却下する", exact: true })
    .click();
  await expect(rejectDialog).toBeHidden();
  await expect(cardOf(page, REJECT_TITLE)).toHaveCount(0);
  expect(await seedFile("case-approvals-check.sql")).toMatch(
    /"check_rejected_case_count":\s*0\b/,
  );

  // 「却下」で絞り込むと、理由が見える
  await main
    .getByRole("combobox", { name: "状態" })
    .selectOption({ label: "却下" });
  await expect(cardOf(page, REJECT_TITLE)).toContainText(REJECT_REASON);
});

test("#146 5-3 AC-3・S-29: メンバーのメニューには「案件承認」が出ず、自分の申請に承認済みと却下（理由つき）が出る", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page, "e2euser_caseapp_member");
  const nav = page.getByRole("navigation", { name: "メインメニュー" });
  await expect(
    nav.getByRole("link", { name: "案件承認", exact: true }),
  ).toHaveCount(0);
  // 直接開いても承認一覧を出さず、審査一覧の API は 403
  const forbidden = await page.request.get("/api/case-requests");
  expect(forbidden.status()).toBe(403);

  await nav.getByRole("link", { name: "案件の申請", exact: true }).click();
  await expect(page).toHaveURL(/\/case-requests$/);
  await expect(cardOf(page, APPROVE_TITLE)).toContainText("承認済み");
  // 5-1 AC-18：申請者の自分の申請に案件番号が出る（取引先コード QKF・日本時間の承認日・連番）
  await expect(cardOf(page, APPROVE_TITLE)).toContainText(/QKF-\d{6}-\d{4}/);
  await expect(cardOf(page, REJECT_TITLE)).toContainText("却下");
  await expect(cardOf(page, REJECT_TITLE)).toContainText(REJECT_REASON);
});
