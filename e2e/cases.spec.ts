// #147（147-A）5-1 AC-4・AC-5・AC-14、画面 S-16・S-17：案件の一覧と詳細の主な流れを、画面からバックエンドまで通して確かめる（実ブラウザの遷移）。
// 流れ：参加者がメニュー「案件」→ S-16（自分が参加する案件）→ 件名を押して S-17 で説明・参加者を見る。サイドバーの「案件」の下にも参加中の案件が出る。
//   非参加者がメニュー「案件」→ S-16 の「すべての案件」→ 件名を押すと「参加者だけが見られます（非公開）」になり、説明が出ない。
// 見える範囲の認可の網羅は結合テスト（backend/src/routes/cases.test.ts）、画面の分岐は frontend/src/pages/Case*.test.tsx で確かめ、ここでは重ねない。
// 前提：e2e/seeds/cases.sql（[E2E_TEST]部署147A・参加者 e2euser_cases_member（作成者）・非参加者 e2euser_cases_outsider・
//   取引先 テスト商事案件 [E2E_TEST]（QKG）・進行中の案件 QKG-261117-0001）。後始末は e2e/seeds/cases-cleanup.sql（識別子だけ。残数 0 を確かめる）。
// ログインの試行制限に当たらないよう、ログインは利用者ごとに1回だけにする。画面の文言は frontend の画面のテストの契約と同じ。
import { execFile } from "node:child_process";
import type { Page } from "@playwright/test";
import { expect, test } from "./console-guard";
import { allowSessionCheck401 } from "./session-console";

const PASSWORD = "TestPass123!";
const CASE_TITLE = "[E2E_TEST]案件一覧の案件";
const CASE_NUMBER = "QKG-261117-0001";
const CASE_DESCRIPTION = "[E2E_TEST]参加者だけが見られる説明";
const CASE_ID = "01JTE2E00000000000C0011147";

function seedFile(file: "cases.sql" | "cases-cleanup.sql") {
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

async function openCasesFromMenu(page: Page) {
  // 閉じたドロワーにも同じ項目があるため、メインメニューに絞る
  const nav = page.getByRole("navigation", { name: "メインメニュー" });
  await nav.getByRole("link", { name: "案件", exact: true }).click();
  await expect(page).toHaveURL(/\/cases$/);
  await expect(
    page.getByRole("main").getByRole("heading", { level: 1, name: "案件一覧" }),
  ).toBeVisible();
  return nav;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await seedFile("cases-cleanup.sql");
  await seedFile("cases.sql");
});
test.afterAll(async () => {
  const output = await seedFile("cases-cleanup.sql");
  // 後始末の後の残数がすべて 0 であること
  expect(output).toContain("remaining_users");
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
});

test("#147 5-1 AC-4・AC-5: 参加者がメニュー「案件」→ S-16 → S-17 で案件の説明と参加者を見られ、サイドバーにも参加中の案件が出る", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page, "e2euser_cases_member");
  const nav = await openCasesFromMenu(page);

  // AC-5：サイドバーの「案件」の下に、参加している進行中の案件が出る
  // リンクの名前は件名を含む（部分一致。案件番号を並べてもよい）。メインメニューの中だけで探す
  await expect(nav.getByRole("link", { name: CASE_TITLE })).toHaveCount(1);
  await expect(nav.getByRole("link", { name: CASE_TITLE })).toHaveAttribute(
    "href",
    `/cases/${CASE_ID}`,
  );

  const main = page.getByRole("main");
  const card = main.getByRole("listitem").filter({ hasText: CASE_TITLE });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText(CASE_NUMBER);
  await expect(card).toContainText("テスト商事案件 [E2E_TEST]");
  await expect(card).toContainText("2026-12-01");
  await expect(card).toContainText("参加者 1人");

  await card.getByRole("link", { name: CASE_TITLE, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/cases/${CASE_ID}$`));
  await expect(
    main.getByRole("heading", { level: 1, name: CASE_TITLE }),
  ).toBeVisible();
  await expect(main.getByText(CASE_DESCRIPTION, { exact: true })).toBeVisible();
  const participants = main.getByRole("list", { name: "参加者" });
  await expect(participants.getByRole("listitem")).toHaveCount(1);
  await expect(participants).toContainText("E2E案件参加者");
  await expect(participants).toContainText("作成者");
  await expect(
    main.getByText("参加者だけが見られます（非公開）", { exact: true }),
  ).toHaveCount(0);
});

test("#147 5-1 AC-4・AC-14: 非参加者が S-16 の「すべての案件」から開くと「参加者だけが見られます（非公開）」になり、説明・参加者が出ない", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page, "e2euser_cases_outsider");
  const nav = await openCasesFromMenu(page);
  // 参加していないので、サイドバーにも「自分が参加する案件」にも出ない
  await expect(nav.getByRole("link", { name: CASE_TITLE })).toHaveCount(0);
  const main = page.getByRole("main");
  await expect(
    main.getByText("参加している案件はありません", { exact: true }),
  ).toBeVisible();

  await main.getByRole("radio", { name: "すべての案件", exact: true }).check();
  const card = main.getByRole("listitem").filter({ hasText: CASE_TITLE });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText(CASE_NUMBER);
  await expect(card).not.toContainText("参加者");

  await card.getByRole("link", { name: CASE_TITLE, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/cases/${CASE_ID}$`));
  await expect(
    main.getByText("参加者だけが見られます（非公開）", { exact: true }),
  ).toBeVisible();
  await expect(
    main.getByRole("heading", { level: 1, name: CASE_TITLE }),
  ).toBeVisible();
  await expect(main.getByText(CASE_DESCRIPTION, { exact: true })).toHaveCount(
    0,
  );
  await expect(main.getByRole("list", { name: "参加者" })).toHaveCount(0);
});
