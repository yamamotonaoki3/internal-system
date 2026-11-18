// #148（148-A）5-2 AC-1・AC-2・AC-4・5-1 AC-11、画面 S-17：案件のやり取りの主な流れを、画面からバックエンドまで通して確かめる（実ブラウザ）。
// 流れ：参加者 member が進行中の案件の S-17 の「やり取り」で、添付つきで投稿 → 別のブラウザの参加者 partner の S-17 に、再読み込みなしで出る（ポーリング）
//   → partner がスレッド（S-07。?thread=）を開いて返信し、リアクションを付ける → member の画面に返信の件数・リアクションが出る。
//   終了の案件（シードで closed）では、入力欄がなく、帯「終了した案件・アーカイブ（読み取り専用）」が出て、過去のやり取りは読める。
//   非参加者 outsider は「参加者だけが見られます（非公開）」で、やり取りが出ない。
// 判定の順・認可・同時の操作の網羅は backend の結合・DB・Service のテスト、画面の分岐は frontend/src/pages/CaseDetailPage.conversation.test.tsx で確かめ、
// ここでは重ねない（終了の案件の添付の取得は backend の routes/messages.case-room.test.ts。シードで R2 の実体を入れられないため）。
// 前提：e2e/seeds/cases-conversation.sql（[E2E_TEST]部署148A・e2euser_case148_member／_partner（両方の案件の参加者）／_outsider（非参加者）・
//   取引先 テスト商事やり取り [E2E_TEST]（QKJ）・進行中の案件 QKJ-261118-0001・終了の案件 QKJ-261118-0002）。
//   後始末は e2e/seeds/cases-conversation-cleanup.sql（識別子だけ。残数 0 を確かめる）。この E2E の利用者は、ほかの spec と共有しない。
// ログインの試行制限に当たらないよう、ログインは利用者ごとに1回だけにする（それぞれ別のブラウザのコンテキスト）。
import { execFile } from "node:child_process";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./console-guard";
import { allowSessionCheck401 } from "./session-console";

const PASSWORD = "TestPass123!";
const OPEN_CASE_ID = "01JTE2E00000000000V0011148";
const CLOSED_CASE_ID = "01JTE2E00000000000V0021148";
const POST_TEXT = "[E2E_TEST]148案件のやり取りの投稿";
const REPLY_TEXT = "[E2E_TEST]148案件のやり取りの返信";
const CLOSED_TEXT = "[E2E_TEST]終了した案件の過去のやり取り";
const CLOSED_BANNER = "終了した案件・アーカイブ（読み取り専用）";
const MEMO = Buffer.from("[E2E_TEST]148 memo", "utf8");

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
  file: "cases-conversation.sql" | "cases-conversation-cleanup.sql",
) => run(["scripts/db-local.ts", "test", "seed-file", `e2e/seeds/${file}`]);

