// #298・#376 AC-1〜AC-7（計画 plan-298 改訂3 の 8-1 の E2E の行）、画面 S-17：同じブラウザの別のタブで別の利用者 B がログインし直し、
// Cookie が B に替わったとき、A の画面の要求は A のヘッダー（X-Expected-User-Id）で送られ、サーバーが 409 SESSION_USER_MISMATCH で断る。
// B の投稿は増えず、A の部屋の下書きは残る。A の画面（同じコンテキストの2ページ）は、資格の喪失と取り違えず、切り替えとして1回ずつ読み込み直され、B の画面になる。
// 読み込み直しを待つ間（受理済みの書き込みを待つ）は覆いが出て、入力欄に届かず、入力が変更ありでも beforeunload の確認で止まらない。
// jsdom では確かめられない、実ブラウザの Cookie の共有・実際の読み込み直し・beforeunload・覆いの下の Tab だけを確かめる。
// 判定の網羅（取り直しの結果ごと・回数・交錯）は、単体と画面のテスト（frontend/src/features/auth/session-user-mismatch-handler.test.ts・
// frontend/src/features/access-loss/reload-after-access-loss.user-switch.test.ts・frontend/src/pages/CaseAccessLoss.userMismatch.test.tsx ほか）に任せ、重ねない。
// 観測の仕組み：
//   - A のページ1（S-17）・ページ3（観測のページ /）を、B のログインの前に開く。両ページの API の要求（セッションの取得を含む）を page.route で保留し、
//     フォーカス等の取り直しで、意図より先に B を見ないようにする。あわせて、B のログインの処理中に A の Cookie のままの要求が
//     サーバーへ届いて 401 と Cookie の削除（Max-Age=0）を受け、B の Cookie が消える競合も防ぐ（保留は、Cookie が B に替わったことを確かめた後に解く）
//   - B のログインは、同じコンテキストの API（context.request）で、許可した Origin を付けて行う（Cookie を共有する）。ログインは A・B で1回ずつ、計2回
//   - ページ1の投稿（POST /api/rooms/:roomId/messages）は page.route で保留し、要求のヘッダーを記録する（読み込み直しの入口が、受理済みの書き込みを待つ間を作る）
//   - 各ページの文書の読み込み（主の枠の document の要求）を、保留を解く前から数え、B の画面が確定した時点で1回と照らす
// 時計（page.clock）は使わない。固定の待ち・toPass・条件つきの分岐は使わない。
// 前提：e2e/seeds/session-user-mismatch.sql（[E2E_TEST]部署298・e2euser_mismatch_001・002・取引先 QMM・案件1件。A・B とも参加者）。
//   後始末は e2e/seeds/session-user-mismatch-cleanup.sql（識別子だけ。残数 0 を確かめる）。
// E2E は同時に1つだけ実行する（検証用の DB・ポートを共有するため）。
// 前提にした口（実装の担当へ）：要求ヘッダーの名前 X-Expected-User-Id、409 の本文の code SESSION_USER_MISMATCH（PR-1 のサーバーの契約）。
import { execFile } from "node:child_process";
import type { Browser, BrowserContext, Page, Route } from "@playwright/test";
import { expect, test } from "./console-guard";

const ORIGIN = "http://localhost:5173";
const PASSWORD = "TestPass123!";
const HEADER = "x-expected-user-id";
const USER_A = {
  id: "01JTE2E00000000000M0005298",
  login: "e2euser_mismatch_001",
};
const USER_B = {
  id: "01JTE2E00000000000M0006298",
  login: "e2euser_mismatch_002",
  name: "E2E食い違いB",
};
const CASE = {
  id: "01JTE2E00000000000M0011298",
  room: "01JTE2E00000000000M0010298",
  title: "[E2E_TEST]食い違いの案件",
  description: "[E2E_TEST]食い違いの説明",
};
const BODY = "[E2E_TEST]298 A の書きかけ";
const DRAFT_KEY = `internal-system:draft:v1:${USER_A.id}:room:${CASE.room}`;
const OVERLAY = "画面を読み込み直しています";
const LOST_TEXT =
  "この案件を表示できなくなったため、画面を読み込み直しました。保存していない入力は消えています。";
/** 2 秒ごとの自動の更新と、読み込み直しが済むまでの余裕 */
const RELOAD_TIMEOUT_MS = 20_000;

