// #342（342-A）AC-1〜AC-10（計画 plan342a2 の 7 節の E1〜E6）、画面 S-17・S-35：ブラウザの「戻る」で文書が丸ごと戻る場合（bfcache）の守り。
// 文書を離れる（pagehide）ときに、案件の中身を持つ包みを、その場で隠す。戻った（pageshow）ときは、セッションを新しく確かめてから、
// 対象の案件を全件確かめ、全件が参加者なら、入力・画面の状態を保ったまま外す。確かめられなければ隠したまま再試行。外された・403・401・別の利用者なら、
// 覆いを保ったまま、新しい文書に置き換わる。
// 【言えること・言えないこと】Playwright は既定で bfcache を使わず、実際の保存・復元を再現できない。ここでは、page.evaluate の中で
//   PageTransitionEvent（pagehide・pageshow）を window に送り（合成。isTrusted は false）、本番の登録（main.tsx）・通信・覆い・文書の遷移が
//   実ブラウザでつながっていることだけを確かめる。合成のイベントは、実際の復元の証拠ではない。実際の復元は、通常のブラウザでの確かめ（計画 8 節の M0〜M3。
//   観測の補助は e2e/support/bfcache-observer.js）で確かめる。
// 判定と分岐の網羅（回数・順序・試行の番号・照合・401・403 の分け方）は、単体と画面のテスト（frontend/src/features/access-loss/page-restore-guard.test.tsx・
//   frontend/src/pages/CaseAccessLossRestore.test.tsx ほか）に任せ、重ねない。ここは、実ブラウザでしか分からないもの
//   （その場での非表示・最上位の層・Tab・Esc・クリック・スクロール・フォーカス・選択範囲・実際の読み込み直し・beforeunload・Cookie）に絞る。
// 「文書が置き換わった」「置き換わらなかった」は、既存の E2E と同じく、window の目印と、ナビゲーションの種類で確かめる。
// 覆いが外れていないことは、確かめの応答を page.route で保留して止め、その間を確かめる。保留できない区間（応答の後、文書が替わるまで）は、
//   ページの中に置いた見張り（MutationObserver。e2e/case-access-loss-reload.spec.ts と同じ方法）が、包みの hidden・inert と、main・nav が見えないことを記録する。
// 固定の待ち（waitForTimeout）・時計（page.clock）・toPass・条件つきの分岐は使わない。「起きない」は、次の定期の取得の応答を待ってから確かめる。
// 前提：e2e/seeds/bfcache-access-loss.sql（[E2E_TEST]部署342・e2euser_bfcache342_a・e2euser_bfcache342_b・取引先 QBF・案件5件・通常のチャンネル1つ）。
//   後始末は e2e/seeds/bfcache-access-loss-cleanup.sql（識別子だけ。残数 0 を確かめる）。
// ログインの試行制限に当たらないよう、ログインは利用者ごとに1回だけ（beforeAll）。各テストは、A の Cookie を写した使い捨てのコンテキストで開き、
//   テストの後に閉じる（Cookie を消す・替えるテストが、ほかのテストに影響しない）。E2E は同時に1つだけ実行する（検証用の DB・ポートを共有するため）。
import { execFile } from "node:child_process";
import type {
  Browser,
  BrowserContext,
  Locator,
  Page,
  Route,
} from "@playwright/test";
import { expect, test } from "./console-guard";

const ORIGIN = "http://localhost:5173";
const PASSWORD = "TestPass123!";
const USER_A = {
  id: "01JTE2E00000000000F0003342",
  login: "e2euser_bfcache342_a",
  name: "E2E戻るA",
};
const USER_B = {
  id: "01JTE2E00000000000F0004342",
  login: "e2euser_bfcache342_b",
  name: "E2E戻るB",
};
const CASES = {
  c1: {
    id: "01JTE2E00000000000F0011342",
    room: "01JTE2E00000000000F0010342",
    description: "[E2E_TEST]戻るの説明1",
  },
  c2: {
    id: "01JTE2E00000000000F0021342",
    room: "01JTE2E00000000000F0020342",
    title: "[E2E_TEST]戻るの案件2",
    parent: "01M7B00000000000000F342P01",
    parentText: "[E2E_TEST]戻るの親2",
    replyText: "[E2E_TEST]戻るの返信2",
  },
  c3: {
    id: "01JTE2E00000000000F0031342",
    room: "01JTE2E00000000000F0030342",
    description: "[E2E_TEST]戻るの説明3",
  },
  c4: {
    id: "01JTE2E00000000000F0041342",
    room: "01JTE2E00000000000F0040342",
    description: "[E2E_TEST]戻るの説明4",
  },
  c5: {
    id: "01JTE2E00000000000F0051342",
    room: "01JTE2E00000000000F0050342",
    description: "[E2E_TEST]戻るの説明5",
  },
} as const;
const CHANNEL_ROOM = "01JTE2E00000000000F0060342";
const LAST_POST_TEXT = "[E2E_TEST]342の投稿25";
const TYPED = "E2E 342の書きかけ";
const UNSAVED_TODO_TITLE = "E2E 342の保存していない題名";
const LOST_TEXT =
  "この案件を表示できなくなったため、画面を読み込み直しました。保存していない入力は消えています。";
/** 確かめに失敗したときの案内と、再試行の共通のボタン（計画 3-7。単体・画面のテストと同じ文言） */
const RESTORE_FAILED_TEXT = "画面を確認できませんでした。再試行してください";
const RETRY_BUTTON = "再試行";
/** 確かめの応答・概要の取り直しの後、読み込み直しが済むまでの余裕（時計を固定しない場面） */
const RELOAD_TIMEOUT_MS = 20_000;
const SESSION_PATH = "/api/auth/session";
const summaryPath = (caseId: string) => `/api/cases/${caseId}`;
/** A の端末の下書きのキー（値は読まない）。形は本番の関数を使わず、決めた形を独立に書く（e2e/case-access-loss-reload.spec.ts と同じ） */
const A_DRAFT_PREFIX = `internal-system:draft:v1:${USER_A.id}:`;
const roomDraftKey = (roomId: string) => `${A_DRAFT_PREFIX}room:${roomId}`;
const COVERED = { hidden: true, inert: true } as const;
const UNCOVERED = { hidden: false, inert: false } as const;

