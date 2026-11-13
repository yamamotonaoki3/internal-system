// #239 AC-1〜AC-6（1-1 AC-4・0-2 AC-8・C-82・C-117）：メッセージ入力欄の下書きを端末（localStorage）に一時保存することを、実ブラウザで確かめる。
// 再読み込み・自動ログアウト後の復元、同じ端末の別の社員からの分離、アプリを開いたときの期限切れの消去、画面を離れる前の確認（リンク・ドロワー・タブを閉じる）、
// 複数タブ（最後に書いたものを優先し、他のタブに反映しない）、手動ログアウトの前の確認と、ログアウトの失敗の案内が見える位置に出ること、ログアウトの成功で下書きが消えること。
// 前提：e2e/seeds/message-drafts.sql（[E2E_TEST]部署239・e2euser_draft_a/_b・チャンネル2つ）。
// 後始末は e2e/seeds/message-drafts-cleanup.sql（社員ID e2euser_draft_・部署名 [E2E_TEST]部署239 だけ。残数 0 を確かめる）。
// ログインの試行制限（#225）に当たらないよう、ログインは A・B の 2 回だけにし、利用者の切り替えは Cookie（__Host-session）の差し替えで行う。
// A のセッションを失効させるログアウトの成功は、最後のテストで行う。テストは順に実行し、ブラウザのコンテキストを使い回す。
// 文言・キーの形は frontend/src/features/{drafts,leave-guard,messages,auth}/*.test.tsx の契約と同じ。
import { execFile } from "node:child_process";
import type {
  Browser,
  BrowserContext,
  Cookie,
  Dialog,
  Page,
} from "@playwright/test";
import { expect, test } from "./console-guard";
import { roomLinkName } from "./room-link";

const ORIGIN = "http://localhost:5173";
const PASSWORD = "TestPass123!";
const USER_A_ID = "01JTE2E2390000000000000A01";
const USER_B_ID = "01JTE2E2390000000000000A02";
const NAME_A = "E2E下書き利用者A";
const C01 = "01JTE2E2390000000000000C01";
const C02 = "01JTE2E2390000000000000C02";
const C01_NAME = "[E2E_TEST]部署239の下書き1";
const C02_NAME = "[E2E_TEST]部署239の下書き2";
const PREFIX = "internal-system:draft:v1:";
const DAY = 24 * 60 * 60 * 1000;
const DIALOG_NAME = /入力した内容は失われます/;
const LOGOUT_FAILURE = /ログアウトできませんでした/;

const keyOf = (userId: string, roomId: string) =>
  `${PREFIX}${userId}:room:${roomId}`;

function seedFile(file: "message-drafts.sql" | "message-drafts-cleanup.sql") {
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
  /** テストの中だけで、意図したエラー（ログアウトの 500 等）を許す */
  allowed: RegExp[];
  /** サーバーへ送った要求の本文（下書きを送っていないことの確認用） */
  postBodies: string[];
};

/** console-guard の page と同じく、エラーレベルのコンソール出力と処理されなかった例外を集める。未ログイン・Cookie を消した後の 401 は仕様どおりのため許す */
function watch(
  page: Page,
  holder: Pick<Guarded, "errors" | "allowed" | "postBodies">,
) {
  const base = [
    /Failed to load resource: the server responded with a status of 401/,
  ];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if ([...base, ...holder.allowed].some((re) => re.test(m.text()))) return;
    holder.errors.push(m.text());
  });
  page.on("pageerror", (e) => holder.errors.push(String(e)));
  page.on("request", (request) => {
    const body = request.postData();
    if (body !== null) holder.postBodies.push(body);
  });
}

async function guardedContext(browser: Browser): Promise<Guarded> {
  const context = await browser.newContext({ baseURL: ORIGIN });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  const holder: Guarded = {
    context,
    page,
    errors: [],
    allowed: [],
    postBodies: [],
  };
  watch(page, holder);
  return holder;
}

