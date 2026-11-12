// #136 AC-1（1-2 AC-1〜AC-6）・AC-2（6-1 AC-1・AC-4）・AC-3（C-168(2)(3)(5)(6)）：ダイレクトメッセージ（S-06）を、画面からバックエンドまで通して確かめる。
// 「新しいDM」から相手を選んで送る → 相手（B）が後からログインして読み、開いたまま2秒ごとの取得で再読み込みなしに新着が出る →
// 第三者（C）は URL で開いても見つからない → S-20・S-27・S-05 の「DMを送る」から同じ DM に入れる → 無効な相手との DM は「退職者」と出て送れない。
// データを変える操作の後は、操作した本人の画面を再読み込みせずに、関係する表示（サイドバーの DM の欄・一覧）が変わることを確かめる。
// 前提：e2e/seeds/dms.sql（[E2E_TEST]部署136・そのチャンネル・e2euser_dm_a/_b/_c/_retired・A と無効な社員の DM）。
// 後始末は e2e/seeds/dms-cleanup.sql（社員ID e2euser_dm_・部署名 [E2E_TEST]部署136 と、その利用者が当事者の DM だけ。残数 0 を確かめる）。
// ログインの試行制限（#225）に当たらないよう、ログインは A・B・C の 3 人で 1 回ずつ（計 3 回）だけにし、A のブラウザはテストの間で使い回す。
// 画面の文言は frontend/src/features/dms/*.test.tsx の契約と同じ。
import { execFile } from "node:child_process";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./console-guard";

const ORIGIN = "http://localhost:5173";
const PASSWORD = "TestPass123!";
const DEPT_NAME = "[E2E_TEST]部署136";
const CHANNEL_NAME = "[E2E_TEST]部署136";
const NAME_A = "E2EDM利用者A";
const NAME_B = "E2EDM利用者B";
const NAME_C = "E2EDM利用者C";
const NAME_RETIRED = "E2EDM利用者R";
const RETIRED_ID = "01JTE2E1360000000000000A04";
const RETIRED_ROOM = "01JTE2E1360000000000000M01";
const FIRST_BODY = "[E2E_TEST]AからBへのDM";
// 「DMを送る」のアクセシブルな名前は「<表示名> さんに DMを送る」（見えている文字を含める。WCAG 2.5.3）。無いことの確認は、相手の名前に関係なく当たる正規表現で行う。
// 社員名のボタン（プロフィールカードを開く）を探すときは、名前に表示名を含む「DMを送る」と取り違えないよう、完全一致で探す
const DM_BUTTON_B = "E2EDM利用者B さんに DMを送る";
const ANY_DM_BUTTON = /DM ?を送る/;

