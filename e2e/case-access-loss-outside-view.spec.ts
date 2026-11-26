// #339 AC-1（計画 plan-339 の 5 節「E2Eと検証の範囲」）、画面 S-35：案件の概要（S-17）を一度も取得していない文書でも、
// S-35 で案件の部屋のスレッド（返信）を取得した実績があれば、資格を失ったことに気づいて、新しい文書に読み込み直す。
// 1件目：S-35 だけを開いたタブが、自分で気づいて読み込み直す。
// 2件目：同じ利用者の別タブ（S-17）で確定した合図（BroadcastChannel）を、概要を持たず、スレッドの実績だけがあるタブが受けて読み込み直す。
// 実ブラウザでの読み込み直しと、タブの間の配信だけを確かめる。判定の分岐・副作用の網羅・覆いの操作の制限は、単体・画面のテスト
// （frontend/src/features/cases/case-access-loss-monitor.test.ts・case-access-loss-relay.test.ts・frontend/src/pages/ThreadsPage.access-loss.test.tsx）と、
// 既存の e2e/case-access-loss-reload.spec.ts に任せ、重ねない。
// 「概要を取得していない」前提は、案件の GET（/api/cases/:caseId と、その下）を page.route で記録し、資格を失う前に0回であることで確かめる。
// 「文書が置き換わった」ことは、既存の E2E と同じく、window の目印が消え、ナビゲーションの種類が reload であることで確かめる。
// 2件目の観測の仕組みは e2e/case-access-loss-cross-tab.spec.ts と同じ（起動の前の見張り・自分の検出の保留・区間の中の概要の GET の数）。
// 時計（page.clock）・固定の待ち・toPass・条件つきの分岐は使わない。
// 前提：e2e/seeds/case-access-loss-outside-view.sql（[E2E_TEST]部署339・e2euser_outv_a・e2euser_outv_b・取引先 QKQ・案件2件と、各部屋のスレッド）。
//   後始末は e2e/seeds/case-access-loss-outside-view-cleanup.sql（識別子だけ。残数 0 を確かめる）。
// ログインの試行制限に当たらないよう、ログインは利用者ごとに1回だけ（beforeAll）。E2E は同時に1つだけ実行する。
import { execFile } from "node:child_process";
import type { Browser, BrowserContext, Page, Route } from "@playwright/test";
import { expect, test } from "./console-guard";

const ORIGIN = "http://localhost:5173";
const PASSWORD = "TestPass123!";
const NAME_A = "E2E画面外A";
const CHANNEL = "internal-system:access-loss:v1";
const CASES = {
  o1: {
    id: "01JTE2E00000000000V0011339",
    room: "01JTE2E00000000000V0010339",
    title: "[E2E_TEST]画面外の案件1",
    description: "[E2E_TEST]画面外の説明1",
    parent: "01M78ZTJC0000000000339P001",
    parentText: "[E2E_TEST]画面外の親1",
    replyText: "[E2E_TEST]画面外の返信1",
  },
  o2: {
    id: "01JTE2E00000000000V0021339",
    room: "01JTE2E00000000000V0020339",
    title: "[E2E_TEST]画面外の案件2",
    description: "[E2E_TEST]画面外の説明2",
    parent: "01M78ZTJC0000000000339P002",
    parentText: "[E2E_TEST]画面外の親2",
    replyText: "[E2E_TEST]画面外の返信2",
  },
} as const;
type CaseItem = (typeof CASES)[keyof typeof CASES];
const LOST_TEXT =
  "この案件を表示できなくなったため、画面を読み込み直しました。保存していない入力は消えています。";
/** スレッド一覧の定期の取得（2秒ごと）と確かめの後、読み込み直しが済むまでの余裕 */
const RELOAD_TIMEOUT_MS = 20_000;
/** 見張りが記録する sessionStorage のキー（テスト専用。e2e339:） */
const HINT_KEY = "e2e339:hint-received-at";

