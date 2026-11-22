// #338 AC-1・AC-2・AC-5（計画 plan-338 の 7-4 の E-1・E-2・E-2 対照・E-3）、画面 S-17：資格を失ったら、片付けの後に、ページの文書ごと読み込み直す。
// jsdom では確かめられない、実際の読み込み直し・前の実行環境の消滅・最上位の層（モーダル）が隠れること・Tab・Esc・クリック・「戻る」・beforeunload を、実ブラウザで確かめる。
// 待ち方・持ち主・合流の網羅は単体（frontend/src/features/access-loss/*.test.ts*）、きっかけの網羅は画面のテスト（frontend/src/pages/CaseAccessLossReload*.test.tsx）に任せ、重ねない。
// 前提：e2e/seeds/case-access-loss-reload.sql（[E2E_TEST]部署338・e2euser_reload_a・e2euser_reload_b・取引先 QKL・案件3件・通常のチャンネル1つと、A の投稿・リアクション）。
//   後始末は e2e/seeds/case-access-loss-reload-cleanup.sql（識別子だけ。残数 0 を確かめる）。
// ログインの試行制限に当たらないよう、ログインは利用者ごとに1回だけ（beforeAll）。同じ利用者の別のページは、同じブラウザのコンテキスト（Cookie を共有）で開く。
// E-2 は、段階を時計（page.clock）と通信の到達の通知（page.route）で固定する。固定の待ち・やり直し（toPass）・条件つきの分岐は使わない。
// 時計（playwright-core 1.64.1 で確かめた）：install() の後も時間は進む（注入の inject が controller.resume() を呼ぶ）。pauseAt で止めると、
//   止めた状態は次の文書にも引き継がれる（_replayLogOnce）。ただし、TanStack Query の通知は setTimeout(0) で動く（query-core の
//   notifyManager の systemSetTimeoutZero）ため、画面の操作の間は止められない（止めると画面が更新されない）。そこで、覆いが出た後
//   （⑤の確認の間）だけ止め、5秒の上限・通信の上限に届かないようにする。読み込み直しを進める⑥の前に resume する（コードレビュー1回目 軽微）。
// E2E は同時に1つだけ実行する（検証用の DB・ポートを共有するため）。
// #340（C-207）：E-1・E-2・E-3 に、読み込み直した後の文書の localStorage のキーの有無を足した（外された・退出した案件の部屋の下書きは無い、
//   別のチャンネルの書きかけは残る）。値は読まない。消す時機・消さない場合の網羅は画面・フック・単体のテスト（*.drafts.test.ts*）に任せる。
import { execFile } from "node:child_process";
import type {
  Browser,
  BrowserContext,
  Dialog,
  Locator,
  Page,
} from "@playwright/test";
import { expect, test } from "./console-guard";
import { roomLinkName } from "./room-link";

const ORIGIN = "http://localhost:5173";
const PASSWORD = "TestPass123!";
const NAME_A = "E2E読み込み直しA";
const NAME_B = "E2E読み込み直しB";
const CASES = {
  e1: {
    id: "01JTE2E00000000000R0011338",
    room: "01JTE2E00000000000R0010338",
    title: "[E2E_TEST]読み込み直しの案件1",
    description: "[E2E_TEST]読み込み直しの説明1",
  },
  e2: {
    id: "01JTE2E00000000000R0021338",
    room: "01JTE2E00000000000R0020338",
    title: "[E2E_TEST]読み込み直しの案件2",
    description: "[E2E_TEST]読み込み直しの説明2",
  },
  e3: {
    id: "01JTE2E00000000000R0031338",
    room: "01JTE2E00000000000R0030338",
    title: "[E2E_TEST]読み込み直しの案件3",
    description: "[E2E_TEST]読み込み直しの説明3",
  },
} as const;
const CHANNEL_ROOM = "01JTE2E00000000000R0040338";
const CHANNEL_NAME = "E2E_TEST_reload_部屋";
const REACTED_TEXT = "[E2E_TEST]読み込み直しのリアクション付きの投稿";
const CASE_POST_TEXT = "[E2E_TEST]338送信中の投稿";
const CHANNEL_DRAFT = "[E2E_TEST]338チャンネルの書きかけ";
const PRIVATE_TEXT = "参加者だけが見られます（非公開）";
const LOST_TEXT =
  "この案件を表示できなくなったため、画面を読み込み直しました。保存していない入力は消えています。";
