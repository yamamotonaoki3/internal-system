// #148（148-B-1）5-2 AC-7（参加者の部分）・C-62・C-184(4)、画面 S-17：案件の添付の一覧の主な流れを、画面からバックエンドまで通して確かめる（実ブラウザ）。
// 流れ：参加者 member が進行中の案件の S-17 の「やり取り」で添付つきで投稿し、スレッド（?thread=）で添付つきで返信する
//   → 「添付ファイル」の区画に2件出る → 返信の行の「元のメッセージへ」で、親のスレッドが開き、返信が見える → ほかの参加者 partner の S-17 にも2件出て、取得できる
//   → 非参加者 outsider には「添付ファイル」の区画が出ない。
// 判定の順・認可・同時の操作の網羅は backend の結合・DB・Service のテスト、画面の分岐は frontend/src/pages/CaseDetailPage.attachments.test.tsx で確かめ、ここでは重ねない。
// 前提：e2e/seeds/case-attachments.sql（[E2E_TEST]部署148B・e2euser_case148b_member／_partner（参加者）／_outsider（非参加者）・
//   取引先 テスト商事添付一覧 [E2E_TEST]（QKN）・進行中の案件 QKN-261119-0001）。添付はシードで入れず、画面からアップロードする。
//   後始末は、手元の R2 の実体（removeStoredObjects）→ e2e/seeds/case-attachments-cleanup.sql（識別子だけ。残数 0 を確かめる）。
//   この E2E の利用者は、ほかの spec と共有しない。E2E は同時に1つだけ動かす。
// ログインの試行制限に当たらないよう、ログインは利用者ごとに1回だけにする（それぞれ別のブラウザのコンテキスト）。
import { execFile } from "node:child_process";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./console-guard";
import { allowSessionCheck401 } from "./session-console";

const PASSWORD = "TestPass123!";
const CASE_ID = "01JTE2E00000000000V0011481";
const POST_TEXT = "[E2E_TEST]148B添付一覧の投稿";
const REPLY_TEXT = "[E2E_TEST]148B添付一覧の返信";
const POST_FILE = "e2e148b投稿メモ.txt";
const REPLY_FILE = "e2e148b返信メモ.txt";
const POST_MEMO = Buffer.from("[E2E_TEST]148B post memo", "utf8");
const REPLY_MEMO = Buffer.from("[E2E_TEST]148B reply memo", "utf8");

const STATE = ".wrangler/state/test";
const BUCKET = "internal-system-attachments";
const WRANGLER = "node_modules/wrangler/bin/wrangler.js";

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
  file: "case-attachments.sql" | "case-attachments-cleanup.sql",
) => run(["scripts/db-local.ts", "test", "seed-file", `e2e/seeds/${file}`]);

/**
 * この E2E の案件の部屋・利用者の添付の実体を、手元の R2（.wrangler/state/test）から消す（行を消す SQL の後始末より前に呼ぶ。
 * e2e/cases-conversation.spec.ts と同じやり方）。本物のバケットには接続しない。
 */
async function removeStoredObjects() {
  const output = await run([
    WRANGLER,
    "d1",
    "execute",
    "DB",
    "--local",
    "--persist-to",
    STATE,
    "--json",
    "--command",
    "SELECT storage_key FROM message_attachments WHERE room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKN-*') OR uploader_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_case148b!_%' ESCAPE '!')",
  ]);
  const parsed = JSON.parse(output) as {
    results: { storage_key: string }[];
  }[];
  for (const row of parsed.flatMap((entry) => entry.results))
    await run([
      WRANGLER,
      "r2",
      "object",
      "delete",
      `${BUCKET}/${row.storage_key}`,
      "--local",
      "--persist-to",
      STATE,
    ]);
}

/** R2 の実体 → SQL の順に後始末する */
async function cleanup() {
  await removeStoredObjects();
  return seedFile("case-attachments-cleanup.sql");
}

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

const attachmentsRegion = (page: Page) =>
  page.getByRole("main").getByRole("region", { name: "添付ファイル" });
const attachmentRow = (page: Page, fileName: string) =>
  attachmentsRegion(page).getByRole("listitem").filter({ hasText: fileName });
const conversation = (page: Page) =>
  page.getByRole("main").getByRole("heading", { level: 2, name: "やり取り" });
const roomLog = (page: Page) =>
  page.getByRole("log", { name: "メッセージ一覧" });
const rowWith = (page: Page, text: string) =>
  roomLog(page).getByRole("listitem").filter({ hasText: text });
const pane = (page: Page) => page.getByRole("region", { name: "スレッド" });

let member: Signed | undefined;
let partner: Signed | undefined;
let outsider: Signed | undefined;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser, baseURL }) => {
  await cleanup();
  await seedFile("case-attachments.sql");
  member = await signIn(browser, baseURL, "e2euser_case148b_member");
  partner = await signIn(browser, baseURL, "e2euser_case148b_partner");
  outsider = await signIn(browser, baseURL, "e2euser_case148b_outsider");
});

test.afterAll(async () => {
  for (const opened of [member, partner, outsider])
    await opened?.context.close();
  const output = await cleanup();
  expect(output).toContain("remaining_users");
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
});