/**
 * この E2E の案件の部屋・利用者の添付の実体を、手元の R2（.wrangler/state/test）から消す（行を消す SQL の後始末より前に呼ぶ。e2e/attachments.spec.ts と同じやり方）。
 * 本物のバケットには接続しない。
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
    "SELECT storage_key FROM message_attachments WHERE room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKJ-*') OR uploader_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_case148!_%' ESCAPE '!')",
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
  return seedFile("cases-conversation-cleanup.sql");
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
  await seedFile("cases-conversation.sql");
  member = await signIn(browser, baseURL, "e2euser_case148_member");
  partner = await signIn(browser, baseURL, "e2euser_case148_partner");
  outsider = await signIn(browser, baseURL, "e2euser_case148_outsider");
});

test.afterAll(async () => {
  for (const opened of [member, partner, outsider])
    await opened?.context.close();
  const output = await cleanup();
  expect(output).toContain("remaining_users");
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
});

test("#148 5-2 AC-1・AC-2・AC-4: 参加者が S-17 で添付つきで投稿すると、別の参加者の S-17 に再読み込みなしで出て、添付を取得できる", async () => {
  const a = member as Signed;
  const b = partner as Signed;
  await b.page.goto(`/cases/${OPEN_CASE_ID}`);
  await expect(conversation(b.page)).toBeVisible();
  await expect(b.page.getByText("まだやり取りがありません")).toBeVisible();

  await a.page.goto(`/cases/${OPEN_CASE_ID}`);
  await expect(conversation(a.page)).toBeVisible();
  await a.page.getByLabel("ファイルを添付").first().setInputFiles({
    name: "e2e148メモ.txt",
    mimeType: "text/plain",
    buffer: MEMO,
  });
  await expect(
    a.page.getByRole("list", { name: "送信前の添付" }).getByRole("listitem"),
  ).toHaveCount(1);
  await a.page.getByRole("textbox", { name: "メッセージ" }).fill(POST_TEXT);
  await a.page.getByRole("button", { name: "送信", exact: true }).click();
  await expect(rowWith(a.page, POST_TEXT)).toBeVisible();

  // 別の参加者の画面に、再読み込みなしで出る（ポーリング）
  const row = rowWith(b.page, POST_TEXT);
  await expect(row).toBeVisible();
  const link = row.getByRole("link", { name: /e2e148メモ\.txt/ });
  await expect(link).toBeVisible();
  const href = (await link.getAttribute("href")) ?? "";
  const res = await b.page.request.get(href);
  expect(res.status()).toBe(200);
  expect(Buffer.compare(await res.body(), MEMO)).toBe(0);
});

test("#148 5-2 AC-1・AC-4: 別の参加者がスレッド（?thread=）で返信し、リアクションを付けると、投稿した人の画面に出る", async () => {
  const a = member as Signed;
  const b = partner as Signed;
  await rowWith(b.page, POST_TEXT)
    .getByRole("button", { name: /返信/ })
    .click();
  await expect(b.page).toHaveURL(
    new RegExp(`/cases/${OPEN_CASE_ID}\\?thread=[0-9A-HJKMNP-TV-Z]{26}$`),
  );
  await pane(b.page).getByRole("textbox", { name: "返信" }).fill(REPLY_TEXT);
  await pane(b.page).getByRole("button", { name: "送信", exact: true }).click();
  await expect(
    pane(b.page).getByRole("log", { name: "返信一覧" }),
  ).toContainText(REPLY_TEXT);

  const row = rowWith(b.page, POST_TEXT);
  await row.getByRole("button", { name: /^リアクションを付ける/ }).click();
  const picker = b.page.getByRole("dialog", { name: "リアクションを選ぶ" });
  await expect(picker).toBeVisible();
  await picker
    .getByRole("grid")
    .getByRole("button")
    .filter({ hasText: "👍" })
    .first()
    .click();
  await expect(picker).toHaveCount(0);

  // 投稿した人の画面（再読み込みなし）に、返信の件数とリアクションが出る
  await expect(
    rowWith(a.page, POST_TEXT).getByRole("button", { name: /^返信 1 件/ }),
  ).toBeVisible();
  await expect(
    rowWith(a.page, POST_TEXT)
      .getByRole("button", { pressed: false })
      .filter({ hasText: "👍" }),
  ).toBeVisible();
});

test("#148 5-1 AC-11: 終了した案件の S-17 では、入力欄がなく、読み取り専用の帯が出て、過去のやり取りは読める", async () => {
  const a = member as Signed;
  await a.page.goto(`/cases/${CLOSED_CASE_ID}`);
  await expect(conversation(a.page)).toBeVisible();
  await expect(a.page.getByText(CLOSED_BANNER)).toBeVisible();
  await expect(rowWith(a.page, CLOSED_TEXT)).toBeVisible();
  await expect(a.page.getByRole("textbox", { name: "メッセージ" })).toHaveCount(
    0,
  );
  await expect(a.page.getByLabel("ファイルを添付")).toHaveCount(0);
});

test("#148 5-2 AC-3・AC-6: 非参加者には「参加者だけが見られます（非公開）」が出て、やり取りが出ない", async () => {
  const c = outsider as Signed;
  await c.page.goto(`/cases/${OPEN_CASE_ID}`);
  await expect(
    c.page.getByText("参加者だけが見られます（非公開）"),
  ).toBeVisible();
  await expect(conversation(c.page)).toHaveCount(0);
  await expect(c.page.getByText(POST_TEXT)).toHaveCount(0);
});
