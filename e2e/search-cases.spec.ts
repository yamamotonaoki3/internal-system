// #155（155-C）E-1：案件の検索（4-2 AC-1〜AC-3）を、画面からバックエンドまで通して確かめる（E2E は同時に1つ。単独で実行する）。
// 流れ：A（S01 の参加者・S02 には参加していない）がヘッダーから検索 → 件名・案件番号（ハイフンなし）・取引先名で、案件の区画に S01・S02 の両方が出る
//   → 参加していない S02 の行を押すと S-17 へ移り、説明は出ず「参加者だけが見られます（非公開）」
//   → S01 を再編集して件名を変え、再読み込みせずに探し直すと、新しい件名で出て、古い件名では出ない。
// 前提のデータは e2e/seeds/search-cases.sql（e2euser_search155c_・[E2E_TEST]部署155C・E2E検索取引先155C [E2E_TEST]・@example.com）。
//   シードの後に、既存の案件の件名の索引を `node scripts/db-local.ts test search-reindex` で作る（利用者の決定 2026-11-21。手元の D1 だけ）。
//   後始末は search-cases-cleanup.sql（件名の索引の行を含め、残数 0 を確かめる）。
// 行は案件の区画の一覧（「案件の検索結果の一覧」）の直下の li で数え、件名の完全な文字列で探す（互いに含まれない件名）。
// 入力と送信は、自動のやり直し（toPass）で包まない（入力の値を確かめてから送る。155-B の軽微）。
// 画面の文言は frontend/src/pages/SearchPage.cases.test.tsx の契約と同じ。
import { execFile } from "node:child_process";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./console-guard";
import { allowSessionCheck401 } from "./session-console";

const PASSWORD = "TestPass123!";
const JOINED_ID = "01JTE2E155C000000000000S01";
const OTHER_ID = "01JTE2E155C000000000000S02";
const JOINED_TITLE = "[E2E_TEST]155C若草会館の改修";
const OTHER_TITLE = "[E2E_TEST]155C若草会館の点検";
const OTHER_DESCRIPTION = "[E2E_TEST]155C参加者だけの点検の説明";
const EDITED_TITLE = "[E2E_TEST]155C山吹会館の改修";
const CLIENT_NAME = "E2E検索取引先155C";

function runLocal(args: string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile(
      process.execPath,
      ["scripts/db-local.ts", "test", ...args],
      { cwd: process.cwd(), windowsHide: true },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}
const seedFile = (file: "search-cases.sql" | "search-cases-cleanup.sql") =>
  runLocal(["seed-file", `e2e/seeds/${file}`]);

async function login(page: Page, loginId: string) {
  allowSessionCheck401(page);
  await page.goto("/login");
  await page.getByLabel("ユーザーID", { exact: true }).fill(loginId);
  await page.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}

const caseRegion = (page: Page) =>
  page.getByRole("main").getByRole("region", { name: "案件" });
/** 案件の行（一覧の直下の li だけ） */
const caseRows = (page: Page): Locator =>
  caseRegion(page)
    .getByRole("list", { name: "案件の検索結果の一覧" })
    .locator(":scope > li");
/** 件名の完全な文字列で探した行（行のリンクの名前が件名と完全に一致する） */
const caseRow = (page: Page, title: string): Locator =>
  caseRows(page).filter({
    has: page.getByRole("link", { name: title, exact: true }),
  });

async function searchFromHeader(page: Page, term: string) {
  const form = page
    .getByRole("banner")
    .getByRole("search", { name: "メッセージの検索" });
  const box = form.getByRole("searchbox", { name: "検索する言葉" });
  await box.fill(term);
  await expect(box).toHaveValue(term);
  await form
    .getByRole("button", { name: "メッセージを検索", exact: true })
    .click();
  await expect(page).toHaveURL(/\/search\?/);
  const main = page.getByRole("main");
  await expect(
    main.getByRole("heading", { level: 1, name: "検索結果" }),
  ).toBeVisible();
  // 画面の検索の欄が新しい語で作り直されたこと（区画も同じ描画で新しい語の取得に替わる。前の語の結果を数えない）
  await expect(
    main.getByRole("searchbox", { name: "検索する言葉" }),
  ).toHaveValue(term);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await seedFile("search-cases-cleanup.sql");
  await seedFile("search-cases.sql");
  await runLocal(["search-reindex"]);
});