async function login(page: Page, loginId: string) {
  await page.goto("/login");
  await page.getByLabel("ユーザーID", { exact: true }).fill(loginId);
  await page.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function sessionCookie(context: BrowserContext): Promise<Cookie> {
  const cookie = (await context.cookies()).find(
    (c) => c.name === "__Host-session",
  );
  if (cookie === undefined) throw new Error("__Host-session がありません");
  return cookie;
}

/** 同じブラウザ（同じ localStorage）のまま、ログインしている社員を Cookie で切り替える */
async function useSession(context: BrowserContext, cookie: Cookie) {
  await context.clearCookies();
  await context.addCookies([
    {
      name: cookie.name,
      value: cookie.value,
      // __Host- の Cookie は Domain 属性なし・Path=/・Secure が必要。url 指定（http）では拒否されるため domain/path で渡す
      domain: cookie.domain,
      path: cookie.path,
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

const mainNav = (page: Page) =>
  page.getByRole("navigation", { name: "メインメニュー" });
const composer = (page: Page) =>
  page.getByRole("main").getByRole("textbox", { name: "メッセージ" });
const confirmDialog = (page: Page) =>
  page.getByRole("dialog", { name: DIALOG_NAME });

async function openRoom(page: Page, roomId: string, name: string) {
  await page.goto(`/channels/${roomId}`);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(composer(page)).toBeVisible();
}

/** キーボードで入力する（click と打鍵で、beforeunload の確認に必要な利用者の操作になる） */
async function typeInto(page: Page, text: string) {
  await composer(page).click();
  // クリックした位置ではなく、本文の末尾に書き足す
  await page.keyboard.press("ControlOrMeta+End");
  await composer(page).pressSequentially(text);
}

async function storedDraft(page: Page, key: string) {
  return page.evaluate((k) => {
    const raw = window.localStorage.getItem(k);
    return raw === null
      ? null
      : (JSON.parse(raw) as { body: string; updatedAt: number });
  }, key);
}

async function draftKeys(page: Page) {
  return page.evaluate(
    (prefix) =>
      Object.keys(window.localStorage).filter((k) => k.startsWith(prefix)),
    PREFIX,
  );
}

/** 変更が残っていても、beforeunload の確認を受け入れて再読み込みする */
async function reloadAccepting(page: Page) {
  const unload = acceptBeforeUnload(page);
  try {
    await page.reload();
  } finally {
    unload.stop();
  }
  await expect(composer(page)).toBeVisible();
}

/** beforeunload の確認が出たら受け入れる（離れることを選ぶ）。出たかどうかを返す */
function acceptBeforeUnload(page: Page) {
  const seen: string[] = [];
  const handler = (dialog: Dialog) => {
    seen.push(dialog.type());
    void dialog.accept();
  };
  page.on("dialog", handler);
  return {
    seen,
    stop: () => page.off("dialog", handler),
  };
}

let a: Guarded | undefined;
let cookieA: Cookie | undefined;
let cookieB: Cookie | undefined;

function main(): Guarded {
  if (a === undefined) throw new Error("A のブラウザがありません");
  return a;
}
function cookie(which: Cookie | undefined, label: string): Cookie {
  if (which === undefined) throw new Error(`${label} の Cookie がありません`);
  return which;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  const before = await seedFile("message-drafts-cleanup.sql");
  expect(before).not.toMatch(/"remaining_\w+":\s*[1-9]/);
  await seedFile("message-drafts.sql");
  // B のログインは別のコンテキストで1回だけ行い、Cookie だけを使う
  const b = await guardedContext(browser);
  await login(b.page, "e2euser_draft_b");
  cookieB = await sessionCookie(b.context);
  await b.context.close();
  expect(b.errors, "B のログインのコンソールのエラー").toEqual([]);

  a = await guardedContext(browser);
  await login(a.page, "e2euser_draft_a");
  cookieA = await sessionCookie(a.context);
});

test.afterAll(async () => {
  await a?.context.close();
  const output = await seedFile("message-drafts-cleanup.sql");
  expect(output).toMatch(/"remaining_users":\s*0/);
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
});

test.afterEach(() => {
  expect(a?.errors ?? [], "コンソールのエラー").toEqual([]);
  if (a !== undefined) a.allowed.length = 0;
});

test("#239 AC-1: 入力した下書きは端末に保存され、再読み込みしても復元する。サーバーには送らない", async () => {
  const { page, postBodies } = main();
  await openRoom(page, C01, C01_NAME);
  await typeInto(page, "[E2E_TEST]再読み込みの前の書きかけ");
  const saved = await storedDraft(page, keyOf(USER_A_ID, C01));
  expect(saved?.body).toBe("[E2E_TEST]再読み込みの前の書きかけ");
  expect(typeof saved?.updatedAt).toBe("number");

  const unload = acceptBeforeUnload(page);
  await page.reload();
  unload.stop();
  await expect(composer(page)).toHaveValue(
    "[E2E_TEST]再読み込みの前の書きかけ",
  );
  expect(postBodies.some((body) => body.includes("再読み込みの前"))).toBe(
    false,
  );
});

test("#239 AC-1（U-7）: Cookie が消えて自動でログアウトされても下書きは残り、同じ社員でまた開くと復元する", async () => {
  const { page, context } = main();
  await context.clearCookies();
  // 2 秒ごとのメッセージの取得が 401 になり、/login へ移る
  await expect(page).toHaveURL(/\/login$/, { timeout: 10_000 });
  expect((await storedDraft(page, keyOf(USER_A_ID, C01)))?.body).toBe(
    "[E2E_TEST]再読み込みの前の書きかけ",
  );
  await useSession(context, cookie(cookieA, "A"));
  await openRoom(page, C01, C01_NAME);
  await expect(composer(page)).toHaveValue(
    "[E2E_TEST]再読み込みの前の書きかけ",
  );
});

test("#239 AC-2: 同じ端末で別の社員（B）が同じチャンネルを開くと入力欄は空で、A に戻すと復元する", async () => {
  const { page, context } = main();
  await useSession(context, cookie(cookieB, "B"));
  await openRoom(page, C01, C01_NAME);
  await expect(composer(page)).toHaveValue("");
  // A の下書きは端末に残ったまま（画面に出ないだけ）
  expect((await storedDraft(page, keyOf(USER_A_ID, C01)))?.body).toBe(
    "[E2E_TEST]再読み込みの前の書きかけ",
  );
  await useSession(context, cookie(cookieA, "A"));
  await openRoom(page, C01, C01_NAME);
  await expect(composer(page)).toHaveValue(
    "[E2E_TEST]再読み込みの前の書きかけ",
  );
});

test("#239 AC-3: アプリを開いたとき、開かない部屋・他の社員の分も含めて期限切れ（8日前）だけを消し、期限内は残して開いたときに復元する", async () => {
  const { page } = main();
  await page.evaluate(
    ({ entries }) => {
      for (const [key, value] of entries)
        window.localStorage.setItem(key, value);
    },
    {
      entries: [
        [
          keyOf(USER_A_ID, C02),
          JSON.stringify({
            body: "[E2E_TEST]期限内の下書き",
            updatedAt: Date.now() - DAY,
          }),
        ],
        [
          keyOf(USER_A_ID, "01JTE2E2390000000000000Z99"),
          JSON.stringify({
            body: "[E2E_TEST]開かない部屋の期限切れ",
            updatedAt: Date.now() - 8 * DAY,
          }),
        ],
        [
          keyOf(USER_B_ID, C01),
          JSON.stringify({
            body: "[E2E_TEST]Bの期限切れ",
            updatedAt: Date.now() - 8 * DAY,
          }),
        ],
        ["e2e-test-other-key", "[E2E_TEST]関係のないキー"],
      ] as [string, string][],
    },
  );
  await page.reload();
  await expect(composer(page)).toBeVisible();
  expect((await draftKeys(page)).sort()).toEqual(
    [keyOf(USER_A_ID, C01), keyOf(USER_A_ID, C02)].sort(),
  );
  expect(
    await page.evaluate(() =>
      window.localStorage.getItem("e2e-test-other-key"),
    ),
  ).toBe("[E2E_TEST]関係のないキー");

  await mainNav(page)
    .getByRole("link", { name: roomLinkName(C02_NAME) })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: C02_NAME }),
  ).toBeVisible();
  await expect(composer(page)).toHaveValue("[E2E_TEST]期限内の下書き");
});

test("#239 AC-4・AC-5: 変更があるときにサイドバーのリンクで移ろうとすると確認を出す。「編集を続ける」で留まり、「破棄して離れる」で下書きを消して移る", async () => {
  const { page } = main();
  // 復元しただけ（変更なし）なので、まだ確認は出ない状態。書き足して変更ありにする
  await typeInto(page, "に書き足し");
  const toC01 = mainNav(page).getByRole("link", {
    name: roomLinkName(C01_NAME),
  });
  await toC01.click();
  await expect(confirmDialog(page)).toBeVisible();
  await expect(
    confirmDialog(page).getByRole("button", { name: "編集を続ける" }),
  ).toBeFocused();
  await confirmDialog(page)
    .getByRole("button", { name: "編集を続ける" })
    .click();
  await expect(confirmDialog(page)).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/channels/${C02}$`));
  await expect(composer(page)).toHaveValue(
    "[E2E_TEST]期限内の下書きに書き足し",
  );
  expect(
    await page.evaluate(() => document.activeElement !== document.body),
  ).toBe(true);

  await toC01.click();
  await confirmDialog(page)
    .getByRole("button", { name: "破棄して離れる" })
    .click();
  await expect(page).toHaveURL(new RegExp(`/channels/${C01}$`));
  expect(await storedDraft(page, keyOf(USER_A_ID, C02))).toBeNull();
  // 他の部屋の下書きは消さない
  expect((await storedDraft(page, keyOf(USER_A_ID, C01)))?.body).toBe(
    "[E2E_TEST]再読み込みの前の書きかけ",
  );
});

test("#239 AC-5: スマホ幅でドロワーのリンクから移ろうとすると、ドロワーは閉じて確認ダイアログだけが出て、フォーカスは「編集を続ける」", async () => {
  const { page } = main();
  await page.setViewportSize({ width: 375, height: 667 });
  try {
    await openRoom(page, C02, C02_NAME);
    await typeInto(page, "[E2E_TEST]スマホの書きかけ");
    await page.getByRole("button", { name: "メニューを開く" }).click();
    const drawer = page.getByRole("dialog", { name: "メニュー" });
    await expect(drawer).toBeVisible();
    await drawer.getByRole("link", { name: roomLinkName(C01_NAME) }).click();
    await expect(confirmDialog(page)).toBeVisible();
    await expect(drawer).toBeHidden();
    await expect(
      confirmDialog(page).getByRole("button", { name: "編集を続ける" }),
    ).toBeFocused();
    await confirmDialog(page)
      .getByRole("button", { name: "編集を続ける" })
      .click();
    await expect(confirmDialog(page)).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/channels/${C02}$`));
    expect(
      await page.evaluate(() => document.activeElement !== document.body),
    ).toBe(true);
  } finally {
    await page.setViewportSize({ width: 1280, height: 800 });
  }
});