function seedFile(file: "dms.sql" | "dms-cleanup.sql") {
  return new Promise<string>((resolve, reject) => {
    execFile(
      process.execPath,
      ["scripts/db-local.ts", "test", "seed-file", `e2e/seeds/${file}`],
      { cwd: process.cwd(), windowsHide: true },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

type Guarded = { context: BrowserContext; page: Page; errors: string[] };

/**
 * テストの間で使い回すブラウザ。console-guard の page と同じく、エラーレベルのコンソール出力と処理されなかった例外を集める。
 * 未ログインのときのセッションの確認（401）は仕様どおりのため許す。allow404 は、第三者が他人の DM を開いたときの 404 だけを許す。
 */
async function guardedPage(
  browser: Browser,
  options: { allow404?: boolean } = {},
): Promise<Guarded> {
  const context = await browser.newContext({ baseURL: ORIGIN });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  const errors: string[] = [];
  const allowed = [
    /Failed to load resource: the server responded with a status of 401/,
    ...(options.allow404
      ? [/Failed to load resource: the server responded with a status of 404/]
      : []),
  ];
  page.on("console", (m) => {
    if (m.type() === "error" && !allowed.some((re) => re.test(m.text())))
      errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  return { context, page, errors };
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
const dmLink = (page: Page, name: string) =>
  mainNav(page).getByRole("link", { name: new RegExp(name) });
const messageBox = (page: Page) =>
  page.getByRole("main").getByRole("textbox", { name: "メッセージ" });

async function send(page: Page, body: string) {
  await messageBox(page).fill(body);
  await page.getByRole("button", { name: "送信", exact: true }).click();
}

async function openMembers(page: Page) {
  await mainNav(page)
    .getByRole("link", { name: "社員一覧", exact: true })
    .click();
  await expect(page).toHaveURL(/\/members$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "社員一覧" }),
  ).toBeVisible();
}

async function searchByName(page: Page, text: string) {
  const main = page.getByRole("main");
  await main.getByLabel("表示名で検索").fill(text);
  await main.getByRole("button", { name: "検索", exact: true }).click();
}

let a: Guarded | undefined;
let b: Guarded | undefined;
let c: Guarded | undefined;
let roomAB = "";

function userA(): Page {
  if (a === undefined) throw new Error("A のブラウザがありません");
  return a.page;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  await seedFile("dms-cleanup.sql");
  await seedFile("dms.sql");
  a = await guardedPage(browser);
  await login(a.page, "e2euser_dm_a");
});

test.afterAll(async () => {
  for (const opened of [a, b, c]) await opened?.context.close();
  const output = await seedFile("dms-cleanup.sql");
  // 後始末の後の残数がすべて 0 であること
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
});

test.afterEach(() => {
  // 開いているすべてのブラウザで、エラーレベルのコンソール出力・処理されなかった例外が無いこと
  for (const opened of [a, b, c])
    expect(opened?.errors ?? [], "コンソールのエラー").toEqual([]);
});

test("#136 AC-1（1-2 AC-1・AC-5）・AC-2（6-1 AC-1・AC-4）・AC-3（C-168(3)）: サイドバーの「新しいDM」から表示名で検索し、部署とステータスを見て B を選んで送る。自分と無効な社員は候補に出ない。S-06 の上部に B のステータスと超過が出て、再読み込みせずにサイドバーに B が出る", async () => {
  const page = userA();

  // サイドバーの「＋ 新しいDM」から相手の選択（/dms/new）へ
  await mainNav(page)
    .getByRole("link", { name: /新しいDM/ })
    .click();
  await expect(page).toHaveURL(/\/dms\/new$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "新しいDM" }),
  ).toBeVisible();
  const main = page.getByRole("main");

  // 表示名の部分一致で検索（C-168(3)）。自分（A）と無効な社員（R）は出ない
  await searchByName(page, "E2EDM利用者");
  const candidates = main.getByRole("listitem").or(main.getByRole("row"));
  const candidateB = candidates.filter({ hasText: NAME_B });
  await expect(candidateB).toHaveCount(1);
  await expect(candidates.filter({ hasText: NAME_C })).toHaveCount(1);
  await expect(main.getByText(NAME_A)).toHaveCount(0);
  await expect(main.getByText(NAME_RETIRED)).toHaveCount(0);

  // 6-1 AC-4：候補の部署とステータス（文字）が見える
  await expect(candidateB).toContainText(DEPT_NAME);
  await expect(candidateB).toContainText("外出");
  await expect(candidateB).toContainText("戻り予定を過ぎています");

  // 前後の空白を除いて検索する（B だけになる）
  await searchByName(page, `  ${NAME_B}  `);
  await expect(candidates.filter({ hasText: NAME_C })).toHaveCount(0);
  await expect(candidateB).toHaveCount(1);

  // B を選ぶと DM（S-06）が開く
  await candidateB.getByRole("button", { name: DM_BUTTON_B }).click();
  await expect(page).toHaveURL(/\/dms\/[0-9A-HJKMNP-TV-Z]{26}$/);
  roomAB = new URL(page.url()).pathname.split("/").pop() ?? "";

  // 6-1 AC-1：上部に相手の表示名（カードを開くボタン）・部署・ステータス・戻り予定の超過
  await expect(
    main.getByRole("button", { name: new RegExp(`^@?${NAME_B}$`) }),
  ).toBeVisible();
  await expect(main).toContainText(DEPT_NAME);
  await expect(main).toContainText("外出");
  await expect(main).toContainText("戻り予定を過ぎています");
  await expect(main).not.toContainText("退職者");
  // 0件の案内
  await expect(main).toContainText("最初のメッセージを送りましょう");

  // 再読み込みせずに、サイドバーの DM の欄に B が出る
  await expect(dmLink(page, NAME_B)).toHaveAttribute("href", `/dms/${roomAB}`);

  // 送ると、再読み込みせずに一覧に出て、入力欄が空になる
  await send(page, FIRST_BODY);
  await expect(page.getByRole("log")).toContainText(FIRST_BODY);
  await expect(messageBox(page)).toHaveValue("");
  await expect(main).not.toContainText("最初のメッセージを送りましょう");
});

test("#136 AC-1（1-2 AC-1・AC-3）: B は A が送った後にログインしても DM を読め、開いたまま A が送った新着が2秒ごとの取得で再読み込みなしに出る。B の返信も A に届く", async ({
  browser,
}) => {
  const pageA = userA();
  b = await guardedPage(browser);
  await login(b.page, "e2euser_dm_b");

  // B のサイドバーに A との DM が出ていて、開くと A の投稿が読める（不在の間に送られたもの）
  const linkToA = dmLink(b.page, NAME_A);
  await expect(linkToA).toHaveAttribute("href", `/dms/${roomAB}`);
  await linkToA.click();
  await expect(b.page).toHaveURL(new RegExp(`/dms/${roomAB}$`));
  await expect(b.page.getByRole("log")).toContainText(FIRST_BODY);
  // B の画面の上部には、相手（A）の表示名・部署・ステータスが出る
  const mainB = b.page.getByRole("main");
  await expect(
    mainB.getByRole("button", { name: new RegExp(`^@?${NAME_A}$`) }),
  ).toBeVisible();
  await expect(mainB).toContainText(DEPT_NAME);
  await expect(mainB).toContainText("在席");

  // A が開いたまま送ると、B の画面に再読み込みなしで出る（page.reload を呼ばない）
  await expect(pageA).toHaveURL(new RegExp(`/dms/${roomAB}$`));
  await send(pageA, "[E2E_TEST]Aの追伸");
  await expect(b.page.getByRole("log")).toContainText("[E2E_TEST]Aの追伸");

  // B が返信すると、A の画面に再読み込みなしで出る。古い順に並ぶ
  await send(b.page, "[E2E_TEST]BからAへの返信");
  await expect(pageA.getByRole("log")).toContainText(
    "[E2E_TEST]BからAへの返信",
  );
  const text = await pageA.getByRole("log").innerText();
  expect(text.indexOf(FIRST_BODY)).toBeLessThan(
    text.indexOf("[E2E_TEST]Aの追伸"),
  );
  expect(text.indexOf("[E2E_TEST]Aの追伸")).toBeLessThan(
    text.indexOf("[E2E_TEST]BからAへの返信"),
  );
});

test("#136 AC-1（1-2 AC-2）: 第三者 C は、A と B の DM を URL で直接開いても見つからず、本文も出ない。API でも一覧・詳細・メッセージ・投稿のどれも見えない", async ({
  browser,
}) => {
  c = await guardedPage(browser, { allow404: true });
  await login(c.page, "e2euser_dm_c");

  // C のサイドバーには、A・B の DM は出ない
  await expect(
    mainNav(c.page).getByText("ダイレクトメッセージ", { exact: true }),
  ).toBeVisible();
  await expect(dmLink(c.page, "E2EDM利用者")).toHaveCount(0);

  // URL で直接開いても「見つかりません」
  await c.page.goto(`/dms/${roomAB}`);
  const main = c.page.getByRole("main");
  await expect(main).toContainText("見つかりません");
  await expect(c.page.getByRole("log")).toHaveCount(0);
  await expect(messageBox(c.page)).toHaveCount(0);
  await expect(c.page.getByText(FIRST_BODY)).toHaveCount(0);

  // API でも見えない（当事者でなければ、存在しないものと区別せず 404）
  expect((await c.page.request.get(`/api/dms/${roomAB}`)).status()).toBe(404);
  expect(
    (await c.page.request.get(`/api/rooms/${roomAB}/messages`)).status(),
  ).toBe(404);
  const post = await c.page.request.post(`/api/rooms/${roomAB}/messages`, {
    headers: { Origin: ORIGIN },
    data: { body: "[E2E_TEST]第三者の投稿" },
  });
  expect(post.status()).toBe(404);
  const list = await c.page.request.get("/api/dms");
  expect(list.status()).toBe(200);
  expect(await list.text()).not.toContain(roomAB);

  // 当事者の画面にも、第三者の投稿は出ていない
  await expect(userA().getByRole("log")).not.toContainText(
    "[E2E_TEST]第三者の投稿",
  );
});

test("#136 AC-1（1-2 AC-4）・AC-3（C-168(5)）: S-20 の行・S-27 のカード・S-05 の参加者の「DMを送る」から、同じ DM（S-06）に入れる。自分には「DMを送る」が出ない。スマホ幅の下部メニューの「DM」から DM の一覧を開ける", async () => {
  const page = userA();
  const main = page.getByRole("main");

  // S-20：表示名で検索し、B の行の「DMを送る」から、既にある同じ DM に入る（新規・既存とも同じ部屋。C-168(5)）
  await openMembers(page);
  await searchByName(page, "E2EDM利用者");
  const rowB = main.getByRole("row", { name: new RegExp(NAME_B) });
  await expect(rowB).toHaveCount(1);
  // 無効な社員は社員一覧に出ない（DM の入口も出ない）
  await expect(
    main.getByRole("row", { name: new RegExp(NAME_RETIRED) }),
  ).toHaveCount(0);
  // 自分の行には「DMを送る」が出ない
  const rowA = main.getByRole("row", { name: new RegExp(NAME_A) });
  await expect(rowA).toHaveCount(1);
  await expect(rowA.getByRole("button", { name: ANY_DM_BUTTON })).toHaveCount(
    0,
  );
  await rowB.getByRole("button", { name: DM_BUTTON_B }).click();
  await expect(page).toHaveURL(new RegExp(`/dms/${roomAB}$`));
  await expect(page.getByRole("log")).toContainText(FIRST_BODY);

  // S-27：B のプロフィールカードの「DMを送る」からも同じ DM に入る。自分のカードには出ない
  await openMembers(page);
  await searchByName(page, "E2EDM利用者");
  await rowA.getByRole("button", { name: NAME_A, exact: true }).click();
  const ownCard = page
    .locator("[popover]:popover-open")
    .filter({ hasText: "閉じる" });
  await expect(ownCard).toContainText("テスト本名DMA");
  await expect(
    ownCard.getByRole("button", { name: ANY_DM_BUTTON }),
  ).toHaveCount(0);
  await ownCard.getByRole("button", { name: "閉じる" }).click();
  await rowB.getByRole("button", { name: NAME_B, exact: true }).click();
  const cardB = page
    .locator("[popover]:popover-open")
    .filter({ hasText: "閉じる" });
  await expect(cardB).toContainText("テスト本名DMB");
  await cardB.getByRole("button", { name: DM_BUTTON_B }).click();
  await expect(page).toHaveURL(new RegExp(`/dms/${roomAB}$`));

  // S-05：参加中のチャンネルの参加者一覧から。B の行には出て、自分の行には出ない
  await mainNav(page)
    .getByRole("link", { name: CHANNEL_NAME, exact: true })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: CHANNEL_NAME }),
  ).toBeVisible();
  const participants = main.getByRole("listitem");
  await expect(
    participants
      .filter({ hasText: NAME_A })
      .getByRole("button", { name: ANY_DM_BUTTON }),
  ).toHaveCount(0);
  await participants
    .filter({ hasText: NAME_B })
    .getByRole("button", { name: DM_BUTTON_B })
    .click();
  await expect(page).toHaveURL(new RegExp(`/dms/${roomAB}$`));

  // スマホ幅：下部メニューは ホーム → DM → 通知 → 自分 の順。「DM」から DM の一覧（/dms）を開ける
  await page.setViewportSize({ width: 375, height: 800 });
  const bottom = page.getByRole("navigation", { name: "下部メニュー" });
  await expect(bottom).toBeVisible();
  await expect(bottom.getByRole("link")).toHaveText(["ホーム", "DM", "通知"]);
  await expect(bottom.getByRole("button", { name: "自分" })).toBeVisible();
  await bottom.getByRole("link", { name: "DM", exact: true }).click();
  await expect(page).toHaveURL(/\/dms$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "ダイレクトメッセージ" }),
  ).toBeVisible();
  await expect(
    main.getByRole("link", { name: new RegExp(NAME_B) }),
  ).toHaveAttribute("href", `/dms/${roomAB}`);
  await page.setViewportSize({ width: 1280, height: 800 });
});

