// #149（149-B）5-4 AC-7・AC-8・AC-12、1-9 AC-2（2秒のポーリング。3秒以内＝C-88）、計画 10節「E2E」：TODO の編集・削除の主な流れを、
// 画面からバックエンドまで通して確かめる（実ブラウザ・2つのブラウザ）。
// 流れ：member が題名を変える → partner の画面に再読み込みなしで出る
//   → partner が編集のダイアログを開いて入力したまま、member が題名をもう一度変える → partner が保存すると 409 の文言が出て、partner の入力が残る
//   → member が TODO を消す → 両方の一覧と進捗から消える。
// 判定の順・認可・同時の操作の網羅は backend の結合・DB・Service のテスト、画面の分岐は frontend/src/pages/CaseTodos.edit.test.tsx で確かめ、ここでは重ねない。
// 前提：e2e/seeds/case-todos-edit.sql（[E2E_TEST]部署149B・e2euser_case149b_member／_partner・取引先 テスト商事TODO編集 [E2E_TEST]（QKV）・
//   進行中の案件 QKV-261120-0001・TODO「[E2E_TEST]149B見積り」）。後始末は e2e/seeds/case-todos-edit-cleanup.sql（識別子だけ。残数 0 を確かめる）を、
//   try/finally の中で必ず実行する。
// 監視：どちらのブラウザでも、コンソールのエラー・処理されなかった例外・失敗した要求（4xx・5xx）を記録し、最後に空であることを確かめる。
//   意図した拒否は、partner の「古い版での保存」の PATCH（この TODO の URL）の 409 だけを、その操作の間に限って許す。未ログインのセッションの確認の 401 も許す。
// 画面の契約は frontend/src/pages/CaseTodos.edit.test.tsx の冒頭と同じ（button「{題名}を編集」「{題名}を削除」・dialog「TODOの編集」・textbox「題名」・
//   button「保存する」・dialog「TODOの削除」・button「削除する」）。
// テストデータの題名・名前に、否定の確認に使う語（「削除」「担当なし」「更新」など）を入れない。切り替わる途中の画面は、前の内容が消えるのを待ってから数を確かめる。
// ログインの試行制限に当たらないよう、ログインは利用者ごとに1回だけにする（それぞれ別のブラウザのコンテキスト）。
import { execFile } from "node:child_process";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./console-guard";

const PASSWORD = "TestPass123!";
const CASE_ID = "01JTE2E00000000000X0011149";
const TODO_ID = "01JTE2E00000000000X0020149";
const TODO_PATH = `/api/cases/${CASE_ID}/todos/${TODO_ID}`;
const ORIGINAL = "[E2E_TEST]149B見積り";
const FIRST_TITLE = "[E2E_TEST]149B見積りの改題一";
const SECOND_TITLE = "[E2E_TEST]149B見積りの改題二";
const PARTNER_INPUT = "[E2E_TEST]149B相手の入力";
const CHANGED_MESSAGE =
  "ほかの人が変更しました。最新の内容を確かめてから、もう一度操作してください";
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

const seedFile = (
  file: "case-todos-edit.sql" | "case-todos-edit-cleanup.sql",
) => run(["scripts/db-local.ts", "test", "seed-file", `e2e/seeds/${file}`]);

type Watched = {
  context: BrowserContext;
  page: Page;
  problems: string[];
  /** true の間だけ、この TODO の PATCH の 409 を許す */
  allowConflict: { on: boolean };
};

const SESSION_401 =
  /Failed to load resource: the server responded with a status of 401/;
const RESOURCE_409 =
  /Failed to load resource: the server responded with a status of 409/;

async function signIn(
  browser: Browser,
  baseURL: string | undefined,
  loginId: string,
): Promise<Watched> {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  const problems: string[] = [];
  const allowConflict = { on: false };
  await page.setViewportSize({ width: 1280, height: 800 });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (SESSION_401.test(text)) return;
    if (
      allowConflict.on &&
      RESOURCE_409.test(text) &&
      new URL(message.location().url || "http://x/").pathname === TODO_PATH
    )
      return;
    problems.push(`console: ${text}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${String(error)}`));
  page.on("requestfailed", (request) =>
    problems.push(`requestfailed: ${request.method()} ${request.url()}`),
  );
  page.on("response", (response) => {
    const status = response.status();
    if (status < 400) return;
    const request = response.request();
    const path = new URL(response.url()).pathname;
    if (status === 401 && path === "/api/auth/session") return;
    if (
      allowConflict.on &&
      status === 409 &&
      request.method() === "PATCH" &&
      path === TODO_PATH
    )
      return;
    problems.push(`response: ${status} ${request.method()} ${path}`);
  });
  await page.goto("/login");
  await page.getByLabel("ユーザーID", { exact: true }).fill(loginId);
  await page.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  return { context, page, problems, allowConflict };
}