const LEFT_TEXT = "案件から退出しました。";
const OVERLAY_TITLE = "画面を読み込み直しています";
const LEAVE_CONFIRM_TITLE = "入力した内容は失われます";
/** 自動の更新（2秒ごと）と概要の取り直しの後、読み込み直しが済むまでの余裕（E-1・E-3。時計を固定しない場面） */
const RELOAD_TIMEOUT_MS = 20_000;
/** 計画 7-4：検出の2秒だけ時計を進める（5秒の上限・通信の上限10秒には届かせない） */
const POLL_MS = 2_000;

function seedFile(
  file: "case-access-loss-reload.sql" | "case-access-loss-reload-cleanup.sql",
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

/**
 * 仕様どおりの拒否の応答だけを許すコンソールの監視（e2e/case-access-loss.spec.ts と同じ考え方）。
 *   401：ログイン前のセッションの確認
 *   403・404：外された後の、テストの案件の中身（詳細・TODO・添付・部屋のメッセージ）の取得
 * それ以外のコンソールのエラー・処理されなかった例外は、expectNoErrors で失敗にする。
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

/** 同じ利用者の、別のページ（Cookie を共有）。console の監視も付ける */
/**
 * 時計を使うテスト（E-2・E-2 対照）のページ。page.clock はブラウザのコンテキストの時計そのもので（playwright-core 1.64.1 の
 * Page の clock = browserContext.clock）、install・pauseAt・resume・runFor は、コンテキストの初期化のスクリプトとして積まれ、
 * 同じコンテキストの後の文書すべてで再生される。止めた時計をほかのテスト（E-3 の b.page など）に持ち越さないよう、
 * テストごとに、同じ利用者の Cookie を写した使い捨てのコンテキストで開き、テストの後（失敗した場合も）に必ず閉じる（afterEach）
 */
const clockContexts: BrowserContext[] = [];
async function openClockPage(
  browser: Browser,
  signed: Signed,
  viewport: { width: number; height: number },
) {
  const context = await browser.newContext({
    baseURL: ORIGIN,
    viewport,
    storageState: await signed.context.storageState(),
  });
  clockContexts.push(context);
  const page = await context.newPage();
  watch(page, signed.errors);
  return page;
}

/** A が、案件の「参加者を管理」で B を参加者から外す（e2e/case-access-loss.spec.ts と同じ操作） */
async function removeB(aPage: Page, caseId: string, title: string) {
  await aPage.goto(`/cases/${caseId}`);
  const main = aPage.getByRole("main");
  await expect(
    main.getByRole("heading", { level: 1, name: title }),
  ).toBeVisible();
  await main.getByRole("button", { name: "参加者を管理", exact: true }).click();
  const manager = aPage.getByRole("dialog", { name: "参加者を管理" });
  await manager
    .getByRole("button", { name: `${NAME_B}を削除`, exact: true })
    .click();
  const confirm = aPage.getByRole("dialog", { name: "参加者の削除" });
  await confirm.getByRole("button", { name: "削除する", exact: true }).click();
  await expect(
    manager.getByRole("listitem").filter({ hasText: NAME_B }),
  ).toHaveCount(0);
}

/** いまの文書のナビゲーションの種類と、前の文書に置いた目印が残っているか */
async function documentState(page: Page) {
  return page.evaluate(() => ({
    type: (
      performance.getEntriesByType("navigation")[0] as
        PerformanceNavigationTiming | undefined
    )?.type,
    marker: (window as unknown as { __e2e338?: string }).__e2e338 ?? null,
  }));
}

async function placeMarker(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __e2e338?: string }).__e2e338 = "前の文書";
  });
}

/**
 * #340（C-207）：B の端末の下書きのキー（localStorage）。値は読まず、キーの有無だけを見る。
 * キーの形は本番の関数を使わず、決めた形（internal-system:draft:v1:<利用者ID>:<scope>）を独立に書く。B の ID はシード（case-access-loss-reload.sql）の値
 */
const B_ID = "01JTE2E00000000000R0006338";
const B_DRAFT_PREFIX = `internal-system:draft:v1:${B_ID}:`;
const roomDraftKey = (roomId: string) => `${B_DRAFT_PREFIX}room:${roomId}`;
const threadDraftKey = (roomId: string, parentId: string) =>
  `${B_DRAFT_PREFIX}thread:${roomId}:${parentId}`;

