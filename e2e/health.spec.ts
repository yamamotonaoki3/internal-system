// 最初のシナリオ：画面を開いて、サーバー（API）と通信できることを確かめる。
// console-guard の test を使うため、コンソールのエラーが出たら失敗になる（C-24）。
import { expect, test } from "./console-guard";
import { allowSessionCheck401 } from "./session-console";

// #120（利用者の承認済みの変更）：未ログインで / を開くと /login に移るため、/login を開く。確かめる内容は変えない
test("画面を開くと、サーバーの状態が表示される", async ({ page }) => {
  allowSessionCheck401(page);
  await page.goto("/login");
  await expect(page.getByText("サーバーの状態：ok")).toBeVisible();
  await expect(page.getByText("環境：test")).toBeVisible();
  await expect(page.getByText("サーバーにつながりません")).toHaveCount(0);
});

test("API（/api/health）が 200 で応答する", async ({ page }) => {
  const response = await page.request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ status: "ok", appEnv: "test" });
});
