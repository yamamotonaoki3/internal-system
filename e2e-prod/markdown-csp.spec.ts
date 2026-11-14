// #134 AC-2（1-5 AC-2・AC-3・AC-6）・改訂1 の軽微3・ADR-0026：本番形（ビルド済みの成果物 + public/_headers の CSP）で、
// メッセージの本文のマークダウンの表示と、その部品の動的読み込みの塊が、CSP 違反を起こさず、style 要素・style 属性を出さないこと。
// あわせて、Tailwind の初期化で消える箇条書きの印・番号が、markdown-body の外部の CSS で戻っていること（list-style-type が none でない）を確かめる。
// 本番形（vite preview）ではログインが 503 になりログインできないため、このテストの中だけで API の応答を差し替える（架空の利用者・本文。DB は使わない）。
// 前提：playwright.prod.config.ts の webServer（npm run build の後の preview）。
import type { Page, Route } from "@playwright/test";
import { expect, test } from "../e2e/console-guard";

const USER_ID = "01JTE2E1340000000000000P01";
const CHANNEL_ID = "01JTE2E1340000000000000P02";

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: "application/json",
    headers: { "cache-control": "no-store" },
    body: JSON.stringify(body),
  });

const message = (n: number, body: string) => ({
  id: `01M78ZTJC0000000000134P${String(n).padStart(3, "0")}`,
  roomId: CHANNEL_ID,
  author: { id: USER_ID, displayName: "テスト記法", isActive: true },
  body,
  createdAt: "2026-11-12T23:00:00.000Z",
  editedAt: n === 1 ? "2026-11-13T00:00:00.000Z" : null,
  deleted: false,
});

// 新しい順（一覧の API の並び）
const ITEMS = [
  message(
    6,
    "[E2E_TEST]整形しない記法\n\n| a | b |\n| :---: | ---: |\n| 1 | 2 |\n\n# 見出し\n\n---",
  ),
  message(5, "[E2E_TEST]<img src=x onerror=alert(1)><script>alert(1)</script>"),
  message(4, "[E2E_TEST]> 引用\n\n```\nconst a = 1\n```"),
  message(3, "[E2E_TEST]番号\n\n1. 最初\n2. 次"),
  message(2, "[E2E_TEST]箇条書き\n\n- 一つ目\n- 二つ目"),
  message(
    1,
    "[E2E_TEST]**本番形の太字** と *斜体* と ~~取り消し~~ と `コード` と [リンク](https://example.com)",
  ),
];

