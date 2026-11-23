// #341 AC-1（計画 plan-341 の 13 の T-E1・T-E2。利用者の決定 Q1〜Q4）、画面 S-17：別のタブで確定した資格の喪失の合図（BroadcastChannel）で、
// 同じ利用者の、同じ案件の S-17 を開いた別のタブも、自分の自動の更新の拒否を待たずに、概要を1回取り直して確かめ、新しい文書に読み込み直す。
// jsdom では確かめられない、実ブラウザでのタブ（同じコンテキストのページ）の間の配信と、実際の読み込み直しだけを確かめる。
// 受けた側の判定・送る側の経路・消さないことの網羅は、単体（frontend/src/features/access-loss/access-loss-broadcast.test.ts・
// frontend/src/features/cases/case-access-loss-relay.test.ts）と画面のテスト（frontend/src/pages/CaseAccessLossCrossTab*.test.tsx・
// CaseAccessLossReload.test.tsx）に任せ、重ねない。#298 の食い違いの状態（AC-2）も、画面のテスト T-S3 に任せる（計画 13 の注記）。
// 観測の仕組み（計画 13 の T-E1）：
//   - 見張り：タブ2・タブ3に addInitScript で、アプリの起動の「前」に、同じ名前の BroadcastChannel を作り、受けた時刻を sessionStorage に記録する
//     （同じ文書では、先に作ったチャンネルから順に配られる。HTML 標準）。sessionStorage はタブごとで、読み込み直した後の文書からも読める
//   - タブ2自身の検出（部屋・TODO の取得）は page.route で保留して止め、合図だけで読み込み直したことを示す
//   - 観測の区間では、タブ2を前面にしない・操作しない（フォーカス・表示の切り替えでの、関係のない概要の取り直しを起こさない）
//   - 概要の GET は page.route で時刻を記録し、見張りが受けた時刻の後で、タブ2の文書が替わる前に始まったものだけを数える
// 対照（T-E2）：タブ2だけ、見張りを作った「後」に、アプリから見える BroadcastChannel を消す。同じ区間で、タブ2は動かない。
// 時計（page.clock）は使わない（#338 の E2E で分かったとおり、時計はコンテキストで共有されるため）。固定の待ち・toPass・条件つきの分岐は使わない。
// 前提：e2e/seeds/case-access-loss-cross-tab.sql（[E2E_TEST]部署341・e2euser_xtab_a・e2euser_xtab_b・取引先 QKZ・案件2件）。
//   後始末は e2e/seeds/case-access-loss-cross-tab-cleanup.sql（識別子だけ。残数 0 を確かめる）。
// ログインの試行制限に当たらないよう、ログインは利用者ごとに1回だけ（beforeAll）。A の3つのページは、同じコンテキスト（Cookie を共有）で開く。
// E2E は同時に1つだけ実行する（検証用の DB・ポートを共有するため）。
// 前提にした口（実装の担当へ）：合図のチャンネルの名前 internal-system:access-loss:v1、値 { v: 1, userId, caseId }。中継は main.tsx で1回登録する。
import { execFile } from "node:child_process";
import type { Browser, BrowserContext, Page, Route } from "@playwright/test";
import { expect, test } from "./console-guard";

const ORIGIN = "http://localhost:5173";
const PASSWORD = "TestPass123!";
const NAME_A = "E2E別タブA";
const CHANNEL = "internal-system:access-loss:v1";
const CASES = {
  e1: {
    id: "01JTE2E00000000000X0011341",
    room: "01JTE2E00000000000X0010341",
    title: "[E2E_TEST]別タブの案件1",
    description: "[E2E_TEST]別タブの説明1",
  },
  e2: {
    id: "01JTE2E00000000000X0021341",
    room: "01JTE2E00000000000X0020341",
    title: "[E2E_TEST]別タブの案件2",
    description: "[E2E_TEST]別タブの説明2",
  },
} as const;
const PRIVATE_TEXT = "参加者だけが見られます（非公開）";
const LOST_TEXT =
  "この案件を表示できなくなったため、画面を読み込み直しました。保存していない入力は消えています。";
/** タブ1の自動の更新（2秒ごと）と概要の取り直しの後、読み込み直しが済むまでの余裕 */
const RELOAD_TIMEOUT_MS = 20_000;
/** 見張りが記録する sessionStorage のキー（テスト専用。e2e341:） */
const HINT_KEY = "e2e341:hint-received-at";

