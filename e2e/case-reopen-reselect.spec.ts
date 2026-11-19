// #150（150-B）5-1 AC-16、3-3 AC-2、画面 S-17：再開のときの参加者の選び直しの主な流れを、画面からバックエンドまで通して確かめる（実ブラウザ3つ）。
// 流れ：外される人 B が終了中の案件の S-17 を開いたままにする → A が「案件を再開」→ B のチェックを外し、C を検索で足す →「確認へ」で
//   「残る人」「追加する人」「外れる人」と共有の文言を確かめ →「再開する」（保存の完了を待つ）
//   → B の画面は、開き直さずに、自動の更新の後に非公開の表示に切り替わる（#308 の仕組み）
//   → C の通知に「参加している案件が再開されました」→ 押すと S-17 で、再開の前の過去のやり取りが見える。
// 判定の順・本文の検証・同時の操作は backend の結合・DB・Service のテスト、ダイアログの分岐は frontend/src/pages/CaseReopenReselect.test.tsx で確かめ、ここでは重ねない。
// 前提：e2e/seeds/case-reopen-reselect.sql（[E2E_TEST]部署150B・e2euser_reopen_a／_b（参加者）・e2euser_reopen_c（非参加）・
//   取引先 テスト商事選び直し [E2E_TEST]（QKR）・終了中の案件 QKR-261119-0001「[E2E_TEST] 再開の選び直し」・過去のやり取り1件）。
//   案件の状態・参加者を変えるため、毎回 seed で作り直す。後始末は e2e/seeds/case-reopen-reselect-cleanup.sql（識別子だけ。残数 0 を確かめる）。
// ログインの試行制限に当たらないよう、ログインは利用者ごとに1回だけにする（それぞれ別のブラウザのコンテキスト）。
// 2人目以降のブラウザ（自分で作ったページ）にも、console-guard と同じ監視を付け、意図した拒否だけを、状態と URL を限定して許す。
import { execFile } from "node:child_process";
import type { Browser, Page } from "@playwright/test";
import { expect, test } from "./console-guard";
import { allowSessionCheck401 } from "./session-console";

const PASSWORD = "TestPass123!";
const CASE_ID = "01JTE2E00000000000W0011150";
const ROOM_ID = "01JTE2E00000000000W0010150";
const CASE_DESCRIPTION = "[E2E_TEST]選び直しの案件の説明";
const PAST_MESSAGE = "[E2E_TEST]再開の前の過去のやり取り";
const NAME_A = "E2E再開する人A";
const NAME_B = "E2E外れる人B";
const NAME_C = "E2E足される人C";
const PRIVATE_TEXT = "参加者だけが見られます（非公開）";
const REOPENED_NOTICE = "参加している案件が再開されました";
const SHARE_TEXT =
  "再開すると、追加した人にも、これまでのメッセージ・TODO・添付が共有されます。外れた人は、この案件の内容を見られなくなります。";
/** 自動の更新（2秒ごと）と概要の取り直しが済むまでの余裕 */
const SWITCH_TIMEOUT_MS = 15_000;

function seedFile(
  file: "case-reopen-reselect.sql" | "case-reopen-reselect-cleanup.sql",
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

type Rejection = { status: number; url: RegExp };

const SESSION_CHECK: Rejection = {
  status: 401,
  url: /\/api\/auth\/session$/,
};
/**
 * 外される人 B に許す拒否：外された後の、この案件の部屋のメッセージ（404。非参加者には部屋の存在を明かさない）と、
 * この案件の TODO・詳細・添付の一覧（403）。ほかはすべて失敗にする（#308 の e2e/case-access-loss.spec.ts と同じ）
 */
const REMOVED_REJECTIONS: Rejection[] = [
  SESSION_CHECK,
  { status: 404, url: new RegExp(`/api/rooms/${ROOM_ID}/messages([?]|$)`) },
  {
    status: 403,
    url: new RegExp(`/api/cases/${CASE_ID}/(todos|detail|attachments)([?]|$)`),
  },
];
const REJECTION_TEXT =
  /Failed to load resource: the server responded with a status of (\d+)/;

/** 自分で作ったページ（console-guard の監視が付かない）に、同じ監視を付ける */
async function newWatchedPage(
  browser: Browser,
  baseURL: string | undefined,
  allowed: readonly Rejection[],
) {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const status = Number(REJECTION_TEXT.exec(m.text())?.[1]);
    const url = m.location().url;
    const intended = allowed.some(
      (rule) => rule.status === status && rule.url.test(url),
    );
    if (!intended) errors.push(`${m.text()} (${url})`);
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

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await seedFile("case-reopen-reselect-cleanup.sql");
  await seedFile("case-reopen-reselect.sql");
});
test.afterAll(async () => {
  const output = await seedFile("case-reopen-reselect-cleanup.sql");
  expect(output).toContain("remaining_users");
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
});

