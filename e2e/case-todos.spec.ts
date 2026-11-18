// #149（149-A）5-4 AC-1〜AC-4・AC-7、1-9 AC-2（C-145：2秒のポーリング。3秒以内＝C-88）、画面 S-17：案件の TODO の主な流れを、
// 画面からバックエンドまで通して確かめる（実ブラウザ）。
// 流れ：参加者 member が S-17 の「TODO」で、担当者 partner を選んで TODO を追加 → 別のブラウザの partner の S-17 に、再読み込みなしで出る（3秒以内）
//   → partner が完了にすると、member の画面の進捗（区画とヘッダー）が再読み込みなしで「1/1」に変わる。非参加者 outsider の S-17 には TODO が出ない。
// 判定の順・認可・同時の操作の網羅は backend の結合・DB・Service のテスト、画面の分岐は frontend/src/pages/CaseTodos*.test.tsx で確かめ、ここでは重ねない。
// 前提：e2e/seeds/case-todos.sql（[E2E_TEST]部署149A・e2euser_case149_member／_partner（参加者）／_outsider（非参加者）・
//   取引先 テスト商事TODO [E2E_TEST]（QKT）・進行中の案件 QKT-261118-0001）。後始末は e2e/seeds/case-todos-cleanup.sql（識別子だけ。残数 0 を確かめる）。
// 画面の契約は frontend/src/pages/CaseTodos.test.tsx の冒頭と同じ（region「TODO」・textbox「題名」・combobox「担当者」・button「追加する」・
//   button「{題名}を完了にする」・progressbar「{total}項目中{done}項目が完了」）。
// ログインの試行制限に当たらないよう、ログインは利用者ごとに1回だけにする（それぞれ別のブラウザのコンテキスト）。
import { execFile } from "node:child_process";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./console-guard";
import { allowSessionCheck401 } from "./session-console";

const PASSWORD = "TestPass123!";
const CASE_ID = "01JTE2E00000000000V0011149";
const TODO_TITLE = "[E2E_TEST]149見積りを送る";
const PARTNER_NAME = "E2E案件TODOの相手";
/** C-88：同じ案件を開いている他の参加者の画面に、3秒以内に反映する */
const REFLECT_MS = 3_000;

function run(args: readonly string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile(
      process.execPath,
      [...args],
      { cwd: process.cwd(), windowsHide: true },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

const seedFile = (file: "case-todos.sql" | "case-todos-cleanup.sql") =>
  run(["scripts/db-local.ts", "test", "seed-file", `e2e/seeds/${file}`]);

type Signed = { context: BrowserContext; page: Page };

async function signIn(
  browser: Browser,
  baseURL: string | undefined,
  loginId: string,
): Promise<Signed> {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  allowSessionCheck401(page);
  await page.goto("/login");
  await page.getByLabel("ユーザーID", { exact: true }).fill(loginId);
  await page.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  return { context, page };
}

const todoSection = (page: Page) =>
  page.getByRole("main").getByRole("region", { name: "TODO" });
const header = (page: Page) => page.getByRole("main").locator("header");

let member: Signed | undefined;
let partner: Signed | undefined;
let outsider: Signed | undefined;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser, baseURL }) => {
  await seedFile("case-todos-cleanup.sql");
  await seedFile("case-todos.sql");
  member = await signIn(browser, baseURL, "e2euser_case149_member");
  partner = await signIn(browser, baseURL, "e2euser_case149_partner");
  outsider = await signIn(browser, baseURL, "e2euser_case149_outsider");
});

test.afterAll(async () => {
  for (const opened of [member, partner, outsider])
    await opened?.context.close();
  const output = await seedFile("case-todos-cleanup.sql");
  expect(output).toContain("remaining_users");
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
});

test("#149 AC-2 5-4 AC-2・AC-7・1-9 AC-2: 参加者が担当者つきで TODO を追加すると、別の参加者の S-17 に再読み込みなしで（3秒以内に）出る", async () => {
  const a = member as Signed;
  const b = partner as Signed;
  await b.page.goto(`/cases/${CASE_ID}`);
  await expect(todoSection(b.page).getByText("項目なし")).toBeVisible();

  await a.page.goto(`/cases/${CASE_ID}`);
  const section = todoSection(a.page);
  await expect(section.getByText("項目なし")).toBeVisible();
  await section.getByRole("textbox", { name: "題名" }).fill(TODO_TITLE);
  await section
    .getByRole("combobox", { name: "担当者" })
    .selectOption({ label: PARTNER_NAME });
  await section.getByRole("button", { name: "追加する" }).click();
  await expect(section.getByText("TODOを追加しました")).toBeVisible();
  await expect(section.getByRole("textbox", { name: "題名" })).toHaveValue("");
  await expect(section.getByText(TODO_TITLE)).toBeVisible();

  // 別の参加者の画面に、再読み込みなしで出る（ポーリング）
  const other = todoSection(b.page);
  await expect(other.getByText(TODO_TITLE)).toBeVisible({
    timeout: REFLECT_MS,
  });
  await expect(other.getByText("0/1")).toBeVisible();
  await expect(
    other.getByRole("listitem").filter({ hasText: TODO_TITLE }),
  ).toContainText(PARTNER_NAME);
});

test("#149 AC-2 5-4 AC-3・AC-4・AC-7: 別の参加者が完了にすると、追加した人の画面の進捗（区画とヘッダー）が再読み込みなしで「1/1」になる", async () => {
  const a = member as Signed;
  const b = partner as Signed;
  await todoSection(b.page)
    .getByRole("button", { name: `${TODO_TITLE}を完了にする` })
    .click();
  await expect(
    todoSection(b.page)
      .getByRole("listitem")
      .filter({ hasText: TODO_TITLE })
      .getByText("完了", { exact: true }),
  ).toBeVisible();

  const section = todoSection(a.page);
  await expect(
    section.getByRole("progressbar", { name: "1項目中1項目が完了" }),
  ).toBeVisible({ timeout: REFLECT_MS });
  await expect(section.getByText("1/1")).toBeVisible();
  await expect(header(a.page).getByText("1/1")).toBeVisible();
  await expect(
    section.getByRole("button", { name: `${TODO_TITLE}を未完了に戻す` }),
  ).toBeVisible();
});

test("#149 AC-1 R-76: 非参加者の S-17 には TODO が出ず、ヘッダーの進捗（概要）だけが出る", async () => {
  const c = outsider as Signed;
  await c.page.goto(`/cases/${CASE_ID}`);
  await expect(
    c.page.getByText("参加者だけが見られます（非公開）"),
  ).toBeVisible();
  await expect(header(c.page).getByText("1/1")).toBeVisible();
  await expect(c.page.getByRole("region", { name: "TODO" })).toHaveCount(0);
  await expect(c.page.getByText(TODO_TITLE)).toHaveCount(0);
});
