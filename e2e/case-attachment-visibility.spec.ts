// #148（148-B-2）5-2 AC-8・AC-9・R-85、画面 S-17・S-35：案件の添付の公開範囲の主な流れを、画面からバックエンドまで通して確かめる（実ブラウザ）。
// 流れ：本人（一般の参加者 uploader）が S-17 で「全社員公開アーカイブで公開できる」を選んで添付 → 「添付ファイル」の一覧にその表示
//   → 本人が「参加者限定」に変更 → 表示が変わる。S-35（スレッドの一覧）から案件のスレッドへ返信すると、選択と案内が出る。
//   → ほかの参加者（一般 member）には「公開範囲を変更」が出ない。担当部署のオーナー（参加者 owner）は変更できる。非参加者（outsider）は配信が 404。
// 判定の順・認可・同時の操作の網羅は backend の結合・DB・Service のテスト、画面の分岐は frontend の画面のテストで確かめ、ここでは重ねない。
// 前提：e2e/seeds/case-attachment-visibility.sql（[E2E_TEST]部署148B2・e2euser_case148b2_uploader／_member／_owner（担当部署のオーナー）／_outsider・
//   取引先 テスト商事公開範囲 [E2E_TEST]（QKR）・進行中の案件 QKR-261119-0001）。添付はシードで入れず、画面からアップロードする。
//   ファイル名・本文に、否定の確認に使う語（公開・参加者・変更）を入れない。
//   後始末は、手元の R2 の実体（removeStoredObjects）→ e2e/seeds/case-attachment-visibility-cleanup.sql（識別子だけ。監査の行も消す。残数 0 を確かめる）。
//   この E2E の利用者は、ほかの spec と共有しない。E2E は同時に1つだけ動かす。ログインは利用者ごとに1回だけ（別のブラウザのコンテキスト）。
// 自分で作ったページには console-guard の監視が付かないため、各ページに同じ監視を付ける。意図した拒否（ログイン前のセッションの確認の 401、
//   非参加者の配信の 404）だけを、状態と URL の組で許す。
import { execFile } from "node:child_process";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./console-guard";

const PASSWORD = "TestPass123!";
const CASE_ID = "01JTE2E00000000000X0111482";
const POST_TEXT = "[E2E_TEST]148B2の投稿";
const REPLY_TEXT = "[E2E_TEST]148B2の返信";
const POST_FILE = "e2e148b2memo-a.txt";
const REPLY_FILE = "e2e148b2memo-b.txt";
const MEMO = Buffer.from("[E2E_TEST]148B2 memo", "utf8");
const LIMITED = "参加者限定";
const PUBLIC = "全社員公開アーカイブで公開できる";
const HINT = "全社員公開が承認されるまでは、参加者だけが見られます";

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
  file:
    "case-attachment-visibility.sql" | "case-attachment-visibility-cleanup.sql",
) => run(["scripts/db-local.ts", "test", "seed-file", `e2e/seeds/${file}`]);

/** この E2E の案件の部屋・利用者の添付の実体を、手元の R2 から消す（行を消す SQL より前。e2e/case-attachments.spec.ts と同じ） */
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
    "SELECT storage_key FROM message_attachments WHERE room_id IN (SELECT room_id FROM channels WHERE purpose = 'case' AND name GLOB 'QKR-*') OR uploader_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_case148b2!_%' ESCAPE '!')",
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

async function cleanup() {
  await removeStoredObjects();
  return seedFile("case-attachment-visibility-cleanup.sql");
}

const REJECTION_TEXT =
  /Failed to load resource: the server responded with a status of (\d+)/;
const INTENDED_REJECTIONS: { status: number; url: RegExp }[] = [
  { status: 401, url: /\/api\/auth\/session$/ },
  { status: 404, url: /\/api\/attachments\/[0-9A-HJKMNP-TV-Z]{26}$/ },
];

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
    if (m.type() !== "error") return;
    const status = Number(REJECTION_TEXT.exec(m.text())?.[1]);
    const url = m.location().url;
    const intended = INTENDED_REJECTIONS.some(
      (rule) => rule.status === status && rule.url.test(url),
    );
    if (!intended) errors.push(`${m.text()} (${url})`);
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
      expect(errors, `${loginId} のコンソールのエラー`).toEqual([]),
  };
}

const attachmentsRegion = (page: Page) =>
  page.getByRole("main").getByRole("region", { name: "添付ファイル" });
const attachmentRow = (page: Page, fileName: string) =>
  attachmentsRegion(page).getByRole("listitem").filter({ hasText: fileName });
const changeButton = (page: Page, fileName: string) =>
  attachmentsRegion(page).getByRole("button", {
    name: `${fileName} の公開範囲を変更`,
  });
const roomLog = (page: Page) =>
  page.getByRole("log", { name: "メッセージ一覧" });
const rowWith = (page: Page, text: string) =>
  roomLog(page).getByRole("listitem").filter({ hasText: text });
const pane = (page: Page) => page.getByRole("region", { name: "スレッド" });