function seedFile(
  file:
    "case-access-loss-cross-tab.sql" | "case-access-loss-cross-tab-cleanup.sql",
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
 * 仕様どおりの拒否の応答だけを許すコンソールの監視（e2e/case-access-loss-reload.spec.ts と同じ考え方）。
 *   401：ログイン前のセッションの確認
 *   403・404：外された後の、テストの案件の中身（詳細・TODO・添付・部屋のメッセージ）の取得
 */
const CASE_IDS = Object.values(CASES)
  .map((item) => item.id)
  .join("|");
const CASE_ROOMS = Object.values(CASES)
  .map((item) => item.room)
  .join("|");
const INTENDED_REJECTIONS: { status: number[]; url: RegExp }[] = [
  { status: [401], url: /\/api\/auth\/session$/ },
  {
    status: [403, 404],
    url: new RegExp(`/api/rooms/(${CASE_ROOMS})/messages([?]|$)`),
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

/**
 * A の別のページ（同じコンテキスト）。アプリの起動の前に、合図の見張りを登録する。
 * hideFromApp が真なら、見張りを作った後に、アプリから見える BroadcastChannel を消す（T-E2 の対照）。初期化のスクリプトは登録した順に動く
 */
async function openWatchedPage(hideFromApp: boolean): Promise<Page> {
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
  if (hideFromApp)
    await page.addInitScript(() => {
      Object.defineProperty(window, "BroadcastChannel", {
        configurable: true,
        writable: true,
        value: undefined,
      });
    });
  return page;
}

/** 見張りが最初に受けた時刻（ページの時計の Date.now）。受けていなければ null */
async function hintReceivedAt(page: Page): Promise<number | null> {
  const value = await page.evaluate(
    (key) => window.sessionStorage.getItem(key),
    HINT_KEY,
  );
  return value === null ? null : Number(value);
}

/** タブ2自身の検出（部屋のメッセージ・TODO の取得）を保留して止める。解くと、そのまま通す */
async function holdOwnDetection(
  page: Page,
  caseItem: (typeof CASES)[keyof typeof CASES],
) {
  const release = signal();
  const hold = async (route: Route) => {
    await release.fired;
    await route.fallback();
  };
  await page.route(`**/api/rooms/${caseItem.room}/messages**`, hold);
  await page.route(`**/api/cases/${caseItem.id}/todos**`, hold);
  return release;
}

/** 概要（GET /api/cases/:caseId）の要求が始まった時刻（テストの側の Date.now） */
async function recordSummaryRequests(
  page: Page,
  caseId: string,
): Promise<number[]> {
  const startedAt: number[] = [];
  await page.route(`**/api/cases/${caseId}`, async (route) => {
    if (route.request().method() === "GET") startedAt.push(Date.now());
    await route.fallback();
  });
  return startedAt;
}

/** タブ2の主のフレームの文書が替わった時刻（テストの側の Date.now） */
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
    marker: (window as unknown as { __e2e341?: string }).__e2e341 ?? null,
  }));
}

async function placeMarker(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __e2e341?: string }).__e2e341 = "前の文書";
  });
}

/** B が、案件の「参加者を管理」で A を参加者から外す（e2e/case-access-loss-reload.spec.ts と同じ操作） */
async function removeA(bPage: Page, caseId: string, title: string) {
  await bPage.goto(`/cases/${caseId}`);
  const main = bPage.getByRole("main");
  await expect(
    main.getByRole("heading", { level: 1, name: title }),
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
  await seedFile("case-access-loss-cross-tab-cleanup.sql");
  await seedFile("case-access-loss-cross-tab.sql");
  a = await login(browser, "e2euser_xtab_a");
  b = await login(browser, "e2euser_xtab_b");
});
test.afterEach(async () => {
  for (const page of extraPages.splice(0)) await page.close();
});
test.afterAll(async () => {
  await a.context.close();
  await b.context.close();
  const output = await seedFile("case-access-loss-cross-tab-cleanup.sql");
  expect(output).toContain("remaining_users");
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
});

