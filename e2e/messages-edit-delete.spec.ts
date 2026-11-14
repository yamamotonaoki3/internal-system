// #134 AC-1（1-3 AC-1〜AC-4）・利用者の決定 U-3・U-8：投稿の編集・削除を、画面からバックエンドまで通して確かめる。
// A がチャンネル（S-05）で自分の投稿を編集・削除する → 再読み込みせずに、新しい本文と「（編集済み）」・「このメッセージは削除されました」が出る。
// 削除は確認の後に再認証を経る。他人（B）の投稿にはボタンがなく、API を直接呼んでも 403 で、内容は変わらない。DM（S-06）でも同じ。
// B がチャンネルを開いた後、A が編集・削除してから、B が画面の中の移動で部屋を開き直すと、最新の一覧から取り直して反映される（U-8）。
// 前提のデータは e2e/seeds/messages-edit.sql（e2euser_edit134_・[E2E_TEST]部署134・@example.com）。後始末は messages-edit-cleanup.sql（残数 0 を確かめる）。
// ログインの試行制限に当たらないよう、ログインは A・B の 2 人で 1 回ずつにし、ブラウザはテストの間で使い回す（順に実行する）。
// 画面の文言は frontend/src/features/messages/messages.edit-delete.test.tsx の契約と同じ。
import { execFile } from "node:child_process";
import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";
import { expect, test } from "./console-guard";
import { roomLinkName } from "./room-link";

const ORIGIN = "http://localhost:5173";
const PASSWORD = "TestPass123!";
const CHANNEL_ID = "01JTE2E1340000000000000C01";
const CHANNEL_NAME = "[E2E_TEST]部署134の編集";
const DM_ROOM = "01JTE2E1340000000000000M01";
const NAME_A = "E2E編集利用者A";
const NAME_B = "E2E編集利用者B";
const MSG_B = "01M78ZTJC00000000001340003";
const MSG_DM_B = "01M78ZTJC00000000001340008";
const EDITED_MARK = "（編集済み）";
const DELETED_TEXT = "このメッセージは削除されました";

function seedFile(file: "messages-edit.sql" | "messages-edit-cleanup.sql") {
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
  return { context, page, errors, loads: () => count };
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
const log = (page: Page) => page.getByRole("log");
const rowWith = (page: Page, text: string): Locator =>
  log(page).getByRole("listitem").filter({ hasText: text });

async function editMessage(page: Page, original: string, next: string) {
  await rowWith(page, original)
    .getByRole("button", { name: "編集", exact: true })
    .click();
  const box = page.getByRole("textbox", {
    name: "メッセージの編集",
    exact: true,
  });
  await expect(box).toHaveValue(original);
  await box.fill(next);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(box).toHaveCount(0);
}

/** 「削除」→ 確認の「削除する」。再認証を求められたら、パスワードを入れて続ける */
async function deleteMessage(
  page: Page,
  body: string,
  options: { expectReauth: boolean },
) {
  await rowWith(page, body)
    .getByRole("button", { name: "削除", exact: true })
    .click();
  const confirm = page.getByRole("dialog", { name: "メッセージの削除" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "削除する", exact: true }).click();
  const reauth = page.getByRole("dialog", { name: "再認証" });
  if (options.expectReauth) {
    await expect(reauth).toBeVisible();
    await reauth.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
    await reauth.getByRole("button", { name: "再認証", exact: true }).click();
  }
  await expect(reauth).toHaveCount(0);
}

type ApiItem = {
  id: string;
  body: string | null;
  editedAt: string | null;
  deleted: boolean;
};

async function itemsOf(page: Page, roomId: string): Promise<ApiItem[]> {
  const response = await page.request.get(`/api/rooms/${roomId}/messages`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { items: ApiItem[] }).items;
}

let a: Guarded | undefined;
let b: Guarded | undefined;

function userA(): Guarded {
  if (a === undefined) throw new Error("A のブラウザがありません");
  return a;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  await seedFile("messages-edit-cleanup.sql");
  await seedFile("messages-edit.sql");
  a = await guardedPage(browser);
  await login(a.page, "e2euser_edit134_a");
});

test.afterAll(async () => {
  for (const opened of [a, b]) await opened?.context.close();
  const output = await seedFile("messages-edit-cleanup.sql");
  // 後始末の後の残数がすべて 0 であること
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
});

test.afterEach(() => {
  // 開いているすべてのブラウザで、エラーレベルのコンソール出力・処理されなかった例外が無いこと
  for (const opened of [a, b])
    expect(opened?.errors ?? [], "コンソールのエラー").toEqual([]);
});