function seedFile(
  file: "session-user-mismatch.sql" | "session-user-mismatch-cleanup.sql",
) {
  return new Promise<string>((resolve, reject) => {
    execFile(
      process.execPath,
      ["scripts/db-local.ts", "test", "seed-file", `e2e/seeds/${file}`],
      { cwd: process.cwd(), windowsHide: true },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

/** 手で解く約束（応答の保留に使う） */
function signal() {
  let fire!: () => void;
  const fired = new Promise<void>((resolve) => {
    fire = resolve;
  });
  return { fired, fire };
}

/**
 * 仕様どおりの拒否の応答だけを許すコンソールの監視。
 *   401：ログイン前のセッションの確認
 *   409：Cookie が B に替わった後の、A のヘッダーの付いた要求（この E2E が確かめる食い違いの拒否。どの API でも起きうる）
 */
const INTENDED_REJECTIONS: { status: number[]; url: RegExp }[] = [
  { status: [401], url: /\/api\/auth\/session$/ },
  { status: [409], url: /\/api\// },
];
const REJECTION_TEXT =
  /Failed to load resource: the server responded with a status of (\d+)/;

function watch(page: Page, errors: string[]) {
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const status = Number(REJECTION_TEXT.exec(m.text())?.[1]);
    const url = m.location().url;
    const intended = INTENDED_REJECTIONS.some(
      (rule) => rule.status.includes(status) && rule.url.test(url),
    );
    if (!intended) errors.push(`${m.text()} (${url})`);
  });
  page.on("pageerror", (e) => errors.push(String(e)));
}

/** ページの離脱の確認（beforeunload の dialog）を記録する。出たら閉じずに残すと止まるので、記録して受け入れる */
function recordDialogs(page: Page): string[] {
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.type());
    void dialog.accept();
  });
  return dialogs;
}

/**
 * API の要求（セッションの取得を含む）を、hold() の後に届いたものだけ保留する。release() で通す。
 * B のログインの処理中に、A の Cookie のままの要求が届くと、サーバーは A のセッションの失効後の 401 と Cookie の削除（Max-Age=0）を返し、
 * ブラウザの B の Cookie を消してしまう（テストの準備が壊れる）。Cookie が B に替わるまで、A の画面の要求をサーバーへ出さない
 */
async function holdRequests(page: Page) {
  let gate: ReturnType<typeof signal> | null = null;
  await page.route("**/api/**", async (route: Route) => {
    const current = gate;
    if (current !== null) await current.fired;
    await route.fallback();
  });
  return {
    hold: () => {
      gate = signal();
    },
    release: () => {
      gate?.fire();
      gate = null;
    },
  };
}

/** 呼んだ後の、主の枠の文書の読み込み（document の要求）の回数を返す関数を作る */
function countDocumentLoads(page: Page): () => number {
  let count = 0;
  page.on("request", (request) => {
    if (
      request.resourceType() === "document" &&
      request.frame() === page.mainFrame()
    )
      count += 1;
  });
  return () => count;
}

let context: BrowserContext;
const errors: string[] = [];

/** セッションの Cookie の値（比べるためだけに使う。出力しない） */
async function sessionCookieValue(): Promise<string | null> {
  const cookies = await context.cookies(ORIGIN);
  return cookies.find((c) => c.name === "__Host-session")?.value ?? null;
}