async function bDraftKeys(page: Page): Promise<string[]> {
  return page.evaluate(
    (prefix) =>
      Object.keys(window.localStorage)
        .filter((key) => key.startsWith(prefix))
        .sort(),
    B_DRAFT_PREFIX,
  );
}

/** 以前の文書で保存した下書きを、入力欄を使わずに置く（本文は架空。[E2E_TEST] の印） */
async function putDraft(page: Page, key: string) {
  await page.evaluate((k) => {
    window.localStorage.setItem(
      k,
      JSON.stringify({
        body: "[E2E_TEST]340前の文書の書きかけ",
        updatedAt: Date.now(),
      }),
    );
  }, key);
}

/** キーボードで入力する（click と打鍵で、beforeunload の確認に必要な利用者の操作になる。e2e/message-drafts.spec.ts と同じ） */
async function typeInto(input: Locator, text: string) {
  await input.click();
  await input.pressSequentially(text);
}

/** 同じ要素であることを後で確かめるための目印（React が管理しない data 属性） */
async function tag(locator: Locator, name: string) {
  await locator.evaluate((element, value) => {
    element.setAttribute("data-e2e338", value);
  }, name);
}

/**
 * 隠したままであることの見張り（#338 AC-2。E-2 の⑥）。文書の応答を保留している間（reloading）は、Playwright の expect・locator が
 * 移動の完了を待つ（playwright-core 1.64.1 の Frame.expect → Page.performActionPreChecks → _performWaitForNavigationCheck が
 * pendingDocument の完了を待つ）ため、その間の DOM を外から取れない。そこで、見張りをページの中に置き、隠す仕組みが外れたこと
 * （包みの hidden・inert が外れた・覆いが閉じた・目印の「付けた人」が閉じた/見えた・入力欄の値が変わった）を見つけたら、
 * 新しい文書でも読める sessionStorage に理由を書く。古い文書が捨てられる直前（pagehide）にも同じ確認をして、印を残す。
 * 包みは #root の直下の div（AccessLossBoundary）。キーはテスト専用（e2e338:）
 */
const WATCH_KEY = "e2e338:hidden-watch";
async function installHiddenWatch(page: Page, watchLeave: boolean) {
  await page.evaluate(
    ({ key, title, draft, leaveTitle, watchLeave }) => {
      const record = (reason: string) => {
        const list = JSON.parse(
          window.sessionStorage.getItem(key) ?? "[]",
        ) as string[];
        if (!list.includes(reason)) list.push(reason);
        window.sessionStorage.setItem(key, JSON.stringify(list));
      };
      const flag = (when: string, failed: boolean, reason: string) => {
        if (failed) record(`${when}:${reason}`);
      };
      const findOverlay = () =>
        [...document.querySelectorAll("dialog")].find((dialog) =>
          dialog.textContent?.includes(title),
        );
      const checkBoundary = (when: string) => {
        const wrapper = document.querySelector<HTMLElement>("#root > div");
        flag(when, wrapper === null || !wrapper.hidden, "shown");
        flag(
          when,
          wrapper === null || !wrapper.hasAttribute("inert"),
          "not-inert",
        );
        flag(when, findOverlay()?.open !== true, "no-overlay");
      };
      const checkKept = (when: string) => {
        const reactors = document.querySelector<HTMLDialogElement>(
          'dialog[data-e2e338="reactors"]',
        );
        flag(when, reactors?.open !== true, "reactors-closed");
        flag(when, reactors?.checkVisibility() === true, "reactors-visible");
        const composer = document.querySelector<HTMLTextAreaElement>(
          '[data-e2e338="composer"]',
        );
        flag(when, composer?.value !== draft, "composer-changed");
        flag(when, composer?.checkVisibility() === true, "composer-visible");
      };
      // 「戻る」の後の離脱の確認（コードレビュー1回目 軽微）：開いたまま、見えない
      const checkLeaveConfirm = (when: string) => {
        if (!watchLeave) return;
        const leave = [
          ...document.querySelectorAll<HTMLDialogElement>("dialog[open]"),
        ].find((dialog) => dialog.textContent?.includes(leaveTitle));
        flag(when, leave === undefined, "leave-confirm-closed");
        flag(when, leave?.checkVisibility() === true, "leave-confirm-visible");
      };
      // 覆いの外に、見える操作部品・文が無い（境界の外に描かれたもの）。フォーカスも覆いの外に無い
      const checkOutside = (when: string) => {
        const overlay = findOverlay();
        const inOverlay = (node: Element) => overlay?.contains(node) === true;
        const visibleOutside = [
          ...document.querySelectorAll<HTMLElement>(
            "button, a, input, textarea, select, dialog, [popover], p, li, h1, h2, h3",
          ),
        ].some((element) => !inOverlay(element) && element.checkVisibility());
        flag(when, visibleOutside, "visible-outside");
        const active = document.activeElement;
        flag(
          when,
          active !== null && active !== document.body && !inOverlay(active),
          "focus-outside",
        );
      };
      const check = (when: string) => {
        checkBoundary(when);
        checkKept(when);
        checkLeaveConfirm(when);
        checkOutside(when);
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
    },
    {
      key: WATCH_KEY,
      title: OVERLAY_TITLE,
      draft: CHANNEL_DRAFT,
      leaveTitle: LEAVE_CONFIRM_TITLE,
      watchLeave,
    },
  );
}

async function readHiddenWatch(page: Page) {
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

let a: Signed;
let b: Signed;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  await seedFile("case-access-loss-reload-cleanup.sql");
  await seedFile("case-access-loss-reload.sql");
  a = await login(browser, "e2euser_reload_a");
  b = await login(browser, "e2euser_reload_b");
});
test.afterEach(async () => {
  for (const context of clockContexts.splice(0)) await context.close();
});
test.afterAll(async () => {
  await a.context.close();
  await b.context.close();
  const output = await seedFile("case-access-loss-reload-cleanup.sql");
  expect(output).toContain("remaining_users");
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
});