function seedFile(
  file: "bfcache-access-loss.sql" | "bfcache-access-loss-cleanup.sql",
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

/** 手で解く約束（通信の到達の通知・応答の保留に使う） */
function signal() {
  let fire!: () => void;
  const fired = new Promise<void>((resolve) => {
    fire = resolve;
  });
  return { fired, fire };
}

// ---- コンソールの監視（仕様どおりの拒否だけを許す。e2e/case-access-loss-outside-view.spec.ts と同じ考え方） ----

type Rule = (text: string, url: string) => boolean;
const REJECTION_TEXT =
  /Failed to load resource: the server responded with a status of (\d+)/;
const statusRule =
  (statuses: number[], url: RegExp): Rule =>
  (text, at) =>
    statuses.includes(Number(REJECTION_TEXT.exec(text)?.[1])) && url.test(at);
/**
 *   401：ログイン前のセッションの確認
 *   403・404：外された後の、案件2の中身（部屋のメッセージ・スレッドの返信・詳細・TODO・添付）の取得
 */
const BASE_RULES: Rule[] = [
  statusRule([401], /\/api\/auth\/session$/),
  statusRule(
    [403, 404],
    new RegExp(`/api/rooms/${CASES.c2.room}/messages([?]|$)`),
  ),
  statusRule(
    [403, 404],
    new RegExp(`/api/messages/${CASES.c2.parent}/replies([?]|$)`),
  ),
  statusRule(
    [403, 404],
    new RegExp(`/api/cases/${CASES.c2.id}/(todos|detail|attachments)([?]|$)`),
  ),
];

function watch(page: Page, errors: string[], extra: Rule[] = []) {
  const rules = [...BASE_RULES, ...extra];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const url = m.location().url;
    if (!rules.some((rule) => rule(m.text(), url)))
      errors.push(`${m.text()} (${url})`);
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

type Opened = Signed & { dialogs: string[] };
const openedContexts: BrowserContext[] = [];

/**
 * 同じ利用者の Cookie を写した、使い捨てのコンテキストのページ。ブラウザのダイアログ（beforeunload など）は、種類を記録して accept する
 * （dismiss すると読み込み直しが止まり、原因が分からなくなるため。e2e/case-access-loss-reload.spec.ts と同じ）。各テストの最後に、0件であることを確かめる
 */
async function openAs(
  browser: Browser,
  signed: Signed,
  options: {
    viewport?: { width: number; height: number };
    rules?: Rule[];
  } = {},
): Promise<Opened> {
  const context = await browser.newContext({
    baseURL: ORIGIN,
    viewport: options.viewport ?? { width: 1280, height: 800 },
    storageState: await signed.context.storageState(),
  });
  openedContexts.push(context);
  const page = await context.newPage();
  const errors: string[] = [];
  watch(page, errors, options.rules);
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.type());
    void dialog.accept();
  });
  return { context, page, errors, dialogs };
}

// ---- 通信の記録・保留 ----

type Logged = { path: string; method: string; at: number; document: boolean };

/** 要求が出た時刻（route より前。保留した要求も数える）。文書の要求も記録する（文書が替わった時刻の目安） */
function recordRequests(page: Page): Logged[] {
  const log: Logged[] = [];
  page.on("request", (request) => {
    log.push({
      path: new URL(request.url()).pathname,
      method: request.method(),
      at: Date.now(),
      document: request.resourceType() === "document",
    });
  });
  return log;
}

function getsOf(log: Logged[], path: string, since: number, until = Infinity) {
  return log.filter(
    (entry) =>
      entry.method === "GET" &&
      entry.path === path &&
      entry.at >= since &&
      entry.at < until,
  );
}

function documentRequestAfter(log: Logged[], since: number) {
  return log.find((entry) => entry.document && entry.at >= since)?.at;
}

/** arm() の後に届いた、その path の GET を1件だけ保留する。到達を知らせ、release() で通す */
async function gateNextGet(page: Page, path: string) {
  let armed = false;
  const arrived = signal();
  const release = signal();
  await page.route(
    (url) => url.pathname === path,
    async (route) => {
      if (!armed || route.request().method() !== "GET") return route.fallback();
      armed = false;
      arrived.fire();
      await release.fired;
      return route.fallback();
    },
  );
  return {
    arm: () => {
      armed = true;
    },
    arrived: arrived.fired,
    release: release.fire,
  };
}

/**
 * start() の後、セッションの確かめ（GET /api/auth/session）以外の API を保留する（定期の取得が、守りより先に、既存の 401・409 の処理を動かさないように）。
 * release() で通す。保留したまま文書が替わった要求は、そのまま捨てられる
 */
async function holdApiExceptSession(page: Page) {
  let holding = false;
  const release = signal();
  await page.route(
    (url) => url.pathname.startsWith("/api/"),
    async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (!holding || path === SESSION_PATH) return route.fallback();
      await release.fired;
      return route.fallback();
    },
  );
  return {
    start: () => {
      holding = true;
    },
    release: () => {
      holding = false;
      release.fire();
    },
  };
}

/** S-35 の A 自身の検出（スレッド一覧・返信・部屋のメッセージの取得）を保留して止める（e2e/case-access-loss-outside-view.spec.ts と同じ） */
async function holdOwnDetection(page: Page) {
  const release = signal();
  const hold = async (route: Route) => {
    await release.fired;
    await route.fallback();
  };
  await page.route("**/api/me/threads**", hold);
  await page.route(`**/api/messages/${CASES.c2.parent}/replies**`, hold);
  await page.route(`**/api/rooms/${CASES.c2.room}/messages**`, hold);
  return release;
}

// ---- 合成した pagehide・pageshow と、包みの状態 ----

/** 境界の包み：#root の直下で、main を含む要素（AccessLossBoundary の包み） */
const wrapperOf = (page: Page) => page.locator("#root > :has(main)");