async function loginA(browser: Browser) {
  context = await browser.newContext({
    baseURL: ORIGIN,
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  watch(page, errors);
  await page.goto("/login");
  await page.getByLabel("ユーザーID", { exact: true }).fill(USER_A.login);
  await page.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  return page;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await seedFile("session-user-mismatch-cleanup.sql");
  await seedFile("session-user-mismatch.sql");
});
test.afterAll(async () => {
  await context?.close();
  const output = await seedFile("session-user-mismatch-cleanup.sql");
  expect(output).toContain("remaining_users");
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
});

test("#298 AC-1〜AC-4・#376 AC-6: 別のタブで B がログインし直すと、A の画面の投稿は A のヘッダーで 409 になり、B の投稿は増えず、A の下書きは残る。A の2ページは喪失と取り違えず、覆いの下で待ってから1回ずつ読み込み直され、B の画面になる", async ({
  browser,
}) => {
  const page1 = await loginA(browser);
  const page3 = await context.newPage();
  watch(page3, errors);
  const dialogs1 = recordDialogs(page1);
  const dialogs3 = recordDialogs(page3);

  // ページ1：S-17 を A として開き、入力を変更ありにする（下書きとして保存される）
  await page1.goto(`/cases/${CASE.id}`);
  const main1 = page1.getByRole("main");
  await expect(
    main1.getByText(CASE.description, { exact: true }),
  ).toBeVisible();
  const box = main1.getByRole("textbox", { name: "メッセージ" });
  await box.fill(BODY);
  await page1.waitForFunction(
    (key) => window.localStorage.getItem(key) !== null,
    DRAFT_KEY,
  );
  // ページ3：観測のページ（ホーム）
  await page3.goto("/");
  await expect(page3.getByRole("main")).toBeVisible();

  // 両ページの API の要求（セッションの取得を含む）を保留する（B を見るのは、Cookie が B に替わり、保留を解いた後）
  const cookieBefore = await sessionCookieValue();
  expect(cookieBefore).not.toBeNull();
  const sessions1 = await holdRequests(page1);
  const sessions3 = await holdRequests(page3);
  sessions1.hold();
  sessions3.hold();
  // ページ1の投稿を保留し、要求のヘッダーと応答を記録する
  const postGate = signal();
  const posts: { header: string | null }[] = [];
  await page1.route(`**/api/rooms/${CASE.room}/messages`, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    posts.push({ header: route.request().headers()[HEADER] ?? null });
    await postGate.fired;
    await route.fallback();
  });

  // 別のタブにあたる、同じコンテキストの API で B がログインする（Cookie が B に替わる）
  const loggedIn = await context.request.post("/api/auth/login", {
    headers: { Origin: ORIGIN },
    data: { loginId: USER_B.login, password: PASSWORD },
  });
  expect(loggedIn.status()).toBe(200);
  // ブラウザのコンテキストの Cookie が B のものに替わった（値は比べるだけで、出力しない）
  const cookieAfter = await sessionCookieValue();
  expect(cookieAfter).not.toBeNull();
  expect(cookieAfter).not.toBe(cookieBefore);

  // ページ1で送信する：要求は A のヘッダーで送られる（保留中）
  const isPost = (url: string, method: string) =>
    url.endsWith(`/api/rooms/${CASE.room}/messages`) && method === "POST";
  const postRequest = page1.waitForRequest((request) =>
    isPost(request.url(), request.method()),
  );
  // 応答の本文は、受け取った時点で読む（409 の直後にページが読み込み直されると、後からは読めない）
  const posted: {
    value: { status: number; cacheControl: string; body: unknown } | null;
  } = { value: null };
  const postResponse = page1.waitForResponse(async (response) => {
    if (!isPost(response.url(), response.request().method())) return false;
    posted.value = {
      status: response.status(),
      cacheControl: response.headers()["cache-control"] ?? "",
      body: await response.json(),
    };
    return true;
  });
  await main1.getByRole("button", { name: "送信", exact: true }).click();
  expect((await postRequest).headers()[HEADER]).toBe(USER_A.id);

  // 各ページの文書の読み込み（主の枠の document の要求）を、ここから数える。切り替えの後の表示が確定した時点で、1回と照らす
  const documentLoads1 = countDocumentLoads(page1);
  const documentLoads3 = countDocumentLoads(page3);
  const page1Reloaded = page1.waitForEvent("load", {
    timeout: RELOAD_TIMEOUT_MS,
  });
  const page3Reloaded = page3.waitForEvent("load", {
    timeout: RELOAD_TIMEOUT_MS,
  });
  // セッションの保留を解く：A のページが B を見て、切り替えの入口が受理済みの書き込み（保留中の投稿）を待つ
  sessions1.release();
  sessions3.release();
  await expect(page1.getByRole("dialog", { name: OVERLAY })).toBeVisible();
  // 覆いの下：入力欄は隠れ、Tab でも焦点が main の中に入らない
  await expect(box).toBeHidden();
  for (let n = 0; n < 3; n += 1) {
    await page1.keyboard.press("Tab");
    expect(
      await page1.evaluate(
        () =>
          document.querySelector("main")?.contains(document.activeElement) ??
          false,
      ),
    ).toBe(false);
  }

  // 投稿の保留を解く：サーバーが 409 SESSION_USER_MISMATCH で断る
  postGate.fire();
  await postResponse;
  expect(posted.value?.status).toBe(409);
  expect(posted.value?.body).toMatchObject({
    code: "SESSION_USER_MISMATCH",
  });
  expect(posted.value?.cacheControl).toContain("no-store");
  expect(posts).toEqual([{ header: USER_A.id }]);

  await page1Reloaded;
  await page3Reloaded;
  // beforeunload の確認で止まらなかった（確認の dialog が出ていない）
  expect(dialogs1).toEqual([]);
  expect(dialogs3).toEqual([]);

  // 読み込み直した後は B の画面。喪失の知らせは出ない
  for (const page of [page1, page3])
    await expect(
      page.getByRole("button", {
        name: `アカウントメニュー（${USER_B.name}）`,
      }),
    ).toBeVisible();
  await expect(
    page1.getByRole("main").getByText(CASE.description, { exact: true }),
  ).toBeVisible();
  // 表示が確定した時点で、各ページの読み込み直しは1回ずつ（2回以上起きていない）
  expect(documentLoads1()).toBe(1);
  expect(documentLoads3()).toBe(1);
  await expect(page1.getByText(LOST_TEXT, { exact: true })).toHaveCount(0);
  await expect(page3.getByText(LOST_TEXT, { exact: true })).toHaveCount(0);
  // A の部屋の下書きは、端末に残っている（消さない）
  expect(
    await page1.evaluate((key) => window.localStorage.getItem(key), DRAFT_KEY),
  ).toContain(BODY);
  // B の投稿は増えていない（B の Cookie で、部屋のメッセージを読む）
  const messages = await context.request.get(
    `/api/rooms/${CASE.room}/messages`,
  );
  expect(messages.status()).toBe(200);
  expect(JSON.stringify(await messages.json())).not.toContain(BODY);
  expect(errors).toEqual([]);
});