test("#134 AC-1（1-3 AC-1・AC-3・AC-4）: チャンネルで自分の投稿を編集すると、再読み込みせずに新しい本文と「（編集済み）」が出る。削除は確認と再認証を経て、再読み込みせずに「このメッセージは削除されました」に替わる", async () => {
  const { page, loads } = userA();
  await page.goto(`/channels/${CHANNEL_ID}`);
  await expect(log(page)).toContainText("[E2E_TEST]Aの編集する投稿");
  const loadsBefore = loads();

  // 編集：その場の編集欄で直して保存する
  await editMessage(
    page,
    "[E2E_TEST]Aの編集する投稿",
    "[E2E_TEST]Aの編集した投稿",
  );
  const edited = rowWith(page, "[E2E_TEST]Aの編集した投稿");
  await expect(edited).toContainText(EDITED_MARK);
  await expect(log(page)).not.toContainText("[E2E_TEST]Aの編集する投稿");

  // 削除：確認 → 再認証（まだ再認証していない）→ 削除の表示
  await deleteMessage(page, "[E2E_TEST]Aの削除する投稿", {
    expectReauth: true,
  });
  await expect(log(page)).toContainText(DELETED_TEXT);
  await expect(log(page)).not.toContainText("[E2E_TEST]Aの削除する投稿");
  const deletedRow = rowWith(page, DELETED_TEXT);
  await expect(deletedRow).toContainText(NAME_A);
  await expect(deletedRow.getByRole("button", { name: "編集" })).toHaveCount(0);
  await expect(deletedRow.getByRole("button", { name: "削除" })).toHaveCount(0);

  // 再読み込みしていない
  expect(loads()).toBe(loadsBefore);

  // サーバーの状態：編集は editedAt つき、削除は deleted で本文を返さない
  const items = await itemsOf(page, CHANNEL_ID);
  const editedItem = items.find(
    (item) => item.body === "[E2E_TEST]Aの編集した投稿",
  );
  expect(editedItem?.editedAt).not.toBeNull();
  expect(editedItem?.deleted).toBe(false);
  const deletedItem = items.find(
    (item) => item.id === "01M78ZTJC00000000001340002",
  );
  expect(deletedItem).toMatchObject({ deleted: true, body: null });
  expect(JSON.stringify(items)).not.toContain("[E2E_TEST]Aの削除する投稿");
});

test("#134 AC-1（1-3 AC-2）: 他人（B）の投稿には「編集」「削除」がなく、API を直接呼んでも 403 で、内容は変わらない", async () => {
  const { page } = userA();
  await expect(page).toHaveURL(new RegExp(`/channels/${CHANNEL_ID}$`));
  const other = rowWith(page, "[E2E_TEST]Bの投稿");
  await expect(other).toContainText(NAME_B);
  await expect(other.getByRole("button", { name: "編集" })).toHaveCount(0);
  await expect(other.getByRole("button", { name: "削除" })).toHaveCount(0);

  const patch = await page.request.patch(`/api/messages/${MSG_B}`, {
    headers: { Origin: ORIGIN },
    data: { body: "[E2E_TEST]他人が書き換えた本文" },
  });
  expect(patch.status()).toBe(403);
  const remove = await page.request.delete(`/api/messages/${MSG_B}`, {
    headers: { Origin: ORIGIN },
  });
  expect(remove.status()).toBe(403);

  const item = (await itemsOf(page, CHANNEL_ID)).find((m) => m.id === MSG_B);
  expect(item).toMatchObject({
    body: "[E2E_TEST]Bの投稿",
    editedAt: null,
    deleted: false,
  });
});

