// #148（148-C）5-1 AC-4 の残り・C-184(1)・C-191(4)、画面 S-16・サイドバー：案件の「最終更新」「未読」の主な流れを、画面からバックエンドまで通して確かめる（実ブラウザ）。
// 流れ：参加者 B が S-16 を開いておく（最初は「最終更新：—」で未読なし）→ 参加者 A が S-17 で投稿する
//   → B の S-16 の行とサイドバーの項目に、再読み込みなしで「未読 1件」が出る（未読は 2 秒ごとのポーリング。一覧の行はポーリングしない＝#117 の既存の動き）
//   → B が開き直すと、S-16 の行に最終更新の日時が出る → B が案件を開くと、既読になり、サイドバーの未読が消える（S-16 に戻っても出ない）
//   → 非参加者 C の S-16（すべての案件）の行には、最終更新・未読が出ない。
// 値を返す範囲・値の決め方の網羅は backend の DB・結合のテスト、画面の分岐は frontend の CasesPage.activity・case-sidebar.unread のテストで確かめ、ここでは重ねない。
// 前提：e2e/seeds/case-activity.sql（[E2E_TEST]部署148C・e2euser_case148c_member（A）／_partner（B）（参加者）／_outsider（C。非参加者）・
//   取引先 テスト商事最終更新 [E2E_TEST]（QKP）・進行中の案件 QKP-261119-0001）。後始末は e2e/seeds/case-activity-cleanup.sql（識別子だけ。残数 0 を確かめる）。
//   この E2E の利用者は、ほかの spec と共有しない。E2E は同時に1つだけ動かす。
// ログインの試行制限に当たらないよう、ログインは利用者ごとに1回だけにする（それぞれ別のブラウザのコンテキスト）。
// 自分で作ったページには console-guard の監視が付かないため、3人のページそれぞれに同じ監視を付け、最後に照合する。
import { execFile } from "node:child_process";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./console-guard";

const PASSWORD = "TestPass123!";
const CASE_ID = "01JTE2E00000000000W0011148";
const CASE_TITLE = "[E2E_TEST]最終更新の進行中の案件";
const POST_TEXT = "[E2E_TEST]148C最終更新の投稿";
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/** 仕様どおりの拒否の応答だけを許す：ログイン前のセッションの確認（401） */
const INTENDED_REJECTION =
  /Failed to load resource: the server responded with a status of 401/;

function seedFile(file: "case-activity.sql" | "case-activity-cleanup.sql") {
  return new Promise<string>((resolve, reject) => {
    execFile(
      process.execPath,
      ["scripts/db-local.ts", "test", "seed-file", `e2e/seeds/${file}`],
      { cwd: process.cwd(), windowsHide: true },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

type Signed = {
  context: BrowserContext;
  page: Page;
  expectNoErrors: () => void;
};

async function signIn(
  browser: Browser,
  baseURL: string | undefined,
  loginId: string,
): Promise<Signed> {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !INTENDED_REJECTION.test(m.text()))
      errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/login");
  await page.getByLabel("ユーザーID", { exact: true }).fill(loginId);
  await page.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  return {
    context,
    page,
    expectNoErrors: () =>
      expect(
        errors,
        `${loginId} のコンソールのエラー・処理されなかった例外`,
      ).toEqual([]),
  };
}

const menu = (page: Page) =>
  page.getByRole("navigation", { name: "メインメニュー" });
const sidebarLink = (page: Page) =>
  menu(page).getByRole("link", { name: new RegExp(`^${escape(CASE_TITLE)}`) });
const card = (page: Page) =>
  page.getByRole("main").getByRole("listitem").filter({ hasText: CASE_TITLE });
const roomLog = (page: Page) =>
  page.getByRole("log", { name: "メッセージ一覧" });

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function openCases(page: Page) {
  await menu(page).getByRole("link", { name: "案件", exact: true }).click();
  await expect(page).toHaveURL(/\/cases$/);
  await expect(
    page.getByRole("main").getByRole("heading", { level: 1, name: "案件一覧" }),
  ).toBeVisible();
}

let a: Signed | undefined;
let b: Signed | undefined;
let c: Signed | undefined;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser, baseURL }) => {
  await seedFile("case-activity-cleanup.sql");
  await seedFile("case-activity.sql");
  a = await signIn(browser, baseURL, "e2euser_case148c_member");
  b = await signIn(browser, baseURL, "e2euser_case148c_partner");
  c = await signIn(browser, baseURL, "e2euser_case148c_outsider");
});