/**
 * 合成した pagehide を window に送り、送った直後（同じタスクの中。描画を待たない）の包みの hidden・inert を返す（計画 3-3：pagehide の処理の中で同期して隠す）
 */
async function dispatchPageHide(page: Page, persisted = true) {
  return page.evaluate((persist) => {
    const wrapper = [
      ...document.querySelectorAll<HTMLElement>("#root > *"),
    ].find((element) => element.querySelector("main") !== null);
    window.dispatchEvent(
      new PageTransitionEvent("pagehide", { persisted: persist }),
    );
    return {
      hidden: wrapper?.hidden === true,
      inert: wrapper?.hasAttribute("inert") === true,
    };
  }, persisted);
}

/** 合成した pageshow を window に送る（isTrusted は false。実際の復元の証拠ではない） */
async function dispatchPageShow(page: Page, persisted = true) {
  await page.evaluate((persist) => {
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: persist }),
    );
  }, persisted);
}

async function expectCovered(page: Page) {
  const wrapper = wrapperOf(page);
  await expect(wrapper).toHaveAttribute("hidden");
  await expect(wrapper).toHaveAttribute("inert");
}

async function expectUncovered(page: Page) {
  const wrapper = wrapperOf(page);
  await expect(wrapper).not.toHaveAttribute("hidden");
  await expect(wrapper).not.toHaveAttribute("inert");
}

/**
 * 覆いが外れないことの見張り（保留できない区間。応答の後、文書が替わるまで）。置いた時点の包みを覚え、つながっている間は hidden・inert を、
 * あわせて main・nav が見えないことを、変化のたびと、古い文書が捨てられる直前（pagehide）に確かめ、違反を sessionStorage に書く（キーはテスト専用の e2e342:）
 */
const WATCH_KEY = "e2e342:cover-watch";
async function installCoverWatch(page: Page) {
  await page.evaluate((key) => {
    const record = (reason: string) => {
      const list = JSON.parse(
        window.sessionStorage.getItem(key) ?? "[]",
      ) as string[];
      if (!list.includes(reason)) list.push(reason);
      window.sessionStorage.setItem(key, JSON.stringify(list));
    };
    const wrapper =
      [...document.querySelectorAll<HTMLElement>("#root > *")].find(
        (element) => element.querySelector("main") !== null,
      ) ?? null;
    const check = (when: string) => {
      if (wrapper === null) record(`${when}:no-wrapper`);
      else if (wrapper.isConnected && !wrapper.hidden) record(`${when}:shown`);
      if (wrapper?.isConnected === true && !wrapper.hasAttribute("inert"))
        record(`${when}:not-inert`);
      const visible = [...document.querySelectorAll("main, nav")].some(
        (element) => element.checkVisibility(),
      );
      if (visible) record(`${when}:content-visible`);
    };
    window.sessionStorage.setItem(key, "[]");
    check("install");
    new MutationObserver(() => check("mutation")).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
    });
    window.addEventListener("pagehide", () => {
      check("pagehide");
      window.sessionStorage.setItem(`${key}:pagehide`, "seen");
    });
  }, WATCH_KEY);
}

async function readCoverWatch(page: Page) {
  return page.evaluate((key) => {
    const result = {
      reasons: JSON.parse(window.sessionStorage.getItem(key) ?? "null") as
        string[] | null,
      pagehide: window.sessionStorage.getItem(`${key}:pagehide`),
    };
    window.sessionStorage.removeItem(key);
    window.sessionStorage.removeItem(`${key}:pagehide`);
    return result;
  }, WATCH_KEY);
}

// ---- 文書の目印・下書き・画面の操作 ----

/** いまの文書のナビゲーションの種類と、前の文書に置いた目印が残っているか */
async function documentState(page: Page) {
  return page.evaluate(() => ({
    type: (
      performance.getEntriesByType("navigation")[0] as
        PerformanceNavigationTiming | undefined
    )?.type,
    marker: (window as unknown as { __e2e342?: string }).__e2e342 ?? null,
  }));
}

const MARKER = "前の文書";
async function placeMarker(page: Page) {
  await page.evaluate((value) => {
    (window as unknown as { __e2e342?: string }).__e2e342 = value;
  }, MARKER);
}

async function aDraftKeys(page: Page): Promise<string[]> {
  return page.evaluate(
    (prefix) =>
      Object.keys(window.localStorage)
        .filter((key) => key.startsWith(prefix))
        .sort(),
    A_DRAFT_PREFIX,
  );
}

/** キーボードで入力する（click と打鍵で、beforeunload の確認に必要な利用者の操作になる） */
async function typeInto(input: Locator, text: string) {
  await input.click();
  await input.pressSequentially(text);
}

/** 同じ要素であることを後で確かめるための目印（React が管理しない data 属性） */
async function tag(locator: Locator, name: string) {
  await locator.evaluate((element, value) => {
    element.setAttribute("data-e2e342", value);
  }, name);
}
const tagged = (page: Page, name: string) =>
  page.locator(`[data-e2e342="${name}"]`);

/** A の S-17 を開き、説明が見えるまで待つ */
async function openCase(page: Page, caseId: string, description: string) {
  await page.goto(`/cases/${caseId}`);
  const main = page.getByRole("main");
  await expect(main.getByText(description, { exact: true })).toBeVisible();
  return main;
}

/** B が、案件の「参加者を管理」で A を参加者から外す（e2e/case-access-loss-outside-view.spec.ts と同じ操作） */
async function removeA(bPage: Page) {
  await bPage.goto(`/cases/${CASES.c2.id}`);
  const main = bPage.getByRole("main");
  await expect(
    main.getByRole("heading", { level: 1, name: CASES.c2.title }),
  ).toBeVisible();
  await main.getByRole("button", { name: "参加者を管理", exact: true }).click();
  const manager = bPage.getByRole("dialog", { name: "参加者を管理" });
  await manager
    .getByRole("button", { name: `${USER_A.name}を削除`, exact: true })
    .click();
  const confirm = bPage.getByRole("dialog", { name: "参加者の削除" });
  await confirm.getByRole("button", { name: "削除する", exact: true }).click();
  await expect(
    manager.getByRole("listitem").filter({ hasText: USER_A.name }),
  ).toHaveCount(0);
}

