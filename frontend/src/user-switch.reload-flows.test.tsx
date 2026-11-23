// #298 AC-4（計画 plan-298 改訂3 の 8-1 の「AC-4 画面（harness。新しい文書の初期化と回数）」の行の (i)・(iv)・(v)。2-8 の「呼ぶ時」）：
// 切り替えの読み込み直しの入口を呼ぶのは、セッションの利用者が、文書の利用者と違う値になったときだけ。
//   (i)  通常のログアウト → /login → B でログイン：1回（ログインの後の移動・続く取り直しと重なっても1回）
//   (iv) 初回セットアップの完了 → 最初のログイン：0回（文書の利用者がまだ無い）
//   (v)  初回のパスワードの変更（同じ利用者のセッションの書き換え）：0回
// (ii)・(iii)（401 の後のログイン）は user-switch.session-switch.test.tsx の末尾にある（1回目）。
// 読み込み直した後の文書で文書の利用者が B になることは、文書の利用者の単体（features/auth/document-user.test.ts：新しい文書は最初に確定した利用者を持つ）で確かめる。
// 状態 × 出来事の表（1回目）のます：文書の利用者 A・セッション無し × B の確定／文書の利用者 無し × A の確定／文書の利用者 A × A の書き換え。
// 入口は test/setup.ts の vi.fn（呼ばれた回数を数える）。データはすべて架空（testuser_298_・[UNIT_TEST]・example.com）。
import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestUserSwitchReload } from "./features/access-loss/reload-after-access-loss";
import { authKeys } from "./features/auth";
import { installDomStubs, type DomStubs } from "./test/app-shell-harness";
import { TEST_PASSWORD } from "./test/auth-handlers";
import {
  MISMATCH_USER_A,
  MISMATCH_USER_B,
  requestsTo,
  respondMismatchWorld,
  type MismatchUser,
} from "./test/session-mismatch-world";
import {
  disposeUserSwitchApps,
  renderUserSwitchApp,
  settleUserSwitchApps,
} from "./test/user-switch-harness";

/** 文書の利用者 A の ID（ヘッダーの期待の値。本番の定義から取らない） */
const A_ID = "01JTESTUSER298WORLDA000001";
const NEW_PASSWORD = "Qz7!kLm2#Rv9wX";

type App = ReturnType<typeof renderUserSwitchApp>;

async function logIn(app: App, user: MismatchUser) {
  await app.user.type(await screen.findByLabelText("ユーザーID"), user.loginId);
  await app.user.type(screen.getByLabelText("パスワード"), TEST_PASSWORD);
  await app.user.click(screen.getByRole("button", { name: "ログイン" }));
}

async function sessionSettled(app: App) {
  await waitFor(() =>
    expect(
      app.client.getQueryState(authKeys.session)?.fetchStatus ?? "idle",
    ).toBe("idle"),
  ); // ログイン後の枠が出て、その画面の通信が始まってから、afterEach の settleUserSwitchApps で終わりを待つ
  // （始まる前に閉じると、通信が後始末の後に届き、次のテストの画面を /login へ移す）
  await screen.findByRole("button", { name: "ログアウト" });
}

let stubs: DomStubs;
beforeEach(() => {
  stubs = installDomStubs();
  vi.mocked(requestUserSwitchReload).mockClear();
});
afterEach(async () => {
  // 前のテストの通信の続きが、次のテストの画面を /login へ移さないよう、終わるのを待つ
  await settleUserSwitchApps();
  disposeUserSwitchApps();
  stubs.restore();
});

