// #147（147-B）5-1 AC-3・AC-7・AC-17、C-182 Q8、画面 S-17・S-18：参加者の追加・削除と納期の変更の主な流れを、画面からバックエンドまで通して確かめる（実ブラウザ）。
// 流れ：参加者（作成者）が S-17 の「参加者を管理」→ 担当部署のオーナーに役割の名前が出て「削除」が出ない → 社員を検索して追加 →
//   追加された人が S-16 の「自分が参加する案件」から S-17 を開いて説明を見られる → 作成者がその人を削除 → 外された人は再読み込みで「参加者だけが見られます（非公開）」。
//   作成者が「納期を変更」で納期を設定すると、S-17 のヘッダーに出る。
// 判定の順・認可・同時の操作の網羅は結合テスト・DB のテスト（backend/src/routes/cases.participants.test.ts 等）、画面の分岐は
// frontend/src/pages/CaseParticipantManager.test.tsx・CaseDueDate.test.tsx で確かめ、ここでは重ねない。
// 前提：e2e/seeds/case-participants.sql（[E2E_TEST]部署147B・作成者 e2euser_casepart_member・担当部署のオーナー e2euser_casepart_owner（参加中）・
//   追加される社員 e2euser_casepart_newcomer・取引先 テスト商事参加者 [E2E_TEST]（QKH）・進行中の案件 QKH-261118-0001。納期は未定）。
//   後始末は e2e/seeds/case-participants-cleanup.sql（識別子だけ。残数 0 を確かめる）。
// ログインの試行制限に当たらないよう、ログインは利用者ごとに1回だけにする（2人目は別のブラウザのコンテキスト）。
// 画面の文言は frontend の画面のテストの契約と同じ。
import { execFile } from "node:child_process";
import type { Browser, Page } from "@playwright/test";
import { expect, test } from "./console-guard";
import { allowSessionCheck401 } from "./session-console";

const PASSWORD = "TestPass123!";
const CASE_ID = "01JTE2E00000000000P0011147";
const CASE_TITLE = "[E2E_TEST]参加者管理の案件";
const CASE_DESCRIPTION = "[E2E_TEST]参加者だけが見られる参加者管理の説明";
const OWNER_NAME = "E2E参加者管理のオーナー";
const NEWCOMER_NAME = "E2E参加者管理の追加対象";
/** 納期（日本時間の今日より後の、十分先の日付） */
const NEW_DUE_DATE = "2027-01-15";

function seedFile(
  file: "case-participants.sql" | "case-participants-cleanup.sql",
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

async function newPage(browser: Browser, baseURL: string | undefined) {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  return { context, page };
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await seedFile("case-participants-cleanup.sql");
  await seedFile("case-participants.sql");
});
test.afterAll(async () => {
  const output = await seedFile("case-participants-cleanup.sql");
  // 後始末の後の残数がすべて 0 であること
  expect(output).toContain("remaining_users");
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
});

test("#147 5-1 AC-3・AC-7・Q8: 参加者が社員を追加すると、追加された人が詳細を見られ、削除すると見られなくなる。担当部署のオーナーには「削除」が出ない", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page, "e2euser_casepart_member");
  await page.goto(`/cases/${CASE_ID}`);
  const main = page.getByRole("main");
  await expect(
    main.getByRole("heading", { level: 1, name: CASE_TITLE }),
  ).toBeVisible();

  // S-18 の参加者の部分を開く
  await main.getByRole("button", { name: "参加者を管理", exact: true }).click();
  const manager = page.getByRole("dialog", { name: "参加者を管理" });
  await expect(manager).toBeVisible();

  // Q8：担当部署のオーナーには役割の名前が出て、「削除」が出ない
  const ownerRow = manager
    .getByRole("listitem")
    .filter({ hasText: OWNER_NAME });
  await expect(ownerRow).toHaveCount(1);
  await expect(ownerRow).toContainText("担当部署のオーナー");
  await expect(ownerRow.getByRole("button")).toHaveCount(0);

  // 社員を検索して追加する
  await manager
    .getByRole("textbox", { name: "社員の検索", exact: true })
    .fill("E2E参加者管理の追加");
  await manager
    .getByRole("button", { name: `${NEWCOMER_NAME}を追加`, exact: true })
    .click();
  await expect(
    page.getByText("参加者を更新しました", { exact: true }),
  ).toBeVisible();
  await expect(
    manager.getByRole("listitem").filter({ hasText: NEWCOMER_NAME }),
  ).toHaveCount(1);

  // 追加された人は、S-16 の「自分が参加する案件」から S-17 を開いて説明を見られる
  const other = await newPage(browser, baseURL);
  try {
    await login(other.page, "e2euser_casepart_newcomer");
    await other.page.goto("/cases");
    const otherMain = other.page.getByRole("main");
    const card = otherMain
      .getByRole("listitem")
      .filter({ hasText: CASE_TITLE });
    await expect(card).toHaveCount(1);
    await card.getByRole("link", { name: CASE_TITLE, exact: true }).click();
    await expect(other.page).toHaveURL(new RegExp(`/cases/${CASE_ID}$`));
    await expect(
      otherMain.getByText(CASE_DESCRIPTION, { exact: true }),
    ).toBeVisible();

    // 作成者がその人を削除する（確認のダイアログを経る）
    await manager
      .getByRole("button", { name: `${NEWCOMER_NAME}を削除`, exact: true })
      .click();
    const confirm = page.getByRole("dialog", { name: "参加者の削除" });
    await expect(confirm).toContainText(NEWCOMER_NAME);
    await confirm
      .getByRole("button", { name: "削除する", exact: true })
      .click();
    await expect(
      manager.getByRole("listitem").filter({ hasText: NEWCOMER_NAME }),
    ).toHaveCount(0);
    await expect(
      page.getByText("参加者を更新しました", { exact: true }),
    ).toBeVisible();

    // 外された人は、再読み込みすると非公開の表示になり、説明が出ない
    await other.page.reload();
    await expect(
      otherMain.getByText("参加者だけが見られます（非公開）", { exact: true }),
    ).toBeVisible();
    await expect(
      otherMain.getByText(CASE_DESCRIPTION, { exact: true }),
    ).toHaveCount(0);
  } finally {
    await other.context.close();
  }
});

test("#147 5-1 AC-17: 参加者が「納期を変更」で納期を設定すると、S-17 のヘッダーに出る", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page, "e2euser_casepart_owner");
  await page.goto(`/cases/${CASE_ID}`);
  const main = page.getByRole("main");
  await expect(
    main.getByRole("heading", { level: 1, name: CASE_TITLE }),
  ).toBeVisible();
  const header = main.locator("header").first();
  await expect(header).not.toContainText(NEW_DUE_DATE);

  await main.getByRole("button", { name: "納期を変更", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "納期の変更" });
  await dialog.getByLabel("納期", { exact: true }).fill(NEW_DUE_DATE);
  await dialog.getByRole("button", { name: "保存する", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(header).toContainText(NEW_DUE_DATE);
});
