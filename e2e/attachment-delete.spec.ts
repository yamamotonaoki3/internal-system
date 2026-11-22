// #270（270-A）AC-8（1-6 AC-4）：自分の添付の削除を、画面からバックエンドまで通して確かめる（計画 7章「AC-8 E2E」。1本）。
// S-05 で添付2つ付きの投稿をし、片方の「〈名前〉を削除」→ 確認の「削除する」→ 再認証 を経ると、再読み込みせずにその添付だけが消え、
// もう片方の添付と本文は残る。消した添付の URL を開くと 404。
// 待ち方は決まる形だけにする（表示・件数・応答を expect で待つ。固定の時間の待ち・やり直し・条件つきの分岐は使わない）。
// ログインの直後は再認証していないため、再認証は必ず求められる（e2e/messages-edit-delete.spec.ts と同じ前提）。
// 前提：e2e/seeds/attachment-delete.sql（[E2E_TEST] 削除添付・e2euser_attdel_a・非公開チャンネル1つ）。
// 後始末：R2 の手元の実体（.wrangler/state/test の internal-system-attachments）を、DB の storage_key を読んで先に消し、
//   そのあと e2e/seeds/attachment-delete-cleanup.sql（外部キーの順。残数 0 を確かめる）を流す。本物のバケットには接続しない。
// 画面の文言・操作は frontend/src/features/messages/messages.attachment-delete.test.tsx の契約と同じ。
import { execFile } from "node:child_process";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./console-guard";

const ORIGIN = "http://localhost:5173";
const PASSWORD = "TestPass123!";
const C01 = "01JTE2E2700000000000000C01";
const STATE = ".wrangler/state/test";
const BUCKET = "internal-system-attachments";
const WRANGLER = "node_modules/wrangler/bin/wrangler.js";
const BODY = "[E2E_TEST]添付を消す投稿";
const TARGET = "e2e消すメモ.txt";
const KEPT = "e2e残すメモ.txt";

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
  file: "attachment-delete.sql" | "attachment-delete-cleanup.sql",
) => run(["scripts/db-local.ts", "test", "seed-file", `e2e/seeds/${file}`]);

/** テストの部屋・利用者の添付の実体を、手元の R2 から消す（行を消す前に呼ぶ） */
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
    `SELECT storage_key FROM message_attachments WHERE room_id = '${C01}' OR uploader_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_attdel!_%' ESCAPE '!')`,
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
  const output = await seedFile("attachment-delete-cleanup.sql");
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
}

type Signed = { context: BrowserContext; page: Page; errors: string[] };

async function login(browser: Browser, loginId: string): Promise<Signed> {
  const context = await browser.newContext({
    baseURL: ORIGIN,
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  const allowed = [
    /Failed to load resource: the server responded with a status of 401/,
  ];
  page.on("console", (m) => {
    if (m.type() === "error" && !allowed.some((re) => re.test(m.text())))
      errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/login");
  await page.getByLabel("ユーザーID", { exact: true }).fill(loginId);
  await page.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  return { context, page, errors };
}

let a: Signed | undefined;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  await cleanup();
  await seedFile("attachment-delete.sql");
  a = await login(browser, "e2euser_attdel_a");
});

test.afterEach(() => {
  expect(a?.errors ?? [], "コンソールのエラー・処理されなかった例外").toEqual(
    [],
  );
});

test.afterAll(async () => {
  await a?.context.close();
  await cleanup();
});

test("#270 AC-8（1-6 AC-4）: S-05 で自分の添付を1つ消すと、確認と再認証を経て、再読み込みせずにその添付だけが消え、その URL は 404 になる", async () => {
  if (a === undefined) throw new Error("ログインできていません");
  const { page } = a;
  await page.goto(`/channels/${C01}`);
  for (const name of [TARGET, KEPT])
    await page
      .getByLabel("ファイルを添付")
      .first()
      .setInputFiles({
        name,
        mimeType: "text/plain",
        buffer: Buffer.from(`[E2E_TEST] ${name}\n`),
      });
  await expect(
    page.getByRole("list", { name: "送信前の添付" }).getByRole("listitem"),
  ).toHaveCount(2);
  await page.getByRole("textbox", { name: "メッセージ" }).fill(BODY);
  await page.getByRole("button", { name: "送信", exact: true }).click();

  const row = page
    .getByRole("log", { name: "メッセージ一覧" })
    .getByRole("listitem")
    .filter({ hasText: BODY });
  const targetLink = row.getByRole("link", { name: TARGET });
  await expect(targetLink).toBeVisible();
  await expect(row.getByRole("link", { name: KEPT })).toBeVisible();
  const targetUrl = (await targetLink.getAttribute("href")) ?? "";
  expect(targetUrl).toMatch(/^\/api\/attachments\/[0-9A-HJKMNP-TV-Z]{26}$/);
  expect((await page.request.get(targetUrl)).status()).toBe(200);

  // 削除：確認 → 再認証（ログインの直後なので必ず求められる）→ 送信
  await row
    .getByRole("button", { name: `${TARGET}を削除`, exact: true })
    .click();
  const confirm = page.getByRole("dialog", { name: "添付の削除" });
  await expect(confirm).toContainText(TARGET);
  const deleted = page.waitForResponse(
    (response) =>
      response.request().method() === "DELETE" &&
      response.url().endsWith(targetUrl),
  );
  await confirm.getByRole("button", { name: "削除する", exact: true }).click();
  const reauth = page.getByRole("dialog", { name: "再認証" });
  await expect(reauth).toBeVisible();
  await reauth.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
  await reauth.getByRole("button", { name: "再認証", exact: true }).click();
  expect((await deleted).status()).toBe(204);

  // 再読み込みせずに、その添付だけが消え、ほかの添付と本文は残る
  await expect(confirm).toHaveCount(0);
  await expect(row.getByRole("link", { name: TARGET })).toHaveCount(0);
  await expect(row.getByRole("link", { name: KEPT })).toBeVisible();
  await expect(row).toContainText(BODY);

  // 消した添付の URL を開くと 404
  expect((await page.request.get(targetUrl)).status()).toBe(404);
});