test("#239 AC-5・AC-6: 2つのタブで同じ下書きを編集すると、後に書いた方が保存され先のタブは変わらない。変更があるタブを閉じるとブラウザの確認が出て、下書きは消えない", async () => {
  const { page, context } = main();
  // 先のタブ（main）は C02 に「スマホの書きかけ」が入ったまま
  const second = await context.newPage();
  const holder = {
    errors: [] as string[],
    allowed: [] as RegExp[],
    postBodies: [] as string[],
  };
  watch(second, holder);
  await openRoom(second, C02, C02_NAME);
  await expect(composer(second)).toHaveValue("[E2E_TEST]スマホの書きかけ");
  await composer(second).click();
  await second.keyboard.press("ControlOrMeta+A");
  await composer(second).pressSequentially("[E2E_TEST]後のタブ");
  expect((await storedDraft(second, keyOf(USER_A_ID, C02)))?.body).toBe(
    "[E2E_TEST]後のタブ",
  );
  // 先のタブには反映しない（C-117）
  await expect(composer(page)).toHaveValue("[E2E_TEST]スマホの書きかけ");

  const closing = new Promise<string>((resolve) => {
    second.once("dialog", (dialog) => {
      resolve(dialog.type());
      void dialog.accept();
    });
  });
  await second.close({ runBeforeUnload: true });
  expect(await closing).toBe("beforeunload");
  expect(holder.errors).toEqual([]);
  expect((await storedDraft(page, keyOf(USER_A_ID, C02)))?.body).toBe(
    "[E2E_TEST]後のタブ",
  );

  // 先のタブを再読み込みすると、最後に保存した内容（後のタブ）を復元する
  const unload = acceptBeforeUnload(page);
  await page.reload();
  unload.stop();
  await expect(composer(page)).toHaveValue("[E2E_TEST]後のタブ");
});

