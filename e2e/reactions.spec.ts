// #138 AC-1（1-7 AC-1〜AC-5）・AC-2（1-4 AC-6）：リアクション・スタンプを、画面からバックエンドまで通して確かめる。
// ① 他人の投稿に絵文字を付ける（チップ・件数・aria-pressed）。再読み込みしても残り、チップを押して取り消せる。自分の投稿にも付けられる
// ② スタンプ（了解）を付けられる。スタンプは本文に入らない（本文は変わらない）
// ③ 2人目が付けると件数2になり、付けた人が読み上げの名前（aria-label）に出る。スマートフォンの幅では「付けた人」ボタンで一覧が出る
// ④ スレッドの返信にも付けられ、開き直しても残る（親にも付けられる）
// ⑤ キーボードだけで操作できる（ピッカーのタブ・グリッドの矢印・Space で選ぶ・Esc で閉じてフォーカスが戻る）
// ⑥ 参加していない公開チャンネルでは、読めるが付けられない（ボタンなし・チップは押せない・API は 403）
// ⑦ 20種類に達すると、新しい種類は付けられない（ピッカーで選べず理由が出る・API は 409）。すでにある種類・重複して付けるのは 200（冪等）
// データを変える操作の後は、再読み込みせずに表示が変わることを確かめ、そのあと再読み込みして残ることも確かめる。
// 前提：e2e/seeds/reactions.sql（[E2E_TEST] リアクション・e2euser_reaction_a/_b・チャンネル2つ・親4件・返信1件・リアクション1件）。
// 後始末は e2e/seeds/reactions-cleanup.sql（社員ID e2euser_reaction_・部署名 [E2E_TEST] リアクション と、その部屋のメッセージ・リアクションだけ。残数 0 を確かめる）。
// ログインの試行制限（#225）に当たらないよう、ログインは A・B の 2 人で 1 回ずつ（計 2 回）だけにし、ブラウザはテストの間で使い回す。
// 画面の文言・操作は frontend/src/features/messages/messages.reactions*.test.tsx・ReactionPicker.test.tsx の契約と同じ。
import { execFile } from "node:child_process";
import type { Browser, BrowserContext, Locator, Page } from "@playwright/test";
import { expect, test } from "./console-guard";

const ORIGIN = "http://localhost:5173";
const PASSWORD = "TestPass123!";
const C01 = "01JTE2E1380000000000000C01";
const C02 = "01JTE2E1380000000000000C02";
const M01 = "01M78ZTJC00000000000013801";
const M02 = "01M78ZTJC00000000000013802";
const M03 = "01M78ZTJC00000000000013803";
const M04 = "01M78ZTJC00000000000013804";
const TEXT_M01 = "[E2E_TEST]リアクション対象1";
const TEXT_M02 = "[E2E_TEST]リアクション対象2のAの投稿";
const TEXT_M03 = "[E2E_TEST]リアクション対象3のスレッドの親";
const TEXT_M04 = "[E2E_TEST]リアクション対象4の未参加の部屋";
const TEXT_R01 = "[E2E_TEST]リアクション対象の返信";
const NAME_A = "E2Eリアクション利用者A";
const NAME_B = "E2Eリアクション利用者B";
const LIMIT_TEXT = "リアクションは20種類までです";

