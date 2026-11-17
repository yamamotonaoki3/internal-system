// #146（146-A）5-3 AC-1・AC-6・AC-7・AC-10・AC-14、画面 S-18：案件の作成の申請の主な流れを、画面からバックエンドまで通して確かめる。
// 流れ：メニュー「案件」→ S-16 の「案件の作成を申請」（#147 で入口を置き換え）→ 似た件名を入れると警告が見え、そのまま申請できる → 自分の申請に出る → 取り下げる → 修正して再申請する。
// データを変える操作の後は、再読み込みせずに、関係する表示（自分の申請の行の状態）が変わることを確かめる。
// 判定の順・応答の形・下書き・入力の検査は、下の層（Service・結合・画面の部品のテスト）で確かめ、ここでは重ねない。
// 前提：e2e/seeds/case-requests.sql（[E2E_TEST]部署146・そのオーナー e2euser_casereq_owner・一般社員 e2euser_casereq_member・取引先 テスト商事 [E2E_TEST]・
//   オーナーの審査中の申請「[E2E_TEST]保守契約」）。後始末は e2e/seeds/case-requests-cleanup.sql（識別子だけ。残数 0 を確かめる）。
// ログインの試行制限に当たらないよう、ログインは1回だけにする。画面の文言は frontend/src/pages/CaseRequestPage.test.tsx の契約と同じ。
import { execFile } from "node:child_process";
import type { Page } from "@playwright/test";
import { expect, test } from "./console-guard";
import { allowSessionCheck401 } from "./session-console";

const PASSWORD = "TestPass123!";
const CLIENT_NAME = "テスト商事 [E2E_TEST]";
const DEPARTMENT = "[E2E_TEST]部署146";
const SIMILAR_TITLE = "[E2E_TEST]保守契約";
const RESUBMIT_TITLE = "[E2E_TEST]改訂した保守の件名";

function seedFile(file: "case-requests.sql" | "case-requests-cleanup.sql") {
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

const myList = (page: Page) =>
  page
    .getByRole("main")
    .locator("section")
    .filter({
      has: page.getByRole("heading", { level: 2, name: "自分の申請" }),
    });
const rowsOf = (page: Page, title: string) =>
  myList(page).getByRole("listitem").filter({ hasText: title });

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await seedFile("case-requests-cleanup.sql");
  await seedFile("case-requests.sql");
});
test.afterAll(async () => {
  const output = await seedFile("case-requests-cleanup.sql");
  // 後始末の後の残数がすべて 0 であること
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
});

test("#146 5-3 AC-1・AC-6・AC-7・AC-10・AC-14: メンバーが似た件名で申請（警告が出ても申請できる）→ 自分の申請に承認待ちで出る → 取り下げる → 修正して再申請すると、別の申請が承認待ちで出る", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page, "e2euser_casereq_member");

  const nav = page.getByRole("navigation", { name: "メインメニュー" });
  // #147：メニューの入口は「案件」（S-16）に置き換わった（既定の方針9）。S-16 の「案件の作成を申請」から S-18 を開く
  await nav.getByRole("link", { name: "案件", exact: true }).click();
  await expect(page).toHaveURL(/\/cases$/);
  await page
    .getByRole("main")
    .getByRole("link", { name: "案件の作成を申請", exact: true })
    .click();
  await expect(page).toHaveURL(/\/case-requests$/);
  const main = page.getByRole("main");
  await expect(
    main.getByRole("heading", { level: 1, name: "案件の作成の申請" }),
  ).toBeVisible();
  await expect(main.getByText("申請はまだありません")).toBeVisible();

  // 5-3 AC-10：件名の注意書き
  await expect(
    main.getByText(
      "件名は参加していない人にも見える場合があります。機密情報を書かないでください",
    ),
  ).toBeVisible();

  // 5-3 AC-14：同じ取引先に審査中の同じ件名があるので、警告が出る
  await main
    .getByRole("combobox", { name: "取引先" })
    .selectOption({ label: CLIENT_NAME });
  await main.getByRole("textbox", { name: "件名" }).fill(SIMILAR_TITLE);
  await expect(main.getByText("似た案件があります")).toBeVisible();
  await main
    .getByRole("textbox", { name: "説明" })
    .fill("[E2E_TEST]主な流れの説明");
  await main
    .getByRole("group", { name: "担当部署" })
    .getByRole("checkbox", { name: DEPARTMENT })
    .check();

  // 警告が出ても申請できる。再読み込みせずに自分の申請に出る
  await main.getByRole("button", { name: "申請する", exact: true }).click();
  await expect(
    main.getByText("案件の作成を申請しました。承認されると案件が作られます"),
  ).toBeVisible();
  const first = rowsOf(page, SIMILAR_TITLE);
  await expect(first).toHaveCount(1);
  await expect(first).toContainText("承認待ち");
  await expect(first).toContainText(CLIENT_NAME);
  await expect(first).toContainText(DEPARTMENT);

  // 5-3 AC-7：取り下げ（確認のダイアログを経る）
  await first.getByRole("button", { name: /取り下げ/ }).click();
  const dialog = page.getByRole("dialog", { name: "申請の取り下げ" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "取り下げる", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(first).toContainText("取り下げ");
  await expect(first.getByRole("button", { name: /取り下げ/ })).toHaveCount(0);

  // 5-3 AC-6：修正して再申請（フォームに元の値が入る）
  await first
    .getByRole("button", { name: "修正して再申請", exact: true })
    .click();
  const title = main.getByRole("textbox", { name: "件名" });
  await expect(title).toHaveValue(SIMILAR_TITLE);
  await expect(main.getByRole("textbox", { name: "説明" })).toHaveValue(
    "[E2E_TEST]主な流れの説明",
  );
  await title.fill(RESUBMIT_TITLE);
  await main.getByRole("button", { name: "申請する", exact: true }).click();
  const second = rowsOf(page, RESUBMIT_TITLE);
  await expect(second).toHaveCount(1);
  await expect(second).toContainText("承認待ち");
  // 元の申請は取り下げのまま残る（履歴）
  await expect(first).toContainText("取り下げ");
});