function seedFile(
  file:
    | "case-access-loss-outside-view.sql"
    | "case-access-loss-outside-view-cleanup.sql",
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

function signal() {
  let fire!: () => void;
  const fired = new Promise<void>((resolve) => {
    fire = resolve;
  });
  return { fired, fire };
}

/**
 * 仕様どおりの拒否の応答だけを許すコンソールの監視（e2e/case-access-loss-cross-tab.spec.ts と同じ考え方）。
 *   401：ログイン前のセッションの確認
 *   403・404：外された後の、テストの案件の中身（詳細・TODO・添付・部屋のメッセージ・スレッドの返信）の取得
 */
const CASE_IDS = Object.values(CASES)
  .map((item) => item.id)
  .join("|");
const CASE_ROOMS = Object.values(CASES)
  .map((item) => item.room)
  .join("|");
const CASE_PARENTS = Object.values(CASES)
  .map((item) => item.parent)
  .join("|");
const INTENDED_REJECTIONS: { status: number[]; url: RegExp }[] = [
  { status: [401], url: /\/api\/auth\/session$/ },
  {
    status: [403, 404],
    url: new RegExp(`/api/rooms/(${CASE_ROOMS})/messages([?]|$)`),
  },
  {
    status: [403, 404],
    url: new RegExp(`/api/messages/(${CASE_PARENTS})/replies([?]|$)`),
  },
  {
    status: [403, 404],
    url: new RegExp(
      `/api/cases/(${CASE_IDS})/(todos|detail|attachments)([?]|$)`,
    ),
  },
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

type Signed = { context: BrowserContext; page: Page; errors: string[] };

async function login(browser: Browser, loginId: string): Promise<Signed> {
  const context = await browser.newContext({
    baseURL: ORIGIN,
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  const errors: string[] = [];
  watch(page, errors);
  await page.goto("/login");
  await page.getByLabel("ユーザーID", { exact: true }).fill(loginId);
  await page.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  return { context, page, errors };
}

/** A の別のページ（同じコンテキスト）。アプリの起動の前に、合図の見張りを登録する */
async function openWatchedPage(): Promise<Page> {
  const page = await a.context.newPage();
  watch(page, a.errors);
  await page.addInitScript(
    ({ channel, key }) => {
      const watcher = new BroadcastChannel(channel);
      watcher.addEventListener("message", () => {
        if (window.sessionStorage.getItem(key) === null)
          window.sessionStorage.setItem(key, String(Date.now()));
      });
    },
    { channel: CHANNEL, key: HINT_KEY },
  );
  return page;
}

async function hintReceivedAt(page: Page): Promise<number | null> {
  const value = await page.evaluate(
    (key) => window.sessionStorage.getItem(key),
    HINT_KEY,
  );
  return value === null ? null : Number(value);
}

/**
 * その案件の GET（概要 /api/cases/:caseId と、その下の詳細・TODO・添付など）の始まった時刻と URL を記録する。
 * 概要だけの時刻は summaryAt に分けて持つ
 */
async function recordCaseRequests(page: Page, caseId: string) {
  const any: string[] = [];
  const summaryAt: number[] = [];
  await page.route(
    new RegExp(`/api/cases/${caseId}([/?]|$)`),
    async (route) => {
      const request = route.request();
      if (request.method() === "GET") {
        any.push(request.url());
        if (new URL(request.url()).pathname === `/api/cases/${caseId}`)
          summaryAt.push(Date.now());
      }
      await route.fallback();
    },
  );
  return { any, summaryAt };
}

/** S-35 で、案件の部屋のスレッドを開き、返信の取得が 200 で済んだこと（スレッドの実績）を確かめる */
async function openThreadOnS35(page: Page, caseItem: CaseItem) {
  const replies = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        `/api/messages/${caseItem.parent}/replies` &&
      response.request().method() === "GET",
  );
  await page.goto(`/threads?thread=${caseItem.parent}`);
  expect((await replies).status()).toBe(200);
  await expect(
    page.getByRole("heading", { level: 1, name: "スレッド" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("list", { name: "スレッド一覧" })
      .getByRole("link")
      .filter({ hasText: caseItem.parentText }),
  ).toHaveCount(1);
  await expect(
    page
      .getByRole("region", { name: "スレッド" })
      .getByRole("log", { name: "返信一覧" })
      .getByText(caseItem.replyText, { exact: true }),
  ).toBeVisible();
}

/** S-35 のタブ自身の検出（スレッド一覧・返信・部屋のメッセージの取得）を保留して止める。解くと、そのまま通す */
async function holdOwnDetection(page: Page, caseItem: CaseItem) {
  const release = signal();
  const hold = async (route: Route) => {
    await release.fired;
    await route.fallback();
  };
  await page.route("**/api/me/threads**", hold);
  await page.route(`**/api/messages/${caseItem.parent}/replies**`, hold);
  await page.route(`**/api/rooms/${caseItem.room}/messages**`, hold);
  return release;
}

function recordNavigations(page: Page): number[] {
  const at: number[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) at.push(Date.now());
  });
  return at;
}

async function documentState(page: Page) {
  return page.evaluate(() => ({
    type: (
      performance.getEntriesByType("navigation")[0] as
        PerformanceNavigationTiming | undefined
    )?.type,
    marker: (window as unknown as { __e2e339?: string }).__e2e339 ?? null,
  }));
}

async function placeMarker(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __e2e339?: string }).__e2e339 = "前の文書";
  });
}