function seedFile(file: "reactions.sql" | "reactions-cleanup.sql") {
  return new Promise<string>((resolve, reject) => {
    execFile(
      process.execPath,
      ["scripts/db-local.ts", "test", "seed-file", `e2e/seeds/${file}`],
      { cwd: process.cwd(), windowsHide: true },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

type Signed = {
  context: BrowserContext;
  page: Page;
  /** エラーレベルのコンソール出力・処理されなかった例外（console-guard の page と同じ監視。手で作ったページには fixture の監視が付かないため） */
  errors: string[];
};

async function login(
  browser: Browser,
  loginId: string,
  viewport = { width: 1280, height: 800 },
): Promise<Signed> {
  const context = await browser.newContext({ baseURL: ORIGIN, viewport });
  const page = await context.newPage();
  const errors: string[] = [];
  // 未ログインのときのセッションの確認（401）は仕様どおりのため許す（session-console.ts の allowSessionCheck401 と同じ理由。このページには fixture の許可が効かないため、ここで許す）
  const allowed = [
    /Failed to load resource: the server responded with a status of 401/,
  ];
  page.on("console", (m) => {
    if (m.type() === "error" && !allowed.some((re) => re.test(m.text())))
      errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/login");
  await page.getByLabel("ユーザーID", { exact: true }).fill(loginId);
  await page.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  return { context, page, errors };
}

const roomLog = (page: Page) =>
  page.getByRole("log", { name: "メッセージ一覧" });
const rowWith = (page: Page, text: string): Locator =>
  roomLog(page).getByRole("listitem").filter({ hasText: text });
const pane = (page: Page) => page.getByRole("region", { name: "スレッド" });
const replyRow = (page: Page, text: string): Locator =>
  pane(page)
    .getByRole("log", { name: "返信一覧" })
    .getByRole("listitem")
    .filter({ hasText: text });
const picker = (page: Page) =>
  page.getByRole("dialog", { name: "リアクションを選ぶ" });
const addButton = (row: Locator) =>
  row.getByRole("button", { name: /^リアクションを付ける/ });
/**
 * 種類のチップ（表示の文字で絞る）。ピッカー（role="dialog"）の中のセルは、同じ行の中に描画され aria-pressed も持つため、
 * ピッカーの外にあるボタンだけに限る（ピッカーが開いている間の確認で、セルをチップと取り違えない）
 */
const chip = (row: Locator, text: string, pressed?: boolean): Locator =>
  row
    .getByRole("button", pressed === undefined ? {} : { pressed })
    .and(row.page().locator(':not([role="dialog"] *)'))
    .filter({ hasText: text });

/** ピッカーを開き、絵文字（文字で探す）を選ぶ。選ぶとピッカーは閉じる */
async function pickEmoji(page: Page, row: Locator, char: string) {
  await addButton(row).click();
  await expect(picker(page)).toBeVisible();
  await picker(page)
    .getByRole("grid")
    .getByRole("button")
    .filter({ hasText: char })
    .first()
    .click();
  await expect(picker(page)).toHaveCount(0);
}

/** ピッカーを開き、スタンプ（名前）を選ぶ */
async function pickStamp(page: Page, row: Locator, label: string) {
  await addButton(row).click();
  await expect(picker(page)).toBeVisible();
  await picker(page).getByRole("tab", { name: "スタンプ" }).click();
  await picker(page).getByRole("button", { name: label, exact: true }).click();
  await expect(picker(page)).toHaveCount(0);
}

const post = (page: Page, messageId: string, kind: string, value: string) =>
  page.request.post(`/api/messages/${messageId}/reactions`, {
    headers: { Origin: ORIGIN },
    data: { kind, value },
  });
const remove = (page: Page, messageId: string, kind: string, value: string) =>
  page.request.delete(
    `/api/messages/${messageId}/reactions/${kind}/${encodeURIComponent(value)}`,
    { headers: { Origin: ORIGIN } },
  );

let a: Signed | undefined;
let b: Signed | undefined;
function who(user: Signed | undefined, label: string): Signed {
  if (user === undefined) throw new Error(`${label} のブラウザがありません`);
  return user;
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  const cleaned = await seedFile("reactions-cleanup.sql");
  expect(cleaned).not.toMatch(/"remaining_\w+":\s*[1-9]/);
  await seedFile("reactions.sql");
  a = await login(browser, "e2euser_reaction_a");
  b = await login(browser, "e2euser_reaction_b");
});

test.afterEach(() => {
  // 開いているすべてのブラウザで、エラーレベルのコンソール出力・処理されなかった例外が無いこと
  for (const opened of [a, b])
    expect(
      opened?.errors ?? [],
      "コンソールのエラー・処理されなかった例外",
    ).toEqual([]);
});

test.afterAll(async () => {
  await a?.context.close();
  await b?.context.close();
  const output = await seedFile("reactions-cleanup.sql");
  expect(output).not.toMatch(/"remaining_\w+":\s*[1-9]/);
});

test("#138 AC-1（1-7 AC-1・AC-3）: 他人の投稿に絵文字を付けるとチップ（件数1・押した状態）が出て、再読み込みしても残り、チップを押して取り消せる。自分の投稿にも付けられる", async () => {
  const { page } = who(a, "A");
  await page.goto(`/channels/${C01}`);
  const row = rowWith(page, TEXT_M01);
  await expect(row).toBeVisible();
  await expect(addButton(row)).toHaveAttribute("aria-haspopup", "dialog");

  await pickEmoji(page, row, "👍");
  // 再読み込みなしで、チップが出る
  await expect(chip(row, "👍", true)).toHaveCount(1);
  await expect(chip(row, "👍", true)).toContainText("1");
  await page.reload();
  await expect(chip(rowWith(page, TEXT_M01), "👍", true)).toContainText("1");

  await chip(rowWith(page, TEXT_M01), "👍", true).click();
  await expect(chip(rowWith(page, TEXT_M01), "👍")).toHaveCount(0);
  await page.reload();
  await expect(rowWith(page, TEXT_M01)).toBeVisible();
  await expect(chip(rowWith(page, TEXT_M01), "👍")).toHaveCount(0);

  // 自分の投稿（M02）にも付けられる
  const own = rowWith(page, TEXT_M02);
  await pickEmoji(page, own, "🎉");
  await expect(chip(own, "🎉", true)).toContainText("1");
  await chip(own, "🎉", true).click();
  await expect(chip(own, "🎉")).toHaveCount(0);
});

test("#138 AC-1（1-7 AC-2・AC-5）: スタンプ（了解）を付けられる。スタンプは本文に入らない", async () => {
  const { page } = who(a, "A");
  await page.goto(`/channels/${C01}`);
  const row = rowWith(page, TEXT_M01);
  await pickStamp(page, row, "了解");
  await expect(chip(row, "了解", true)).toContainText("1");
  await expect(row).toContainText(TEXT_M01);

  const response = await page.request.get(
    `/api/rooms/${C01}/messages?limit=100`,
  );
  const items = (
    (await response.json()) as {
      items: { id: string; body: string | null }[];
    }
  ).items;
  expect(items.find((item) => item.id === M01)?.body).toBe(TEXT_M01);
});

test("#138 AC-1（1-7 AC-3・U-5）: 2人目（B）が付けると件数2になり、付けた人が読み上げの名前に出る。スマートフォンの幅では「付けた人」で一覧が出る。取り消せる", async () => {
  const bPage = who(b, "B").page;
  await bPage.goto(`/channels/${C01}`);
  const bRow = rowWith(bPage, TEXT_M01);
  // 他の人（A）が付けたチップは、開き直したときに反映される（U-10）
  const stamp = chip(bRow, "了解", false);
  await expect(stamp).toContainText("1");
  await expect(stamp).toHaveAttribute("aria-label", new RegExp(NAME_A));
  await stamp.click();
  await expect(chip(bRow, "了解", true)).toContainText("2");
  const label =
    (await chip(bRow, "了解", true).getAttribute("aria-label")) ?? "";
  expect(label).toContain(NAME_A);
  expect(label).toContain(NAME_B);
  expect(label).toContain("2人");

  // A が開き直すと、件数2・付けた人 2 人
  const aPage = who(a, "A").page;
  await aPage.reload();
  const aRow = rowWith(aPage, TEXT_M01);
  await expect(chip(aRow, "了解", true)).toContainText("2");
  await expect(chip(aRow, "了解", true)).toHaveAttribute(
    "aria-label",
    new RegExp(NAME_B),
  );

  // スマートフォンの幅：「付けた人」ボタンで一覧が出る
  await aPage.setViewportSize({ width: 390, height: 844 });
  const reactors = aRow.getByRole("button", { name: /^付けた人/ });
  await expect(reactors).toBeVisible();
  await reactors.click();
  const dialog = aPage.getByRole("dialog", { name: "付けた人" });
  await expect(dialog).toContainText(NAME_A);
  await expect(dialog).toContainText(NAME_B);
  await dialog.getByRole("button", { name: "閉じる" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(reactors).toBeFocused();
  await aPage.setViewportSize({ width: 1280, height: 800 });

  // 取り消す（B → A の順）。他人の行は消えない
  await chip(bRow, "了解", true).click();
  await expect(chip(bRow, "了解", false)).toContainText("1");
  await chip(aRow, "了解", true).click();
  await expect(chip(aRow, "了解")).toHaveCount(0);
});

test("#138 AC-2（1-4 AC-6）: スレッドの返信（と親）にリアクションを付けられ、開き直しても残る", async () => {
  const { page } = who(a, "A");
  await page.goto(`/channels/${C01}?thread=${M03}`);
  await expect(pane(page)).toBeVisible();
  const reply = replyRow(page, TEXT_R01);
  await expect(reply).toBeVisible();
  await pickEmoji(page, reply, "👍");
  await expect(chip(reply, "👍", true)).toContainText("1");

  // 親（スレッドの枠の中の親）にも付けられる
  const parent = pane(page)
    .getByRole("listitem")
    .filter({ hasText: TEXT_M03 })
    .first();
  await pickEmoji(page, parent, "🎉");
  await expect(chip(parent, "🎉", true)).toContainText("1");

  await page.reload();
  await expect(chip(replyRow(page, TEXT_R01), "👍", true)).toContainText("1");
  await expect(
    chip(
      pane(page).getByRole("listitem").filter({ hasText: TEXT_M03 }).first(),
      "🎉",
      true,
    ),
  ).toContainText("1");

  await chip(replyRow(page, TEXT_R01), "👍", true).click();
  await expect(chip(replyRow(page, TEXT_R01), "👍")).toHaveCount(0);
  await chip(
    pane(page).getByRole("listitem").filter({ hasText: TEXT_M03 }).first(),
    "🎉",
    true,
  ).click();
  // 部屋の一覧の親の行も、開き直すと最新（取り消した後）になっている
  await page.goto(`/channels/${C01}`);
  await expect(chip(rowWith(page, TEXT_M03), "🎉")).toHaveCount(0);
});

test("#138 AC-1（キーボード）: キーボードだけで、ピッカーを開き、タブ・セルを移動し、Space で選べる。Esc で閉じるとフォーカスがボタンに戻る", async () => {
  const { page } = who(a, "A");
  await page.goto(`/channels/${C01}`);
  const row = rowWith(page, TEXT_M02);
  const button = addButton(row);
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(picker(page)).toBeVisible();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  // 開いたら、選ばれたタブにフォーカスがある
  const selectedTab = picker(page).getByRole("tab", { selected: true });
  await expect(selectedTab).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(picker(page).getByRole("tab").nth(1)).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(picker(page).getByRole("tab").nth(1)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(picker(page).getByRole("tab").first()).toHaveAttribute(
    "aria-selected",
    "true",
  );
  // Tab でグリッドの最初のセルへ。→ で次のセルへ。Space で選ぶ
  await page.keyboard.press("Tab");
  const cells = picker(page).getByRole("grid").getByRole("button");
  await expect(cells.first()).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(cells.nth(1)).toBeFocused();
  const chosen = ((await cells.nth(1).textContent()) ?? "").trim();
  await page.keyboard.press("Space");
  await expect(picker(page)).toHaveCount(0);
  await expect(chip(row, chosen, true)).toContainText("1");
  await expect(button).toBeFocused();

  // Esc で閉じる。何も増えず、フォーカスがボタンに戻る
  await page.keyboard.press("Enter");
  await expect(picker(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(picker(page)).toHaveCount(0);
  await expect(button).toBeFocused();
  await expect(row.getByRole("button", { pressed: true })).toHaveCount(1);

  // チップもキーボードで取り消せる
  await chip(row, chosen, true).focus();
  await page.keyboard.press("Enter");
  await expect(row.getByRole("button", { pressed: true })).toHaveCount(0);
});

test("#138 コードレビュー1回目（軽微）: スマートフォンの幅でも、絵文字のグリッドの全セルがピッカーの枠と画面の中に収まり、横スクロールが出ない（どの分類のタブでも）", async () => {
  const { page } = who(a, "A");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/channels/${C01}`);
  const row = rowWith(page, TEXT_M01);
  await addButton(row).click();
  const dialog = picker(page);
  await expect(dialog).toBeVisible();
  const tabCount = await dialog.getByRole("tab").count();
  // 最後のタブはスタンプ。絵文字のタブ（それ以外）を順に開く
  for (let index = 0; index < tabCount - 1; index += 1) {
    await dialog.getByRole("tab").nth(index).click();
    const frame = await dialog.boundingBox();
    expect(frame).not.toBeNull();
    const buttons = dialog.getByRole("grid").getByRole("button");
    const total = await buttons.count();
    expect(total).toBeGreaterThan(0);
    for (let cell = 0; cell < total; cell += 1) {
      const box = await buttons.nth(cell).boundingBox();
      expect(box, `タブ${index}のセル${cell}`).not.toBeNull();
      // 枠の中（右端・左端がはみ出さない）
      expect(box!.x).toBeGreaterThanOrEqual(frame!.x);
      expect(box!.x + box!.width).toBeLessThanOrEqual(
        frame!.x + frame!.width + 0.5,
      );
      // 画面の中
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    }
    expect(frame!.x + frame!.width).toBeLessThanOrEqual(390);
  }
  // 横スクロールが出ていない
  const overflow = await page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 800 });
});

test("#138 コードレビュー2回目（軽微）: スマートフォンの幅で、同じ行のすべてのセルを自分で付けた状態（いちばん幅が広くなる）でも、全セルがピッカーの枠と画面の中に収まり、横スクロールが出ない", async () => {
  const { page } = who(a, "A");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/channels/${C01}`);
  const row = rowWith(page, TEXT_M01);
  const dialog = picker(page);
  await addButton(row).click();
  await expect(dialog).toBeVisible();
  // 最初のタブの最初の行のセル（列の数は画面から読む）を、API で自分が付けた状態にする
  const firstRow = dialog.getByRole("row").first().getByRole("button");
  const columns = await firstRow.count();
  expect(columns).toBeGreaterThanOrEqual(2);
  const chars: string[] = [];
  for (let index = 0; index < columns; index += 1)
    chars.push(((await firstRow.nth(index).textContent()) ?? "").trim());
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  try {
    for (const char of chars)
      expect((await post(page, M01, "emoji", char)).status()).toBe(200);
    // 開き直して（付けた状態を読み込み直して）、ピッカーを開く
    await page.reload();
    await addButton(rowWith(page, TEXT_M01)).click();
    await expect(dialog).toBeVisible();
    const frame = await dialog.boundingBox();
    expect(frame).not.toBeNull();
    const buttons = dialog.getByRole("grid").getByRole("button");
    for (let cell = 0; cell < columns; cell += 1) {
      // 同じ行のすべてのセルが、自分で付けた状態（押した状態）になっている
      await expect(buttons.nth(cell)).toHaveAttribute("aria-pressed", "true");
      const box = await buttons.nth(cell).boundingBox();
      expect(box, `付けたセル${cell}`).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(frame!.x);
      expect(box!.x + box!.width).toBeLessThanOrEqual(
        frame!.x + frame!.width + 0.5,
      );
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    }
    // 付けたセルも付けていないセルも、同じ行の中で枠からはみ出さない（全セル）
    const total = await buttons.count();
    for (let cell = 0; cell < total; cell += 1) {
      const box = await buttons.nth(cell).boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(
        frame!.x + frame!.width + 0.5,
      );
    }
    const overflow = await page.evaluate(() => {
      const root = document.scrollingElement ?? document.documentElement;
      return root.scrollWidth - root.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  } finally {
    // 後始末：付けたものを取り消す（取り消しは冪等）
    for (const char of chars) await remove(page, M01, "emoji", char);
    await page.setViewportSize({ width: 1280, height: 800 });
  }
});

test("#138 AC-1（U-8）: 参加していない公開チャンネルでは、リアクションを読めるが付けられない（ボタンなし・チップは押せない・API は 403）", async () => {
  const { page } = who(a, "A");
  await page.goto(`/channels/${C02}`);
  const row = rowWith(page, TEXT_M04);
  await expect(row).toBeVisible();
  await expect(addButton(row)).toHaveCount(0);
  const existing = chip(row, "👍", false);
  await expect(existing).toContainText("1");
  await expect(existing).toHaveAttribute("aria-disabled", "true");
  await expect(existing).toHaveAttribute("aria-label", new RegExp(NAME_B));
  // aria-disabled の要素は、Playwright の click() が「操作できない」と判断して待ち続ける。押せない状態でも押しても変わらないことを確かめるため、force で押す
  await existing.click({ force: true });
  await expect(chip(row, "👍", false)).toContainText("1");

  expect((await post(page, M04, "emoji", "👏")).status()).toBe(403);
  expect((await remove(page, M04, "emoji", "👍")).status()).toBe(403);
  const list = await page.request.get(`/api/rooms/${C02}/messages?limit=100`);
  expect(list.status()).toBe(200);
});

test("#138 AC-1（1-7 AC-4・U-12）: 20種類に達すると、新しい種類はピッカーで選べず理由が出る（API は 409）。すでにある種類・重複して付けるのは 200", async () => {
  const { page } = who(a, "A");
  const kinds: [string, string][] = [
    ...[
      "👍",
      "👏",
      "🙏",
      "🙇",
      "✅",
      "👀",
      "💯",
      "🎉",
      "✨",
      "🔥",
      "💪",
      "🙌",
      "👌",
      "⭐",
    ].map((value): [string, string] => ["emoji", value]),
    ...["like", "ok", "thanks", "good-work", "checking", "congrats"].map(
      (value): [string, string] => ["stamp", value],
    ),
  ];
  for (const [kind, value] of kinds)
    expect((await post(page, M02, kind, value)).status()).toBe(200);
  // 重複して付けても 200（冪等）。行は増えない
  const again = await post(page, M02, "emoji", "👍");
  expect(again.status()).toBe(200);
  const body = (await again.json()) as { reactions: unknown[] };
  expect(body.reactions).toHaveLength(20);
  // 21種類目は 409
  const over = await post(page, M02, "emoji", "😀");
  expect(over.status()).toBe(409);

  await page.goto(`/channels/${C01}`);
  const row = rowWith(page, TEXT_M02);
  await addButton(row).click();
  await picker(page).getByRole("tab", { name: "顔" }).click();
  const first = picker(page).getByRole("grid").getByRole("button").first();
  await expect(first).toHaveAttribute("aria-disabled", "true");
  await expect(picker(page).getByRole("status")).toContainText(LIMIT_TEXT);
  // aria-disabled の要素は通常の click() が待ち続けるため、force で押して、何も付かないことを確かめる
  await first.click({ force: true });
  // ピッカーは開いたまま。選べなかったので、まだ閉じていない（選べれば閉じる）
  await expect(picker(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(picker(page)).toHaveCount(0);
  // 付いたチップはない（チップはピッカーの外のボタンだけを指す）
  await expect(chip(row, "😀")).toHaveCount(0);

  // 後始末：20種類を取り消す（取り消しは冪等）
  for (const [kind, value] of kinds)
    expect((await remove(page, M02, kind, value)).status()).toBe(200);
  const gone = await remove(page, M02, "emoji", "👍");
  expect(gone.status()).toBe(200);
  expect(((await gone.json()) as { reactions: unknown[] }).reactions).toEqual(
    [],
  );
});