test("#239 AC-5（U-7）: 離脱の確認を表示中に Cookie が消えて定期の取得が 401 になっても、/login へ移り、確認ダイアログは残らず、未処理の例外もなく、下書きは端末に残る", async () => {
  const { page, context, errors } = main();
  const before = errors.length;
  try {
    await openRoom(page, C02, C02_NAME);
    await typeInto(page, "[E2E_TEST]確認中に失効");
    const expected = (await storedDraft(page, keyOf(USER_A_ID, C02)))?.body;
    expect(expected).toContain("[E2E_TEST]確認中に失効");
    await mainNav(page)
      .getByRole("link", { name: roomLinkName(C01_NAME) })
      .click();
    await expect(confirmDialog(page)).toBeVisible();

    // 確認の表示中にセッションを失効させる（2 秒ごとの取得が 401 になる）
    await context.clearCookies();
    await expect(page).toHaveURL(/\/login$/, { timeout: 10_000 });
    await expect(confirmDialog(page)).toHaveCount(0);
    expect(
      errors.slice(before),
      "ページの未処理の例外・コンソールのエラー",
    ).toEqual([]);
    expect((await storedDraft(page, keyOf(USER_A_ID, C02)))?.body).toBe(
      expected,
    );
  } finally {
    // 後続のテストのために、A のセッションを戻す（ログインは増やさない）
    await useSession(context, cookie(cookieA, "A"));
  }
});

