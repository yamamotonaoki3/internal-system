// #270（270-B）AC-1・AC-4・AC-11：添付だけの投稿（C-137(3)）の主な流れを、画面からバックエンドまで通して確かめる（計画 6章「E2E」。1本・serial）。
// S-05 で、本文を空のまま添付1件を付けて送る → 再読み込みなしで、本文の段のない行に添付のリンクが出る → その投稿を編集して本文を足す → 本文が出る
//   → 本文を消して保存 → 本文の段が消える → 添付の「削除」で、利用者の決定2の案内（投稿ごと削除してください）が出て、再認証を求めない。
// 判定の順・競合・索引・API の契約は下の層（DB・Service・結合・画面の部品のテスト）で確かめ、ここでは重ねない。
// 待ち方は決まる形だけにする（表示・件数・応答を expect で待つ。固定の時間の待ち・やり直し・条件つきの分岐は使わない）。
// ログインの直後は再認証していないため、削除が再認証へ進むなら必ず「再認証」のダイアログが出る（e2e/attachment-delete.spec.ts と同じ前提）。
//   ここでは、それが出ないことを確かめる。
// 前提：e2e/seeds/attachment-only-post.sql（[E2E_TEST] 本文なし添付・e2euser_attonly_a・非公開チャンネル1つ）。
// 後始末：R2 の手元の実体（.wrangler/state/test の internal-system-attachments）を、DB の storage_key を読んで先に消し、
//   そのあと e2e/seeds/attachment-only-post-cleanup.sql（外部キーの順。残数 0 を確かめる）を流す。本物のバケットには接続しない。
// 画面の文言・操作は frontend/src/features/messages/messages.attachment-only.test.tsx・messages.attachment-delete.test.tsx の契約と同じ。
import { execFile } from "node:child_process";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./console-guard";

const ORIGIN = "http://localhost:5173";
const PASSWORD = "TestPass123!";
const C01 = "01JTE2E270B000000000000C01";
const STATE = ".wrangler/state/test";
const BUCKET = "internal-system-attachments";
const WRANGLER = "node_modules/wrangler/bin/wrangler.js";
const FILE_NAME = "e2e添付だけのメモ.txt";
const ADDED_BODY = "[E2E_TEST]あとから足した本文";
const LAST_ATTACHMENT_MESSAGE =
  "本文のない投稿の、最後の添付は削除できません。投稿ごと削除してください。";

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
  file: "attachment-only-post.sql" | "attachment-only-post-cleanup.sql",
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
    `SELECT storage_key FROM message_attachments WHERE room_id = '${C01}' OR uploader_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_attonly!_%' ESCAPE '!')`,
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
  const output = await seedFile("attachment-only-post-cleanup.sql");
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
  // 未ログインのときのセッションの確認の 401 だけを許す（e2e/attachment-delete.spec.ts と同じ）
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
  await seedFile("attachment-only-post.sql");
  a = await login(browser, "e2euser_attonly_a");
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

test("#270 AC-1・AC-4・AC-11（C-137(3)）: S-05 で本文なしで添付だけを送り、編集で本文を足して消し、最後の添付の削除では投稿ごとの削除を案内される", async () => {
  if (a === undefined) throw new Error("ログインできていません");
  const { page } = a;
  await page.goto(`/channels/${C01}`);

  // 1. 本文を空のまま、添付1件だけで送る（AC-1・AC-11）
  await page
    .getByLabel("ファイルを添付")
    .first()
    .setInputFiles({
      name: FILE_NAME,
      mimeType: "text/plain",
      buffer: Buffer.from(`[E2E_TEST] ${FILE_NAME}\n`),
    });
  await expect(
    page.getByRole("list", { name: "送信前の添付" }).getByRole("listitem"),
  ).toHaveCount(1);
  await expect(page.getByRole("textbox", { name: "メッセージ" })).toHaveValue(
    "",
  );
  const posted = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().endsWith(`/api/rooms/${C01}/messages`),
  );
  await page.getByRole("button", { name: "送信", exact: true }).click();
  expect((await posted).status()).toBe(201);

  // 2. 再読み込みなしで、本文の段のない行に、添付のリンクが出る（AC-4）
  // メッセージの行は、添付のリンクと、行の操作「編集」（自分の投稿の行だけが持つ。添付の一覧〔list「添付」〕の行は持たない）の両方を含む listitem。
  // 添付の一覧の行（「〈名前〉を削除」とリンクだけ）を除くため、「編集」で絞る（MessageItem.tsx・MessageAttachments.tsx）
  const row = page
    .getByRole("log", { name: "メッセージ一覧" })
    .getByRole("listitem")
    .filter({ has: page.getByRole("link", { name: FILE_NAME }) })
    .filter({
      has: page.getByRole("button", { name: "編集", exact: true }),
    });
  await expect(row.getByRole("link", { name: FILE_NAME })).toBeVisible();
  await expect(row.locator(".markdown-body")).toHaveCount(0);
  await expect(page.getByText("メッセージを入力してください")).toHaveCount(0);

  // 3. 編集して本文を足す → 本文が出る（AC-11）
  await row.getByRole("button", { name: "編集", exact: true }).click();
  const editBox = page.getByRole("textbox", { name: "メッセージの編集" });
  await expect(editBox).toHaveValue("");
  await editBox.fill(ADDED_BODY);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(editBox).toHaveCount(0);
  await expect(row).toContainText(ADDED_BODY);

  // 4. 本文を消して保存 → 本文の段が消える（決定3・AC-11）
  await row.getByRole("button", { name: "編集", exact: true }).click();
  await expect(editBox).toHaveValue(ADDED_BODY);
  await editBox.fill("");
  const edited = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      /\/api\/messages\/[0-9A-HJKMNP-TV-Z]{26}$/.test(response.url()),
  );
  await page.getByRole("button", { name: "保存", exact: true }).click();
  expect((await edited).status()).toBe(200);
  await expect(editBox).toHaveCount(0);
  await expect(row).not.toContainText(ADDED_BODY);
  await expect(row.locator(".markdown-body")).toHaveCount(0);
  await expect(row.getByRole("link", { name: FILE_NAME })).toBeVisible();

  // 5. 最後の添付の「削除」：案内だけを出し、再認証を求めず、DELETE を送らない（決定2・AC-11）
  const deletes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "DELETE") deletes.push(request.url());
  });
  await row
    .getByRole("button", { name: `${FILE_NAME}を削除`, exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "添付の削除" });
  await expect(dialog).toContainText(LAST_ATTACHMENT_MESSAGE);
  await expect(dialog.getByRole("button", { name: "削除する" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "再認証" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "閉じる", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row.getByRole("link", { name: FILE_NAME })).toBeVisible();
  expect(deletes).toEqual([]);
});