test("#338 AC-1・AC-5 E-1: S-17 を開いたまま外されると、新しい文書に読み込み直され（種類 reload・前の目印がない）、中身が出ず、非公開の表示と知らせが出る", async () => {
  const page = b.page;
  await page.goto(`/cases/${CASES.e1.id}`);
  const main = page.getByRole("main");
  await expect(
    main.getByText(CASES.e1.description, { exact: true }),
  ).toBeVisible();
  // #340 AC-1：S-17 の入力欄に書く（入力のたびに同期で保存される。キーができたことを、キー名で確かめる）
  await typeInto(
    main.getByRole("textbox", { name: "メッセージ" }),
    "E2E 340の書きかけ",
  );
  expect(await bDraftKeys(page)).toContain(roomDraftKey(CASES.e1.room));
  await placeMarker(page);
  const reloaded = page.waitForEvent("load", { timeout: RELOAD_TIMEOUT_MS });

  await removeB(a.page, CASES.e1.id, CASES.e1.title);

  await reloaded;
  expect(await documentState(page)).toEqual({ type: "reload", marker: null });
  // #340 AC-1・AC-4：読み込み直した後の文書で、外された案件の部屋の下書きのキーが無い
  expect(await bDraftKeys(page)).not.toContain(roomDraftKey(CASES.e1.room));
  await expect(page).toHaveURL(new RegExp(`/cases/${CASES.e1.id}$`));
  await expect(main.getByText(PRIVATE_TEXT, { exact: true })).toHaveCount(1);
  // 非公開の表示が出た後に確かめる（描画の前に数えて空振りしない）：入力欄は出ず、キーも書き戻されていない
  await expect(main.getByRole("textbox", { name: "メッセージ" })).toHaveCount(
    0,
  );
  expect(await bDraftKeys(page)).not.toContain(roomDraftKey(CASES.e1.room));
  await expect(
    main.getByText(CASES.e1.description, { exact: true }),
  ).toHaveCount(0);
  await expect(main.getByRole("heading", { name: "やり取り" })).toHaveCount(0);
  await expect(page.getByText(LOST_TEXT, { exact: true })).toHaveCount(1);
  // 外した人の画面は、参加者のまま
  await expect(
    a.page.getByRole("main").getByText(CASES.e1.description, { exact: true }),
  ).toBeVisible();
  expect(b.errors).toEqual([]);
  expect(a.errors).toEqual([]);
});