test("#239 AC-5: ブラウザの戻る（POP）で離れようとすると確認を出す。「編集を続ける」で確認が閉じて部屋に留まり本文が残り、もう一度戻って「破棄して離れる」で確認が閉じて前の画面へ移り、下書きが消える", async () => {
  const { page, errors } = main();
  const before = errors.length;
  // 画面内の遷移（SPA）だけで履歴を作る。goto で開くと戻るが文書の遷移になり、ルーターの判定を通らない
  await page.goto("/");
  await mainNav(page)
    .getByRole("link", { name: roomLinkName(C02_NAME) })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: C02_NAME }),
  ).toBeVisible();
  await expect(composer(page)).toBeVisible();
  await typeInto(page, "[E2E_TEST]戻るの確認");
  const typed = await composer(page).inputValue();
  expect(typed).toContain("[E2E_TEST]戻るの確認");

  // 1回目：編集を続ける
  await page.evaluate(() => window.history.back());
  await expect(confirmDialog(page)).toBeVisible();
  await confirmDialog(page)
    .getByRole("button", { name: "編集を続ける" })
    .click();
  await expect(confirmDialog(page)).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/channels/${C02}$`));
  await expect(composer(page)).toHaveValue(typed);

  // 2回目：破棄して離れる
  await page.evaluate(() => window.history.back());
  await expect(confirmDialog(page)).toBeVisible();
  await confirmDialog(page)
    .getByRole("button", { name: "破棄して離れる" })
    .click();
  await expect(confirmDialog(page)).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);
  expect(await storedDraft(page, keyOf(USER_A_ID, C02))).toBeNull();
  expect(
    errors.slice(before),
    "ページの未処理の例外・コンソールのエラー",
  ).toEqual([]);
});

/** ウィンドウを下までスクロールし、ヘッダー（失敗の案内の位置）が表示域の外にあることを確かめる */
async function scrollToBottom(page: Page) {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(0);
  await expect(page.getByRole("banner")).not.toBeInViewport();
}

const failureNotice = (page: Page) =>
  page.getByRole("alert").filter({ hasText: LOGOUT_FAILURE });

async function failLogout(page: Page, gate?: Promise<void>) {
  await page.route("**/api/auth/logout", async (route) => {
    if (gate !== undefined) await gate;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({
        code: "INTERNAL",
        message: "エラーが発生しました",
      }),
    });
  });
}

test("#239 AC-4（U-2）: スマホ幅で下までスクロールし、変更があるままログアウト →「破棄して離れる」→ API が失敗すると、失敗の案内が見える位置に出て、下書きと本文が残る", async () => {
  const { page, allowed } = main();
  allowed.push(/the server responded with a status of 500/);
  await page.setViewportSize({ width: 375, height: 667 });
  try {
    await openRoom(page, C01, C01_NAME);
    await typeInto(page, "に追記");
    await scrollToBottom(page);
    await failLogout(page);
    await page.getByRole("button", { name: "自分", exact: true }).click();
    await page.getByRole("button", { name: "ログアウト", exact: true }).click();
    await expect(confirmDialog(page)).toBeVisible();
    await confirmDialog(page)
      .getByRole("button", { name: "破棄して離れる" })
      .click();
    await expect(failureNotice(page).first()).toBeInViewport();
    expect(
      await page.evaluate(() => document.activeElement !== document.body),
    ).toBe(true);
    await expect(page).toHaveURL(new RegExp(`/channels/${C01}$`));
    await expect(composer(page)).toHaveValue(
      "[E2E_TEST]再読み込みの前の書きかけに追記",
    );
    expect((await storedDraft(page, keyOf(USER_A_ID, C01)))?.body).toBe(
      "[E2E_TEST]再読み込みの前の書きかけに追記",
    );
  } finally {
    await page.unroute("**/api/auth/logout");
    await page.setViewportSize({ width: 1280, height: 800 });
  }
});

test("#239 AC-4（U-2）: デスクトップ幅（縦にスクロールする高さ）でも、ログアウトの失敗の案内が見える位置に出る", async () => {
  const { page, allowed } = main();
  allowed.push(/the server responded with a status of 500/);
  await page.setViewportSize({ width: 1280, height: 500 });
  try {
    await reloadAccepting(page);
    await typeInto(page, "と");
    await scrollToBottom(page);
    await failLogout(page);
    await page
      .getByRole("button", { name: `アカウントメニュー（${NAME_A}）` })
      .click();
    await page.getByRole("button", { name: "ログアウト", exact: true }).click();
    await confirmDialog(page)
      .getByRole("button", { name: "破棄して離れる" })
      .click();
    await expect(failureNotice(page).first()).toBeInViewport();
    expect(
      await page.evaluate(() => document.activeElement !== document.body),
    ).toBe(true);
    expect((await storedDraft(page, keyOf(USER_A_ID, C01)))?.body).toBe(
      "[E2E_TEST]再読み込みの前の書きかけに追記と",
    );
  } finally {
    await page.unroute("**/api/auth/logout");
    await page.setViewportSize({ width: 1280, height: 800 });
  }
});

test("#239 AC-4（改訂5）: 失敗の前に入力欄へフォーカスを置いていても（フォーカスを移さないときも）、失敗の案内は表示域に入る", async () => {
  const { page, allowed } = main();
  allowed.push(/the server responded with a status of 500/);
  await page.setViewportSize({ width: 375, height: 667 });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await reloadAccepting(page);
    await typeInto(page, "!");
    await scrollToBottom(page);
    await failLogout(page, gate);
    await page.getByRole("button", { name: "自分", exact: true }).click();
    await page.getByRole("button", { name: "ログアウト", exact: true }).click();
    await confirmDialog(page)
      .getByRole("button", { name: "破棄して離れる" })
      .click();
    // 応答を待つ間に、利用者が入力欄に戻る
    await composer(page).focus();
    await scrollToBottom(page);
    release();
    await expect(failureNotice(page).first()).toBeInViewport();
    await expect(composer(page)).toBeFocused();
  } finally {
    release();
    await page.unroute("**/api/auth/logout");
    await page.setViewportSize({ width: 1280, height: 800 });
  }
});

test("#239 AC-4・AC-5: 変更があるままログアウトを押すと確認を出し、「破棄して離れる」でログアウトが成功すると /login へ移り、端末の下書きは0件になる", async () => {
  const { page } = main();
  await reloadAccepting(page);
  await typeInto(page, "[E2E_TEST]最後の書き足し");
  expect((await draftKeys(page)).length).toBeGreaterThan(0);
  await page
    .getByRole("button", { name: `アカウントメニュー（${NAME_A}）` })
    .click();
  await page.getByRole("button", { name: "ログアウト", exact: true }).click();
  await expect(confirmDialog(page)).toBeVisible();
  await confirmDialog(page)
    .getByRole("button", { name: "破棄して離れる" })
    .click();
  await expect(page).toHaveURL(/\/login$/);
  expect(await draftKeys(page)).toEqual([]);
  expect(
    await page.evaluate(() =>
      window.localStorage.getItem("e2e-test-other-key"),
    ),
  ).toBe("[E2E_TEST]関係のないキー");
  await expect(
    page.getByText("この端末の下書きを消せませんでした", { exact: false }),
  ).toHaveCount(0);
});
