// #137 AC-1（1-4 AC-1〜AC-4・C-59・C-94・C-147）：スレッドの返信とスレッド一覧を、画面からバックエンドまで通して確かめる。
// ① A がチャンネルから S-07 を開いて返信すると、再読み込みせずに返信が出て、チャンネルの親の行が「返信 1 件」になる（閉じるとフォーカスが戻る）
// ② B（別のブラウザ）が開いたままの S-35（/threads）に、再読み込みなしで新しいスレッドと未読の件数が出る。行を選ぶと S-07 が開き、既読になって、印が再読み込みなしで消える
// ③ スレッド一覧の並びは最後の返信が新しい順。自分が関わらないスレッド（親も返信も他人だけ）は出ない
// ④ 親を削除すると、開いている S-07 の返信欄が閉じて案内が出る。既存の返信は読め、API で返信しても 409
// ⑤ 参加していない公開チャンネルでは、スレッドは読めるが返信できない（画面は入力欄なし、API は 403）。既読も送らない
// ⑥ 返信の下書きが、スレッドごとに端末に保存され、?thread= を替えて往復しても混ざらず戻る。変更があるまま別の画面へ移ろうとすると確認が出る
// データを変える操作の後は、再読み込みせずに、関係する表示（返信・件数・未読の印）が変わることを確かめる。
// 前提：e2e/seeds/threads.sql（[E2E_TEST]部署137・e2euser_thr_a/_b・チャンネル2つ・親6件・返信5件）。
// 後始末は e2e/seeds/threads-cleanup.sql（社員ID e2euser_thr_・部署名 [E2E_TEST]部署137 と、その部屋のメッセージだけ。残数 0 を確かめる）。
// ログインの試行制限（#225）に当たらないよう、ログインは A・B の 2 人で 1 回ずつ（計 2 回）だけにし、ブラウザはテストの間で使い回す。
// 画面の文言は frontend/src/features/threads/*.test.tsx・frontend/src/pages/ThreadsPage.test.tsx の契約と同じ。
import { execFile } from "node:child_process";
import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";
import { expect, test } from "./console-guard";

const ORIGIN = "http://localhost:5173";
const PASSWORD = "TestPass123!";
const C01 = "01JTE2E1370000000000000C01";
const C02 = "01JTE2E1370000000000000C02";
const USER_A_ID = "01JTE2E1370000000000000A01";
const P1 = "01M78ZTJC00000000000013701";
const P2 = "01M78ZTJC00000000000013702";
const P3 = "01M78ZTJC00000000000013703";
const P4 = "01M78ZTJC00000000000013704";
const P5 = "01M78ZTJC00000000000013705";
const R5 = "01M7938JW80000000000013715";
const TEXT_P1 = "[E2E_TEST]親1の返信なし";
const TEXT_P2 = "[E2E_TEST]親2の古いスレッド";
const TEXT_P3 = "[E2E_TEST]親3の新しいスレッド";
const TEXT_P4 = "[E2E_TEST]親4のAの投稿";
const TEXT_P5 = "[E2E_TEST]親5の未参加のチャンネル";
const TEXT_P6 = "[E2E_TEST]親6のBは無関係";
const A_REPLY = "[E2E_TEST]AからP1への返信";
const DELETED_PARENT_NOTICE = "元のメッセージが削除されたため、返信できません";
const NOT_JOINED_NOTICE = "このチャンネルに参加すると、返信できます";
const DELETED_TEXT = "このメッセージは削除されました";

function seedFile(file: "threads.sql" | "threads-cleanup.sql") {
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
  /** 画面の読み込み（再読み込みを含む）の回数 */
  loads: () => number;
  /** スレッドの既読（PUT /api/messages/:親ID/thread-read-position）の要求を出した親の ID（届いた順） */
  threadReadPuts: string[];
};

