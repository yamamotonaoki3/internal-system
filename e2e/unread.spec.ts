// #237 AC-1〜AC-3（3-1 AC-1〜AC-3・1-1 AC-2・C-94・C-169）：チャンネル・DM の未読の件数と既読を、画面からバックエンドまで通して確かめる。
// A でログイン → サイドバーの参加中のチャンネル（参加の後の他人の投稿101件）に「99+」、参加の前の投稿は数えない別のチャンネルに「1」、
// DM（B の投稿2件＋A の投稿1件）に「2」。未参加の公開チャンネルは GET /api/me/unread に出ない
// → DM を開くと、再読み込みなしでサイドバーの DM の件数が消える → A がホームにいる間に B（別のブラウザ）が DM に投稿すると、サイドバーに「1」が出る
// → A がチャンネルを開くと件数が消え、再読み込みしても戻らない → 未参加の公開チャンネルを開いても既読の要求は出ず、コンソールのエラーもない。
// データを変える操作の後は、再読み込みせずに、関係する表示（サイドバーの件数）が変わることを確かめる。
// 前提：e2e/seeds/unread.sql（[E2E_TEST]部署237・e2euser_unread_a/_b・チャンネル3つ・A と B の DM）。
// 後始末は e2e/seeds/unread-cleanup.sql（社員ID e2euser_unread_・部署名 [E2E_TEST]部署237 と、その利用者が当事者の DM だけ。残数 0 を確かめる）。
// ログインの試行制限（#225）に当たらないよう、ログインは A・B の 2 人で 1 回ずつ（計 2 回）だけにし、ブラウザはテストの間で使い回す。
// 画面の文言（リンクの名前の「未読 n件」「未読 99件以上」、印の「99+」）は frontend/src/features/unread/*.test.tsx の契約と同じ。
import { execFile } from "node:child_process";
import type { Browser, BrowserContext, Page, Request } from "@playwright/test";
import { expect, test } from "./console-guard";
import { roomLinkName } from "./room-link";

const ORIGIN = "http://localhost:5173";
const PASSWORD = "TestPass123!";
const CHANNEL_UNREAD = "[E2E_TEST]部署237の未読";
const CHANNEL_UNJOINED = "[E2E_TEST]部署237の未参加";
const CHANNEL_BEFORE_JOIN = "[E2E_TEST]部署237の参加の前";
const CHANNEL_UNREAD_ID = "01JTE2E2370000000000000C01";
const CHANNEL_UNJOINED_ID = "01JTE2E2370000000000000C02";
const DM_ROOM = "01JTE2E2370000000000000M01";
const NAME_B = "E2E未読利用者B";
const NEW_DM_BODY = "[E2E_TEST]BからAへの新着";