const todoSection = (page: Page) =>
  page.getByRole("main").getByRole("region", { name: "TODO" });
const header = (page: Page) => page.getByRole("main").locator("header");
const editDialog = (page: Page) =>
  page.getByRole("dialog", { name: "TODOの編集" });

async function retitle(page: Page, from: string, to: string) {
  await todoSection(page)
    .getByRole("button", { name: `${from}を編集` })
    .click();
  const dialog = editDialog(page);
  await dialog.getByRole("textbox", { name: "題名" }).fill(to);
  await dialog.getByRole("button", { name: "保存する" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(todoSection(page).getByText("TODOを更新しました")).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("#149 AC-1・AC-2 149-B 5-4 AC-7・AC-8・AC-12: 題名の変更が別の参加者に再読み込みなしで出て、古い版での保存は 409 で入力が残り、消した TODO は両方の一覧と進捗から消える", async ({
  browser,
  baseURL,
}) => {
  await seedFile("case-todos-edit-cleanup.sql");
  await seedFile("case-todos-edit.sql");
  const opened: Watched[] = [];
  try {
    const a = await signIn(browser, baseURL, "e2euser_case149b_member");
    opened.push(a);
    const b = await signIn(browser, baseURL, "e2euser_case149b_partner");
    opened.push(b);

    await a.page.goto(`/cases/${CASE_ID}`);
    await b.page.goto(`/cases/${CASE_ID}`);
    await expect(todoSection(a.page).getByText(ORIGINAL)).toBeVisible();
    await expect(todoSection(b.page).getByText(ORIGINAL)).toBeVisible();
    await expect(todoSection(b.page).getByText("0/1")).toBeVisible();

    // 1. member が題名を変える → partner の画面に、再読み込みなしで（3秒以内に）出る
    await retitle(a.page, ORIGINAL, FIRST_TITLE);
    const other = todoSection(b.page);
    await expect(other.getByText(ORIGINAL, { exact: true })).toHaveCount(0, {
      timeout: REFLECT_MS,
    });
    await expect(other.getByText(FIRST_TITLE, { exact: true })).toHaveCount(1);

    // 2. partner が編集のダイアログを開いて入力したまま、member が題名をもう一度変える
    await other.getByRole("button", { name: `${FIRST_TITLE}を編集` }).click();
    const dialog = editDialog(b.page);
    await dialog.getByRole("textbox", { name: "題名" }).fill(PARTNER_INPUT);
    await retitle(a.page, FIRST_TITLE, SECOND_TITLE);

    // 3. partner が古い版で保存する → 409 の文言が出て、partner の入力が残る（この PATCH の 409 だけを許す）
    b.allowConflict.on = true;
    const conflict = b.page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        new URL(response.url()).pathname === TODO_PATH,
    );
    await dialog.getByRole("button", { name: "保存する" }).click();
    expect((await conflict).status()).toBe(409);
    await expect(dialog.getByRole("alert")).toContainText(CHANGED_MESSAGE);
    await expect(dialog.getByRole("textbox", { name: "題名" })).toHaveValue(
      PARTNER_INPUT,
    );
    await expect(dialog.getByText(`最新の内容：${SECOND_TITLE}`)).toBeVisible();
    b.allowConflict.on = false;
    await dialog.getByRole("button", { name: "キャンセル" }).click();
    await expect(dialog).toHaveCount(0);

    // 4. member が TODO を消す → 両方の一覧と進捗（区画とヘッダー）から消える
    await todoSection(a.page)
      .getByRole("button", { name: `${SECOND_TITLE}を削除` })
      .click();
    const confirm = a.page.getByRole("dialog", { name: "TODOの削除" });
    await expect(confirm).toContainText(`「${SECOND_TITLE}」を削除します。`);
    await confirm.getByRole("button", { name: "削除する" }).click();
    await expect(
      todoSection(a.page).getByText("TODOを削除しました"),
    ).toBeVisible();
    for (const page of [a.page, b.page]) {
      await expect(
        todoSection(page).getByText(SECOND_TITLE, { exact: true }),
      ).toHaveCount(0, { timeout: REFLECT_MS });
      await expect(todoSection(page).getByText("項目なし")).toHaveCount(1);
      await expect(header(page).getByText("0/1")).toHaveCount(0);
    }

    for (const watched of opened)
      expect(watched.problems, "コンソールのエラー・失敗した要求").toEqual([]);
  } finally {
    for (const watched of opened) await watched.context.close();
    const output = await seedFile("case-todos-edit-cleanup.sql");
    expect(output).toContain("remaining_users");
    expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
  }
});
