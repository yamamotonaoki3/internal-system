// #149（149-C）5-4 AC-7・AC-10・AC-11・AC-12・AC-13・AC-14、1-9 AC-2（2秒のポーリング。3秒以内＝C-88）、計画 plan-149c 9.9：
// TODO の履歴・削除済みの一覧・復元の主な流れを、画面からバックエンドまで通して確かめる（実ブラウザ・2つのブラウザ）。
// 流れ：member が TODO の担当を partner から担当なしに変えて、完了にする → 「履歴」に担当の変更と完了が出る
//   → member が削除する（確認の本文に復元できる旨）→ 通常の一覧から消え、進捗が変わる
//   → 「削除済みのTODO」を開く → 題名・削除した人が出て、「履歴」に削除が出る
//   → 「復元」→「TODOを復元しました」、通常の一覧に戻り、進捗が戻る。partner の画面にも再読み込みなしで3秒以内に出る。
// 判定の順・認可・同時の操作の網羅は backend の結合・DB・Service のテスト、画面の分岐は frontend/src/pages/CaseTodos.history.test.tsx で確かめ、ここでは重ねない。
// 前提：e2e/seeds/case-todos-history.sql（[E2E_TEST]部署149C・e2euser_case149c_member／_partner・取引先 テスト商事TODO履歴 [E2E_TEST]（QKX）・
//   進行中の案件 QKX-261120-0001・TODO「[E2E_TEST]149C見積りの確認」〔担当 partner〕と「[E2E_TEST]149C請求の準備」）。
//   後始末は e2e/seeds/case-todos-history-cleanup.sql（識別子だけ。残数 0 を確かめる）を、try/finally の中で必ず実行する。
// 監視：どちらのブラウザでも、コンソールのエラー・処理されなかった例外・失敗した要求（4xx・5xx）を記録し、最後に空であることを確かめる
//   （未ログインのセッションの確認の 401 だけを許す。既存の case-todos-edit.spec.ts と同じ見張り）。
// 画面の契約は frontend/src/pages/CaseTodos.history.test.tsx・CaseTodos.edit.test.tsx の冒頭と同じ（button「{題名}の履歴」・
//   region「{題名}の変更履歴」・button「削除済みのTODO」・region「削除済みのTODO」・button「{題名}を復元」・dialog「TODOの編集」・
//   combobox「担当者」・button「保存する」・button「{題名}を完了にする」・button「{題名}を削除」・dialog「TODOの削除」・button「削除する」）。
// 否定の確認は、肯定の確認と同じ定数（題名の全文・exact）で取る。テストデータの題名・名前に、否定の確認に使う語（「削除」「復元」「担当なし」「完了」など）を入れない。
// 切り替わる途中の画面は、前の内容が消えるのを待ってから数を確かめる。ログインは利用者ごとに1回だけにする（それぞれ別のブラウザのコンテキスト）。
import { execFile } from "node:child_process";
import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";
import { expect, test } from "./console-guard";

const PASSWORD = "TestPass123!";
const CASE_ID = "01JTE2E00000000000Z0011149";
const TITLE = "[E2E_TEST]149C見積りの確認";
const OTHER_TITLE = "[E2E_TEST]149C請求の準備";
const MEMBER_NAME = "E2E案件TODO履歴の参加者";
const PARTNER_NAME = "E2E案件TODO履歴の相手";
const DELETE_HINT = "削除したTODOは、削除済みの一覧から復元できます。";
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
  file: "case-todos-history.sql" | "case-todos-history-cleanup.sql",
) => run(["scripts/db-local.ts", "test", "seed-file", `e2e/seeds/${file}`]);

type Watched = { context: BrowserContext; page: Page; problems: string[] };

const SESSION_401 =
  /Failed to load resource: the server responded with a status of 401/;

async function signIn(
  browser: Browser,
  baseURL: string | undefined,
  loginId: string,
): Promise<Watched> {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  const problems: string[] = [];
  await page.setViewportSize({ width: 1280, height: 800 });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (SESSION_401.test(text)) return;
    problems.push(`console: ${text}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${String(error)}`));
  page.on("requestfailed", (request) =>
    problems.push(`requestfailed: ${request.method()} ${request.url()}`),
  );
  page.on("response", (response) => {
    const status = response.status();
    if (status < 400) return;
    const path = new URL(response.url()).pathname;
    if (status === 401 && path === "/api/auth/session") return;
    problems.push(`response: ${status} ${response.request().method()} ${path}`);
  });
  await page.goto("/login");
  await page.getByLabel("ユーザーID", { exact: true }).fill(loginId);
  await page.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  return { context, page, problems };
}

const todoSection = (page: Page) =>
  page.getByRole("main").getByRole("region", { name: "TODO", exact: true });
const deletedRegion = (page: Page) =>
  todoSection(page).getByRole("region", {
    name: "削除済みのTODO",
    exact: true,
  });
const historyOf = (container: Locator, title: string) =>
  container.getByRole("region", { name: `${title}の変更履歴`, exact: true });
/** 名前の前後の空白に依らずに照合する */
const loose = (...parts: string[]) =>
  new RegExp(
    parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s*"),
  );

test.describe.configure({ mode: "serial" });

