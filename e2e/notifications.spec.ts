// #124 AC-1（3-4 AC-1〜AC-5 の土台）・AC-2: ヘッダーの通知の件数・通知の一覧 S-14・既読・すべて既読・スマホ幅の下部メニューの「通知」を、
// 画面からバックエンドまで通して確かめる。データを変える操作の後は、再読み込みせずに関係する表示が変わることを確かめる。
// 前提：e2e/seeds/notifications.sql（e2euser_notif_01 宛て：未読3件・既読1件／e2euser_notif_02 宛て：未読1件。種類は対応表に無い e2e_sample）。
// 後始末は e2e/seeds/notifications-cleanup.sql（社員ID e2euser_notif_・部署名 [E2E_TEST]部署124 の識別子だけ。残数 0 を確かめる文つき）。
// ログインの試行制限（接続元 15 分 30 回）に当たらないよう、ログインは e2euser_notif_01 と e2euser_notif_02 で 1 回ずつ（計 2 回）だけにする。
import { execFile } from "node:child_process";
import type { Page } from "@playwright/test";
import { expect, test } from "./console-guard";
import { allowSessionCheck401 } from "./session-console";

const PASSWORD = "TestPass123!";
// 他人宛て（e2euser_notif_02）の通知の ID。e2euser_notif_01 の画面・API に出てはならない
const OTHER_NOTIFICATION_ID = "01JTE2E00000000000000N5124";

function seedFile(
  file: "notifications.sql" | "notifications-cleanup.sql",
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ["scripts/db-local.ts", "test", "seed-file", `e2e/seeds/${file}`],
      { cwd: process.cwd(), windowsHide: true },
      (error) => (error ? reject(error) : resolve()),
    );
  });
}

async function login(page: Page, loginId: string) {
  allowSessionCheck401(page);
  await page.goto("/login");
  await page.getByLabel("ユーザーID", { exact: true }).fill(loginId);
  await page.getByLabel("パスワード", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}

const headerBell = (page: Page) =>
  page.getByRole("banner").getByRole("link", { name: /^通知/ });

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await seedFile("notifications-cleanup.sql");
  await seedFile("notifications.sql");
});
test.afterAll(async () => {
  await seedFile("notifications-cleanup.sql");
});

test("#124 AC-1（3-4 AC-3・R-57・AC-5）: ヘッダーの件数から S-14 へ移ると本人の通知だけが出て、既読・すべて既読で再読み込みせずに印が消え、スマホ幅の下部メニューの「通知」からも開ける", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page, "e2euser_notif_01");

  // ヘッダーの通知：未読 3 件（既読 1 件と、他人宛ての 1 件は数えない）
  await expect(headerBell(page)).toContainText("3");

  // 押すと S-14 へ直接移る
  await headerBell(page).click();
  await expect(page).toHaveURL(/\/notifications$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "通知", exact: true }),
  ).toBeVisible();

  // 本人の通知（4 件）だけが出る。他人（e2euser_notif_02）宛ては、画面にも API の応答にも出ない
  const main = page.getByRole("main");
  await expect(main.getByRole("listitem")).toHaveCount(4);
  const listed = await page.request.get("/api/me/notifications?limit=100");
  expect(listed.status()).toBe(200);
  const body = (await listed.json()) as { items: { id: string }[] };
  expect(body.items).toHaveLength(4);
  expect(body.items.map((item) => item.id)).not.toContain(
    OTHER_NOTIFICATION_ID,
  );

  // 1 件を既読にすると、再読み込みせずに未読の印が 3 → 2 になり、行は残る
  await main
    .getByRole("button", { name: "既読にする", exact: true })
    .first()
    .click();
  await expect(headerBell(page)).toContainText("2");
  await expect(
    main.getByRole("button", { name: "既読にする", exact: true }),
  ).toHaveCount(2);
  await expect(main.getByRole("listitem")).toHaveCount(4);

  // すべて既読にすると、再読み込みせずに印が消える
  await main
    .getByRole("button", { name: "すべて既読にする", exact: true })
    .click();
  await expect(
    main.getByRole("button", { name: "既読にする", exact: true }),
  ).toHaveCount(0);
  await expect(headerBell(page)).not.toContainText(/\d/);
  await expect(main.getByRole("listitem")).toHaveCount(4);

  // スマホ幅：下部メニューに「ホーム」「通知」「自分」の順で並び、「通知」から S-14 を開ける
  await page.setViewportSize({ width: 375, height: 800 });
  const bottom = page.getByRole("navigation", { name: "下部メニュー" });
  await expect(bottom).toBeVisible();
  await bottom.getByRole("link", { name: "ホーム", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await bottom.getByRole("link", { name: "通知", exact: true }).click();
  await expect(page).toHaveURL(/\/notifications$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "通知", exact: true }),
  ).toBeVisible();
});

test("#124 AC-1（R-57）: 別の社員（e2euser_notif_02）には、その社員宛ての通知だけが出て、他人の既読の操作は 404 になる", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page, "e2euser_notif_02");
  await expect(headerBell(page)).toContainText("1");
  await headerBell(page).click();
  await expect(page).toHaveURL(/\/notifications$/);
  await expect(page.getByRole("main").getByRole("listitem")).toHaveCount(1);

  // 他人（e2euser_notif_01）宛ての通知の ID の既読は 404（存在を漏らさない）
  const origin = new URL(page.url()).origin;
  const res = await page.request.post(
    "/api/me/notifications/01JTE2E00000000000000N1124/read",
    { headers: { Origin: origin } },
  );
  expect(res.status()).toBe(404);
});