test.afterAll(async () => {
  for (const opened of [a, b, c]) await opened?.context.close();
  const output = await seedFile("case-activity-cleanup.sql");
  expect(output).toContain("remaining_users");
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
});

test("#148 148-C 5-1 AC-4: 投稿の前、参加者 B の S-16 の行は「最終更新：—」で、未読の印はない", async () => {
  const pb = (b as Signed).page;
  await openCases(pb);
  await expect(card(pb)).toHaveCount(1);
  await expect(card(pb)).toContainText("最終更新：—");
  await expect(card(pb)).not.toContainText("未読");
  await expect(sidebarLink(pb)).toHaveAccessibleName(CASE_TITLE);
});

test("#148 148-C C-184(1): 参加者 A が投稿すると、開いたままの B の S-16 の行とサイドバーに、再読み込みなしで「未読 1件」が出る", async () => {
  const pa = (a as Signed).page;
  const pb = (b as Signed).page;
  await pa.goto(`/cases/${CASE_ID}`);
  await expect(
    pa.getByRole("main").getByRole("heading", { level: 2, name: "やり取り" }),
  ).toBeVisible();
  await pa.getByRole("textbox", { name: "メッセージ" }).fill(POST_TEXT);
  await pa.getByRole("button", { name: "送信", exact: true }).click();
  await expect(
    roomLog(pa).getByRole("listitem").filter({ hasText: POST_TEXT }),
  ).toBeVisible();

  // 未読の数は、2 秒ごとのポーリングで出る（B の画面は開き直さない）
  await expect(card(pb)).toContainText("未読 1件");
  await expect(sidebarLink(pb)).toHaveAccessibleName(
    new RegExp(`^${escape(CASE_TITLE)}\\s+未読 1件$`),
  );
  // 件名のリンクの名前は件名のまま
  await expect(
    card(pb).getByRole("link", { name: CASE_TITLE, exact: true }),
  ).toBeVisible();
});

test("#148 148-C C-191(4): B が S-16 を開き直すと、行に最終更新の日時が出る", async () => {
  const pb = (b as Signed).page;
  await pb.reload();
  await expect(card(pb)).toHaveCount(1);
  const time = card(pb).locator("time");
  await expect(time).toHaveCount(1);
  await expect(time).toHaveAttribute("datetime", ISO);
  await expect(card(pb)).not.toContainText("最終更新：—");
  await expect(card(pb)).toContainText("未読 1件");
});

test("#148 148-C 3-1 AC-2: B が案件を開くと既読になり、サイドバーの未読が消え、S-16 に戻っても出ない", async () => {
  const pb = (b as Signed).page;
  await card(pb).getByRole("link", { name: CASE_TITLE, exact: true }).click();
  await expect(pb).toHaveURL(new RegExp(`/cases/${CASE_ID}$`));
  await expect(
    roomLog(pb).getByRole("listitem").filter({ hasText: POST_TEXT }),
  ).toBeVisible();
  await expect(sidebarLink(pb)).toHaveAccessibleName(CASE_TITLE);

  await openCases(pb);
  await expect(card(pb)).toHaveCount(1);
  await expect(card(pb)).not.toContainText("未読");
  await expect(card(pb).locator("time")).toHaveCount(1);
});

test("#148 148-C 5-1 AC-2・C-191(4): 非参加者 C の S-16（すべての案件）の行には、最終更新・未読が出ない", async () => {
  const pc = (c as Signed).page;
  await openCases(pc);
  await pc
    .getByRole("main")
    .getByRole("radio", { name: "すべての案件", exact: true })
    .check();
  await expect(card(pc)).toHaveCount(1);
  await expect(card(pc)).not.toContainText("最終更新");
  await expect(card(pc)).not.toContainText("未読");
  await expect(card(pc).locator("time")).toHaveCount(0);
  // 参加していないので、サイドバーにも出ない
  await expect(sidebarLink(pc)).toHaveCount(0);
});

test("#148 148-C C-24: 3人のページに、コンソールのエラー・処理されなかった例外がない", () => {
  for (const opened of [a, b, c]) (opened as Signed).expectNoErrors();
});