test("#149 149-C 5-4 AC-7・AC-10・AC-11・AC-12・AC-13・AC-14: 担当の変更と完了が履歴に出て、削除した TODO を削除済みの一覧で確かめて復元すると、通常の一覧と進捗に戻り、別の参加者にも再読み込みなしで出る", async ({
  browser,
  baseURL,
}) => {
  await seedFile("case-todos-history-cleanup.sql");
  await seedFile("case-todos-history.sql");
  const opened: Watched[] = [];
  try {
    const a = await signIn(browser, baseURL, "e2euser_case149c_member");
    opened.push(a);
    const b = await signIn(browser, baseURL, "e2euser_case149c_partner");
    opened.push(b);
    await a.page.goto(`/cases/${CASE_ID}`);
    await b.page.goto(`/cases/${CASE_ID}`);
    const section = todoSection(a.page);
    await expect(section.getByText(TITLE, { exact: true })).toHaveCount(1);
    await expect(section.getByText("0/2")).toBeVisible();
    await expect(
      todoSection(b.page).getByText(TITLE, { exact: true }),
    ).toHaveCount(1);

    // 1. 担当を partner から担当なしに変え、完了にする → 履歴に、担当の変更と完了が出る
    await section.getByRole("button", { name: `${TITLE}を編集` }).click();
    const dialog = a.page.getByRole("dialog", { name: "TODOの編集" });
    await dialog
      .getByRole("combobox", { name: "担当者" })
      .selectOption({ label: "担当なし" });
    await dialog.getByRole("button", { name: "保存する" }).click();
    await expect(dialog).toHaveCount(0);
    await section.getByRole("button", { name: `${TITLE}を完了にする` }).click();
    await expect(section.getByText("1/2")).toBeVisible();
    await section.getByRole("button", { name: `${TITLE}の履歴` }).click();
    const history = historyOf(section, TITLE);
    await expect(history).toBeVisible();
    await expect(history).toContainText(
      loose("担当を", PARTNER_NAME, "から", "担当なしに変更"),
    );
    await expect(
      history.getByRole("listitem").filter({ hasText: "完了" }),
    ).toHaveCount(1);
    await expect(history.getByRole("listitem")).toHaveCount(3);

    // 2. 削除する（確認の本文に、復元できる旨）→ 通常の一覧から消え、進捗が変わる
    await section.getByRole("button", { name: `${TITLE}を削除` }).click();
    const confirm = a.page.getByRole("dialog", { name: "TODOの削除" });
    await expect(confirm).toContainText(`「${TITLE}」を削除します。`);
    await expect(confirm).toContainText(DELETE_HINT);
    await confirm.getByRole("button", { name: "削除する" }).click();
    await expect(section.getByText("TODOを削除しました")).toBeVisible();
    // 削除済みの一覧は閉じたまま（通常の一覧だけが区画にある）。肯定の確認と同じ定数で数える
    await expect(section.getByText(TITLE, { exact: true })).toHaveCount(0);
    await expect(section.getByText("0/1")).toBeVisible();
    await expect(section.getByText(OTHER_TITLE, { exact: true })).toHaveCount(
      1,
    );

    // partner の画面（削除済みの一覧は開いていない）でも、復元の前に、通常の一覧から消え、進捗が変わることを再読み込みなしで確かめる
    const otherAfterDelete = todoSection(b.page);
    await expect(
      otherAfterDelete.getByText(TITLE, { exact: true }),
    ).toHaveCount(0, { timeout: REFLECT_MS });
    await expect(otherAfterDelete.getByText("0/1")).toBeVisible({
      timeout: REFLECT_MS,
    });
    await expect(
      otherAfterDelete.getByText(OTHER_TITLE, { exact: true }),
    ).toHaveCount(1);

    // 3. 「削除済みのTODO」を開く → 題名・削除した人が出て、「履歴」に削除が出る
    await section.getByRole("button", { name: "削除済みのTODO" }).click();
    const deleted = deletedRegion(a.page);
    await expect(deleted.getByText(TITLE, { exact: true })).toHaveCount(1);
    const deletedRow = deleted.getByRole("listitem").filter({ hasText: TITLE });
    await expect(deletedRow).toContainText(loose("削除した人：", MEMBER_NAME));
    await deletedRow.getByRole("button", { name: `${TITLE}の履歴` }).click();
    const deletedHistory = historyOf(deleted, TITLE);
    await expect(deletedHistory.getByRole("listitem")).toHaveCount(4);
    await expect(deletedHistory.getByRole("listitem").last()).toContainText(
      "削除",
    );

    // 4. 復元 →「TODOを復元しました」、通常の一覧に戻り、進捗が戻る。partner の画面にも3秒以内に出る
    await deletedRow.getByRole("button", { name: `${TITLE}を復元` }).click();
    await expect(section.getByText("TODOを復元しました")).toBeVisible();
    await expect(deleted.getByText(TITLE, { exact: true })).toHaveCount(0, {
      timeout: REFLECT_MS,
    });
    await expect(section.getByText(TITLE, { exact: true })).toHaveCount(1);
    await expect(section.getByText("1/2")).toBeVisible();
    const other = todoSection(b.page);
    await expect(other.getByText(TITLE, { exact: true })).toHaveCount(1, {
      timeout: REFLECT_MS,
    });
    await expect(other.getByText("1/2")).toBeVisible({ timeout: REFLECT_MS });

    for (const watched of opened)
      expect(watched.problems, "コンソールのエラー・失敗した要求").toEqual([]);
  } finally {
    for (const watched of opened) await watched.context.close();
    const output = await seedFile("case-todos-history-cleanup.sql");
    expect(output).toContain("remaining_users");
    expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
  }
});