describe("#298 AC-4 新しい文書の初期化と、切り替えの読み込み直しの回数", () => {
  it("#298 AC-4 (i): A が通常のログアウト → /login → B でログイン：読み込み直しを1回求める（ログインの後の移動・続く取り直しと重なっても1回）。ログアウトは A のヘッダーで送られる", async () => {
    const world = respondMismatchWorld(MISMATCH_USER_A);
    const app = renderUserSwitchApp("/", { needles: [] });
    // 「ログイン状態の確認中」の main ではなく、ログイン後の画面が出るのを待つ
    await app.user.click(
      await screen.findByRole("button", { name: "ログアウト" }),
    );
    await waitFor(() =>
      expect(app.router.state.location.pathname).toBe("/login"),
    );
    const [logout] = requestsTo(world, "POST", /\/api\/auth\/logout$/);
    expect(logout).toEqual({
      method: "POST",
      path: "/api/auth/logout",
      header: A_ID,
      status: 204,
    });
    expect(requestUserSwitchReload).not.toHaveBeenCalled();

    await logIn(app, MISMATCH_USER_B);
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/"));
    await sessionSettled(app);
    await act(async () => {
      await app.client.refetchQueries({
        queryKey: authKeys.session,
        exact: true,
      });
    });
    expect(requestUserSwitchReload).toHaveBeenCalledTimes(1);
  });

  it("#298 AC-4 (i)（対照）: A が通常のログアウト → A で再ログイン：読み込み直しは求めない（0回）", async () => {
    respondMismatchWorld(MISMATCH_USER_A);
    const app = renderUserSwitchApp("/", { needles: [] });
    // 「ログイン状態の確認中」の main ではなく、ログイン後の画面が出るのを待つ
    await app.user.click(
      await screen.findByRole("button", { name: "ログアウト" }),
    );
    await waitFor(() =>
      expect(app.router.state.location.pathname).toBe("/login"),
    );
    await logIn(app, MISMATCH_USER_A);
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/"));
    await sessionSettled(app);
    expect(requestUserSwitchReload).not.toHaveBeenCalled();
  });

  it("#298 AC-4 (iv): 初回セットアップの完了 → 最初のログイン：読み込み直しは求めない（0回）。セットアップの送信には、文書の利用者が無いのでヘッダーが付かない", async () => {
    const world = respondMismatchWorld(null);
    world.setupDone = false;
    const app = renderUserSwitchApp("/setup", { needles: [] });
    await app.user.type(
      await screen.findByLabelText(/セットアップ用のトークン/),
      "TESTONLY_setup_token_aaaaaaaaaaaaaaaaaaaaaa",
    );
    await app.user.type(
      screen.getByLabelText(/会社名/),
      "[[UNIT_TEST]298テスト株式会社",
    );
    await app.user.type(
      screen.getByLabelText(/部署名/),
      "[[UNIT_TEST]298テスト部",
    );
    await app.user.type(
      screen.getByLabelText(/社員ID/),
      MISMATCH_USER_A.loginId,
    );
    await app.user.type(screen.getByLabelText(/本名/), "テスト太郎");
    await app.user.type(
      screen.getByLabelText(/メールアドレス$/),
      `${MISMATCH_USER_A.loginId}@example.com`,
    );
    await app.user.click(
      screen.getByRole("checkbox", {
        name: /会社が発行した自分のメールアドレスだと確認しました/,
      }),
    );
    await app.user.click(screen.getByRole("button", { name: "登録する" }));
    await app.user.click(
      await screen.findByRole("button", { name: "ログイン画面へ進む" }),
    );
    const [setup] = requestsTo(world, "POST", /\/api\/setup$/);
    expect(setup?.header).toBeNull();

    await logIn(app, MISMATCH_USER_A);
    await waitFor(() => expect(app.router.state.location.pathname).toBe("/"));
    await sessionSettled(app);
    expect(requestUserSwitchReload).not.toHaveBeenCalled();
  });

  it("#298 AC-4 (v): 初回のパスワードの変更（同じ利用者 A のセッションの書き換え）：読み込み直しは求めない（0回）。変更は A のヘッダーで送られる", async () => {
    const world = respondMismatchWorld(MISMATCH_USER_A);
    world.mustChangePassword = true;
    const app = renderUserSwitchApp("/", { needles: [] });
    await app.user.type(
      await screen.findByLabelText("現在のパスワード"),
      TEST_PASSWORD,
    );
    await app.user.type(
      screen.getByLabelText("新しいパスワード"),
      NEW_PASSWORD,
    );
    await app.user.type(
      screen.getByLabelText("新しいパスワード（確認）"),
      NEW_PASSWORD,
    );
    await app.user.click(
      screen.getByRole("button", { name: "パスワードを変更" }),
    );
    await waitFor(() =>
      expect(requestsTo(world, "PUT", /\/api\/me\/password$/)[0]?.status).toBe(
        200,
      ),
    );
    expect(requestsTo(world, "PUT", /\/api\/me\/password$/)[0]?.header).toBe(
      A_ID,
    );
    await waitFor(() =>
      expect(
        (
          app.client.getQueryData(authKeys.session) as {
            mustChangePassword: boolean;
          }
        ).mustChangePassword,
      ).toBe(false),
    );
    await sessionSettled(app);
    expect(requestUserSwitchReload).not.toHaveBeenCalled();
  });
});