test("#136 AC-1（1-2 AC-6）・AC-3（C-168(2)(5)(6)）: 無効な相手との DM は、サイドバー・上部・過去の投稿に「退職者」を併記し、プロフィールへのボタン・リンクと入力欄を出さない。投稿の API は 409 で、履歴は読める。無効な相手との新しい DM は 422", async () => {
  const page = userA();
  const main = page.getByRole("main");

  // サイドバーの DM の欄に「退職者」を併記する
  const retiredLink = dmLink(page, NAME_RETIRED);
  await expect(retiredLink).toContainText("退職者");
  await expect(retiredLink).toHaveAttribute("href", `/dms/${RETIRED_ROOM}`);
  // 最終活動の新しい順：A と B の DM が、無効な相手との DM より上にある
  const order = await mainNav(page)
    .getByRole("link", { name: /E2EDM利用者/ })
    .allTextContents();
  expect(order.findIndex((t) => t.includes(NAME_B))).toBeLessThan(
    order.findIndex((t) => t.includes(NAME_RETIRED)),
  );

  await retiredLink.click();
  await expect(page).toHaveURL(new RegExp(`/dms/${RETIRED_ROOM}$`));
  // 過去の投稿は、投稿時点の表示名に「退職者」を併記して読める
  const log = page.getByRole("log");
  await expect(log).toContainText("[E2E_TEST]無効化の前の投稿");
  await expect(log).toContainText(NAME_RETIRED);
  await expect(log).toContainText("退職者");
  // 上部：表示名と「退職者」。プロフィール（カード）のボタン・リンクは出さない
  await expect(main).toContainText(NAME_RETIRED);
  await expect(
    main.getByRole("button", { name: new RegExp(NAME_RETIRED) }),
  ).toHaveCount(0);
  await expect(
    main.getByRole("link", { name: new RegExp(NAME_RETIRED) }),
  ).toHaveCount(0);
  // 入力欄の代わりに、送れないことを知らせる
  await expect(messageBox(page)).toHaveCount(0);
  await expect(main).toContainText(
    "相手のアカウントが無効になっているため、送信できません",
  );

  // API：投稿は 409（C-168(2)）で行は増えない。履歴の取得は 200
  const posted = await page.request.post(
    `/api/rooms/${RETIRED_ROOM}/messages`,
    {
      headers: { Origin: ORIGIN },
      data: { body: "[E2E_TEST]届かない投稿" },
    },
  );
  expect(posted.status()).toBe(409);
  const history = await page.request.get(`/api/rooms/${RETIRED_ROOM}/messages`);
  expect(history.status()).toBe(200);
  const historyText = await history.text();
  expect(historyText).toContain("[E2E_TEST]無効化の前の投稿");
  expect(historyText).not.toContain("[E2E_TEST]届かない投稿");

  // 無効な相手との DM の開始は 422（C-168(5)）
  const started = await page.request.post("/api/dms", {
    headers: { Origin: ORIGIN },
    data: { partnerUserId: RETIRED_ID },
  });
  expect(started.status()).toBe(422);
});
