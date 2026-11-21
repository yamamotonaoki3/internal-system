// #155（155-A）E-1：メッセージの検索（4-1 AC-1〜AC-3・Issue AC-4）を、画面からバックエンドまで通して確かめる（単独で実行する）。
// 流れ：A（すべての部屋の参加者）がヘッダーから検索 → 公開・非公開・DM・案件の部屋の結果が出る → B（どこにも参加していない）は公開だけ →
//   結果から元の場所（S-05 のスレッド）へ → A が投稿・編集・削除した後に検索し直すと反映される → 期間の絞り込みで0件。
// 前提のデータは e2e/seeds/search.sql（e2euser_search155_・[E2E_TEST]部署155・@example.com）。シードの後に、既存のメッセージの索引を
//   `node scripts/db-local.ts test search-reindex` で作る（計画 4.2 D-9。手元の D1 だけ）。後始末は search-cleanup.sql（検索の索引の行を含め、残数 0 を確かめる）。
// 否定の確認（出ない）は、検索の語が入力欄・見出しにも出るため、結果の一覧（「検索結果の一覧」）の中の行に絞って確かめる。
// 画面の文言は frontend/src/pages/SearchPage.test.tsx の契約と同じ。
// 155-B（添付ファイル名の検索。利用者の決定 B-4）：シードの添付（e2e155b-見積-0001〜0004.txt）は、beforeAll の search-reindex で登録される
//   （再登録で添付も入ることの確認。2回目の計画レビューの軽微 (1)）。A には4つの部屋の行に印「ファイル名で一致」と名前が出て、B には公開の分だけ。
//   A が添付つきで投稿すると名前で引け、削除の後は引けない。255文字の名前10件は、行の中で折り返し、横にはみ出さない（実ブラウザの配置）。
//   画面の契約は frontend/src/pages/SearchPage.attachments.test.tsx と同じ。行は名前の完全な文字列で探す（互いに含まれない名前）。
//   画面から投稿した添付の R2 の実体は、行を消す前に手元の R2 から消す（attachments.spec.ts と同じ方法。本物のバケットには接続しない）。
import { execFile } from "node:child_process";
import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";
import { expect, test } from "./console-guard";

const ORIGIN = "http://localhost:5173";
const PASSWORD = "TestPass123!";
const PUBLIC_ROOM = "01JTE2E1550000000000000C01";
const PUBLIC_MESSAGE = "01M78ZTJC00000000001550001";
const COMMON = "検索155共通";
const WORDS = {
  public: "開放室の語句",
  private: "非公開室の語句",
  direct: "直接対話の語句",
  case: "案件室の語句",
} as const;

const STATE = ".wrangler/state/test";
const BUCKET = "internal-system-attachments";
const WRANGLER = "node_modules/wrangler/bin/wrangler.js";
const MARKER = "ファイル名で一致";
const NAME_PREFIX = "e2e155b-見積";
const SEEDED_NAMES = {
  public: "e2e155b-見積-0001.txt",
  private: "e2e155b-見積-0002.txt",
  direct: "e2e155b-見積-0003.txt",
  case: "e2e155b-見積-0004.txt",
} as const;
const POSTED_NAME = "e2e155b-見積-0005.txt";