test("#338 AC-2 E-2: 確かめの途中に別の画面へ移り、モーダル（付けた人）と書きかけを持った状態で喪失が確定すると、覆いの間、同じモーダルが開いたまま見えず、入力欄も見えず、Tab・Esc・クリック・「戻る」で変わらず、離脱の確認も見えず、beforeunload の確認が出ない", async ({
  browser,
}) => {
  // 準備：スマホの幅（「付けた人」はスマホ幅の部品）。最初の読み込みの前に時計を固定する
  const page = await openClockPage(browser, b, { width: 390, height: 844 });
  await page.clock.install();
  const beforeUnload: Dialog[] = [];
  page.on("dialog", (dialog) => {
    if (dialog.type() === "beforeunload") beforeUnload.push(dialog);
    void dialog.accept();
  });

  // ① B が S-17 で投稿を送る。その POST を受け、到達を知らせ、応答は保留する
  const postArrived = signal();
  const postRelease = signal();
  await page.route(`**/api/rooms/${CASES.e2.room}/messages`, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    postArrived.fire();
    await postRelease.fired;
    return route.fallback();
  });
  // ② 概要の取得の、構えた後の分を保留できるようにする（到達を知らせる）
  let holdSummary = false;
  const summaryArrived = signal();
  const summaryRelease = signal();
  await page.route(`**/api/cases/${CASES.e2.id}`, async (route) => {
    if (!holdSummary || route.request().method() !== "GET")
      return route.fallback();
    summaryArrived.fire();
    await summaryRelease.fired;
    return route.fallback();
  });

  await page.goto(`/cases/${CASES.e2.id}`);
  const main = page.getByRole("main");
  await expect(
    main.getByText(CASES.e2.description, { exact: true }),
  ).toBeVisible();
  // #340 AC-1：以前の文書で保存した、この案件の部屋のスレッドの返信の下書き（投稿の下書きは、送信の成功で消えるため、別に置く）
  const e2ThreadDraft = threadDraftKey(
    CASES.e2.room,
    "01JTE2E00000000000R0029338",
  );
  await putDraft(page, e2ThreadDraft);
  const caseComposer = main.getByRole("textbox", { name: "メッセージ" });
  await typeInto(caseComposer, CASE_POST_TEXT);
  await main.getByRole("button", { name: "送信", exact: true }).click();
  await postArrived.fired;

  // ③ A が B を外す → B の時計を検出の2秒だけ進める → 自動の更新が拒否を受け、概要の確かめが届く
  holdSummary = true;
  await removeB(a.page, CASES.e2.id, CASES.e2.title);
  await page.clock.runFor(POLL_MS);
  await summaryArrived.fired;

  // ④ B がアプリの中の移動でチャンネルの画面へ移り、入力欄に書き込み（見張りが生きる）、「付けた人」を開く
  await page.getByRole("button", { name: "メニューを開く" }).click();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: roomLinkName(CHANNEL_NAME) })
    .click();
  await expect(page).toHaveURL(new RegExp(`/channels/${CHANNEL_ROOM}$`));
  const channelComposer = page
    .getByRole("main")
    .getByRole("textbox", { name: "メッセージ" });
  await typeInto(channelComposer, CHANNEL_DRAFT);
  await tag(channelComposer, "composer");
  // #340：喪失の確定の前は、どちらのキーもある（否定の確認が空振りしない）
  expect(await bDraftKeys(page)).toEqual(
    expect.arrayContaining([e2ThreadDraft, roomDraftKey(CHANNEL_ROOM)]),
  );
  const row = page
    .getByRole("log", { name: "メッセージ一覧" })
    .getByRole("listitem")
    .filter({ hasText: REACTED_TEXT });
  await row.getByRole("button", { name: /^付けた人/ }).click();
  const reactorsVisible = page.getByRole("dialog", { name: "付けた人" });
  await expect(reactorsVisible).toBeVisible();
  await expect(
    reactorsVisible.getByText(NAME_A, { exact: true }),
  ).toBeVisible();
  await tag(reactorsVisible, "reactors");
  const closeBox = await reactorsVisible
    .getByRole("button", { name: "閉じる" })
    .boundingBox();
  if (closeBox === null) throw new Error("「閉じる」の位置を取れません");

  // 非表示を含めて取る（同じ要素であることは、付けた目印で確かめる）
  const reactors = page.locator('dialog[data-e2e338="reactors"]');
  const composer = page.locator('[data-e2e338="composer"]');
  const overlay = page.getByRole("dialog", { name: OVERLAY_TITLE });
  async function expectHiddenButKept() {
    await expect(reactors).toHaveCount(1);
    await expect(reactors).toHaveAttribute("open", "");
    await expect(reactors).toBeHidden();
    await expect(reactors.getByText(NAME_A, { exact: true })).toHaveCount(1);
    await expect(reactors.getByText(NAME_A, { exact: true })).toBeHidden();
    await expect(composer).toHaveCount(1);
    await expect(composer).toHaveValue(CHANNEL_DRAFT);
    await expect(composer).toBeHidden();
  }

  // ⑤ 確かめの応答（非参加）を返す → 覆いが見える（POST を保留しているので待機が続く）
  summaryRelease.fire();
  await expect(
    page.getByRole("heading", { name: OVERLAY_TITLE }),
  ).toBeVisible();
  // 覆いの確認の間は時計を止める（5秒の上限・通信の上限10秒に届かせない）。止める時刻は、いまの時計より先でなければならないため、
  // 1秒先にする（その1秒の間に来るタイマーは1回ずつ動く。待機の開始から、まだ5秒には届かない）
  const pageNow = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(pageNow + 1_000);
  // (1)(2) 同じモーダルが開いたまま見えず、入力欄も値が残ったまま見えない
  await expectHiddenButKept();
  // (3) Tab・Esc（2回）・「閉じる」があった位置のクリックで、変わらない（覆いも残る）
  await page.keyboard.press("Tab");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.mouse.click(
    closeBox.x + closeBox.width / 2,
    closeBox.y + closeBox.height / 2,
  );
  await expectHiddenButKept();
  await expect(overlay).toHaveAttribute("open", "");
  await expect(
    page.getByRole("heading", { name: OVERLAY_TITLE }),
  ).toBeVisible();
  // (4) 「戻る」：離脱の確認は、非表示を含めて取り、開いたこと（件数1・open）を待ってから、見えないことを確かめる
  await page.goBack();
  const leaveConfirm = page.locator("dialog[open]", {
    hasText: LEAVE_CONFIRM_TITLE,
  });
  await expect(leaveConfirm).toHaveCount(1);
  await expect(leaveConfirm).toBeHidden();
  await expectHiddenButKept();

  // ⑥ 見張りを置いてから（まだ移動は始まっていないので、置いた時点の違反は0のはず）、文書の取得を保留する登録をし、POST の応答を返す
  //    → 文書の要求が届く（reloading の間）。この間は外から DOM を取れないので、見張りに任せる
  await installHiddenWatch(page, true);
  // 読み込み直しを進める：止めていた時計を戻す（POST の完了の後の1つ後のタスクは、時計で進む）
  await page.clock.resume();
  const documentArrived = signal();
  const documentRelease = signal();
  await page.route("**/*", async (route) => {
    if (route.request().resourceType() !== "document") return route.fallback();
    documentArrived.fire();
    await documentRelease.fired;
    return route.fallback();
  });
  postRelease.fire();
  await documentArrived.fired;

  // ⑦ 文書の応答を返し、新しい文書が読み込まれる。この間の beforeunload の確認は0回。
  //    見張り：置いてから古い文書が捨てられるまで（pagehide を含む）、隠す仕組みが一度も外れていない
  const loaded = page.waitForEvent("load");
  documentRelease.fire();
  await loaded;
  expect(beforeUnload).toHaveLength(0);
  expect((await documentState(page)).marker).toBeNull();
  expect(await readHiddenWatch(page)).toEqual({
    reasons: [],
    pagehide: "seen",
  });
  // #340 AC-1・AC-2・AC-4：読み込み直した後の文書で、外された案件の部屋の下書き（投稿・スレッドの返信）のキーは無く、
  // 別のチャンネルの書きかけ（CHANNEL_DRAFT）のキーは残っている
  const keysAfter = await bDraftKeys(page);
  expect(
    keysAfter.filter(
      (key) =>
        key === roomDraftKey(CASES.e2.room) ||
        key.startsWith(`${B_DRAFT_PREFIX}thread:${CASES.e2.room}:`),
    ),
  ).toEqual([]);
  expect(keysAfter).toContain(roomDraftKey(CHANNEL_ROOM));
  await page.close();
  expect(b.errors).toEqual([]);
});

