// シードした架空のデータ（e2e/seeds/health.sql）を、画面の裏の API から読めることを確かめる。
// 検証用 DB への初期化・シードの保存先と、開発サーバー（dev:test）の保存先が同じであることの確認も兼ねる。
// #120（利用者の承認済みの変更）：/api/sample-users はログインが必要になったため、事前にログインする手順と、未認証で 401 になる確認を足した。
// ログインする利用者は e2e/seeds/login.sql の架空の利用者（パスワードはテスト専用の固定値）。
import { expect, test } from "./console-guard";

const ORIGIN = "http://localhost:5173";

test("#120 AC-1（0-2 AC-3）: ログインしていないと /api/sample-users は 401", async ({
  page,
}) => {
  const response = await page.request.get("/api/sample-users");
  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect((await response.json()) as { code: string }).toMatchObject({
    code: "UNAUTHENTICATED",
  });
});

test("シードした利用者（e2euser_health_001）を API から読める（#120：事前にログインする）", async ({
  page,
}) => {
  const login = await page.request.post("/api/auth/login", {
    headers: { Origin: ORIGIN },
    data: { loginId: "e2euser_login_001", password: "TestPass123!" },
  });
  expect(login.status()).toBe(200);

  const response = await page.request.get("/api/sample-users");
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { users: { username: string }[] };
  expect(body.users.map((user) => user.username)).toContain(
    "e2euser_health_001",
  );
});