async function mockApi(page: Page): Promise<void> {
  await page.route("**/api/auth/session", (route) =>
    json(route, {
      user: {
        id: USER_ID,
        displayName: "テスト記法",
        loginId: "e2euser_md_001",
      },
      permissions: [],
      mustChangePassword: false,
      reauthenticatedAt: null,
    }),
  );
  await page.route(/\/api\/channels(\?.*)?$/, (route) =>
    json(route, {
      items: [
        {
          id: CHANNEL_ID,
          roomId: CHANNEL_ID,
          name: "[E2E_TEST]本番形の記法",
          visibility: "public",
          departmentId: null,
          departmentName: null,
          joined: true,
        },
      ],
      nextCursor: null,
    }),
  );
  await page.route(`**/api/channels/${CHANNEL_ID}`, (route) =>
    json(route, {
      id: CHANNEL_ID,
      roomId: CHANNEL_ID,
      name: "[E2E_TEST]本番形の記法",
      description: "",
      visibility: "public",
      departmentId: null,
      joined: true,
      isCaseChannel: false,
      canPost: true,
      readOnly: false,
      memberCount: 1,
      members: [{ id: USER_ID, displayName: "テスト記法" }],
    }),
  );
  await page.route(
    new RegExp(`/api/rooms/${CHANNEL_ID}/messages(\\?.*)?$`),
    (route) => {
      const after = new URL(route.request().url()).searchParams.get("after");
      return json(
        route,
        after === null
          ? { items: ITEMS, nextCursor: null, hasMore: false }
          : { items: [], nextCursor: null, hasMore: false },
      );
    },
  );
  await page.route(`**/api/rooms/${CHANNEL_ID}/read-position`, (route) =>
    route.fulfill({ status: 204 }),
  );
  await page.route(/\/api\/dms(\?.*)?$/, (route) =>
    json(route, { items: [], nextCursor: null }),
  );
  await page.route(/\/api\/me\/unread(\?.*)?$/, (route) =>
    json(route, { items: [], nextCursor: null }),
  );
  await page.route("**/api/me/notifications/unread-count", (route) =>
    json(route, { count: 0 }),
  );
  await page.route("**/api/me/profile", (route) =>
    json(route, {
      id: USER_ID,
      loginId: "e2euser_md_001",
      displayName: "テスト記法",
      legalName: "テスト記法",
      email: "e2euser_md_001@example.com",
      extension: null,
      jobTitle: null,
      department: null,
      status: { kind: "available", returnAt: null, message: null },
    }),
  );
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

test("#134 AC-2（1-5 AC-2・AC-3・ADR-0026）: 本番の CSP の下で、マークダウンの表示と動的読み込みの塊が CSP 違反を起こさず、style 要素・style 属性がなく、箇条書きの印・番号が見える", async ({
  page,
}) => {
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  const scripts: string[] = [];
  page.on("response", (response) => {
    if (response.request().resourceType() === "script")
      scripts.push(new URL(response.url()).pathname);
  });
  await watchCsp(page);
  await mockApi(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  const response = await page.goto(`/channels/${CHANNEL_ID}`);
  expect(response?.headers()["content-security-policy"]).toContain(
    "style-src 'self'",
  );

  const log = page.getByRole("log");
  // マークダウンの部品の塊を読み込み、整形した表示に替わる
  await expect(
    log.locator(".markdown-body strong", { hasText: "本番形の太字" }),
  ).toBeVisible();
  await expect(log.locator(".markdown-body del")).toHaveText("取り消し");
  await expect(log).toContainText("（編集済み）");
  // 読み込んだ塊（動的に読み込んだものを含む）は、すべて同じオリジンの /assets/ の外部ファイル
  expect(scripts.length).toBeGreaterThan(0);
  for (const path of scripts) expect(path).toMatch(/^\/assets\/.+\.js$/);

  // 箇条書きの印・番号が見える（Tailwind の初期化で消えたものを、markdown-body の CSS で戻している）
  const bullets = log.locator(".markdown-body ul").first();
  const numbers = log.locator(".markdown-body ol").first();
  await expect(bullets).toBeVisible();
  await expect(numbers).toBeVisible();
  const listStyles = await page.evaluate(() => {
    const ul = document.querySelector(".markdown-body ul");
    const ol = document.querySelector(".markdown-body ol");
    return {
      ul: ul ? getComputedStyle(ul).listStyleType : "",
      ol: ol ? getComputedStyle(ol).listStyleType : "",
      li: ul?.querySelector("li")
        ? getComputedStyle(ul.querySelector("li") as Element).display
        : "",
    };
  });
  expect(listStyles.ul).not.toBe("none");
  expect(listStyles.ul).not.toBe("");
  expect(listStyles.ol).not.toBe("none");
  expect(listStyles.ol).not.toBe("");
  expect(listStyles.li).toBe("list-item");

  // 表（列の寄せ）を書いても table・style 属性を出さない。HTML は文字で出る
  await expect(log.locator("table, img, script, h1, hr")).toHaveCount(0);
  await expect(log).toContainText("<img src=x onerror=alert(1)>");

  // 画面全体で style 要素・style 属性が 0、CSP 違反がない、ダイアログが開いていない
  // （2秒ごとの取得の後も変わらないことを確かめるため、新着の取得（after）の応答を1回待つ）
  await page.waitForResponse(
    (r) =>
      r.url().includes(`/api/rooms/${CHANNEL_ID}/messages`) &&
      new URL(r.url()).searchParams.has("after"),
  );
  const counts = await page.evaluate(() => ({
    styleElements: document.querySelectorAll("style").length,
    styleAttributes: document.querySelectorAll("[style]").length,
  }));
  expect(counts.styleElements, "style 要素が0").toBe(0);
  expect(counts.styleAttributes, "style 属性が0").toBe(0);
  const violations = await page.evaluate(
    () => (window as unknown as { __cspViolations: string[] }).__cspViolations,
  );
  expect(violations, "securitypolicyviolation").toEqual([]);
  expect(dialogs).toEqual([]);
});
