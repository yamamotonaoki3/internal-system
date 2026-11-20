// #149（149-D）5-4 AC-6（担当者が外れたとき）、1-9 AC-2（2秒のポーリング。3秒以内＝C-88）、計画 10節「E2E」：
// member が、TODO の担当の partner を参加者から外す → member の画面の TODO に、再読み込みなしで「担当なし（以前の担当：partner の名前）」が出る。
// 書き換えの規則・件数・取り消し・やり直しは backend の DB・Service のテストで確かめ、ここでは重ねない。
// 前提：e2e/seeds/case-todos-unassign.sql（e2euser_case149d_member／_partner・取引先コード QKW・進行中の案件 QKW-261120-0001・
//   TODO「[E2E_TEST]149D見積り」〔担当 partner〕）。TODO はシードで入れる（作成の画面は 149-A の E2E で確かめ済み）。
//   後始末は e2e/seeds/case-todos-unassign-cleanup.sql（識別子だけ。残数 0 を確かめる）を、try/finally の中で必ず実行する。
// 監視：コンソールのエラー・処理されなかった例外・失敗した要求（4xx・5xx）を記録し、最後に空であることを確かめる（未ログインのセッションの確認の 401 は許す）。
// 画面の契約は e2e/case-participants.spec.ts と同じ（button「参加者を管理」・dialog「参加者を管理」・button「{名前}を削除」・dialog「参加者の削除」・button「削除する」）。
import { execFile } from "node:child_process";
import type { Page } from "@playwright/test";
import { expect, test } from "./console-guard";

const PASSWORD = "TestPass123!";
const CASE_ID = "01JTE2E00000000000Y0011149";
const TODO_TITLE = "[E2E_TEST]149D見積り";
const PARTNER_NAME = "E2E案件TODO外しの相手";
/** C-88：3秒以内に反映する */
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
  file: "case-todos-unassign.sql" | "case-todos-unassign-cleanup.sql",
) => run(["scripts/db-local.ts", "test", "seed-file", `e2e/seeds/${file}`]);

const todoSection = (page: Page) =>
  page.getByRole("main").getByRole("region", { name: "TODO" });

test("#149 149-D 5-4 AC-6: 担当者を参加者から外すと、外した人の画面の TODO が再読み込みなしで「担当なし（以前の担当：名前）」になる", async ({
  page,
}) => {
  await seedFile("case-todos-unassign-cleanup.sql");
  await seedFile("case-todos-unassign.sql");
  const problems: string[] = [];
  try {
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      if (/status of 401/.test(message.text())) return;
      problems.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) =>
      problems.push(`pageerror: ${String(error)}`),
    );
    page.on("response", (response) => {
      if (response.status() < 400) return;
      const path = new URL(response.url()).pathname;
      if (response.status() === 401 && path === "/api/auth/session") return;
      problems.push(`response: ${response.status()} ${path}`);
    });
    await page.goto("/login");
    await page
      .getByLabel("ユーザーID", { exact: true })
      .fill("e2euser_case149d_member");
    await page.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "ログイン", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);

    await page.goto(`/cases/${CASE_ID}`);
    const item = todoSection(page)
      .getByRole("listitem")
      .filter({ hasText: TODO_TITLE });
    await expect(item).toContainText(`担当：${PARTNER_NAME}`);
    await expect(item.getByText("担当なし")).toHaveCount(0);

    const main = page.getByRole("main");
    await main
      .getByRole("button", { name: "参加者を管理", exact: true })
      .click();
    const manager = page.getByRole("dialog", { name: "参加者を管理" });
    await manager
      .getByRole("button", { name: `${PARTNER_NAME}を削除`, exact: true })
      .click();
    const confirm = page.getByRole("dialog", { name: "参加者の削除" });
    await confirm
      .getByRole("button", { name: "削除する", exact: true })
      .click();
    await expect(
      manager.getByRole("listitem").filter({ hasText: PARTNER_NAME }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");

    // 再読み込みせずに、TODO の担当の表示が変わる（前の表示が消えるのを待ってから確かめる）
    await expect(item).not.toContainText(`担当：${PARTNER_NAME}`, {
      timeout: REFLECT_MS,
    });
    await expect(item).toContainText(
      `担当：担当なし（以前の担当：${PARTNER_NAME}）`,
    );
    expect(problems, "コンソールのエラー・失敗した要求").toEqual([]);
  } finally {
    const output = await seedFile("case-todos-unassign-cleanup.sql");
    expect(output).toContain("remaining_users");
    expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
  }
});
