// #119 AC-4：S-34 初代全体管理者の初回セットアップを、画面からバックエンドまで通して確かめる。
// 前提：pretest:e2e がテスト用DBを空にして作り直すため、開始時は初代管理者が未設定。
// トークンは環境変数 SETUP_TOKEN（.env.test。npm run test:e2e が読み込む）から読み、値をファイルに書かない。
// データはすべて架空（e2euser_001・example.com・[E2E_TEST]）。削除は backend/db/seeds/cleanup.sql の識別子で行う。
import { expect, test } from "./console-guard";
import { allowSessionCheck401 } from "./session-console";

const VALID = {
  companyName: "[E2E_TEST]テスト株式会社",
  departmentName: "[E2E_TEST]テスト部",
  loginId: "e2euser_001",
  legalName: "テスト太郎",
  email: "e2euser_001@example.com",
};

// 2つ目のテストは1つ目の登録の結果に依存するため、順に実行する（再試行ではない）
test.describe.configure({ mode: "serial" });

function setupToken(): string {
  const token = process.env.SETUP_TOKEN;
  if (token === undefined || token === "")
    throw new Error(
      "SETUP_TOKEN が設定されていません（.env.test に利用者が入れる。値はここに書かない）",
    );
  return token;
}

test("#119 AC-4: 未設定の状態から登録すると初期パスワードが一度だけ表示され、戻る・再読み込みの後は表示されず「完了済み」になる", async ({
  page,
}) => {
  const token = setupToken();
  allowSessionCheck401(page);

  // 入口：未設定のときだけ、ログイン画面（未ログインで / を開くと移る先。#120）にリンクが出る
  await page.goto("/login");
  await page.getByRole("link", { name: "初回セットアップへ" }).click();
  await expect(page).toHaveURL(/\/setup$/);

  await page.getByLabel(/セットアップ用のトークン/).fill(token);
  await page.getByLabel(/会社名/).fill(VALID.companyName);
  await page.getByLabel(/部署名/).fill(VALID.departmentName);
  await page.getByLabel(/社員ID/).fill(VALID.loginId);
  await page.getByLabel(/本名/).fill(VALID.legalName);
  await page.getByLabel(/メールアドレス$/).fill(VALID.email);
  await page
    .getByRole("checkbox", {
      name: /会社が発行した自分のメールアドレスだと確認しました/,
    })
    .check();

  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/setup") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "登録する" }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const body = (await response.json()) as { initialPassword: string };
  const initialPassword = body.initialPassword;
  expect(initialPassword.length).toBe(16);

  // 一度だけ表示される
  await expect(page.getByText(initialPassword, { exact: true })).toBeVisible();
  await expect(page.getByText(VALID.loginId, { exact: true })).toBeVisible();
  await expect(page.getByText(token)).toHaveCount(0);

  // ブラウザの保存場所・履歴・URLに残らない
  const leaked = await page.evaluate(
    ([password, secret]) => {
      const dump: string[] = [window.location.href];
      for (const storage of [window.localStorage, window.sessionStorage]) {
        for (let i = 0; i < storage.length; i += 1) {
          const key = storage.key(i) ?? "";
          dump.push(key, storage.getItem(key) ?? "");
        }
      }
      dump.push(JSON.stringify(window.history.state ?? null));
      const text = dump.join("\n");
      return text.includes(password) || text.includes(secret);
    },
    [initialPassword, token] as const,
  );
  expect(leaked).toBe(false);

  // 離脱して戻る：表示されず「完了済み」（#120：離脱先はログイン画面。/login → /setup はリンクでの通常の遷移なので、戻ると /setup）
  await page.goto("/login");
  await expect(
    page.getByRole("link", { name: "初回セットアップへ" }),
  ).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByText(/完了しています/)).toBeVisible();
  await expect(page.getByText(initialPassword)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "登録する" })).toHaveCount(0);

  // 再読み込み：表示されず「完了済み」
  await page.reload();
  await expect(page.getByText(/完了しています/)).toBeVisible();
  await expect(page.getByText(initialPassword)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "登録する" })).toHaveCount(0);
});

test("#119 AC-4: 完了済みの後に API へ再び登録を送っても 409 で、セットアップは再実行できない", async ({
  page,
}) => {
  // 前のテストで登録済み（同じファイルの中で順に実行する。DBは実行の開始時に作り直す）
  const status = await page.request.get("/api/setup/status");
  expect(status.status()).toBe(200);
  expect(await status.json()).toEqual({ setupRequired: false });
  const response = await page.request.post("/api/setup", {
    headers: { Origin: "http://localhost:5173" },
    data: {
      setupToken: setupToken(),
      ...VALID,
      loginId: "e2euser_002",
      email: "e2euser_002@example.com",
      emailConfirmed: true,
    },
  });
  expect(response.status()).toBe(409);
});
