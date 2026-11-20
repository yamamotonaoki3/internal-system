// #150（150-C）5-1 AC-20・C-122(3)・C-133(3)、画面 S-17：案件の内容の再編集の主な流れを、画面からバックエンドまで通して確かめる（実ブラウザ3つ）。
// 流れ：参加者 A が「内容を編集」で件名・説明・取引先を変え、部署 X を足す（保存の完了を待つ）→ 再読み込みせずに見出しが新しい件名になる
//   → 部署 X のオーナー C のサイドバーに案件が出て、詳細（説明）が見える（自動参加）
//   → 参加していない担当部署のオーナー B は、説明の欄のないダイアログで件名だけを変えられる。
// 判定の順・本文の検証・同時の操作は backend の結合・DB・Service のテスト、ダイアログの分岐は frontend/src/pages/CaseEdit*.test.tsx で確かめ、ここでは重ねない。
// 前提：e2e/seeds/case-edit.sql。後始末は e2e/seeds/case-edit-cleanup.sql（識別子だけ。残数 0 を確かめる）。
// 2人目以降のブラウザにも console-guard と同じ監視を付け、意図した拒否（未ログインのセッション確認の 401）だけを許す。
import { execFile } from "node:child_process";
import type { Browser, Page } from "@playwright/test";
import { expect, test } from "./console-guard";
import { allowSessionCheck401 } from "./session-console";

const PASSWORD = "TestPass123!";
const CASE_ID = "01JTE2E00000000000R0011150";
const NEW_TITLE = "[E2E_TEST] 再編集の後の件名";
const NEW_DESCRIPTION = "[E2E_TEST]再編集の後の説明";
const OWNER_TITLE = "[E2E_TEST] オーナーが直した件名";
const NEW_CLIENT = "テスト商事再編集後 [E2E_TEST]";
const DEPT_X = "[E2E_TEST]部署150CX";

function seedFile(file: "case-edit.sql" | "case-edit-cleanup.sql") {
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

const SESSION_CHECK = { status: 401, url: /\/api\/auth\/session$/ };
const REJECTION_TEXT =
  /Failed to load resource: the server responded with a status of (\d+)/;

async function newWatchedPage(browser: Browser, baseURL: string | undefined) {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const status = Number(REJECTION_TEXT.exec(m.text())?.[1]);
    const url = m.location().url;
    if (!(status === SESSION_CHECK.status && SESSION_CHECK.url.test(url)))
      errors.push(`${m.text()} (${url})`);
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  return {
    context,
    page,
    expectNoErrors: (who: string) =>
      expect(
        errors,
        `${who} のコンソールのエラー・処理されなかった例外`,
      ).toEqual([]),
  };
}

const savedResponse = (page: Page) =>
  page.waitForResponse(
    (r) =>
      r.request().method() === "PATCH" &&
      new URL(r.url()).pathname === `/api/cases/${CASE_ID}`,
  );

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await seedFile("case-edit-cleanup.sql");
  await seedFile("case-edit.sql");
});
test.afterAll(async () => {
  const output = await seedFile("case-edit-cleanup.sql");
  expect(output).toContain("remaining_users");
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
});

test("#150 5-1 AC-20・C-133(3)・C-122(3): A が件名・説明・取引先を変え部署 X を足すと、X のオーナー C が自動で参加し、参加していないオーナー B は件名だけを変えられる", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page, "e2euser_caseedit_a");
  const ownerC = await newWatchedPage(browser, baseURL);
  const ownerB = await newWatchedPage(browser, baseURL);
  try {
    // ---- A：内容を編集する ----
    await page.goto(`/cases/${CASE_ID}`);
    const main = page.getByRole("main");
    await main.getByRole("button", { name: "内容を編集", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "案件の内容の編集" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("textbox", { name: /件名/ }).fill(NEW_TITLE);
    await dialog.getByRole("textbox", { name: /説明/ }).fill(NEW_DESCRIPTION);
    await dialog
      .getByRole("combobox", { name: /取引先/ })
      .selectOption({ label: NEW_CLIENT });
    await dialog
      .getByRole("group", { name: "担当部署" })
      .getByRole("checkbox", { name: DEPT_X, exact: true })
      .check();
    const saved = savedResponse(page);
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    expect((await saved).status()).toBe(200);
    await expect(dialog).toHaveCount(0);
    await expect(main.getByText("案件の内容を保存しました")).toBeVisible();
    // 再読み込みせずに、見出し・説明が新しい値になる
    await expect(main.getByRole("heading", { level: 1 })).toHaveText(NEW_TITLE);
    await expect(
      main.getByText(NEW_DESCRIPTION, { exact: true }),
    ).toBeVisible();

    // ---- C：部署 X のオーナーとして自動で参加し、サイドバーに出て詳細が見える ----
    await login(ownerC.page, "e2euser_caseedit_c");
    const link = ownerC.page
      .getByRole("navigation", { name: "メインメニュー" })
      .getByRole("link", {
        name: new RegExp(`^${NEW_TITLE.replace(/[[\]]/g, "\\$&")}`),
      });
    await expect(link).toBeVisible();
    await link.click();
    await expect(ownerC.page).toHaveURL(new RegExp(`/cases/${CASE_ID}$`));
    await expect(
      ownerC.page.getByRole("main").getByText(NEW_DESCRIPTION, { exact: true }),
    ).toBeVisible();

    // ---- B：参加していない担当部署のオーナー。説明の欄がなく、件名だけを変える ----
    await login(ownerB.page, "e2euser_caseedit_b");
    await ownerB.page.goto(`/cases/${CASE_ID}`);
    const bMain = ownerB.page.getByRole("main");
    await expect(bMain.getByRole("heading", { level: 1 })).toHaveText(
      NEW_TITLE,
    );
    await bMain
      .getByRole("button", { name: "内容を編集", exact: true })
      .click();
    const bDialog = ownerB.page.getByRole("dialog", {
      name: "案件の内容の編集",
    });
    await expect(bDialog.getByRole("textbox", { name: /件名/ })).toHaveValue(
      NEW_TITLE,
    );
    await expect(bDialog.getByRole("textbox", { name: /説明/ })).toHaveCount(0);
    await bDialog.getByRole("textbox", { name: /件名/ }).fill(OWNER_TITLE);
    const bSaved = savedResponse(ownerB.page);
    await bDialog.getByRole("button", { name: "保存", exact: true }).click();
    expect((await bSaved).status()).toBe(200);
    await expect(bDialog).toHaveCount(0);
    await expect(bMain.getByRole("heading", { level: 1 })).toHaveText(
      OWNER_TITLE,
    );
    await expect(
      bMain.getByText("参加者だけが見られます（非公開）"),
    ).toBeVisible();

    ownerC.expectNoErrors("自動で参加したオーナー C");
    ownerB.expectNoErrors("参加していないオーナー B");
  } finally {
    await ownerC.context.close();
    await ownerB.context.close();
  }
});
