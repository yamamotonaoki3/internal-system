// #383 AC-1・AC-3（計画 5 節の新規 E2E・計画レビュー 1 回目の軽微 2）：同じブラウザ（同じコンテキスト）の別のタブで B がログインした直後に、
// 古いタブの、古い Cookie（A）のままの要求がサーバーに届いて 401 になっても、その応答が新しいセッション（B）の Cookie を消さず、
// 新しいタブが未ログインに戻らないことを、実ブラウザの Cookie の保存と、タブの間の共有で確かめる。
// 「消さない」ことの網羅（経路・状態ごと）は、単体と結合のテスト（backend/src/lib/session-middleware.cookie.test.ts・
// backend/src/routes/auth.session-cookie.test.ts）に任せ、重ねない。
// 観測の仕組み（競合を、待ち時間に頼らず、毎回起こす）：
//   - 古いタブ（A のホーム）の API の要求を page.route で保留する。保留した時点のブラウザの Cookie（その要求が持っていた Cookie）を記録する
//   - 保留した要求が1件以上あること（A の Cookie を持っていること）を確かめてから、新しいタブで B がログインする
//   - B のログインの応答が届き、ブラウザの Cookie が B に替わったことを確かめてから、保留を解く。保留した要求は、記録した Cookie のまま、
//     ブラウザと Cookie を共有しない別の要求のコンテキストで実際のサーバーへ送り（共有すると、テストの側が先に Cookie を書き換えるため）、
//     受けた応答（状態・本文・Set-Cookie を作り替えない）を、古いタブの応答としてブラウザに渡す（route.fulfill）。ブラウザが Set-Cookie を適用する
//   - 届いた要求が A の古い Cookie を持ち、401 になったことを確かめる（競合が起きなかった回を合格にしない）
// 時計（page.clock）は使わない。固定の待ち・toPass・条件つきの分岐は使わない。Cookie の値は比べるだけで、出力しない。
// 前提：e2e/seeds/session-cookie-race.sql（[E2E_TEST]部署383・e2euser_cookierace_001・002）。
//   後始末は e2e/seeds/session-cookie-race-cleanup.sql（識別子だけ。残数 0 を確かめる）。ログインは A・B で1回ずつ、計2回。
// E2E は同時に1つだけ実行する（検証用の DB・ポートを共有するため）。
import { execFile } from "node:child_process";
import type {
  APIRequestContext,
  BrowserContext,
  Page,
  Request,
} from "@playwright/test";
import { expect, test } from "./console-guard";

const ORIGIN = "http://localhost:5173";
const SESSION_COOKIE_NAME = "__Host-session";
const PASSWORD = "TestPass123!";
const USER_A = {
  id: "01JTE2E00000000000C0002383",
  login: "e2euser_cookierace_001",
  name: "E2ECookie競合A",
};
const USER_B = {
  id: "01JTE2E00000000000C0003383",
  login: "e2euser_cookierace_002",
  name: "E2ECookie競合B",
};

function seedFile(
  file: "session-cookie-race.sql" | "session-cookie-race-cleanup.sql",
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

/** 手で解く約束（保留に使う） */
function signal() {
  let fire!: () => void;
  const fired = new Promise<void>((resolve) => {
    fire = resolve;
  });
  return { fired, fire };
}

const REJECTION_TEXT =
  /Failed to load resource: the server responded with a status of (\d+)/;

/**
 * 仕様どおりの拒否の応答だけを許すコンソールの監視（ページごとに、許す状態と URL を決める）
 *   古いタブ：401（A の古い Cookie の要求。この E2E が起こす拒否）と、409（Cookie が B に替わった後の、A の画面の要求。#298 の拒否）
 *   新しいタブ：許さない（B のログインの後、未ログインに戻らない）
 */
function watch(
  page: Page,
  errors: string[],
  intended: { status: number[]; url: RegExp }[],
) {
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const status = Number(REJECTION_TEXT.exec(m.text())?.[1]);
    const url = m.location().url;
    if (!intended.some((r) => r.status.includes(status) && r.url.test(url)))
      errors.push(`${m.text()} (${url})`);
  });
  page.on("pageerror", (e) => errors.push(String(e)));
}

let context: BrowserContext;
let isolated: APIRequestContext | undefined;
const errors: string[] = [];

/** ブラウザのコンテキストの、セッションの Cookie の値（比べるためだけに使う。出力しない） */
async function sessionCookieValue(): Promise<string | null> {
  const cookies = await context.cookies(ORIGIN);
  return cookies.find((c) => c.name === SESSION_COOKIE_NAME)?.value ?? null;
}

type Delivered = {
  request: Request;
  /** 保留した時点のブラウザの Cookie（その要求が持っていた Cookie） */
  cookieAtIssue: string | null;
  status: number;
  code: unknown;
};

/**
 * 古いタブの API の要求を、hold() の後に届いたものだけ保留する。release() の後、保留した要求を、保留した時点の Cookie のまま実際のサーバーへ送り、
 * 受けた応答をそのまま古いタブに渡す。保留を解いた後に届いた要求は、そのまま通す
 */
