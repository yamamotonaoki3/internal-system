// #308 AC-1・AC-3（5-1 AC-2・AC-3）、画面 S-17：案件の画面を開いたまま、ほかの参加者に外された人の画面が、再読み込みなしで、
// 自動の更新（やり取り・TODO の2秒ごとの取り直し）の後に、「参加者だけが見られます（非公開）」に切り替わることを、実ブラウザ2つで確かめる。
// 流れ：外される人 B が S-17 を開いて説明を見る → 外す人 A が「参加者を管理」で B を削除する → B の画面は、開き直さず（reload・移動なし）に非公開の表示になり、説明が消える。
//   A の画面は参加者のまま変わらない（AC-3）。
// 切り替えの網羅（403・404・通信の失敗・再試行・ダイアログ・キャッシュ）は frontend/src/pages/CaseAccessLoss.test.tsx で確かめ、ここでは重ねない。
// 前提：e2e/seeds/case-access-loss.sql（[E2E_TEST]部署308・作成者 e2euser_loss_a・参加者 e2euser_loss_b・取引先 テスト商事外され [E2E_TEST]（QKM）・進行中の案件 QKM-261119-0001）。
//   後始末は e2e/seeds/case-access-loss-cleanup.sql（識別子だけ。残数 0 を確かめる）。
// ログインの試行制限に当たらないよう、ログインは利用者ごとに1回だけにする（2人目は別のブラウザのコンテキスト）。
import { execFile } from "node:child_process";
import type { Browser, Page } from "@playwright/test";
import { expect, test } from "./console-guard";
import { allowSessionCheck401 } from "./session-console";

const PASSWORD = "TestPass123!";
const CASE_ID = "01JTE2E00000000000Q0011308";
const CASE_TITLE = "[E2E_TEST]外された人の画面の案件";
const CASE_DESCRIPTION = "[E2E_TEST]外された人には見えなくなる説明";
const REMOVED_NAME = "E2E外される人B";
const PRIVATE_TEXT = "参加者だけが見られます（非公開）";
/** 自動の更新（2秒ごと）と概要の取り直しが済むまでの余裕 */
const SWITCH_TIMEOUT_MS = 15_000;

function seedFile(
  file: "case-access-loss.sql" | "case-access-loss-cleanup.sql",
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

/**
 * 外される人 B のページ（自分で作ったページには console-guard の監視が付かないため、ここで同じ監視を付ける）。
 * 許すのは、仕様どおりの拒否の応答だけ。コンソールの文言には URL がないので、メッセージの位置（location().url）で応答の URL を確かめ、
 * 状態と URL の組で限定する：
 *   401：ログイン前のセッションの確認
 *   404：外された後の、この案件の部屋のメッセージの取得（非参加者には部屋の存在を明かさない設計。docs/design/messages.md の「見えるか」）。ポーリングは止まるので1回だけ
 *   403：外された後の、この案件の TODO・詳細の取得
 * それ以外のコンソールのエラー・処理されなかった例外は、終了時の照合（expectNoErrors）で失敗にする。
 */
const ROOM_ID = "01JTE2E00000000000Q0010308";
const INTENDED_REJECTIONS: { status: number; url: RegExp }[] = [
  { status: 401, url: /\/api\/auth\/session$/ },
  { status: 404, url: new RegExp(`/api/rooms/${ROOM_ID}/messages([?]|$)`) },
  {
    status: 403,
    url: new RegExp(`/api/cases/${CASE_ID}/(todos|detail)([?]|$)`),
  },
];
const REJECTION_TEXT =
  /Failed to load resource: the server responded with a status of (\d+)/;

async function newPage(browser: Browser, baseURL: string | undefined) {
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  const errors: string[] = [];
  let roomRejections = 0;
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const status = Number(REJECTION_TEXT.exec(m.text())?.[1]);
    const url = m.location().url;
    const intended = INTENDED_REJECTIONS.find(
      (rule) => rule.status === status && rule.url.test(url),
    );
    if (intended === undefined) errors.push(`${m.text()} (${url})`);
    else if (intended.status === 404) roomRejections += 1;
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  return {
    context,
    page,
    expectNoErrors: () => {
      expect(errors, "B のコンソールのエラー・処理されなかった例外").toEqual(
        [],
      );
      // 部屋の取得の拒否でポーリングが止まる（要求が増え続けない）
      expect(roomRejections).toBeLessThanOrEqual(1);
    },
  };
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await seedFile("case-access-loss-cleanup.sql");
  await seedFile("case-access-loss.sql");
});
test.afterAll(async () => {
  const output = await seedFile("case-access-loss-cleanup.sql");
  // 後始末の後の残数がすべて 0 であること
  expect(output).toContain("remaining_users");
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
});

test("#308 AC-1・AC-3 5-1 AC-2・AC-3: 参加者に外された人の画面は、開いたまま（再読み込みなし）で、自動の更新の後に非公開の表示に切り替わり、外した人の画面は変わらない", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page, "e2euser_loss_a");
  const removed = await newPage(browser, baseURL);
  try {
    await login(removed.page, "e2euser_loss_b");
    await removed.page.goto(`/cases/${CASE_ID}`);
    const removedMain = removed.page.getByRole("main");
    await expect(
      removedMain.getByText(CASE_DESCRIPTION, { exact: true }),
    ).toBeVisible();
    await expect(
      removedMain.getByRole("heading", { name: "やり取り" }),
    ).toBeVisible();

    // 外す人が、B を参加者から削除する
    await page.goto(`/cases/${CASE_ID}`);
    const main = page.getByRole("main");
    await expect(
      main.getByRole("heading", { level: 1, name: CASE_TITLE }),
    ).toBeVisible();
    await main
      .getByRole("button", { name: "参加者を管理", exact: true })
      .click();
    const manager = page.getByRole("dialog", { name: "参加者を管理" });
    await manager
      .getByRole("button", { name: `${REMOVED_NAME}を削除`, exact: true })
      .click();
    const confirm = page.getByRole("dialog", { name: "参加者の削除" });
    await confirm
      .getByRole("button", { name: "削除する", exact: true })
      .click();
    await expect(
      manager.getByRole("listitem").filter({ hasText: REMOVED_NAME }),
    ).toHaveCount(0);

    // 外された人の画面：再読み込み・移動をしないまま、非公開の表示に切り替わり、説明・やり取りが消える
    // 切り替えの途中は、TODO・やり取りの区画がそれぞれ拒否の文言を出すため、同じ文言が一時的に2つ出る（正しい途中の状態）。
    // 先に説明が消える（切り替わった）のを待ち、その後に、非公開の文言が最終的にちょうど1つ（概要の側だけ）になることを確かめる
    await expect(
      removedMain.getByText(CASE_DESCRIPTION, { exact: true }),
    ).toHaveCount(0, { timeout: SWITCH_TIMEOUT_MS });
    await expect(
      removedMain.getByText(PRIVATE_TEXT, { exact: true }),
    ).toHaveCount(1, { timeout: SWITCH_TIMEOUT_MS });
    await expect(
      removedMain.getByRole("heading", { name: "やり取り" }),
    ).toHaveCount(0);
    await expect(removed.page).toHaveURL(new RegExp(`/cases/${CASE_ID}$`));

    // 外した人の画面は、参加者のまま変わらない
    await expect(
      main.getByText(CASE_DESCRIPTION, { exact: true }),
    ).toBeVisible();
    await expect(main.getByText(PRIVATE_TEXT, { exact: true })).toHaveCount(0);
    removed.expectNoErrors();
  } finally {
    await removed.context.close();
  }
});
