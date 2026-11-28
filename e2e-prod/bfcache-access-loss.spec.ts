// #342（342-A）AC-1・AC-4・AC-6（計画 plan342a2 の 7 節の「本番形 spec」）：本番形（ビルド済みの成果物 + public/_headers の CSP）で、
// ブラウザの「戻る」の守り（pagehide で隠す → pageshow で確かめる → 失敗の案内と再試行 → 解除）の覆いが、CSP の下で動き、
// style 要素・style 属性を増やさず、CSP 違反を起こさないことを確かめる。判定の網羅は繰り返さない（開発用の e2e/bfcache-access-loss.spec.ts と単体・画面のテスト）。
// 【言えること・言えないこと】本番形（vite preview）ではログインが 503 になるため、このテストの中だけで API の応答を差し替える（架空の利用者・本文。DB は使わない。
//   docs/testing/e2e.md の「本番形の E2E」）。そのため、ここで言えるのは、ビルドした成果物の中で、守りが登録され（main.tsx）、覆い・案内・再試行・解除が
//   CSP の下で描かれること、セッションの確かめの後に案件の概要を取得することまで。実際のセッション・権限・サーバーの答え・文書の読み込み直し・
//   実際の bfcache の保存と復元は、ここでは確かめられない（開発用の E2E と、通常のブラウザでの確かめ〔計画 8 節の M0〜M3〕に任せる）。
// pagehide・pageshow は、page.evaluate の中で PageTransitionEvent を window に送る合成（isTrusted は false）。実際の復元の証拠ではない。
// 対象の案件は、S-35 のスレッド一覧の行（caseId を持つ）で作る（計画 3-2 の「スレッド一覧の読み込み済み全ページにある案件行」）。
// 前提：playwright.prod.config.ts の webServer（npm run build の後の preview）。固定の待ち・時計・toPass・条件つきの分岐は使わない。
import type { Page, Route } from "@playwright/test";
import { allowConsoleError, expect, test } from "../e2e/console-guard";

const USER_ID = "01JTE2E3420000000000000P01";
const CASE_ID = "01JTE2E3420000000000000P02";
const CASE_ROOM = "01JTE2E3420000000000000P03";
const PARENT_TEXT = "[E2E_TEST]342本番形の親";
const RESTORE_FAILED_TEXT = "画面を確認できませんでした。再試行してください";
const RETRY_BUTTON = "再試行";
const SESSION_PATH = "/api/auth/session";
const SUMMARY_PATH = `/api/cases/${CASE_ID}`;

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: "application/json",
    headers: { "cache-control": "no-store" },
    body: JSON.stringify(body),
  });

function signal() {
  let fire!: () => void;
  const fired = new Promise<void>((resolve) => {
    fire = resolve;
  });
  return { fired, fire };
}

const PARENT = {
  id: "01M7B00000000000000P342001",
  roomId: CASE_ROOM,
  author: { id: USER_ID, displayName: "テスト戻る", isActive: true },
  body: PARENT_TEXT,
  createdAt: "2026-11-28T00:00:00.000Z",
  editedAt: null,
  deleted: false,
  parentMessageId: null,
  replyCount: 1,
  mentions: [],
  reactions: [],
  attachments: [],
};

/** 参加者の概要（frontend/src/features/cases/api/case-api.ts の概要の形） */
const SUMMARY = {
  id: CASE_ID,
  caseNumber: "QBP-261128-0001",
  title: "[E2E_TEST]342本番形の案件",
  status: "active",
  client: {
    id: "01JTE2E3420000000000000P04",
    name: "テスト商事本番形 [E2E_TEST]",
    isActive: true,
  },
  departments: [],
  dueDate: null,
  isParticipant: true,
  canManage: false,
  participantCount: 1,
  canEditDueDate: false,
  progress: null,
  lastActivityAt: null,
  channelId: CASE_ROOM,
};

type Controls = {
  sessionCalls: number;
  summaryCalls: number;
  /** 次のセッションの GET を保留する（到達を知らせ、release で応答する） */
  holdNextSession: () => { arrived: Promise<void>; release: () => void };
  /** 次の概要の GET を、通信の失敗にする */
  failNextSummary: () => void;
};

async function mockApi(page: Page): Promise<Controls> {
  let sessionHold: { arrived: () => void; released: Promise<void> } | null =
    null;
  let failSummary = false;
  const controls: Controls = {
    sessionCalls: 0,
    summaryCalls: 0,
    holdNextSession: () => {
      const arrived = signal();
      const release = signal();
      sessionHold = { arrived: arrived.fire, released: release.fired };
      return { arrived: arrived.fired, release: release.fire };
    },
    failNextSummary: () => {
      failSummary = true;
    },
  };
  await page.route(`**${SESSION_PATH}`, async (route) => {
    controls.sessionCalls += 1;
    const hold = sessionHold;
    sessionHold = null;
    if (hold !== null) {
      hold.arrived();
      await hold.released;
    }
    return json(route, {
      user: {
        id: USER_ID,
        displayName: "テスト戻る",
        loginId: "e2euser_bfcache342_prod",
      },
      permissions: [],
      mustChangePassword: false,
      reauthenticatedAt: null,
    });
  });
  await page.route(`**${SUMMARY_PATH}`, (route) => {
    controls.summaryCalls += 1;
    if (failSummary) {
      failSummary = false;
      return route.abort("failed");
    }
    return json(route, SUMMARY);
  });
  await page.route(/\/api\/me\/threads(\?.*)?$/, (route) =>
    json(route, {
      items: [
        {
          parent: PARENT,
          room: {
            kind: "channel",
            id: CASE_ROOM,
            name: "QBP-261128-0001",
          },
          lastReplyAt: "2026-11-28T00:00:05.000Z",
          unreadCount: 0,
          caseId: CASE_ID,
        },
      ],
      nextCursor: null,
    }),
  );
  // 共通レイアウトが呼ぶ一覧（e2e-prod/csp-style.spec.ts の mockLoggedIn と同じ形）
  for (const pattern of [
    /\/api\/channels(\?.*)?$/,
    /\/api\/dms(\?.*)?$/,
    /\/api\/cases(\?.*)?$/,
    /\/api\/me\/unread(\?.*)?$/,
  ])
    await page.route(pattern, (route) =>
      json(route, { items: [], nextCursor: null }),
    );
  await page.route("**/api/me/notifications/unread-count", (route) =>
    json(route, { count: 0 }),
  );
  await page.route("**/api/me/profile", (route) =>
    json(route, {
      id: USER_ID,
      loginId: "e2euser_bfcache342_prod",
      displayName: "テスト戻る",
      legalName: "テスト戻る",
      email: "e2euser_bfcache342_prod@example.com",
      extension: null,
      jobTitle: null,
      department: null,
      status: { kind: "available", returnAt: null, message: null },
    }),
  );
  return controls;
}