/**
 * テストの間で使い回すブラウザ。console-guard の page と同じく、エラーレベルのコンソール出力と処理されなかった例外を集める。
 * 未ログインのときのセッションの確認（401）は仕様どおりのため許す。
 */
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
  let count = 0;
  page.on("load", () => {
    count += 1;
  });
  const threadReadPuts: string[] = [];
  page.on("request", (request) => {
    const match = /^\/api\/messages\/([^/]+)\/thread-read-position$/.exec(
      new URL(request.url()).pathname,
    );
    if (request.method() === "PUT" && match?.[1] !== undefined)
      threadReadPuts.push(match[1]);
  });
  return { context, page, errors, loads: () => count, threadReadPuts };
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
const roomLog = (page: Page) =>
  page.getByRole("log", { name: "メッセージ一覧" });
const rowWith = (page: Page, text: string): Locator =>
  roomLog(page).getByRole("listitem").filter({ hasText: text });
const pane = (page: Page) => page.getByRole("region", { name: "スレッド" });
const replyLog = (page: Page) =>
  pane(page).getByRole("log", { name: "返信一覧" });
const replyBox = (page: Page) =>
  pane(page).getByRole("textbox", { name: "返信", exact: true });
const threadRows = (page: Page) =>
  page.getByRole("list", { name: "スレッド一覧" }).getByRole("link");
const threadRow = (page: Page, text: string): Locator =>
  threadRows(page).filter({ hasText: text });

/** 「削除」→ 確認の「削除する」。再認証を求められたら、パスワードを入れて続ける */
async function deleteMessage(page: Page, body: string) {
  await rowWith(page, body)
    .getByRole("button", { name: "削除", exact: true })
    .click();
  const confirm = page.getByRole("dialog", { name: "メッセージの削除" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "削除する", exact: true }).click();
  const reauth = page.getByRole("dialog", { name: "再認証" });
  await expect(reauth).toBeVisible();
  await reauth.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
  await reauth.getByRole("button", { name: "再認証", exact: true }).click();
  await expect(reauth).toHaveCount(0);
}

let a: Guarded | undefined;
let b: Guarded | undefined;
let bLoadsAtStart = 0;

function user(which: Guarded | undefined, label: string): Guarded {
  if (which === undefined) throw new Error(`${label} のブラウザがありません`);
  return which;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  const before = await seedFile("threads-cleanup.sql");
  expect(before).not.toMatch(/"remaining_\w+":\s*[1-9]/);
  await seedFile("threads.sql");
  a = await guardedPage(browser);
  await login(a.page, "e2euser_thr_a");
  b = await guardedPage(browser);
  await login(b.page, "e2euser_thr_b");
  // B はスレッド一覧（S-35）を開いたままにする。この後は再読み込みしない（②で、再読み込みなしの反映を確かめる）
  await b.page.goto("/threads");
  await expect(
    b.page.getByRole("heading", { level: 1, name: "スレッド" }),
  ).toBeVisible();
  await expect(threadRow(b.page, TEXT_P3)).toBeVisible();
  bLoadsAtStart = b.loads();
});

test.afterAll(async () => {
  for (const opened of [a, b]) await opened?.context.close();
  const output = await seedFile("threads-cleanup.sql");
  // 後始末の後の残数がすべて 0 であること（スレッドの既読位置・返信・メッセージ・参加・部屋・利用者・部署）
  expect(output).toMatch(/"remaining_thread_read_positions":\s*0/);
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
});

test.afterEach(() => {
  // 開いているすべてのブラウザで、エラーレベルのコンソール出力・処理されなかった例外が無いこと
  for (const opened of [a, b])
    expect(opened?.errors ?? [], "コンソールのエラー").toEqual([]);
});