test("#134 AC-1（1-3 AC-1・AC-2）: DM（S-06）でも、自分の投稿を編集・削除でき、再読み込みせずに反映する。相手の投稿にはボタンがなく、API を直接呼んでも 403", async () => {
  const { page, loads } = userA();
  await mainNav(page)
    .getByRole("link", { name: new RegExp(NAME_B) })
    .click();
  await expect(page).toHaveURL(new RegExp(`/dms/${DM_ROOM}$`));
  await expect(log(page)).toContainText("[E2E_TEST]DMのAの編集する投稿");
  const loadsBefore = loads();

  await editMessage(
    page,
    "[E2E_TEST]DMのAの編集する投稿",
    "[E2E_TEST]DMのAの編集した投稿",
  );
  await expect(rowWith(page, "[E2E_TEST]DMのAの編集した投稿")).toContainText(
    EDITED_MARK,
  );

  // 1つ目のテストで再認証してから5分以内のため、再認証は求められない（0-5）
  await deleteMessage(page, "[E2E_TEST]DMのAの削除する投稿", {
    expectReauth: false,
  });
  await expect(log(page)).toContainText(DELETED_TEXT);
  await expect(log(page)).not.toContainText("[E2E_TEST]DMのAの削除する投稿");
  expect(loads()).toBe(loadsBefore);

  const partner = rowWith(page, "[E2E_TEST]DMのBの投稿");
  await expect(partner.getByRole("button", { name: "編集" })).toHaveCount(0);
  await expect(partner.getByRole("button", { name: "削除" })).toHaveCount(0);
  const patch = await page.request.patch(`/api/messages/${MSG_DM_B}`, {
    headers: { Origin: ORIGIN },
    data: { body: "[E2E_TEST]他人が書き換えた本文" },
  });
  expect(patch.status()).toBe(403);
  const remove = await page.request.delete(`/api/messages/${MSG_DM_B}`, {
    headers: { Origin: ORIGIN },
  });
  expect(remove.status()).toBe(403);
  const item = (await itemsOf(page, DM_ROOM)).find((m) => m.id === MSG_DM_B);
  expect(item).toMatchObject({ body: "[E2E_TEST]DMのBの投稿", deleted: false });
});

test("#134 AC-1（U-8）: B がチャンネルを開いた後に A が編集・削除すると、B が画面の中の移動で部屋を開き直したときに、再読み込みせずに最新の一覧から反映される", async ({
  browser,
}) => {
  const pageA = userA().page;
  b = await guardedPage(browser);
  const pageB = b.page;
  await login(pageB, "e2euser_edit134_b");

  // B がサイドバーからチャンネルを開き、A の投稿を読む
  await mainNav(pageB)
    .getByRole("link", { name: roomLinkName(CHANNEL_NAME) })
    .click();
  await expect(pageB).toHaveURL(new RegExp(`/channels/${CHANNEL_ID}$`));
  await expect(log(pageB)).toContainText(
    "[E2E_TEST]開き直しで確かめる編集の投稿",
  );
  await expect(log(pageB)).toContainText(
    "[E2E_TEST]開き直しで確かめる削除の投稿",
  );
  const loadsBefore = b.loads();

  // B はホームへ移る（画面の中の移動。再読み込みしない）
  await mainNav(pageB)
    .getByRole("link", { name: "ホーム", exact: true })
    .click();
  await expect(pageB).toHaveURL(/\/$/);

  // A がチャンネルへ戻り、編集・削除する（再認証は5分以内のため求められない）
  await mainNav(pageA)
    .getByRole("link", { name: roomLinkName(CHANNEL_NAME) })
    .click();
  await expect(pageA).toHaveURL(new RegExp(`/channels/${CHANNEL_ID}$`));
  await editMessage(
    pageA,
    "[E2E_TEST]開き直しで確かめる編集の投稿",
    "[E2E_TEST]開き直しで確かめた編集の結果",
  );
  await deleteMessage(pageA, "[E2E_TEST]開き直しで確かめる削除の投稿", {
    expectReauth: false,
  });
  await expect(log(pageA)).not.toContainText(
    "[E2E_TEST]開き直しで確かめる削除の投稿",
  );

  // B がサイドバーから同じチャンネルを開き直すと、最新の一覧から取り直して反映される
  await mainNav(pageB)
    .getByRole("link", { name: roomLinkName(CHANNEL_NAME) })
    .click();
  await expect(pageB).toHaveURL(new RegExp(`/channels/${CHANNEL_ID}$`));
  await expect(
    rowWith(pageB, "[E2E_TEST]開き直しで確かめた編集の結果"),
  ).toContainText(EDITED_MARK);
  await expect(log(pageB)).not.toContainText(
    "[E2E_TEST]開き直しで確かめる編集の投稿",
  );
  await expect(log(pageB)).not.toContainText(
    "[E2E_TEST]開き直しで確かめる削除の投稿",
  );
  await expect(log(pageB)).toContainText(DELETED_TEXT);
  // B の画面には、自分（B）の投稿にだけボタンがあり、A の投稿にはない
  await expect(
    rowWith(pageB, "[E2E_TEST]開き直しで確かめた編集の結果").getByRole(
      "button",
      { name: "編集" },
    ),
  ).toHaveCount(0);
  await expect(
    rowWith(pageB, "[E2E_TEST]Bの投稿").getByRole("button", {
      name: "編集",
      exact: true,
    }),
  ).toHaveCount(1);
  expect(b.loads()).toBe(loadsBefore);
});