test("#338 AC-2 E-2 対照: E-2 の④と同じ状態（喪失なし・時計の固定も同じ）でテストが再読み込みすると、beforeunload の確認が1回出る（見張りが生きていることを示す）", async ({
  browser,
}) => {
  const page = await openClockPage(browser, b, { width: 390, height: 844 });
  await page.clock.install();
  const beforeUnload: string[] = [];
  page.on("dialog", (dialog) => {
    beforeUnload.push(dialog.type());
    void dialog.accept();
  });
  await page.goto(`/channels/${CHANNEL_ROOM}`);
  const channelComposer = page
    .getByRole("main")
    .getByRole("textbox", { name: "メッセージ" });
  await typeInto(channelComposer, CHANNEL_DRAFT);
  const row = page
    .getByRole("log", { name: "メッセージ一覧" })
    .getByRole("listitem")
    .filter({ hasText: REACTED_TEXT });
  await row.getByRole("button", { name: /^付けた人/ }).click();
  const reactorsDialog = page.getByRole("dialog", { name: "付けた人" });
  await expect(reactorsDialog).toBeVisible();
  // E-2 の⑥の見張りが、隠していない状態を実際に見つけることを示す（働かない見張りは、何も守らない）
  await tag(channelComposer, "composer");
  await tag(reactorsDialog, "reactors");
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1_000);
  await installHiddenWatch(page, true);
  const watched = await page.evaluate(
    (key) => JSON.parse(window.sessionStorage.getItem(key) ?? "[]") as string[],
    WATCH_KEY,
  );
  expect(watched).toEqual(
    expect.arrayContaining([
      "install:shown",
      "install:not-inert",
      "install:no-overlay",
      "install:reactors-visible",
      "install:composer-visible",
      "install:leave-confirm-closed",
      "install:visible-outside",
      "install:focus-outside",
    ]),
  );

  await page.reload();
  // reload の後、pagehide でも違反（隠していない）を記録している
  const afterReload = await readHiddenWatch(page);
  expect(afterReload.pagehide).toBe("seen");
  expect(afterReload.reasons).toEqual(
    expect.arrayContaining(["pagehide:shown", "pagehide:no-overlay"]),
  );
  // 計画は dismiss だが、dismiss すると reload の完了を待てないため、e2e/message-drafts.spec.ts と同じく accept で数える
  expect(beforeUnload).toEqual(["beforeunload"]);
  await page.close();
  expect(b.errors).toEqual([]);
});