async function changeTo(page: Page, fileName: string, label: string) {
  await changeButton(page, fileName).click();
  const dialog = page.getByRole("dialog", { name: "公開範囲を変更" });
  await expect(dialog.getByText(HINT)).toBeVisible();
  await dialog.getByRole("radio", { name: label }).check();
  await dialog.getByRole("button", { name: "変更", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(attachmentRow(page, fileName)).toContainText(label);
}

let uploader: Signed | undefined;
let member: Signed | undefined;
let owner: Signed | undefined;
let outsider: Signed | undefined;
let attachmentHref = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser, baseURL }) => {
  await cleanup();
  await seedFile("case-attachment-visibility.sql");
  uploader = await signIn(browser, baseURL, "e2euser_case148b2_uploader");
  member = await signIn(browser, baseURL, "e2euser_case148b2_member");
  owner = await signIn(browser, baseURL, "e2euser_case148b2_owner");
  outsider = await signIn(browser, baseURL, "e2euser_case148b2_outsider");
});

test.afterAll(async () => {
  for (const opened of [uploader, member, owner, outsider]) {
    opened?.expectNoErrors();
    await opened?.context.close();
  }
  const output = await cleanup();
  expect(output).toContain("remaining_users");
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
});

test("#148 AC-8: 本人が S-17 で「全社員公開アーカイブで公開できる」を選んで添付すると、一覧にその表示が出る", async () => {
  const a = uploader as Signed;
  await a.page.goto(`/cases/${CASE_ID}`);
  await a.page.getByLabel("ファイルを添付").first().setInputFiles({
    name: POST_FILE,
    mimeType: "text/plain",
    buffer: MEMO,
  });
  const select = a.page.getByRole("combobox", {
    name: `${POST_FILE} の公開範囲`,
  });
  await expect(select).toHaveValue("participants_only");
  await expect(a.page.getByText(HINT).first()).toBeVisible();
  await select.selectOption({ label: PUBLIC });
  await a.page.getByRole("textbox", { name: "メッセージ" }).fill(POST_TEXT);
  await a.page.getByRole("button", { name: "送信", exact: true }).click();
  await expect(
    rowWith(a.page, POST_TEXT).getByRole("link", { name: POST_FILE }),
  ).toBeVisible();
  await expect(attachmentRow(a.page, POST_FILE)).toContainText(PUBLIC);
  attachmentHref =
    (await attachmentRow(a.page, POST_FILE)
      .getByRole("link", { name: POST_FILE })
      .getAttribute("href")) ?? "";
  expect(attachmentHref).toMatch(/\/api\/attachments\/[0-9A-HJKMNP-TV-Z]{26}$/);
});

test("#148 AC-9: 本人は「参加者限定」に変更でき、表示が変わる", async () => {
  const a = uploader as Signed;
  await a.page.goto(`/cases/${CASE_ID}`);
  await changeTo(a.page, POST_FILE, LIMITED);
});

test("#148 AC-8: S-35（スレッドの一覧）から案件のスレッドへ返信すると、選択と案内が出る", async () => {
  const a = uploader as Signed;
  await a.page.goto(`/cases/${CASE_ID}`);
  await rowWith(a.page, POST_TEXT)
    .getByRole("button", { name: /返信/ })
    .click();
  await pane(a.page).getByRole("textbox", { name: "返信" }).fill(REPLY_TEXT);
  await pane(a.page).getByRole("button", { name: "送信", exact: true }).click();
  await expect(
    pane(a.page).getByRole("log", { name: "返信一覧" }),
  ).toContainText(REPLY_TEXT);
  await a.page.goto("/threads");
  await a.page
    .getByRole("list", { name: "スレッド一覧" })
    .getByRole("link")
    .filter({ hasText: POST_TEXT })
    .click();
  await pane(a.page).getByLabel("ファイルを添付").setInputFiles({
    name: REPLY_FILE,
    mimeType: "text/plain",
    buffer: MEMO,
  });
  await expect(
    pane(a.page).getByRole("combobox", { name: `${REPLY_FILE} の公開範囲` }),
  ).toHaveValue("participants_only");
  await expect(pane(a.page).getByText(HINT)).toBeVisible();
});

test("#148 AC-9 R-85: ほかの参加者（一般）には「公開範囲を変更」が出ない", async () => {
  const b = member as Signed;
  await b.page.goto(`/cases/${CASE_ID}`);
  await expect(attachmentRow(b.page, POST_FILE)).toContainText(LIMITED);
  await expect(changeButton(b.page, POST_FILE)).toHaveCount(0);
});

test("#148 AC-9 R-85: 担当部署のオーナー（参加者）は、ほかの人の添付を変更できる", async () => {
  const c = owner as Signed;
  await c.page.goto(`/cases/${CASE_ID}`);
  await changeTo(c.page, POST_FILE, PUBLIC);
});

test("#148 AC-8 C-64: 全社員公開アーカイブで公開できる添付でも、非参加者の配信は 404", async () => {
  const d = outsider as Signed;
  const res = await d.page.request.get(attachmentHref);
  expect(res.status()).toBe(404);
});