test("#341 AC-1 T-E1: タブ1で喪失が確定すると、合図を受けたタブ2（自分の検出は止めてある）が、概要を1回取り直し、新しい文書に読み込み直され、中身が出ず、lost の知らせが出る", async () => {
  const caseItem = CASES.e1;
  const tab1 = a.page;
  const tab2 = await openWatchedPage(false);
  const tab3 = await openWatchedPage(false);
  extraPages.push(tab2, tab3);

  // タブ2：S-17 を参加者として開き、自分の検出を止め、目印を置く
  await tab2.goto(`/cases/${caseItem.id}`);
  await expect(
    tab2.getByRole("main").getByText(caseItem.description, { exact: true }),
  ).toBeVisible();
  const releaseOwn = await holdOwnDetection(tab2, caseItem);
  const summaryRequests = await recordSummaryRequests(tab2, caseItem.id);
  const navigations = recordNavigations(tab2);
  await placeMarker(tab2);
  // タブ3：見張りだけを置いたページ（その案件の概要を持たない）
  await tab3.goto("/");
  // タブ1：同じ案件の S-17。観測の区間の前に前面にし、以後タブ2・タブ3を前面にしない・操作しない
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

  await removeA(b.page, caseItem.id, caseItem.title);

  // 区間の終わり：タブ3が受けたこと・タブ1の新しい文書の知らせ・タブ2の文書の置き換わりの、遅いほう
  await tab3.waitForFunction(
    (key) => window.sessionStorage.getItem(key) !== null,
    HINT_KEY,
    { timeout: RELOAD_TIMEOUT_MS },
  );
  await tab1Reloaded;
  await expect(tab1.getByText(LOST_TEXT, { exact: true })).toHaveCount(1);
  await tab2Reloaded;
  releaseOwn.fire();

  const receivedAt = await hintReceivedAt(tab2);
  expect(receivedAt).not.toBeNull();
  const replacedAt = navigations.find((at) => at >= (receivedAt ?? Infinity));
  expect(replacedAt).toBeDefined();
  // 区間の中で、タブ2の概要の GET が1回あり、その後にタブ2の文書が替わった
  const inWindow = summaryRequests.filter(
    (at) => at >= (receivedAt ?? Infinity) && at < (replacedAt ?? -Infinity),
  );
  expect(inWindow).toHaveLength(1);
  expect(await documentState(tab2)).toEqual({ type: "reload", marker: null });
  const main2 = tab2.getByRole("main");
  await expect(main2.getByText(PRIVATE_TEXT, { exact: true })).toHaveCount(1);
  await expect(
    main2.getByText(caseItem.description, { exact: true }),
  ).toHaveCount(0);
  await expect(main2.getByRole("heading", { name: "やり取り" })).toHaveCount(0);
  await expect(tab2.getByText(LOST_TEXT, { exact: true })).toHaveCount(1);
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
});

test("#341 AC-1 T-E2（対照）: タブ2だけ、アプリから見える BroadcastChannel を消すと、同じ区間で、タブ2は概要を取らず、文書も替わらない", async () => {
  const caseItem = CASES.e2;
  const tab1 = a.page;
  const tab2 = await openWatchedPage(true);
  const tab3 = await openWatchedPage(false);
  extraPages.push(tab2, tab3);

  await tab2.goto(`/cases/${caseItem.id}`);
  await expect(
    tab2.getByRole("main").getByText(caseItem.description, { exact: true }),
  ).toBeVisible();
  const releaseOwn = await holdOwnDetection(tab2, caseItem);
  const summaryRequests = await recordSummaryRequests(tab2, caseItem.id);
  await placeMarker(tab2);
  await tab3.goto("/");
  await tab1.goto(`/cases/${caseItem.id}`);
  await expect(
    tab1.getByRole("main").getByText(caseItem.description, { exact: true }),
  ).toBeVisible();
  await tab1.bringToFront();
  const tab1Reloaded = tab1.waitForEvent("load", {
    timeout: RELOAD_TIMEOUT_MS,
  });

  await removeA(b.page, caseItem.id, caseItem.title);

  // 区間の終わり：タブ3が受けたことと、タブ1の新しい文書の知らせ（タブ2は置き換わらないため）
  await tab3.waitForFunction(
    (key) => window.sessionStorage.getItem(key) !== null,
    HINT_KEY,
    { timeout: RELOAD_TIMEOUT_MS },
  );
  await tab1Reloaded;
  await expect(tab1.getByText(LOST_TEXT, { exact: true })).toHaveCount(1);

  // 見張りは消す前に作ったので、合図は受けている（受けたのに、アプリは動かない）
  const receivedAt = await hintReceivedAt(tab2);
  expect(receivedAt).not.toBeNull();
  expect(
    summaryRequests.filter((at) => at >= (receivedAt ?? Infinity)),
  ).toHaveLength(0);
  expect(await documentState(tab2)).toEqual({
    type: "navigate",
    marker: "前の文書",
  });
  releaseOwn.fire();
  expect(a.errors).toEqual([]);
  expect(b.errors).toEqual([]);
});