function seedFile(file: "unread.sql" | "unread-cleanup.sql") {
  return new Promise<string>((resolve, reject) => {
    execFile(
      process.execPath,
      ["scripts/db-local.ts", "test", "seed-file", `e2e/seeds/${file}`],
      { cwd: process.cwd(), windowsHide: true },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

type Guarded = {
  context: BrowserContext;
  page: Page;
  errors: string[];
  readPuts: { roomId: string; status: number | null }[];
};

/**
 * テストの間で使い回すブラウザ。console-guard の page と同じく、エラーレベルのコンソール出力と処理されなかった例外を集める。
 * 未ログインのときのセッションの確認（401）は仕様どおりのため許す。既読の要求（PUT .../read-position）を部屋ごとに記録する。
 */
async function guardedPage(browser: Browser): Promise<Guarded> {
  const context = await browser.newContext({ baseURL: ORIGIN });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  const errors: string[] = [];
  const readPuts: Guarded["readPuts"] = [];
  const allowed = [
    /Failed to load resource: the server responded with a status of 401/,
  ];
  page.on("console", (m) => {
    if (m.type() === "error" && !allowed.some((re) => re.test(m.text())))
      errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  const readPath = /^\/api\/rooms\/([^/]+)\/read-position$/;
  page.on("request", (request: Request) => {
    const match = readPath.exec(new URL(request.url()).pathname);
    if (request.method() === "PUT" && match?.[1] !== undefined)
      readPuts.push({ roomId: match[1], status: null });
  });
  page.on("response", (response) => {
    const match = readPath.exec(new URL(response.url()).pathname);
    if (response.request().method() !== "PUT" || match?.[1] === undefined)
      return;
    const pending = readPuts.find(
      (entry) => entry.roomId === match[1] && entry.status === null,
    );
    if (pending !== undefined) pending.status = response.status();
  });
  return { context, page, errors, readPuts };
}

async function login(page: Page, loginId: string) {
  await page.goto("/login");
  await page.getByLabel("ユーザーID", { exact: true }).fill(loginId);
  await page.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}

const mainNav = (page: Page) =>
  page.getByRole("navigation", { name: "メインメニュー" });

/** 「{名前} 未読 n件」のリンクの名前（名前の完全一致に、読み上げ用の件数が付いたもの） */
const withUnread = (name: string, spoken: string) =>
  new RegExp(
    `^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+${spoken}\\s*$`,
  );

let a: Guarded | undefined;
let b: Guarded | undefined;

function guarded(which: Guarded | undefined, label: string): Guarded {
  if (which === undefined) throw new Error(`${label} のブラウザがありません`);
  return which;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  const before = await seedFile("unread-cleanup.sql");
  expect(before).not.toMatch(/"remaining_\w+":\s*[1-9]/);
  await seedFile("unread.sql");
  a = await guardedPage(browser);
  await login(a.page, "e2euser_unread_a");
});

test.afterAll(async () => {
  for (const opened of [a, b]) await opened?.context.close();
  const output = await seedFile("unread-cleanup.sql");
  // 後始末の後の残数がすべて 0 であること（read_positions・メッセージ・参加・会話・部屋・利用者・部署）
  expect(output).toMatch(/"remaining_read_positions":\s*0/);
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
});

test.afterEach(() => {
  // 開いているすべてのブラウザで、エラーレベルのコンソール出力・処理されなかった例外が無いこと
  for (const opened of [a, b])
    expect(opened?.errors ?? [], "コンソールのエラー").toEqual([]);
});

test("#237 AC-1（3-1 AC-1・C-169）: サイドバーに部屋ごとの未読の件数が出る。101件は「99+」、参加の前の投稿は数えない、自分の投稿は数えない。未参加の公開チャンネルは未読の対象にしない", async () => {
  const page = guarded(a, "A").page;
  const nav = mainNav(page);

  // 参加の後の他人の投稿が101件：印は「99+」、リンクの名前は「… 未読 99件以上」
  const unreadLink = nav.getByRole("link", {
    name: withUnread(CHANNEL_UNREAD, "未読 99件以上"),
  });
  await expect(unreadLink).toBeVisible();
  await expect(unreadLink).toContainText("99+");

  // 参加の前の投稿2件と参加の後の投稿1件：「1」（参加の前は数えない）
  const beforeJoinLink = nav.getByRole("link", {
    name: withUnread(CHANNEL_BEFORE_JOIN, "未読 1件"),
  });
  await expect(beforeJoinLink).toBeVisible();

  // DM：B の投稿2件と自分の投稿1件：「2」（自分の投稿は数えない）
  const dmLink = nav.getByRole("link", {
    name: withUnread(NAME_B, "未読 2件"),
  });
  await expect(dmLink).toBeVisible();
  await expect(dmLink).toContainText("2");

  // 未参加の公開チャンネルは、サイドバーにも未読の一覧（API）にも出ない
  await expect(
    nav.getByRole("link", { name: roomLinkName(CHANNEL_UNJOINED) }),
  ).toHaveCount(0);
  const res = await page.request.get("/api/me/unread?limit=100");
  expect(res.status()).toBe(200);
  const body = (await res.json()) as {
    items: { roomId: string; count: number }[];
  };
  expect(body.items.map((item) => item.roomId)).not.toContain(
    CHANNEL_UNJOINED_ID,
  );
  expect(body.items).toContainEqual({ roomId: CHANNEL_UNREAD_ID, count: 100 });
  expect(body.items).toContainEqual({ roomId: DM_ROOM, count: 2 });
});

test("#237 AC-2（3-1 AC-2）: DM を開くと既読になり、再読み込みせずにサイドバーの DM の件数が消える", async () => {
  const opened = guarded(a, "A");
  const page = opened.page;
  const nav = mainNav(page);
  const readResponse = page.waitForResponse(
    (r) =>
      r.request().method() === "PUT" &&
      new URL(r.url()).pathname === `/api/rooms/${DM_ROOM}/read-position`,
  );
  await nav.getByRole("link", { name: withUnread(NAME_B, "未読 2件") }).click();
  await expect(page).toHaveURL(new RegExp(`/dms/${DM_ROOM}$`));
  expect((await readResponse).status()).toBe(204);
  // 再読み込みせずに、件数が消えて名前だけのリンクになる
  await expect(
    nav.getByRole("link", { name: new RegExp(`^\\s*${NAME_B}\\s*$`) }),
  ).toBeVisible();
  await expect(
    nav.getByRole("link", { name: withUnread(NAME_B, "未読 \\d+件") }),
  ).toHaveCount(0);
});

test("#237 AC-1・AC-2: A がホームにいる間に B が DM に投稿すると、A のサイドバーに再読み込みなしで「1」が出る", async ({
  browser,
}) => {
  const page = guarded(a, "A").page;
  await mainNav(page)
    .getByRole("link", { name: "ホーム", exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("ホーム");

  b = await guardedPage(browser);
  await login(b.page, "e2euser_unread_b");
  await b.page.goto(`/dms/${DM_ROOM}`);
  const box = b.page
    .getByRole("main")
    .getByRole("textbox", { name: "メッセージ" });
  await box.fill(NEW_DM_BODY);
  await b.page.getByRole("button", { name: "送信", exact: true }).click();
  await expect(b.page.getByRole("log")).toContainText(NEW_DM_BODY);

  // A の画面は再読み込みしない。2秒ごとの未読の取得で、件数が出る
  await expect(
    mainNav(page).getByRole("link", { name: withUnread(NAME_B, "未読 1件") }),
  ).toBeVisible({ timeout: 10_000 });
});

test("#237 AC-2: チャンネルを開くと件数が消え、再読み込みしても戻らない（既読はサーバーに残る）", async () => {
  const page = guarded(a, "A").page;
  const nav = mainNav(page);
  const readResponse = page.waitForResponse(
    (r) =>
      r.request().method() === "PUT" &&
      new URL(r.url()).pathname ===
        `/api/rooms/${CHANNEL_UNREAD_ID}/read-position`,
  );
  await nav
    .getByRole("link", { name: withUnread(CHANNEL_UNREAD, "未読 99件以上") })
    .click();
  await expect(page).toHaveURL(new RegExp(`/channels/${CHANNEL_UNREAD_ID}$`));
  await expect(
    page.getByRole("heading", { level: 1, name: CHANNEL_UNREAD }),
  ).toBeVisible();
  expect((await readResponse).status()).toBe(204);
  const plainName = new RegExp(
    `^\\s*${CHANNEL_UNREAD.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`,
  );
  await expect(nav.getByRole("link", { name: plainName })).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: CHANNEL_UNREAD }),
  ).toBeVisible();
  await expect(
    mainNav(page).getByRole("link", { name: plainName }),
  ).toBeVisible();
  // 再読み込みの後、未読の一覧を取り直しても件数は出ない
  const res = await page.request.get("/api/me/unread?limit=100");
  const body = (await res.json()) as { items: { roomId: string }[] };
  expect(body.items.map((item) => item.roomId)).not.toContain(
    CHANNEL_UNREAD_ID,
  );
});

test("#237 AC-1（1-1 AC-2・C-94）: 未参加の公開チャンネルを開いても、読めるが既読の要求は出ない", async () => {
  const opened = guarded(a, "A");
  const page = opened.page;
  const before = opened.readPuts.length;
  // 2秒ごとのメッセージの取得が少なくとも1回終わるまで待ち、その間に既読の要求が出ないことを確かめる
  const polled = page.waitForResponse(
    (r) =>
      r.request().method() === "GET" &&
      new URL(r.url()).pathname ===
        `/api/rooms/${CHANNEL_UNJOINED_ID}/messages` &&
      new URL(r.url()).searchParams.has("after"),
  );
  await page.goto(`/channels/${CHANNEL_UNJOINED_ID}`);
  await expect(
    page.getByRole("heading", { level: 1, name: CHANNEL_UNJOINED }),
  ).toBeVisible();
  await expect(page.getByRole("log")).toContainText(
    "[E2E_TEST]未参加のチャンネルの投稿2",
  );
  await expect(page.getByRole("button", { name: "参加する" })).toBeVisible();
  await polled;
  expect(
    opened.readPuts
      .slice(before)
      .filter((entry) => entry.roomId === CHANNEL_UNJOINED_ID),
  ).toEqual([]);
});