async function holdOldTab(page: Page, api: APIRequestContext) {
  let gate: ReturnType<typeof signal> | null = null;
  const held: Request[] = [];
  const firstHeld = signal();
  const delivered: Delivered[] = [];
  await page.route("**/api/**", async (route) => {
    const current = gate;
    if (current === null) return route.fallback();
    const request = route.request();
    const cookieAtIssue = await sessionCookieValue();
    held.push(request);
    firstHeld.fire();
    await current.fired;
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(request.headers()))
      if (!["cookie", "host", "content-length"].includes(name.toLowerCase()))
        headers[name] = value;
    if (cookieAtIssue !== null)
      headers.cookie = `${SESSION_COOKIE_NAME}=${cookieAtIssue}`;
    const response = await api.fetch(request.url(), {
      method: request.method(),
      headers,
      data: request.postDataBuffer() ?? undefined,
      maxRedirects: 0,
      failOnStatusCode: false,
    });
    const text = await response.text();
    delivered.push({
      request,
      cookieAtIssue,
      status: response.status(),
      code: text === "" ? null : (JSON.parse(text) as { code?: unknown }).code,
    });
    await route.fulfill({ response });
  });
  return {
    held,
    firstHeld: firstHeld.fired,
    delivered,
    hold: () => {
      gate = signal();
    },
    release: () => {
      gate?.fire();
      gate = null;
    },
  };
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await seedFile("session-cookie-race-cleanup.sql");
  await seedFile("session-cookie-race.sql");
});
test.afterAll(async () => {
  await isolated?.dispose();
  await context?.close();
  const output = await seedFile("session-cookie-race-cleanup.sql");
  expect(output).toContain("remaining_users");
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
});

test("#383 AC-1・AC-3: 別のタブで B がログインした直後に、古いタブの A の古い Cookie の要求が 401 になっても、B の Cookie は消えず、新しいタブは未ログインに戻らない", async ({
  browser,
  playwright,
}) => {
  context = await browser.newContext({
    baseURL: ORIGIN,
    viewport: { width: 1280, height: 800 },
  });
  // ブラウザの Cookie と共有しない、要求のコンテキスト（保留した要求を、記録した Cookie のまま送るため）
  isolated = await playwright.request.newContext({ baseURL: ORIGIN });

  // 古いタブ：A が画面からログインし、ホームを開いたままにする
  const oldTab = await context.newPage();
  watch(oldTab, errors, [{ status: [401, 409], url: /\/api\// }]);
  await oldTab.goto("/login");
  await oldTab.getByLabel("ユーザーID", { exact: true }).fill(USER_A.login);
  await oldTab.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
  await oldTab.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(oldTab).toHaveURL(/\/$/);
  await expect(
    oldTab.getByRole("button", {
      name: `アカウントメニュー（${USER_A.name}）`,
    }),
  ).toBeVisible();
  const cookieA = await sessionCookieValue();
  expect(cookieA, "A の Cookie が保存されていない").not.toBeNull();

  // 古いタブの API の要求を保留し、A の Cookie を持った要求が1件以上届くまで待つ（ホームの定期の取得）
  const oldRequests = await holdOldTab(oldTab, isolated);
  oldRequests.hold();
  await oldRequests.firstHeld;
  const [stale] = oldRequests.held;
  expect(stale, "古いタブの要求を保留できていない").toBeDefined();

  // 新しいタブ（同じコンテキスト）：B がログインする。ブラウザ自身の要求（同じ送信元の fetch）なので、Set-Cookie はブラウザが適用する。
  // ログイン中の A がいるため、ログインの画面は開けない（/login はホームへ移る）。アプリの画面を持たない同じ送信元のページから送る
  const newTab = await context.newPage();
  watch(newTab, errors, []);
  await newTab.goto("/api/health");
  const loginStatus = await newTab.evaluate(
    async ({ loginId, password }) => {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId, password }),
      });
      return res.status;
    },
    { loginId: USER_B.login, password: PASSWORD },
  );
  expect(loginStatus).toBe(200);
  // ブラウザの Cookie が B のものに替わった（値は比べるだけで、出力しない）
  const cookieB = await sessionCookieValue();
  expect(cookieB, "B の Cookie が保存されていない").not.toBeNull();
  expect(cookieB === cookieA, "Cookie が B に替わっていない").toBe(false);

  // ログインの確定の後に、古いタブの要求を放す。A の古い Cookie のままサーバーに届き、その応答が古いタブに届く
  const staleFinished = oldTab.waitForEvent("requestfinished", {
    predicate: (request) => request === stale,
  });
  oldRequests.release();
  await staleFinished;

  // 競合が実際に起きた：届いた要求は A の古い Cookie を持ち、サーバーは 401 UNAUTHENTICATED で拒否した
  const first = oldRequests.delivered.find((d) => d.request === stale);
  expect(first, "保留した要求の応答を記録できていない").toBeDefined();
  expect(
    first?.cookieAtIssue === cookieA,
    "保留した要求が A の古い Cookie を持っていない",
  ).toBe(true);
  expect(first?.status).toBe(401);
  expect(first?.code).toBe("UNAUTHENTICATED");

  // 古いタブの 401 の応答が届いた後も、ブラウザの Cookie は B のまま（消えていない・替わっていない）
  const cookieAfter = await sessionCookieValue();
  expect(
    cookieAfter !== null,
    "古いタブの 401 の応答で、セッションの Cookie が消えた",
  ).toBe(true);
  expect(cookieAfter === cookieB, "セッションの Cookie が B のものでない").toBe(
    true,
  );

  // 新しいタブの次の要求は、B のログイン中として通る（未ログインに戻らない）
  await newTab.goto("/");
  await expect(
    newTab.getByRole("button", {
      name: `アカウントメニュー（${USER_B.name}）`,
    }),
  ).toBeVisible();
  await expect(newTab).not.toHaveURL(/\/login$/);
  const session = await newTab.evaluate(async () => {
    const res = await fetch("/api/auth/session");
    return {
      status: res.status,
      userId: ((await res.json()) as { user?: { id?: string } }).user?.id,
    };
  });
  expect(session).toEqual({ status: 200, userId: USER_B.id });
  expect(errors).toEqual([]);
});