/** B が、案件の「参加者を管理」で A を参加者から外す（e2e/case-access-loss-cross-tab.spec.ts と同じ操作） */
async function removeA(bPage: Page, caseItem: CaseItem) {
  await bPage.goto(`/cases/${caseItem.id}`);
  const main = bPage.getByRole("main");
  await expect(
    main.getByRole("heading", { level: 1, name: caseItem.title }),
  ).toBeVisible();
  await main.getByRole("button", { name: "参加者を管理", exact: true }).click();
  const manager = bPage.getByRole("dialog", { name: "参加者を管理" });
  await manager
    .getByRole("button", { name: `${NAME_A}を削除`, exact: true })
    .click();
  const confirm = bPage.getByRole("dialog", { name: "参加者の削除" });
  await confirm.getByRole("button", { name: "削除する", exact: true }).click();
  await expect(
    manager.getByRole("listitem").filter({ hasText: NAME_A }),
  ).toHaveCount(0);
}

let a: Signed;
let b: Signed;
const extraPages: Page[] = [];

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  await seedFile("case-access-loss-outside-view-cleanup.sql");
  await seedFile("case-access-loss-outside-view.sql");
  a = await login(browser, "e2euser_outv_a");
  b = await login(browser, "e2euser_outv_b");
});
test.afterEach(async () => {
  for (const page of extraPages.splice(0)) await page.close();
});
test.afterAll(async () => {
  await a.context.close();
  await b.context.close();
  const output = await seedFile("case-access-loss-outside-view-cleanup.sql");
  expect(output).toContain("remaining_users");
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
});

test("#339 AC-1: 概要未取得のS-35で資格を失うと文書が置き換わる", async () => {
  const caseItem = CASES.o1;
  const page = a.page;
  // 記録は、S-35 を開く前から始める（この文書で、案件を一度も取得していないことを確かめるため）
  const caseRequests = await recordCaseRequests(page, caseItem.id);
  await openThreadOnS35(page, caseItem);
  expect(caseRequests.any).toEqual([]);
  const navigations = recordNavigations(page);
  await placeMarker(page);
  const reloaded = page.waitForEvent("load", { timeout: RELOAD_TIMEOUT_MS });

  const removalStartedAt = Date.now();
  await removeA(b.page, caseItem);

  await reloaded;
  // AC-1「資格の確認が走る」：外した後、文書が替わる前に、この文書から概要の GET が出た（回数の網羅は単体に任せる）
  const replacedAt = navigations.find((at) => at >= removalStartedAt);
  expect(replacedAt).toBeDefined();
  expect(
    caseRequests.summaryAt.filter(
      (at) => at >= removalStartedAt && at < (replacedAt ?? -Infinity),
    ).length,
  ).toBeGreaterThanOrEqual(1);
  expect(await documentState(page)).toEqual({ type: "reload", marker: null });
  await expect(page.getByText(LOST_TEXT, { exact: true })).toHaveCount(1);
  await expect(page.getByText(caseItem.replyText, { exact: true })).toHaveCount(
    0,
  );
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
});

test("#339 AC-1: 概要未取得でもスレッドの実績がある別タブは合図から文書を置き換える", async () => {
  const caseItem = CASES.o2;
  const tab1 = a.page;
  const tab2 = await openWatchedPage();
  extraPages.push(tab2);

  // タブ2：S-35 で案件のスレッドだけを取得する（概要は取得しない）
  const caseRequests = await recordCaseRequests(tab2, caseItem.id);
  await openThreadOnS35(tab2, caseItem);
  expect(caseRequests.any).toEqual([]);
  const releaseOwn = await holdOwnDetection(tab2, caseItem);
  const navigations = recordNavigations(tab2);
  await placeMarker(tab2);
  // タブ1：同じ案件の S-17。観測の区間の前に前面にし、以後タブ2を前面にしない・操作しない
  await tab1.goto(`/cases/${caseItem.id}`);
  await expect(
    tab1.getByRole("main").getByText(caseItem.description, { exact: true }),
  ).toBeVisible();
  await tab1.bringToFront();
  expect(await hintReceivedAt(tab2)).toBeNull();
  const tab1Reloaded = tab1.waitForEvent("load", {
    timeout: RELOAD_TIMEOUT_MS,
  });
  const tab2Reloaded = tab2.waitForEvent("load", {
    timeout: RELOAD_TIMEOUT_MS,
  });

  await removeA(b.page, caseItem);

  await tab1Reloaded;
  await expect(tab1.getByText(LOST_TEXT, { exact: true })).toHaveCount(1);
  await tab2Reloaded;
  releaseOwn.fire();

  const receivedAt = await hintReceivedAt(tab2);
  expect(receivedAt).not.toBeNull();
  const replacedAt = navigations.find((at) => at >= (receivedAt ?? Infinity));
  expect(replacedAt).toBeDefined();
  // 合図を受けた後、文書が替わる前に、タブ2の概要の GET が1回あった（合図から確かめて読み込み直した）
  const inWindow = caseRequests.summaryAt.filter(
    (at) => at >= (receivedAt ?? Infinity) && at < (replacedAt ?? -Infinity),
  );
  expect(inWindow).toHaveLength(1);
  expect(await documentState(tab2)).toEqual({ type: "reload", marker: null });
  await expect(tab2.getByText(LOST_TEXT, { exact: true })).toHaveCount(1);
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
});