test.afterAll(async () => {
  const output = await seedFile("search-cases-cleanup.sql");
  // 後始末の後の残数（件名の索引の行を含む）がすべて 0 であること
  expect(output).toContain("remaining_case_title_documents");
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
});

test("#155 4-2 AC-1・AC-3 E-1: 件名・案件番号（ハイフンなし）・取引先名で、参加している案件と参加していない案件の両方が案件の区画に出る", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page, "e2euser_search155c_a");
  for (const term of ["若草会館", "QSK2611", CLIENT_NAME]) {
    await searchFromHeader(page, term);
    await expect(caseRow(page, JOINED_TITLE)).toHaveCount(1);
    await expect(caseRow(page, OTHER_TITLE)).toHaveCount(1);
    await expect(caseRows(page)).toHaveCount(2);
  }
  // 4-2 AC-2・C-84：結果の概要に進捗を出す。シードの案件に TODO は無いため、参加・不参加のどちらの行も0件の表示「項目なし」で、進捗バーは出ない
  for (const title of [JOINED_TITLE, OTHER_TITLE]) {
    await expect(caseRow(page, title).getByText("項目なし")).toBeVisible();
    await expect(caseRow(page, title).getByRole("progressbar")).toHaveCount(0);
  }
  // 参加していない案件の説明は、検索の結果に出ない
  await expect(page.getByRole("main")).not.toContainText(OTHER_DESCRIPTION);
});

test("#155 4-2 AC-2 E-1: 参加していない案件の行を押すと S-17 へ移り、説明は出ず「参加者だけが見られます（非公開）」", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page, "e2euser_search155c_a");
  await searchFromHeader(page, "若草会館の点検");
  await expect(caseRows(page)).toHaveCount(1);
  await caseRow(page, OTHER_TITLE)
    .getByRole("link", { name: OTHER_TITLE, exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/cases/${OTHER_ID}$`));
  const main = page.getByRole("main");
  await expect(
    main.getByText("参加者だけが見られます（非公開）"),
  ).toBeVisible();
  await expect(main.getByText(OTHER_DESCRIPTION)).toHaveCount(0);
});

test("#155 4-2 AC-1 E-1: 再編集で件名を変えると、再読み込みせずに探し直したとき、新しい件名で出て、古い件名では出ない", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page, "e2euser_search155c_a");
  // 先に「ある」を確かめる
  await searchFromHeader(page, "若草会館の改修");
  await expect(caseRow(page, JOINED_TITLE)).toHaveCount(1);

  await caseRow(page, JOINED_TITLE)
    .getByRole("link", { name: JOINED_TITLE, exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/cases/${JOINED_ID}$`));
  const main = page.getByRole("main");
  await main.getByRole("button", { name: "内容を編集", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "案件の内容の編集" });
  const title = dialog.getByRole("textbox", { name: /件名/ });
  await title.fill(EDITED_TITLE);
  await expect(title).toHaveValue(EDITED_TITLE);
  const saved = page.waitForResponse(
    (r) =>
      r.request().method() === "PATCH" &&
      new URL(r.url()).pathname === `/api/cases/${JOINED_ID}`,
  );
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(main.getByRole("heading", { level: 1 })).toHaveText(
    EDITED_TITLE,
  );

  // 再読み込みせずに、ヘッダーから探し直す
  await searchFromHeader(page, "山吹会館");
  await expect(caseRow(page, EDITED_TITLE)).toHaveCount(1);
  await expect(caseRows(page)).toHaveCount(1);
  await searchFromHeader(page, "若草会館の改修");
  // 否定の前に、区画が0件の表示になったことを確かめる（読み込み中のまま数えない）
  await expect(
    caseRegion(page).getByText("一致する案件はありません"),
  ).toBeVisible();
  await expect(caseRow(page, JOINED_TITLE)).toHaveCount(0);
  // 番号では、件名を変えても出る
  await searchFromHeader(page, "QSK-261121-0001");
  await expect(caseRow(page, EDITED_TITLE)).toHaveCount(1);
});