// CSP 違反（securitypolicyviolation）を集める。console のエラーは console-guard が見る
async function watchCsp(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __cspViolations: string[] };
    w.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      w.__cspViolations.push(`${e.violatedDirective}: ${e.blockedURI}`);
    });
  });
}

async function expectNoInlineStyleNorViolation(page: Page, when: string) {
  const state = await page.evaluate(() => ({
    styleElements: document.querySelectorAll("style").length,
    styleAttributes: document.querySelectorAll("[style]").length,
    violations: (window as unknown as { __cspViolations: string[] })
      .__cspViolations,
  }));
  expect(state.styleElements, `${when}：style 要素が0`).toBe(0);
  expect(state.styleAttributes, `${when}：style 属性が0`).toBe(0);
  expect(state.violations, `${when}：securitypolicyviolation`).toEqual([]);
}

/** 合成した pagehide を送り、送った直後（同じタスクの中）の包み（#root の直下で main を含む要素）の hidden・inert を返す */
async function dispatchPageHide(page: Page) {
  return page.evaluate(() => {
    const wrapper = [
      ...document.querySelectorAll<HTMLElement>("#root > *"),
    ].find((element) => element.querySelector("main") !== null);
    window.dispatchEvent(
      new PageTransitionEvent("pagehide", { persisted: true }),
    );
    return {
      hidden: wrapper?.hidden === true,
      inert: wrapper?.hasAttribute("inert") === true,
    };
  });
}

async function dispatchPageShow(page: Page) {
  await page.evaluate(() => {
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    );
  });
}

test("#342 AC-1・AC-4・AC-6 本番形: CSP の下で、合成した pagehide で隠れ、確かめの間・失敗の案内と再試行・再試行の後の解除で、style 要素・style 属性が0のまま、CSP 違反がない", async ({
  page,
}) => {
  allowConsoleError(
    page,
    /net::ERR_FAILED/,
    "このテストが、戻ったときの概要の取得を1回だけ通信の失敗にするため",
  );
  await watchCsp(page);
  const api = await mockApi(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  const response = await page.goto("/threads");
  expect(response?.headers()["content-security-policy"]).toContain(
    "style-src 'self'",
  );
  const row = page
    .getByRole("list", { name: "スレッド一覧" })
    .getByText(PARENT_TEXT, { exact: true });
  await expect(row).toBeVisible();
  await expectNoInlineStyleNorViolation(page, "表示の後");
  const wrapper = page.locator("#root > :has(main)");

  // ① 離れる：pagehide の処理の中で隠れる
  expect(await dispatchPageHide(page)).toEqual({ hidden: true, inert: true });
  await expect(row).toBeHidden();
  await expectNoInlineStyleNorViolation(page, "隠した後");

  // ② 戻る：セッションの確かめを保留した間（確かめの覆い）も、style・CSP 違反がない
  const held = api.holdNextSession();
  api.failNextSummary();
  const sessionsBefore = api.sessionCalls;
  await dispatchPageShow(page);
  await held.arrived;
  await expect(wrapper).toHaveAttribute("hidden");
  await expect(wrapper).toHaveAttribute("inert");
  await expectNoInlineStyleNorViolation(page, "確かめの間");

  // ③ 概要の取得が通信の失敗 → 隠したまま、失敗の案内と再試行
  held.release();
  const retry = page.getByRole("button", { name: RETRY_BUTTON });
  await expect(retry).toBeVisible();
  await expect(
    page.getByText(RESTORE_FAILED_TEXT, { exact: true }),
  ).toBeVisible();
  await expect(wrapper).toHaveAttribute("hidden");
  await expect(row).toBeHidden();
  expect(api.sessionCalls).toBe(sessionsBefore + 1);
  expect(api.summaryCalls).toBeGreaterThanOrEqual(1);
  await expectNoInlineStyleNorViolation(page, "失敗の案内");

  // ④ 再試行 → セッションから確かめ直し、参加者なら外れる
  const summariesBefore = api.summaryCalls;
  await retry.click();
  await expect(wrapper).not.toHaveAttribute("hidden");
  await expect(wrapper).not.toHaveAttribute("inert");
  await expect(row).toBeVisible();
  await expect(
    page.getByText(RESTORE_FAILED_TEXT, { exact: true }),
  ).toHaveCount(0);
  expect(api.sessionCalls).toBeGreaterThanOrEqual(sessionsBefore + 2);
  expect(api.summaryCalls).toBeGreaterThan(summariesBefore);
  await expectNoInlineStyleNorViolation(page, "外した後");
});