/**
 * 次の定期の取得（部屋のメッセージ。2秒ごと）の応答（「起きない」を確かめる前の起点）。呼んだ後に届いた応答だけを待つ。
 * 投稿の無い部屋は after を付けずに最新から取り直す（features/messages/hooks/message-polling.ts の catchUpMessages）ため、after の有無は問わない
 */
function nextRoomPoll(page: Page, roomId: string) {
  return page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/rooms/${roomId}/messages` &&
      response.request().method() === "GET",
  );
}

/** 観測の補助（e2e/support/bfcache-observer.js）が記録した、pagehide・pageshow の項目 */
type Observed = {
  type: string;
  persisted?: boolean;
  isTrusted?: boolean;
  wrapper: { found: boolean; hidden: boolean | null; inert: boolean | null };
};
async function observedTransitions(page: Page) {
  return page.evaluate(() =>
    (
      window as unknown as {
        __bfcache342Observer: { entries: () => Observed[] };
      }
    ).__bfcache342Observer
      .entries()
      .filter((entry) => entry.type === "pagehide" || entry.type === "pageshow")
      .map(({ type, persisted, isTrusted, wrapper }) => ({
        type,
        persisted,
        isTrusted,
        wrapper,
      })),
  );
}

let a: Signed;
let b: Signed;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  await seedFile("bfcache-access-loss-cleanup.sql");
  await seedFile("bfcache-access-loss.sql");
  a = await login(browser, USER_A.login);
  b = await login(browser, USER_B.login);
});
test.afterEach(async () => {
  for (const context of openedContexts.splice(0)) await context.close();
});
test.afterAll(async () => {
  await a.context.close();
  await b.context.close();
  const output = await seedFile("bfcache-access-loss-cleanup.sql");
  expect(output).toContain("remaining_users");
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
});

test("#342 AC-1・AC-4・AC-7 E1: 資格のある S-17 で、合成した pagehide の処理の中で包みが隠れ、確かめの応答を保留した間は Tab・打鍵・クリックが中身に届かず、参加者と確かめた後に、同じ入力欄・入力・選択範囲・フォーカス・一覧と画面のスクロールが戻り、文書は替わらない", async ({
  browser,
}) => {
  const { page, errors, dialogs } = await openAs(browser, a, {
    viewport: { width: 1280, height: 600 },
  });
  const log = recordRequests(page);
  const main = await openCase(page, CASES.c1.id, CASES.c1.description);
  const list = main.getByRole("log", { name: "メッセージ一覧" });
  await expect(list.getByText(LAST_POST_TEXT, { exact: true })).toBeVisible();
  const composer = main.getByRole("textbox", { name: "メッセージ" });
  await typeInto(composer, TYPED);
  await tag(composer, "composer");
  await tag(list, "list");
  // 画面の状態を作る：選択範囲・一覧のスクロール・画面のスクロール（フォーカスは入力欄のまま）
  const before = await page.evaluate(() => {
    const input = document.querySelector<HTMLTextAreaElement>(
      '[data-e2e342="composer"]',
    );
    const scroller = document.querySelector<HTMLElement>(
      '[data-e2e342="list"]',
    );
    if (input === null || scroller === null) throw new Error("目印がない");
    input.setSelectionRange(2, 5);
    const listMax = scroller.scrollHeight - scroller.clientHeight;
    scroller.scrollTo({ top: Math.floor(listMax / 2), behavior: "instant" });
    const windowMax =
      document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({ top: Math.floor(windowMax / 2), behavior: "instant" });
    return {
      listTop: scroller.scrollTop,
      windowY: window.scrollY,
      focused: document.activeElement === input,
    };
  });
  // 前提：一覧も画面もスクロールしていて、フォーカスは入力欄（戻すものがある）
  expect(before.listTop).toBeGreaterThan(0);
  expect(before.windowY).toBeGreaterThan(0);
  expect(before.focused).toBe(true);
  const composerBox = await composer.boundingBox();
  if (composerBox === null) throw new Error("入力欄の位置を取れない");
  // 観測の補助は、アプリの起動の後に入れる（守りより後のリスナーになる。計画 8 節）
  await page.addScriptTag({ path: "e2e/support/bfcache-observer.js" });
  await placeMarker(page);
  const sessionGate = await gateNextGet(page, SESSION_PATH);

  // ① 離れる：pagehide の処理の中で隠れる
  expect(await dispatchPageHide(page)).toEqual(COVERED);
  await expect(main.getByText(CASES.c1.description)).toBeHidden();

  // ② 戻る：セッションの確かめを保留し、その間は隠れたまま、操作が中身に届かない
  const shownAt = Date.now();
  sessionGate.arm();
  await dispatchPageShow(page);
  await sessionGate.arrived;
  await expectCovered(page);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.type("zz");
  await page.mouse.click(
    composerBox.x + composerBox.width / 2,
    composerBox.y + composerBox.height / 2,
  );
  expect(
    await page.evaluate(() => {
      const wrapper = document.querySelector("#root > :has(main)");
      const active = document.activeElement;
      return active !== null && wrapper?.contains(active) === true;
    }),
  ).toBe(false);
  await expect(tagged(page, "composer")).toBeHidden();
  await expect(tagged(page, "composer")).toHaveValue(TYPED);
  // 観測の補助（守りより後のリスナー）が見た包みは、pagehide・pageshow のどちらでも隠れている。合成なので isTrusted は false
  expect(await observedTransitions(page)).toEqual([
    {
      type: "pagehide",
      persisted: true,
      isTrusted: false,
      wrapper: { found: true, ...COVERED },
    },
    {
      type: "pageshow",
      persisted: true,
      isTrusted: false,
      wrapper: { found: true, ...COVERED },
    },
  ]);

  // ③ セッション（同じ利用者）の後に、案件の概要（参加者）を確かめて外れる。入力・選択範囲・フォーカス・スクロールが戻る
  sessionGate.release();
  await expectUncovered(page);
  const composerAfter = tagged(page, "composer");
  await expect(composerAfter).toBeVisible();
  await expect(composerAfter).toHaveValue(TYPED);
  await expect(composerAfter).toBeFocused();
  await expect(composerAfter).toHaveJSProperty("selectionStart", 2);
  await expect(composerAfter).toHaveJSProperty("selectionEnd", 5);
  await expect(tagged(page, "list")).toHaveJSProperty(
    "scrollTop",
    before.listTop,
  );
  await expect(page.locator("html")).toHaveJSProperty(
    "scrollTop",
    before.windowY,
  );
  expect(await documentState(page)).toEqual({
    type: "navigate",
    marker: MARKER,
  });
  const sessions = getsOf(log, SESSION_PATH, shownAt);
  const summaries = getsOf(log, summaryPath(CASES.c1.id), shownAt);
  expect(sessions.length).toBeGreaterThanOrEqual(1);
  expect(summaries.length).toBeGreaterThanOrEqual(1);
  expect(summaries[0]?.at).toBeGreaterThanOrEqual(sessions[0]?.at ?? Infinity);
  expect(dialogs).toEqual([]);
  expect(errors).toEqual([]);
});

test("#342 AC-1・AC-4 E1: 開いたモーダル（参加者を管理）と、その中の入力は、確かめの間の Esc・Tab・クリックで閉じず・変わらず、参加者と確かめた後に、同じモーダルが開いたまま見える", async ({
  browser,
}) => {
  const { page, errors, dialogs } = await openAs(browser, a);
  const main = await openCase(page, CASES.c1.id, CASES.c1.description);
  await main.getByRole("button", { name: "参加者を管理", exact: true }).click();
  const manager = page.getByRole("dialog", { name: "参加者を管理" });
  await expect(manager).toBeVisible();
  const search = manager.getByRole("textbox", { name: "社員の検索" });
  await typeInto(search, "E2E");
  await tag(manager, "manager");
  await tag(search, "search");
  const managerBox = await manager.boundingBox();
  if (managerBox === null) throw new Error("モーダルの位置を取れない");
  await placeMarker(page);
  const sessionGate = await gateNextGet(page, SESSION_PATH);

  expect(await dispatchPageHide(page)).toEqual(COVERED);
  sessionGate.arm();
  await dispatchPageShow(page);
  await sessionGate.arrived;
  await expectCovered(page);
  // 同じモーダルが DOM に残ったまま開いた状態で、見えない
  await expect(tagged(page, "manager")).toHaveAttribute("open", "");
  await expect(tagged(page, "manager")).toBeHidden();
  // Esc（モーダルを閉じる操作）・Tab・モーダルがあった位置のクリックで、変わらない
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Tab");
  await page.mouse.click(
    managerBox.x + managerBox.width / 2,
    managerBox.y + managerBox.height / 2,
  );
  await expect(tagged(page, "manager")).toHaveAttribute("open", "");
  await expect(tagged(page, "search")).toHaveValue("E2E");
  await expectCovered(page);

  sessionGate.release();
  await expectUncovered(page);
  await expect(tagged(page, "manager")).toBeVisible();
  await expect(tagged(page, "manager")).toHaveAttribute("open", "");
  await expect(tagged(page, "search")).toHaveValue("E2E");
  expect(await documentState(page)).toEqual({
    type: "navigate",
    marker: MARKER,
  });
  expect(dialogs).toEqual([]);
  expect(errors).toEqual([]);
});

test("#342 AC-1・AC-4 E1: 開いた popover（アカウントメニュー）は、確かめの間は見えず、参加者と確かめた後に、同じ要素が開いたまま見える", async ({
  browser,
}) => {
  const { page, errors, dialogs } = await openAs(browser, a);
  await openCase(page, CASES.c1.id, CASES.c1.description);
  await page
    .getByRole("button", { name: `アカウントメニュー（${USER_A.name}）` })
    .click();
  await expect(page.getByRole("button", { name: "ログアウト" })).toBeVisible();
  // 開いている popover に目印を付ける（1つだけ開いていることも確かめる）
  expect(
    await page.evaluate(() => {
      const open = [...document.querySelectorAll("[popover]")].filter(
        (element) => element.matches(":popover-open"),
      );
      open.forEach((element) => element.setAttribute("data-e2e342", "popover"));
      return open.length;
    }),
  ).toBe(1);
  const popoverOpen = () =>
    tagged(page, "popover").evaluate((element) =>
      element.matches(":popover-open"),
    );
  await placeMarker(page);
  const sessionGate = await gateNextGet(page, SESSION_PATH);

  expect(await dispatchPageHide(page)).toEqual(COVERED);
  sessionGate.arm();
  await dispatchPageShow(page);
  await sessionGate.arrived;
  await expectCovered(page);
  await expect(tagged(page, "popover")).toBeHidden();

  sessionGate.release();
  await expectUncovered(page);
  await expect(tagged(page, "popover")).toBeVisible();
  expect(await popoverOpen()).toBe(true);
  await expect(page.getByRole("button", { name: "ログアウト" })).toBeVisible();
  expect(await documentState(page)).toEqual({
    type: "navigate",
    marker: MARKER,
  });
  expect(dialogs).toEqual([]);
  expect(errors).toEqual([]);
});

test("#342 AC-2・AC-3・AC-5 E2: 概要を取得していない S-35 の案件（スレッドの実績）と、別の画面で取得した参加者の概要の案件を、戻ったときにセッションの後で全件確かめ、外された案件があれば、覆いを保ったまま新しい文書に置き換わる", async ({
  browser,
}) => {
  const { page, errors, dialogs } = await openAs(browser, a);
  const log = recordRequests(page);
  // 参加者の概要（案件3）を、この文書のキャッシュに持つ
  await openCase(page, CASES.c3.id, CASES.c3.description);
  // アプリの中の移動で S-35 へ（文書は替えない）。案件2のスレッドを開き、返信を取得する（スレッドの実績）
  await page
    .getByRole("navigation", { name: "メインメニュー" })
    .getByRole("link", { name: /^スレッド/ })
    .click();
  await expect(page).toHaveURL(/\/threads$/);
  const replies = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        `/api/messages/${CASES.c2.parent}/replies` &&
      response.request().method() === "GET",
  );
  await page
    .getByRole("list", { name: "スレッド一覧" })
    .getByRole("link")
    .filter({ hasText: CASES.c2.parentText })
    .click();
  expect((await replies).status()).toBe(200);
  await expect(
    page
      .getByRole("region", { name: "スレッド" })
      .getByRole("log", { name: "返信一覧" })
      .getByText(CASES.c2.replyText, { exact: true }),
  ).toBeVisible();
  // 前提：この文書で、案件2の概要は取得していない。案件3の概要は取得した。文書は1つのまま
  expect(getsOf(log, summaryPath(CASES.c2.id), 0)).toEqual([]);
  expect(getsOf(log, summaryPath(CASES.c3.id), 0).length).toBeGreaterThan(0);
  expect(log.filter((entry) => entry.document)).toHaveLength(1);
  // A 自身の検出を止め、戻ったときの守りの確かめだけで動いたことを示す
  const releaseOwn = await holdOwnDetection(page);
  await placeMarker(page);

  // ① 離れる
  expect(await dispatchPageHide(page)).toEqual(COVERED);
  await installCoverWatch(page);
  // ② 離れている間に、B が A を案件2から外す
  await removeA(b.page);
  // ③ 戻る：案件2の概要の応答を保留し、その間も隠れている。応答（非参加）の後、覆いを保ったまま、文書が置き換わる
  const summaryGate = await gateNextGet(page, summaryPath(CASES.c2.id));
  summaryGate.arm();
  const reloaded = page.waitForEvent("load", { timeout: RELOAD_TIMEOUT_MS });
  const shownAt = Date.now();
  await dispatchPageShow(page);
  await summaryGate.arrived;
  await expectCovered(page);
  summaryGate.release();
  await reloaded;
  releaseOwn.fire();

  expect(await documentState(page)).toEqual({ type: "reload", marker: null });
  expect(await readCoverWatch(page)).toEqual({ reasons: [], pagehide: "seen" });
  // 戻ってから文書が替わるまでに、セッションを確かめ、その後に、両方の案件の概要を確かめた（全件）
  const replacedAt = documentRequestAfter(log, shownAt);
  expect(replacedAt).toBeDefined();
  const until = replacedAt ?? -Infinity;
  const sessions = getsOf(log, SESSION_PATH, shownAt, until);
  const lostSummaries = getsOf(log, summaryPath(CASES.c2.id), shownAt, until);
  const keptSummaries = getsOf(log, summaryPath(CASES.c3.id), shownAt, until);
  expect(sessions.length).toBeGreaterThanOrEqual(1);
  expect(lostSummaries.length).toBeGreaterThanOrEqual(1);
  expect(keptSummaries.length).toBeGreaterThanOrEqual(1);
  const firstSummaryAt = Math.min(
    lostSummaries[0]?.at ?? -Infinity,
    keptSummaries[0]?.at ?? -Infinity,
  );
  expect(firstSummaryAt).toBeGreaterThanOrEqual(sessions[0]?.at ?? Infinity);
  await expect(page.getByText(LOST_TEXT, { exact: true })).toHaveCount(1);
  await expect(page.getByText(CASES.c2.replyText, { exact: true })).toHaveCount(
    0,
  );
  expect(dialogs).toEqual([]);
  expect(errors).toEqual([]);
  expect(b.errors).toEqual([]);
});

test("#342 AC-8 E3: 離れている間にログインが切れていたら、戻ったときのセッションの確かめが 401 になり、案件を確かめずに、覆いを保ったまま新しい文書に置き換わる（beforeunload の確認・喪失の知らせは出ず、下書きは消えない）", async ({
  browser,
}) => {
  const { context, page, errors, dialogs } = await openAs(browser, a);
  const log = recordRequests(page);
  const main = await openCase(page, CASES.c4.id, CASES.c4.description);
  await typeInto(main.getByRole("textbox", { name: "メッセージ" }), TYPED);
  expect(await aDraftKeys(page)).toContain(roomDraftKey(CASES.c4.room));
  await placeMarker(page);
  const apiHold = await holdApiExceptSession(page);

  expect(await dispatchPageHide(page)).toEqual(COVERED);
  await installCoverWatch(page);
  // 離れている間に、この文書のログインが切れる（ブラウザの Cookie が無くなる）。セッションの確かめ以外の API は、戻るまで保留する
  apiHold.start();
  await context.clearCookies();
  const sessionAnswer = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === SESSION_PATH &&
      response.request().method() === "GET",
  );
  const reloaded = page.waitForEvent("load", { timeout: RELOAD_TIMEOUT_MS });
  const shownAt = Date.now();
  await dispatchPageShow(page);
  expect((await sessionAnswer).status()).toBe(401);
  await reloaded;
  apiHold.release();

  expect(await documentState(page)).toEqual({ type: "reload", marker: null });
  expect(await readCoverWatch(page)).toEqual({ reasons: [], pagehide: "seen" });
  expect(dialogs).toEqual([]);
  // 401 のときは、文書が替わるまでに、案件を確かめない（保留した要求も、出た時点で数える）
  const replacedAt = documentRequestAfter(log, shownAt) ?? -Infinity;
  expect(getsOf(log, summaryPath(CASES.c4.id), shownAt, replacedAt)).toEqual(
    [],
  );
  // 新しい文書は未ログインとして始まり、ログインの画面になる。喪失の知らせは出ず、下書きは残る
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("button", { name: "ログイン", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(LOST_TEXT, { exact: true })).toHaveCount(0);
  expect(await aDraftKeys(page)).toContain(roomDraftKey(CASES.c4.room));
  expect(errors).toEqual([]);
});

test("#342 AC-3 E3: 離れている間に、このブラウザの Cookie が別の利用者に替わっていたら、戻ったときのセッションの確かめから切り替えの入口へ進み、案件を確かめずに、新しい文書に置き換わる（喪失の知らせ・下書きの消去はない）", async ({
  browser,
}) => {
  const { context, page, errors, dialogs } = await openAs(browser, a);
  const log = recordRequests(page);
  const main = await openCase(page, CASES.c4.id, CASES.c4.description);
  await typeInto(main.getByRole("textbox", { name: "メッセージ" }), TYPED);
  expect(await aDraftKeys(page)).toContain(roomDraftKey(CASES.c4.room));
  await placeMarker(page);
  const apiHold = await holdApiExceptSession(page);

  expect(await dispatchPageHide(page)).toEqual(COVERED);
  await installCoverWatch(page);
  // 離れている間に、同じブラウザで B がログインした状態にする（B の Cookie を写す。値は出力しない）。ほかの API は、戻るまで保留する
  apiHold.start();
  await context.addCookies(await b.context.cookies(ORIGIN));
  const answeredUsers: (string | undefined)[] = [];
  const sessionAnswer = page.waitForResponse(async (response) => {
    if (
      new URL(response.url()).pathname !== SESSION_PATH ||
      response.request().method() !== "GET"
    )
      return false;
    // 文書が替わると本文を読めなくなるため、受け取った時点で読む（docs/testing/e2e.md の 409 の行と同じ）
    answeredUsers.push(
      ((await response.json()) as { user?: { id?: string } }).user?.id,
    );
    return true;
  });
  const reloaded = page.waitForEvent("load", { timeout: RELOAD_TIMEOUT_MS });
  const shownAt = Date.now();
  await dispatchPageShow(page);
  expect((await sessionAnswer).status()).toBe(200);
  expect(answeredUsers).toEqual([USER_B.id]);
  await reloaded;
  apiHold.release();

  expect(await documentState(page)).toEqual({ type: "reload", marker: null });
  expect(await readCoverWatch(page)).toEqual({ reasons: [], pagehide: "seen" });
  expect(dialogs).toEqual([]);
  // 文書が替わるまでに、案件を確かめていない（新しい文書の S-17 の取得は数えない）
  const replacedAt = documentRequestAfter(log, shownAt) ?? -Infinity;
  expect(getsOf(log, summaryPath(CASES.c4.id), shownAt, replacedAt)).toEqual(
    [],
  );
  // 新しい文書は B の画面。喪失の知らせは出ず、A の下書きは端末に残る
  await expect(
    page.getByRole("button", { name: `アカウントメニュー（${USER_B.name}）` }),
  ).toBeVisible();
  await expect(page.getByText(LOST_TEXT, { exact: true })).toHaveCount(0);
  expect(await aDraftKeys(page)).toContain(roomDraftKey(CASES.c4.room));
  expect(errors).toEqual([]);
});

test("#342 AC-6・AC-7 E4: 戻ったときの概要の取得が通信の失敗なら、隠したまま失敗の案内と「再試行」が出て、入力と文書は保たれる。再試行でセッションから確かめ直し、参加者なら外れる", async ({
  browser,
}) => {
  const summary = summaryPath(CASES.c4.id);
  const { page, errors, dialogs } = await openAs(browser, a, {
    rules: [
      // この E2E が起こす通信の失敗（概要の取得を1回だけ切る）
      (text, url) =>
        text.includes("net::ERR_FAILED") && new URL(url).pathname === summary,
    ],
  });
  const log = recordRequests(page);
  const main = await openCase(page, CASES.c4.id, CASES.c4.description);
  const composer = main.getByRole("textbox", { name: "メッセージ" });
  await typeInto(composer, TYPED);
  await tag(composer, "composer");
  await placeMarker(page);
  let failNext = false;
  let failed = 0;
  await page.route(
    (url) => url.pathname === summary,
    async (route) => {
      if (!failNext || route.request().method() !== "GET")
        return route.fallback();
      failNext = false;
      failed += 1;
      return route.abort("failed");
    },
  );

  expect(await dispatchPageHide(page)).toEqual(COVERED);
  failNext = true;
  await dispatchPageShow(page);
  // 失敗：隠したまま、案内と再試行。入力・文書は保たれ、片付け・読み込み直しはしない
  const retry = page.getByRole("button", { name: RETRY_BUTTON });
  await expect(retry).toBeVisible();
  await expect(
    page.getByText(RESTORE_FAILED_TEXT, { exact: true }),
  ).toBeVisible();
  expect(failed).toBe(1);
  await expectCovered(page);
  await expect(tagged(page, "composer")).toBeHidden();
  await expect(tagged(page, "composer")).toHaveValue(TYPED);
  expect(await documentState(page)).toEqual({
    type: "navigate",
    marker: MARKER,
  });
  await expect(page.getByText(LOST_TEXT, { exact: true })).toHaveCount(0);
  expect(await aDraftKeys(page)).toContain(roomDraftKey(CASES.c4.room));

  // 再試行：セッションから確かめ直し、参加者なら外れる
  const retriedAt = Date.now();
  await retry.click();
  await expectUncovered(page);
  await expect(tagged(page, "composer")).toBeVisible();
  await expect(tagged(page, "composer")).toHaveValue(TYPED);
  await expect(
    page.getByText(RESTORE_FAILED_TEXT, { exact: true }),
  ).toHaveCount(0);
  expect(await documentState(page)).toEqual({
    type: "navigate",
    marker: MARKER,
  });
  const sessions = getsOf(log, SESSION_PATH, retriedAt);
  const summaries = getsOf(log, summary, retriedAt);
  expect(sessions.length).toBeGreaterThanOrEqual(1);
  expect(summaries.length).toBeGreaterThanOrEqual(1);
  expect(summaries[0]?.at).toBeGreaterThanOrEqual(sessions[0]?.at ?? Infinity);
  expect(dialogs).toEqual([]);
  expect(errors).toEqual([]);
});

test("#342 AC-10 E5: 案件の中身を持たない画面（通常のチャンネル）では、pagehide・pageshow で覆わず、セッション・案件を確かめず、読み込み直さない", async ({
  browser,
}) => {
  const { page, errors, dialogs } = await openAs(browser, a);
  const log = recordRequests(page);
  await page.goto(`/channels/${CHANNEL_ROOM}`);
  const composer = page
    .getByRole("main")
    .getByRole("textbox", { name: "メッセージ" });
  await expect(composer).toBeVisible();
  await typeInto(composer, TYPED);
  // 前提：この文書は、案件の概要・案件の部屋のメッセージ・スレッドを取得していない（対象 0 件）
  expect(
    log.filter(
      (entry) =>
        /^\/api\/cases\/[^/]+/.test(entry.path) ||
        entry.path.startsWith("/api/me/threads") ||
        Object.values(CASES).some((item) =>
          entry.path.startsWith(`/api/rooms/${item.room}/`),
        ),
    ),
  ).toEqual([]);
  await placeMarker(page);

  const eventsAt = Date.now();
  expect(await dispatchPageHide(page)).toEqual(UNCOVERED);
  await dispatchPageShow(page);
  // 「起きない」は、次の定期の取得の応答を待ってから確かめる
  await nextRoomPoll(page, CHANNEL_ROOM);
  expect(getsOf(log, SESSION_PATH, eventsAt)).toEqual([]);
  expect(
    log.filter(
      (entry) =>
        entry.at >= eventsAt && /^\/api\/cases\/[^/]+/.test(entry.path),
    ),
  ).toEqual([]);
  await expectUncovered(page);
  await expect(composer).toBeVisible();
  await expect(composer).toHaveValue(TYPED);
  await expect(page.getByRole("button", { name: RETRY_BUTTON })).toHaveCount(0);
  expect(await documentState(page)).toEqual({
    type: "navigate",
    marker: MARKER,
  });
  expect(dialogs).toEqual([]);
  expect(errors).toEqual([]);
});

test("#342 AC-1・AC-10 E5: 案件の中身を持つ S-17 でも、退避の準備（pagehide）の無い pageshow（persisted=false）では確かめない。対照：pagehide の後なら、persisted=false の pageshow でも、セッションから確かめ、参加者なら外れる", async ({
  browser,
}) => {
  const { page, errors, dialogs } = await openAs(browser, a);
  const log = recordRequests(page);
  await openCase(page, CASES.c4.id, CASES.c4.description);
  await placeMarker(page);

  // 退避の準備の無い pageshow：確かめず、覆わない
  const firstAt = Date.now();
  await dispatchPageShow(page, false);
  await nextRoomPoll(page, CASES.c4.room);
  expect(getsOf(log, SESSION_PATH, firstAt)).toEqual([]);
  expect(getsOf(log, summaryPath(CASES.c4.id), firstAt)).toEqual([]);
  await expectUncovered(page);
  await expect(page.getByRole("button", { name: RETRY_BUTTON })).toHaveCount(0);

  // 対照：pagehide（退避の準備）の後は、persisted=false でも確かめる（記録の仕組みが働いていることも示す）
  expect(await dispatchPageHide(page)).toEqual(COVERED);
  const sessionAsked = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === SESSION_PATH &&
      request.method() === "GET",
  );
  await dispatchPageShow(page, false);
  await sessionAsked;
  await expectUncovered(page);
  await expect(
    page.getByRole("main").getByText(CASES.c4.description, { exact: true }),
  ).toBeVisible();
  expect(await documentState(page)).toEqual({
    type: "navigate",
    marker: MARKER,
  });
  expect(dialogs).toEqual([]);
  expect(errors).toEqual([]);
});

test("#342 AC-5 E6: 戻ったときの概要が 403 なら、覆いを保ったまま新しい文書に置き換わる。保存していない入力（TODO の題名）は失われ、保存済みの下書き（メッセージの入力欄）は消えない", async ({
  browser,
}) => {
  const summary = summaryPath(CASES.c5.id);
  const { page, errors, dialogs } = await openAs(browser, a, {
    rules: [statusRule([403], new RegExp(`${summary}$`))],
  });
  const main = await openCase(page, CASES.c5.id, CASES.c5.description);
  await typeInto(main.getByRole("textbox", { name: "メッセージ" }), TYPED);
  expect(await aDraftKeys(page)).toContain(roomDraftKey(CASES.c5.room));
  await typeInto(
    main.getByRole("textbox", { name: "題名", exact: true }),
    UNSAVED_TODO_TITLE,
  );
  await placeMarker(page);
  // 戻ったときの、守りの概要の取得（1回）だけを、サーバーの拒否の形（403 FORBIDDEN）で返す。
  // 権限の変更をシードで作らないのは、ほかの取得も 403 になり、既存の検出が守りより先に動くため（データは架空）
  let forbidNext = false;
  let forbidden = 0;
  await page.route(
    (url) => url.pathname === summary,
    async (route) => {
      if (!forbidNext || route.request().method() !== "GET")
        return route.fallback();
      forbidNext = false;
      forbidden += 1;
      return route.fulfill({
        status: 403,
        contentType: "application/json",
        headers: { "cache-control": "no-store" },
        body: JSON.stringify({
          code: "FORBIDDEN",
          message: "[E2E_TEST]342の拒否",
        }),
      });
    },
  );

  expect(await dispatchPageHide(page)).toEqual(COVERED);
  await installCoverWatch(page);
  forbidNext = true;
  const reloaded = page.waitForEvent("load", { timeout: RELOAD_TIMEOUT_MS });
  await dispatchPageShow(page);
  await reloaded;

  expect(forbidden).toBe(1);
  expect(await documentState(page)).toEqual({ type: "reload", marker: null });
  expect(await readCoverWatch(page)).toEqual({ reasons: [], pagehide: "seen" });
  expect(dialogs).toEqual([]);
  // 新しい文書：保存済みの下書きのキーは残り、入力欄に戻る。保存していない TODO の題名は失われている
  const mainAfter = page.getByRole("main");
  await expect(
    mainAfter.getByText(CASES.c5.description, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(LOST_TEXT, { exact: true })).toHaveCount(1);
  expect(await aDraftKeys(page)).toContain(roomDraftKey(CASES.c5.room));
  await expect(
    mainAfter.getByRole("textbox", { name: "メッセージ" }),
  ).toHaveValue(TYPED);
  await expect(
    mainAfter.getByRole("textbox", { name: "題名", exact: true }),
  ).toHaveValue("");
  expect(errors).toEqual([]);
});