test("#150 5-1 AC-16・3-3 AC-2: A が再開で B を外し C を足すと、B の画面は非公開に切り替わり、C に再開の通知が届いて過去のやり取りが見える", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page, "e2euser_reopen_a");
  const removed = await newWatchedPage(browser, baseURL, REMOVED_REJECTIONS);
  const added = await newWatchedPage(browser, baseURL, [SESSION_CHECK]);
  try {
    // ---- B：終了中の案件を開いたままにする ----
    await login(removed.page, "e2euser_reopen_b");
    await removed.page.goto(`/cases/${CASE_ID}`);
    const removedMain = removed.page.getByRole("main");
    await expect(
      removedMain.getByText(CASE_DESCRIPTION, { exact: true }),
    ).toBeVisible();

    // ---- A：B を外し、C を足して再開する ----
    await page.goto(`/cases/${CASE_ID}`);
    const main = page.getByRole("main");
    await main.getByRole("button", { name: "案件を再開", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "案件の再開" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("checkbox", { name: NAME_A, exact: true }),
    ).toBeDisabled();
    await dialog.getByRole("checkbox", { name: NAME_B, exact: true }).uncheck();
    await dialog
      .getByRole("textbox", { name: "社員の検索", exact: true })
      .fill("足される人");
    await dialog
      .getByRole("button", { name: `${NAME_C}を追加`, exact: true })
      .click();
    await dialog.getByRole("button", { name: "確認へ", exact: true }).click();
    await expect(dialog.getByRole("region", { name: "残る人" })).toContainText(
      NAME_A,
    );
    await expect(
      dialog.getByRole("region", { name: "追加する人" }),
    ).toContainText(NAME_C);
    await expect(
      dialog.getByRole("region", { name: "外れる人" }),
    ).toContainText(NAME_B);
    await expect(dialog.getByText(SHARE_TEXT, { exact: true })).toBeVisible();
    const saved = page.waitForResponse(
      (r) =>
        r.request().method() === "POST" &&
        new URL(r.url()).pathname === `/api/cases/${CASE_ID}/reopen`,
    );
    await dialog.getByRole("button", { name: "再開する", exact: true }).click();
    expect((await saved).status()).toBe(200);
    await expect(dialog).toHaveCount(0);
    await expect(main.getByText("案件を再開しました")).toBeVisible();

    // ---- B：開き直さずに、非公開の表示に切り替わる ----
    await expect(
      removedMain.getByText(PRIVATE_TEXT, { exact: true }),
    ).toBeVisible({ timeout: SWITCH_TIMEOUT_MS });
    await expect(
      removedMain.getByText(CASE_DESCRIPTION, { exact: true }),
    ).toHaveCount(0);
    await expect(removed.page).toHaveURL(new RegExp(`/cases/${CASE_ID}$`));

    // ---- C：再開の通知から開き、過去のやり取りが見える ----
    await login(added.page, "e2euser_reopen_c");
    await added.page
      .getByRole("banner")
      .getByRole("link", { name: /^通知/ })
      .click();
    await expect(added.page).toHaveURL(/\/notifications$/);
    await added.page
      .getByRole("main")
      .getByRole("button", { name: new RegExp(REOPENED_NOTICE) })
      .first()
      .click();
    await expect(added.page).toHaveURL(new RegExp(`/cases/${CASE_ID}$`));
    const addedMain = added.page.getByRole("main");
    await expect(
      addedMain.getByRole("log", { name: "メッセージ一覧" }),
    ).toContainText(PAST_MESSAGE);
    await expect(
      addedMain.getByText(CASE_DESCRIPTION, { exact: true }),
    ).toBeVisible();

    removed.expectNoErrors("外された人 B");
    added.expectNoErrors("足された人 C");
  } finally {
    await removed.context.close();
    await added.context.close();
  }
});