function runNode(args: string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile(
      process.execPath,
      args,
      { cwd: process.cwd(), windowsHide: true },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

/** 画面から投稿した添付（シードでない行）の実体を、手元の R2 から消す（行を消す前に呼ぶ） */
async function removeStoredObjects() {
  const output = await runNode([
    WRANGLER,
    "d1",
    "execute",
    "DB",
    "--local",
    "--persist-to",
    STATE,
    "--json",
    "--command",
    "SELECT storage_key FROM message_attachments WHERE id NOT LIKE '01JTE2E155B%' AND (room_id LIKE '01JTE2E155%' OR uploader_id LIKE '01JTE2E155%')",
  ]);
  const parsed = JSON.parse(output) as { results: { storage_key: string }[] }[];
  for (const row of parsed.flatMap((entry) => entry.results))
    await runNode([
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

function runLocal(args: string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile(
      process.execPath,
      ["scripts/db-local.ts", "test", ...args],
      { cwd: process.cwd(), windowsHide: true },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}
const seedFile = (file: "search.sql" | "search-cleanup.sql") =>
  runLocal(["seed-file", `e2e/seeds/${file}`]);

type Guarded = { context: BrowserContext; page: Page; errors: string[] };

/** テストの間で使い回すブラウザ。エラーレベルのコンソール出力と処理されなかった例外を集める。未ログインのセッションの確認（401）だけを許す */
async function guardedPage(browser: Browser): Promise<Guarded> {
  const context = await browser.newContext({ baseURL: ORIGIN });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  const errors: string[] = [];
  const allowed = [
    /Failed to load resource: the server responded with a status of 401/,
  ];
  page.on("console", (m) => {
    if (m.type() === "error" && !allowed.some((re) => re.test(m.text())))
      errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  return { context, page, errors };
}

async function login(page: Page, loginId: string) {
  await page.goto("/login");
  await page.getByLabel("ユーザーID", { exact: true }).fill(loginId);
  await page.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}

const headerSearch = (page: Page) =>
  page.getByRole("banner").getByRole("search", { name: "メッセージの検索" });
const results = (page: Page) =>
  page.getByRole("main").getByRole("list", { name: "検索結果の一覧" });
/** 結果の行（一覧の直下の li だけ。行の中の「一致したファイル名」の li は数えない） */
const resultRows = (page: Page): Locator =>
  results(page).locator(":scope > li");
const resultRow = (page: Page, text: string): Locator =>
  resultRows(page).filter({ hasText: text });
const noMatch = (page: Page) =>
  page.getByRole("main").getByText("一致するメッセージはありません");

async function searchFromHeader(page: Page, term: string) {
  const form = headerSearch(page);
  const box = form.getByRole("searchbox", { name: "検索する言葉" });
  // 再認証の直後などに画面の枠が作り直されると、入れた語が消えることがある。入れて送り、移るまでをやり直す
  await expect(async () => {
    await box.fill(term);
    await expect(box).toHaveValue(term, { timeout: 1_000 });
    await form.getByRole("button", { name: "検索", exact: true }).click();
    await expect(page).toHaveURL(/\/search\?/, { timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  await expect(
    page.getByRole("main").getByRole("heading", { level: 1, name: "検索結果" }),
  ).toBeVisible();
}

let a: Guarded | undefined;
let b: Guarded | undefined;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  await removeStoredObjects();
  await seedFile("search-cleanup.sql");
  await seedFile("search.sql");
  await runLocal(["search-reindex"]);
  a = await guardedPage(browser);
  await login(a.page, "e2euser_search155_a");
});

test.afterAll(async () => {
  try {
    for (const opened of [a, b]) await opened?.context.close();
  } finally {
    await removeStoredObjects();
    const output = await seedFile("search-cleanup.sql");
    // 後始末の後の残数（検索の索引の行を含む）がすべて 0 であること
    expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
  }
});

test.afterEach(() => {
  for (const opened of [a, b])
    expect(opened?.errors ?? [], "コンソールのエラー").toEqual([]);
});

const userA = () => {
  if (a === undefined) throw new Error("A のブラウザがありません");
  return a.page;
};

test("#155 AC-1 E-1: A はヘッダーから検索し、参加している公開・非公開・DM・案件の部屋の結果が出る", async () => {
  const page = userA();
  await page.goto("/");
  await searchFromHeader(page, COMMON);
  for (const word of Object.values(WORDS))
    await expect(resultRow(page, word)).toHaveCount(1);
});

test("#155 AC-4 E-1: B（どこにも参加していない）は、未参加の公開チャンネルの結果だけが出て、非公開・他人の DM・非参加の案件は出ない", async ({
  browser,
}) => {
  b = await guardedPage(browser);
  await login(b.page, "e2euser_search155_b");
  await searchFromHeader(b.page, COMMON);
  await expect(resultRow(b.page, WORDS.public)).toHaveCount(1);
  for (const word of [WORDS.private, WORDS.direct, WORDS.case])
    await expect(resultRow(b.page, word)).toHaveCount(0);
  await expect(resultRows(b.page)).toHaveCount(1);
  // 見えない部屋だけにある語は、どこにもない語と同じく0件
  await searchFromHeader(b.page, WORDS.private);
  await expect(noMatch(b.page)).toBeVisible();
});

test("#155 AC-1 E-1: 結果から元の場所（チャンネル S-05 のスレッド）へ移れる", async () => {
  const page = userA();
  await searchFromHeader(page, WORDS.public);
  await resultRow(page, WORDS.public).getByRole("link").click();
  await expect(page).toHaveURL(
    new RegExp(`/channels/${PUBLIC_ROOM}\\?thread=${PUBLIC_MESSAGE}`),
  );
  await expect(page.getByRole("main")).toContainText(WORDS.public);
});

test("#155 AC-3 E-1: 投稿の後に引け、編集の後は新しい語で引けて古い語で引けず、削除の後は引けない", async () => {
  const page = userA();
  await page.goto(`/channels/${PUBLIC_ROOM}`);
  await page
    .getByRole("textbox", { name: "メッセージ" })
    .fill("[E2E_TEST]検索155新規の投稿文");
  await page.getByRole("button", { name: "送信", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("検索155新規の投稿文");

  await searchFromHeader(page, "検索155新規");
  await expect(resultRow(page, "検索155新規の投稿文")).toHaveCount(1);

  // 編集
  await page.goto(`/channels/${PUBLIC_ROOM}`);
  const row = page
    .getByRole("log")
    .getByRole("listitem")
    .filter({ hasText: "検索155新規の投稿文" });
  await row.getByRole("button", { name: "編集", exact: true }).click();
  const box = page.getByRole("textbox", {
    name: "メッセージの編集",
    exact: true,
  });
  await box.fill("[E2E_TEST]検索155編集後の投稿文");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(box).toHaveCount(0);

  await searchFromHeader(page, "検索155編集後");
  await expect(resultRow(page, "検索155編集後の投稿文")).toHaveCount(1);
  await searchFromHeader(page, "検索155新規");
  await expect(noMatch(page)).toBeVisible();

  // 削除（確認と再認証を経る）
  await page.goto(`/channels/${PUBLIC_ROOM}`);
  await page
    .getByRole("log")
    .getByRole("listitem")
    .filter({ hasText: "検索155編集後の投稿文" })
    .getByRole("button", { name: "削除", exact: true })
    .click();
  const confirm = page.getByRole("dialog", { name: "メッセージの削除" });
  await confirm.getByRole("button", { name: "削除する", exact: true }).click();
  const reauth = page.getByRole("dialog", { name: "再認証" });
  if (await reauth.isVisible()) {
    await reauth.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
    await reauth.getByRole("button", { name: "再認証", exact: true }).click();
  }
  await expect(page.getByRole("log")).toContainText(
    "このメッセージは削除されました",
  );

  await searchFromHeader(page, "検索155編集後");
  await expect(noMatch(page)).toBeVisible();
});

test("#155 AC-3 E-1: 期間の絞り込み（JST の日付）：投稿の日の翌日からでは0件、投稿の日からなら出る", async () => {
  const page = userA();
  await searchFromHeader(page, WORDS.public);
  await expect(resultRow(page, WORDS.public)).toHaveCount(1);
  const main = page.getByRole("main");
  // 絞り込みは折りたたまれている。検索し直した後に閉じるかは決めていないため、入力の前に、閉じていれば開く
  const startDate = async (value: string) => {
    const input = main.getByLabel("開始日");
    if (!(await input.isVisible()))
      await main.getByText("絞り込み", { exact: true }).click();
    await input.fill(value);
  };
  // シードの作成日時は 2026-11-12T23:00:00.000Z（JST では 2026-11-13 08:00）
  await startDate("2026-11-14");
  await main.getByRole("button", { name: "検索", exact: true }).click();
  await expect(noMatch(page)).toBeVisible();
  await startDate("2026-11-13");
  await main.getByRole("button", { name: "検索", exact: true }).click();
  await expect(resultRow(page, WORDS.public)).toHaveCount(1);
});

// ---- 155-B 添付ファイル名の検索 ----

const nameRow = (page: Page, name: string): Locator => resultRow(page, name);
const matchedNames = (row: Locator) =>
  row.getByRole("list", { name: "一致したファイル名" }).getByRole("listitem");

test("#155 AC-1 AC-3 155-B E-1: 再登録の後、A は名前の語で、4つの部屋の添付の行が出て、どの行にも印「ファイル名で一致」と一致した名前が出る", async () => {
  const page = userA();
  await searchFromHeader(page, NAME_PREFIX);
  for (const name of Object.values(SEEDED_NAMES)) {
    const row = nameRow(page, name);
    await expect(row).toHaveCount(1);
    await expect(row.getByText(MARKER, { exact: true })).toBeVisible();
    await expect(matchedNames(row)).toHaveText([name]);
  }
  await expect(resultRows(page)).toHaveCount(Object.keys(SEEDED_NAMES).length);
});

test("#155 AC-2 AC-4 155-B E-1: B は名前の語で、公開チャンネルの添付の行だけが出て、非公開・他人の DM・非参加の案件の添付の名前は出ない", async () => {
  const other = b?.page;
  if (other === undefined) throw new Error("B のブラウザがありません");
  await searchFromHeader(other, NAME_PREFIX);
  await expect(nameRow(other, SEEDED_NAMES.public)).toHaveCount(1);
  for (const name of [
    SEEDED_NAMES.private,
    SEEDED_NAMES.direct,
    SEEDED_NAMES.case,
  ])
    await expect(results(other).getByText(name)).toHaveCount(0);
  await expect(resultRows(other)).toHaveCount(1);
  // 見えない添付だけにある名前は、どこにもない語と同じく0件
  await searchFromHeader(other, SEEDED_NAMES.private);
  await expect(noMatch(other)).toBeVisible();
});

test("#155 AC-1 155-B E-1: 名前で一致した行から、そのメッセージのスレッドへ移れる", async () => {
  const page = userA();
  await searchFromHeader(page, SEEDED_NAMES.public);
  await nameRow(page, SEEDED_NAMES.public).getByRole("link").click();
  await expect(page).toHaveURL(
    new RegExp(`/channels/${PUBLIC_ROOM}\\?thread=${PUBLIC_MESSAGE}`),
  );
});

test("#155 AC-3 155-B E-1: 添付つきで投稿すると名前で引け、そのメッセージを削除すると引けない", async () => {
  const page = userA();
  await page.goto(`/channels/${PUBLIC_ROOM}`);
  await page
    .getByLabel("ファイルを添付")
    .first()
    .setInputFiles({
      name: POSTED_NAME,
      mimeType: "text/plain",
      buffer: Buffer.from("[E2E_TEST] 検索155の添付\n"),
    });
  await expect(
    page.getByRole("list", { name: "送信前の添付" }).getByRole("listitem"),
  ).toHaveCount(1);
  await page
    .getByRole("textbox", { name: "メッセージ" })
    .fill("[E2E_TEST]検索155添付つきの投稿文");
  await page.getByRole("button", { name: "送信", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("検索155添付つきの投稿文");

  await searchFromHeader(page, POSTED_NAME);
  const row = nameRow(page, POSTED_NAME);
  await expect(row).toHaveCount(1);
  await expect(row.getByText(MARKER, { exact: true })).toBeVisible();

  await page.goto(`/channels/${PUBLIC_ROOM}`);
  await page
    .getByRole("log")
    .getByRole("listitem")
    .filter({ hasText: "検索155添付つきの投稿文" })
    .getByRole("button", { name: "削除", exact: true })
    .click();
  const confirm = page.getByRole("dialog", { name: "メッセージの削除" });
  await confirm.getByRole("button", { name: "削除する", exact: true }).click();
  const reauth = page.getByRole("dialog", { name: "再認証" });
  if (await reauth.isVisible()) {
    await reauth.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
    await reauth.getByRole("button", { name: "再認証", exact: true }).click();
  }
  await expect(page.getByRole("log")).toContainText(
    "このメッセージは削除されました",
  );

  await searchFromHeader(page, POSTED_NAME);
  await expect(noMatch(page)).toBeVisible();
});

test("#155 AC-1 155-B E-1 R1-7: 255文字の名前が10件並んでも、行の中で折り返し、横にはみ出さない", async () => {
  const page = userA();
  await searchFromHeader(page, "e2e155b長名");
  const row = resultRow(page, "検索155長い名前の行");
  await expect(row).toHaveCount(1);
  const names = matchedNames(row);
  await expect(names).toHaveCount(10);
  const rowBox = await row.boundingBox();
  if (rowBox === null) throw new Error("行の位置が取れません");
  for (let i = 0; i < 10; i += 1) {
    const box = await names.nth(i).boundingBox();
    if (box === null) throw new Error("名前の位置が取れません");
    expect(box.x).toBeGreaterThanOrEqual(rowBox.x - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(rowBox.x + rowBox.width + 1);
  }
  // 画面全体も横にはみ出さない
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