test("#338 AC-1・AC-5 E-3: S-17 で自分から退出すると、/cases の新しい文書に置き換わり、「案件から退出しました。」が1回出る", async () => {
  const page = b.page;
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/cases/${CASES.e3.id}`);
  const main = page.getByRole("main");
  await expect(
    main.getByText(CASES.e3.description, { exact: true }),
  ).toBeVisible();
  // #340 AC-1 (c)（利用者の決定 Q1：本人の退出でも消す）：入力欄に書いてから退出する
  await typeInto(
    main.getByRole("textbox", { name: "メッセージ" }),
    "E2E 340の退出の前の書きかけ",
  );
  expect(await bDraftKeys(page)).toContain(roomDraftKey(CASES.e3.room));
  await placeMarker(page);
  const loaded = page.waitForEvent("load", { timeout: RELOAD_TIMEOUT_MS });

  await main.getByRole("button", { name: "参加者を管理", exact: true }).click();
  const manager = page.getByRole("dialog", { name: "参加者を管理" });
  await manager
    .getByRole("listitem")
    .filter({ hasText: NAME_B })
    .getByRole("button", { name: "退出する" })
    .click();
  const confirm = page.getByRole("dialog", { name: "案件からの退出" });
  await confirm.getByRole("button", { name: "退出する", exact: true }).click();

  await loaded;
  await expect(page).toHaveURL(/\/cases$/);
  expect((await documentState(page)).marker).toBeNull();
  await expect(page.getByText(LEFT_TEXT, { exact: true })).toHaveCount(1);
  await expect(
    page.getByText(CASES.e3.description, { exact: true }),
  ).toHaveCount(0);
  // #340 AC-1 (c)：退出した後の新しい文書で、その案件の部屋の下書きのキーが無い
  expect(await bDraftKeys(page)).not.toContain(roomDraftKey(CASES.e3.room));
  expect(b.errors).toEqual([]);
});
