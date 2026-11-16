// #140 AC-1（1-6 AC-1〜AC-3・AC-7・AC-9）・AC-2（1-4 AC-5）・AC-3：メッセージの添付を、画面からバックエンドまで通して確かめる。
// ① S-05 で画像と PDF を添付して投稿すると、画像が表示され、PDF をダウンロードできる（中身は送ったバイト列）
// ② S-07 のスレッドの返信に添付でき、返信に添付のリンクが出る
// ③ 参加していない社員が、非公開チャンネルの添付の URL を開くと 404
// ファイルはテストの中でバイト列から作る（架空・無害。実在の画像・文書は使わない）。
// 前提：e2e/seeds/attachments.sql（[E2E_TEST] 添付・e2euser_att_a（参加者）/_b（非参加者）・非公開チャンネル1つ・親1件）。
// 後始末：R2 の手元の実体（.wrangler/state/test の internal-system-attachments）を、DB の storage_key を読んで先に消し、
//   そのあと e2e/seeds/attachments-cleanup.sql（外部キーの順。残数 0 を確かめる）を流す。本物のバケットには接続しない。
// 画面の文言・操作は frontend/src/features/messages/messages.attachments*.test.tsx の契約と同じ。
import { execFile } from "node:child_process";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./console-guard";

const ORIGIN = "http://localhost:5173";
const PASSWORD = "TestPass123!";
const C01 = "01JTE2E1400000000000000C01";
const P01 = "01M78ZTJC00000000000014001";
const TEXT_P01 = "[E2E_TEST]添付のスレッドの親";
const STATE = ".wrangler/state/test";
const BUCKET = "internal-system-attachments";
const WRANGLER = "node_modules/wrangler/bin/wrangler.js";

/** 1x1 の PNG（架空。中身は固定のバイト列） */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%[E2E_TEST]\n%%EOF\n",
);
const TEXT = Buffer.from("[E2E_TEST] 返信の添付\n");

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

const seedFile = (file: "attachments.sql" | "attachments-cleanup.sql") =>
  run(["scripts/db-local.ts", "test", "seed-file", `e2e/seeds/${file}`]);

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
    `SELECT storage_key FROM message_attachments WHERE room_id = '${C01}' OR uploader_id IN (SELECT id FROM users WHERE login_id LIKE 'e2euser!_att!_%' ESCAPE '!')`,
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
  const output = await seedFile("attachments-cleanup.sql");
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
let b: Signed | undefined;
/** ① で投稿した画像の配信の URL（③ で使う） */
let imageUrl = "";

const signed = (who: Signed | undefined) => {
  if (who === undefined) throw new Error("ログインできていません");
  return who;
};

const roomLog = (page: Page) =>
  page.getByRole("log", { name: "メッセージ一覧" });

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  await cleanup();
  await seedFile("attachments.sql");
  a = await login(browser, "e2euser_att_a");
  b = await login(browser, "e2euser_att_b");
});

test.afterEach(() => {
  for (const opened of [a, b])
    expect(
      opened?.errors ?? [],
      "コンソールのエラー・処理されなかった例外",
    ).toEqual([]);
});

test.afterAll(async () => {
  await a?.context.close();
  await b?.context.close();
  await cleanup();
});

test("#140 AC-1（1-6 AC-1・AC-3・AC-7）: S-05 で画像と PDF を添付して投稿すると、画像が表示され、PDF をダウンロードできる", async () => {
  const { page } = signed(a);
  await page.goto(`/channels/${C01}`);
  await page.getByLabel("ファイルを添付").first().setInputFiles({
    name: "e2e画像.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await page.getByLabel("ファイルを添付").first().setInputFiles({
    name: "e2e資料.pdf",
    mimeType: "application/pdf",
    buffer: PDF,
  });
  const pending = page.getByRole("list", { name: "送信前の添付" });
  await expect(pending.getByRole("listitem")).toHaveCount(2);
  await page
    .getByRole("textbox", { name: "メッセージ" })
    .fill("[E2E_TEST]添付つきの投稿");
  await page.getByRole("button", { name: "送信", exact: true }).click();

  const row = roomLog(page)
    .getByRole("listitem")
    .filter({ hasText: "[E2E_TEST]添付つきの投稿" });
  const image = row.getByRole("img", { name: "e2e画像.png" });
  await expect(image).toBeVisible();
  // 画像が実際に読み込めた（幅が 0 でない）
  await expect
    .poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  imageUrl = (await image.getAttribute("src")) ?? "";
  expect(imageUrl).toMatch(/^\/api\/attachments\/[0-9A-HJKMNP-TV-Z]{26}$/);

  const downloadPromise = page.waitForEvent("download");
  await row.getByRole("link", { name: /e2e資料\.pdf/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("e2e資料.pdf");
  const path = await download.path();
  const { readFile } = await import("node:fs/promises");
  expect(Buffer.compare(await readFile(path), PDF)).toBe(0);
});

test("#140 AC-2（1-4 AC-5）・AC-1（1-6 AC-9）: S-07 のスレッドの返信に添付でき、返信に添付のリンクが出る", async () => {
  const { page } = signed(a);
  await page.goto(`/channels/${C01}?thread=${P01}`);
  const pane = page.getByRole("region", { name: "スレッド" });
  await expect(pane.getByText(TEXT_P01)).toBeVisible();
  await pane.getByLabel("ファイルを添付").setInputFiles({
    name: "e2e返信メモ.txt",
    mimeType: "text/plain",
    buffer: TEXT,
  });
  await pane
    .getByRole("textbox", { name: "返信" })
    .fill("[E2E_TEST]添付つきの返信");
  await pane.getByRole("button", { name: "送信", exact: true }).click();
  const replyRow = pane
    .getByRole("log", { name: "返信一覧" })
    .getByRole("listitem")
    .filter({ hasText: "[E2E_TEST]添付つきの返信" });
  await expect(
    replyRow.getByRole("link", { name: /e2e返信メモ\.txt/ }),
  ).toHaveAttribute("href", /^\/api\/attachments\/[0-9A-HJKMNP-TV-Z]{26}$/);
});

test("#140 AC-1（1-6 AC-2・AC-7）: 参加していない社員が、非公開チャンネルの添付の URL を開くと 404", async () => {
  const { page } = signed(b);
  expect(imageUrl).not.toBe("");
  const response = await page.request.get(imageUrl);
  expect(response.status()).toBe(404);
  expect(response.headers()["content-disposition"]).toBeUndefined();
});