test("#137 AC-1（1-4 AC-1・AC-3）①: A がチャンネルから S-07 を開いて返信すると、再読み込みなしで返信が出て、親の行が「返信 1 件」になる。閉じるとフォーカスが戻る", async () => {
  const { page, loads } = user(a, "A");
  await page.goto(`/channels/${C01}`);
  await expect(rowWith(page, TEXT_P1)).toBeVisible();
  const loadsBefore = loads();

  const opener = rowWith(page, TEXT_P1).getByRole("button", { name: /返信/ });
  await opener.click();
  await expect(page).toHaveURL(new RegExp(`/channels/${C01}\\?thread=${P1}$`));
  await expect(
    pane(page).getByRole("heading", { name: "スレッド" }),
  ).toBeFocused();
  await expect(pane(page).getByText("まだ返信はありません")).toBeVisible();

  await replyBox(page).fill(A_REPLY);
  await pane(page).getByRole("button", { name: "送信", exact: true }).click();
  // 再読み込みせずに、返信が出て、入力欄は空になり、親の行が「返信 1 件」になる
  await expect(replyLog(page)).toContainText(A_REPLY);
  await expect(replyBox(page)).toHaveValue("");
  await expect(
    rowWith(page, TEXT_P1).getByRole("button", { name: /^返信 1 件/ }),
  ).toBeVisible();
  expect(loads()).toBe(loadsBefore);

  // 閉じると ?thread= が外れ、フォーカスは開いたボタンへ戻る（名前は「返信 1 件」に替わっている）
  await pane(page)
    .getByRole("button", { name: "スレッドを閉じる", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/channels/${C01}$`));
  await expect(pane(page)).toHaveCount(0);
  await expect(
    rowWith(page, TEXT_P1).getByRole("button", { name: /^返信 1 件/ }),
  ).toBeFocused();
});

test("#137 AC-1（1-4 AC-4）②: B が開いたままの S-35 に、再読み込みなしで新しいスレッドと未読の件数が出る。行を選ぶと S-07 が開き、既読になって印が消える", async () => {
  const { page, loads, threadReadPuts } = user(b, "B");
  // A の返信（①）が、再読み込みなしで B の一覧に出る（2秒ごとの取り直し）
  const p1 = threadRow(page, TEXT_P1);
  await expect(p1).toBeVisible({ timeout: 10_000 });
  await expect(p1).toContainText("未読 1件");
  await expect(threadRow(page, TEXT_P2)).toContainText("未読 1件");
  await expect(threadRow(page, TEXT_P3)).toContainText("未読 1件");
  expect(loads()).toBe(bLoadsAtStart);

  const read = page.waitForResponse(
    (r) =>
      r.request().method() === "PUT" &&
      new URL(r.url()).pathname === `/api/messages/${P1}/thread-read-position`,
  );
  await p1.click();
  await expect(page).toHaveURL(new RegExp(`/threads\\?thread=${P1}$`));
  await expect(replyLog(page)).toContainText(A_REPLY);
  expect((await read).status()).toBe(204);
  expect(threadReadPuts).toContain(P1);
  // 再読み込みせずに、P1 の未読の印が消え、ほかのスレッドの未読は残る
  await expect(threadRow(page, TEXT_P1)).not.toContainText("未読");
  await expect(threadRow(page, TEXT_P2)).toContainText("未読 1件");
  await expect(threadRow(page, TEXT_P3)).toContainText("未読 1件");
  expect(loads()).toBe(bLoadsAtStart);

  // 閉じると一覧に戻り、フォーカスは開いた行へ戻る
  await pane(page)
    .getByRole("button", { name: "スレッドを閉じる", exact: true })
    .click();
  await expect(page).toHaveURL(/\/threads$/);
  await expect(threadRow(page, TEXT_P1)).toBeFocused();
});

test("#137 AC-1（1-4 AC-4）③: スレッド一覧は最後の返信が新しい順に並び、自分が関わらないスレッドは出ない（API も同じ）", async () => {
  const { page } = user(b, "B");
  const texts = await threadRows(page).allTextContents();
  const indexOf = (label: string) =>
    texts.findIndex((text) => text.includes(label));
  // A の新しい返信（P1）→ 返信3 → … → 返信2 の順
  expect(indexOf(TEXT_P1)).toBe(0);
  expect(indexOf(TEXT_P3)).toBeGreaterThan(indexOf(TEXT_P1));
  expect(indexOf(TEXT_P2)).toBeGreaterThan(indexOf(TEXT_P3));
  // 自分が返信した（P4・P5）スレッドは出る。親も返信も A だけの P6 は出ない
  expect(indexOf(TEXT_P4)).toBeGreaterThanOrEqual(0);
  expect(indexOf(TEXT_P5)).toBeGreaterThanOrEqual(0);
  expect(indexOf(TEXT_P6)).toBe(-1);

  const response = await page.request.get("/api/me/threads");
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    items: { parent: { id: string }; unreadCount: number }[];
  };
  const ids = body.items.map((item) => item.parent.id);
  expect(ids[0]).toBe(P1);
  expect(ids.indexOf(P3)).toBeLessThan(ids.indexOf(P2));
  expect(ids).not.toContain("01M78ZTJC00000000000013706");
  // P1 は ② で既読にした。P2・P3 は未読 1
  const unread = new Map(
    body.items.map((item) => [item.parent.id, item.unreadCount]),
  );
  expect(unread.get(P1)).toBe(0);
  expect(unread.get(P2)).toBe(1);
  expect(unread.get(P3)).toBe(1);
});

test("#137 AC-2（1-4 AC-2・C-59）④: 親を削除すると、開いている S-07 の返信欄が閉じて案内が出る。既存の返信は読め、API で返信しても 409", async () => {
  const opened = user(b, "B");
  await opened.page.goto(`/channels/${C01}?thread=${P4}`);
  await expect(replyLog(opened.page)).toContainText("[E2E_TEST]返信4のBから");
  await expect(replyBox(opened.page)).toBeVisible();

  // A が親（自分の投稿）を削除する
  const deleter = user(a, "A").page;
  await deleter.goto(`/channels/${C01}`);
  await expect(rowWith(deleter, TEXT_P4)).toBeVisible();
  await deleteMessage(deleter, TEXT_P4);
  await expect(roomLog(deleter)).toContainText(DELETED_TEXT);

  // B の画面は再読み込みしない。2秒ごとの取得で、返信欄が閉じて案内が出る
  await expect(opened.page.getByText(DELETED_PARENT_NOTICE)).toBeVisible({
    timeout: 10_000,
  });
  await expect(replyBox(opened.page)).toHaveCount(0);
  await expect(
    pane(opened.page).getByRole("button", { name: "送信", exact: true }),
  ).toHaveCount(0);
  await expect(pane(opened.page)).toContainText(DELETED_TEXT);
  await expect(replyLog(opened.page)).toContainText("[E2E_TEST]返信4のBから");

  // API を直接呼んでも、削除された親への返信は 409。返信は増えない
  const post = await opened.page.request.post(`/api/messages/${P4}/replies`, {
    headers: { Origin: ORIGIN },
    data: { body: "[E2E_TEST]遅れた返信" },
  });
  expect(post.status()).toBe(409);
  const list = await opened.page.request.get(`/api/messages/${P4}/replies`);
  expect(list.status()).toBe(200);
  const payload = (await list.json()) as {
    items: { body: string | null }[];
    parent: { deleted: boolean; body: string | null };
    replyBlockedReason: string | null;
  };
  expect(payload.items.map((item) => item.body)).toEqual([
    "[E2E_TEST]返信4のBから",
  ]);
  expect(payload.parent.deleted).toBe(true);
  expect(payload.parent.body).toBeNull();
  expect(payload.replyBlockedReason).toBe("deleted_parent");
});

test("#137 AC-1（1-4 AC-1・C-94）⑤: 参加していない公開チャンネルでは、スレッドは読めるが返信できない（画面は入力欄なし・API は 403）。既読も送らない", async () => {
  const { page, threadReadPuts } = user(a, "A");
  const putsBefore = threadReadPuts.length;
  await page.goto(`/channels/${C02}?thread=${P5}`);
  await expect(replyLog(page)).toContainText("[E2E_TEST]返信5のBから");
  await expect(pane(page).getByText(NOT_JOINED_NOTICE)).toBeVisible();
  await expect(replyBox(page)).toHaveCount(0);
  await expect(
    pane(page).getByRole("button", { name: "送信", exact: true }),
  ).toHaveCount(0);

  const post = await page.request.post(`/api/messages/${P5}/replies`, {
    headers: { Origin: ORIGIN },
    data: { body: "[E2E_TEST]参加していない人の返信" },
  });
  expect(post.status()).toBe(403);
  const put = await page.request.put(
    `/api/messages/${P5}/thread-read-position`,
    { headers: { Origin: ORIGIN }, data: { lastReadMessageId: R5 } },
  );
  expect(put.status()).toBe(403);
  // 画面は、既読の要求を出していない（参加者ではないため）。返信も増えていない
  expect(threadReadPuts.slice(putsBefore)).toEqual([]);
  const list = await page.request.get(`/api/messages/${P5}/replies`);
  const payload = (await list.json()) as {
    items: unknown[];
    replyBlockedReason: string | null;
  };
  expect(payload.items).toHaveLength(1);
  expect(payload.replyBlockedReason).toBe("not_joined");
});

test("#137 AC-1（1-4 AC-3）⑥: 返信の下書きはスレッドごとに端末へ保存され、?thread= を替えて往復しても混ざらず戻る。変更があるまま別の画面へ移ろうとすると確認が出る", async () => {
  const { page } = user(a, "A");
  await page.goto(`/channels/${C01}`);
  await expect(rowWith(page, TEXT_P2)).toBeVisible();
  const draftKey = (parentId: string) =>
    `internal-system:draft:v1:${USER_A_ID}:thread:${C01}:${parentId}`;
  const stored = (parentId: string) =>
    page.evaluate(
      (key) => window.localStorage.getItem(key),
      draftKey(parentId),
    );

  // P2 を開いて書く。書きかけは P2 のキーだけに保存される
  await rowWith(page, TEXT_P2)
    .getByRole("button", { name: /^返信 1 件/ })
    .click();
  await expect(replyBox(page)).toBeVisible();
  await replyBox(page).fill("[E2E_TEST]P2の書きかけ");
  await expect
    .poll(async () => (await stored(P2)) ?? "")
    .toContain("[E2E_TEST]P2の書きかけ");
  expect(await stored(P3)).toBeNull();

  // 変更があるまま別の画面（ホーム）へ移ろうとすると、確認が出て、「編集を続ける」で留まる
  await mainNav(page)
    .getByRole("link", { name: "ホーム", exact: true })
    .click();
  const leave = page.getByRole("dialog", { name: /入力した内容は失われます/ });
  await expect(leave).toBeVisible();
  await leave.getByRole("button", { name: "編集を続ける" }).click();
  await expect(leave).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/channels/${C01}\\?thread=${P2}$`));
  await expect(replyBox(page)).toHaveValue("[E2E_TEST]P2の書きかけ");

  // ?thread= だけを P3 に替えると、P3 の入力欄は空で始まり、P2 の書きかけは混ざらない
  await rowWith(page, TEXT_P3)
    .getByRole("button", { name: /^返信 1 件/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`\\?thread=${P3}$`));
  await expect(replyLog(page)).toContainText("[E2E_TEST]返信3のAから");
  await expect(replyBox(page)).toHaveValue("");
  await replyBox(page).fill("[E2E_TEST]P3の書きかけ");
  await expect
    .poll(async () => (await stored(P3)) ?? "")
    .toContain("[E2E_TEST]P3の書きかけ");

  // P2 に戻すと、P2 の書きかけが戻る。P3 の書きかけは P3 に残る
  await rowWith(page, TEXT_P2)
    .getByRole("button", { name: /^返信 1 件/ })
    .click();
  await expect(replyLog(page)).toContainText("[E2E_TEST]返信2のAから");
  await expect(replyBox(page)).toHaveValue("[E2E_TEST]P2の書きかけ");
  expect(await stored(P3)).toContain("[E2E_TEST]P3の書きかけ");

  // 送信すると、P2 の下書きだけが消える（P2 の入力欄の本文が P2 に送られる）
  await pane(page).getByRole("button", { name: "送信", exact: true }).click();
  await expect(replyLog(page)).toContainText("[E2E_TEST]P2の書きかけ");
  await expect(replyBox(page)).toHaveValue("");
  expect(await stored(P2)).toBeNull();
  expect(await stored(P3)).toContain("[E2E_TEST]P3の書きかけ");
});