test("#148 AC-7: 参加者が S-17 で添付つきで投稿・返信すると、「添付ファイル」の区画に2件出る", async () => {
  const a = member as Signed;
  await a.page.goto(`/cases/${CASE_ID}`);
  await expect(conversation(a.page)).toBeVisible();
  await expect(attachmentsRegion(a.page)).toBeVisible();
  await expect(
    attachmentsRegion(a.page).getByText("添付ファイルはありません"),
  ).toBeVisible();

  // 部屋への投稿（添付つき）
  await a.page.getByLabel("ファイルを添付").first().setInputFiles({
    name: POST_FILE,
    mimeType: "text/plain",
    buffer: POST_MEMO,
  });
  await expect(
    a.page.getByRole("list", { name: "送信前の添付" }).getByRole("listitem"),
  ).toHaveCount(1);
  await a.page.getByRole("textbox", { name: "メッセージ" }).fill(POST_TEXT);
  await a.page.getByRole("button", { name: "送信", exact: true }).click();
  await expect(rowWith(a.page, POST_TEXT)).toBeVisible();
  // 保存の完了を待つ（投稿の行に添付のリンクが出る）
  await expect(
    rowWith(a.page, POST_TEXT).getByRole("link", { name: POST_FILE }),
  ).toBeVisible();

  // スレッドで返信（添付つき）
  await rowWith(a.page, POST_TEXT)
    .getByRole("button", { name: /返信/ })
    .click();
  await expect(a.page).toHaveURL(
    new RegExp(`/cases/${CASE_ID}\\?thread=[0-9A-HJKMNP-TV-Z]{26}$`),
  );
  await pane(a.page).getByLabel("ファイルを添付").setInputFiles({
    name: REPLY_FILE,
    mimeType: "text/plain",
    buffer: REPLY_MEMO,
  });
  await pane(a.page).getByRole("textbox", { name: "返信" }).fill(REPLY_TEXT);
  await pane(a.page).getByRole("button", { name: "送信", exact: true }).click();
  await expect(
    pane(a.page).getByRole("log", { name: "返信一覧" }),
  ).toContainText(REPLY_TEXT);
  // 返信の保存の完了を待つ（入力欄が空になり、親の行が「返信 1 件」になる）
  await expect(pane(a.page).getByRole("textbox", { name: "返信" })).toHaveValue(
    "",
  );
  await expect(
    rowWith(a.page, POST_TEXT).getByRole("button", { name: /^返信 1 件/ }),
  ).toBeVisible();

  // 自分の添付つきの投稿・返信の成功で、一覧が取り直される
  await expect(attachmentRow(a.page, POST_FILE)).toBeVisible();
  await expect(attachmentRow(a.page, REPLY_FILE)).toBeVisible();
  await expect(attachmentsRegion(a.page).getByRole("listitem")).toHaveCount(2);
});

test("#148 AC-7 C-184(4): 返信の添付の「元のメッセージへ」で、親のスレッドが開き、その返信が見える", async () => {
  const a = member as Signed;
  // スレッドを閉じた状態から始める（開き直す）
  await a.page.goto(`/cases/${CASE_ID}`);
  await expect(attachmentRow(a.page, REPLY_FILE)).toBeVisible();
  await expect(pane(a.page)).toHaveCount(0);
  await attachmentRow(a.page, REPLY_FILE).getByText("元のメッセージへ").click();
  await expect(a.page).toHaveURL(
    new RegExp(`/cases/${CASE_ID}\\?thread=[0-9A-HJKMNP-TV-Z]{26}$`),
  );
  await expect(
    pane(a.page).getByRole("log", { name: "返信一覧" }),
  ).toContainText(REPLY_TEXT);
});

test("#148 AC-7 C-62: ほかの参加者の S-17 にも2件出て、一覧のリンクからファイルを取得できる", async () => {
  const b = partner as Signed;
  await b.page.goto(`/cases/${CASE_ID}`);
  await expect(attachmentRow(b.page, POST_FILE)).toBeVisible();
  await expect(attachmentRow(b.page, REPLY_FILE)).toBeVisible();
  const link = attachmentRow(b.page, REPLY_FILE).getByRole("link", {
    name: REPLY_FILE,
  });
  const href = (await link.getAttribute("href")) ?? "";
  expect(href).toMatch(/\/api\/attachments\/[0-9A-HJKMNP-TV-Z]{26}$/);
  const res = await b.page.request.get(href);
  expect(res.status()).toBe(200);
  expect(Buffer.compare(await res.body(), REPLY_MEMO)).toBe(0);
});

test("#148 AC-7 R-62: 非参加者には「添付ファイル」の区画が出ず、ファイル名も出ない", async () => {
  const c = outsider as Signed;
  await c.page.goto(`/cases/${CASE_ID}`);
  await expect(
    c.page.getByText("参加者だけが見られます（非公開）"),
  ).toBeVisible();
  await expect(attachmentsRegion(c.page)).toHaveCount(0);
  await expect(c.page.getByText(POST_FILE)).toHaveCount(0);
  await expect(c.page.getByText(REPLY_FILE)).toHaveCount(0);
});
