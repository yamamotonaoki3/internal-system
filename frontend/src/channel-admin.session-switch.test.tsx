// #143-b b-AC-1・b-AC-2（計画 #143-b 8.2 の F8。Skill「frontend-state」「security」）: 利用者の切り替えをまたいで、前の利用者のチャンネル管理（S-39）・
// アーカイブ（S-38）の一覧を出さない。401 の処理はセッションのキャッシュだけを捨て、ほかのキャッシュは残す（0-2 AC-8）ため、
// 一覧のキーにログイン中の利用者の ID を入れ、ID が確かめられる前は取得しない。前のデータは同じ利用者のときだけ残す。
// 契約（計画 5.5「キャッシュ」）：キーは channelKeys.admin(userId, filter) = ["channels", "admin", userId, filter]、
//   channelKeys.archived(userId) = ["channels", "archived", userId]。
// 同じ QueryClient で利用者 A → B に切り替え、B の応答を保留している間にも A の行が出ないことを確かめる（固定の時間の待ちは使わない）。
// データはすべて架空。
import { act, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authKeys } from "./features/auth";
import {
  installDomStubs,
  renderApp,
  type DomStubs,
} from "./test/app-shell-harness";
import {
  CHANNEL_DELETE_PERMISSION,
  CHANNEL_EDIT_PERMISSION,
  adminChannel,
  archivedItem,
  deferred,
  respondAdminChannels,
  respondArchivedItems,
  respondManageWrites,
} from "./test/channel-admin-handlers";
import { TEST_PASSWORD } from "./test/auth-handlers";
import { server } from "./test/server";

const USER_A = {
  id: "01JTEST143BSESSA0000000001",
  displayName: "testuser_143b_a",
  loginId: "testuser_143b_a",
};
const USER_B = {
  id: "01JTEST143BSESSB0000000001",
  displayName: "testuser_143b_b",
  loginId: "testuser_143b_b",
};
const A_NAME = "E2E_TEST_143bAの部屋";
const B_NAME = "E2E_TEST_143bBの部屋";
const PERMISSIONS = [CHANNEL_EDIT_PERMISSION, CHANNEL_DELETE_PERMISSION];

let stubs: DomStubs;
beforeEach(() => {
  stubs = installDomStubs();
});
afterEach(() => {
  stubs.restore();
});

function sessionOf(user: typeof USER_A) {
  return {
    user,
    permissions: PERMISSIONS,
    mustChangePassword: false,
    reauthenticatedAt: null,
  };
}

const rowWith = (name: string) =>
  screen.queryAllByRole("row").find((row) => row.textContent?.includes(name));

/** キャッシュにある、指定した種類（admin・archived）の一覧のキーの利用者の ID */
function cachedUserIds(
  client: ReturnType<typeof renderApp>["client"],
  kind: "admin" | "archived",
) {
  return client
    .getQueryCache()
    .findAll({ queryKey: ["channels", kind] })
    .map((query) => query.queryKey[2]);
}

describe("#143-b F8: 利用者の切り替えと一覧のキー", () => {
  it("#143-b b-AC-1（F8）: S-39 で A から B に切り替えると、B の応答を待つ間は A の行を出さず、応答の後は B の行だけを出す。キーに利用者の ID が入る", async () => {
    const gate = deferred();
    let sessionUser = USER_A;
    const calls = respondAdminChannels(async (_params, call) => {
      if (call === 1)
        return { items: [adminChannel(1, { name: A_NAME })], nextCursor: null };
      await gate.promise;
      return { items: [adminChannel(2, { name: B_NAME })], nextCursor: null };
    });
    server.use(
      http.get("/api/auth/session", () =>
        HttpResponse.json(sessionOf(sessionUser)),
      ),
    );
    const { client } = renderApp("/channel-management");
    await waitFor(() => expect(rowWith(A_NAME)).toBeDefined());
    expect(cachedUserIds(client, "admin")).toEqual([USER_A.id]);

    sessionUser = USER_B;
    act(() => {
      client.removeQueries({ queryKey: authKeys.session });
      client.setQueryData(authKeys.session, sessionOf(USER_B));
    });

    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(2));
    expect(await screen.findByText("読み込み中です")).toBeTruthy();
    expect(rowWith(A_NAME)).toBeUndefined();
    expect(cachedUserIds(client, "admin")).toContain(USER_B.id);

    gate.release();
    await waitFor(() => expect(rowWith(B_NAME)).toBeDefined());
    expect(rowWith(A_NAME)).toBeUndefined();
  });

  it("#143-b b-AC-2（F8）: S-38 で A から B に切り替えると、B の応答を待つ間は A の行を出さず、応答の後は B の行だけを出す", async () => {
    const gate = deferred();
    let sessionUser = USER_A;
    const calls = respondArchivedItems(async (_params, call) => {
      if (call === 1)
        return { items: [archivedItem(1, { name: A_NAME })], nextCursor: null };
      await gate.promise;
      return { items: [archivedItem(2, { name: B_NAME })], nextCursor: null };
    });
    server.use(
      http.get("/api/auth/session", () =>
        HttpResponse.json(sessionOf(sessionUser)),
      ),
    );
    const { client } = renderApp("/archive");
    await waitFor(() => expect(rowWith(A_NAME)).toBeDefined());
    expect(cachedUserIds(client, "archived")).toEqual([USER_A.id]);

    sessionUser = USER_B;
    act(() => {
      client.removeQueries({ queryKey: authKeys.session });
      client.setQueryData(authKeys.session, sessionOf(USER_B));
    });

    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(2));
    expect(rowWith(A_NAME)).toBeUndefined();

    gate.release();
    await waitFor(() => expect(rowWith(B_NAME)).toBeDefined());
    expect(rowWith(A_NAME)).toBeUndefined();
  });

  it("#143-b b-AC-1（F8）: 同じ利用者の中で状態の絞り込みを変えたときは、新しい一覧が届くまで前の行を残す", async () => {
    const gate = deferred();
    server.use(
      http.get("/api/auth/session", () => HttpResponse.json(sessionOf(USER_A))),
    );
    respondAdminChannels(async (params) => {
      if (params.get("state") === "active") {
        await gate.promise;
        return { items: [adminChannel(2, { name: B_NAME })], nextCursor: null };
      }
      return { items: [adminChannel(1, { name: A_NAME })], nextCursor: null };
    });
    const { user } = renderApp("/channel-management");
    await waitFor(() => expect(rowWith(A_NAME)).toBeDefined());
    await user.selectOptions(screen.getByLabelText("状態"), "使用中");
    // #155：ヘッダーにもメッセージの検索のボタン「検索」があるため、画面の本文（main）の中に絞って押す
    await user.click(
      within(screen.getByRole("main")).getByRole("button", { name: "検索" }),
    );
    expect(rowWith(A_NAME)).toBeDefined();
    gate.release();
    await waitFor(() => expect(rowWith(B_NAME)).toBeDefined());
  });
});

// #143-b コードレビュー1回目（重大1）：ページの中の状態（開いているダイアログの対象・完了の通知・絞り込みの入力）も、利用者の切り替えで作り直す
// （方針：ページを利用者の ID を key にして描画する。ID が確かめられる前は描画しない）。B の応答を保留している間も、A のチャンネルの名前を画面のどこにも出さない。
describe("#143-b レビュー1回目（重大1）: 利用者の切り替えとページの状態", () => {
  function world(kind: "admin" | "archived") {
    const gate = deferred();
    const state = { user: USER_A };
    server.use(
      http.get("/api/auth/session", () =>
        HttpResponse.json(sessionOf(state.user)),
      ),
    );
    const calls =
      kind === "admin"
        ? respondAdminChannels(async () => {
            if (state.user === USER_A)
              return {
                items: [adminChannel(1, { name: A_NAME })],
                nextCursor: null,
              };
            await gate.promise;
            return {
              items: [adminChannel(2, { name: B_NAME })],
              nextCursor: null,
            };
          })
        : respondArchivedItems(async () => {
            if (state.user === USER_A)
              return {
                items: [archivedItem(1, { name: A_NAME })],
                nextCursor: null,
              };
            await gate.promise;
            return {
              items: [archivedItem(2, { name: B_NAME })],
              nextCursor: null,
            };
          });
    return { gate, state, calls };
  }

  /** 401 の処理と同じく、セッションのキャッシュだけを捨てて B にする。B の一覧の取得が始まるまで待つ */
  async function switchToB(
    client: ReturnType<typeof renderApp>["client"],
    w: ReturnType<typeof world>,
  ) {
    const before = w.calls.length;
    w.state.user = USER_B;
    act(() => {
      client.removeQueries({ queryKey: authKeys.session });
      client.setQueryData(authKeys.session, sessionOf(USER_B));
    });
    await waitFor(() => expect(w.calls.length).toBeGreaterThan(before));
  }

  const showsA = () => document.body.textContent?.includes(A_NAME) ?? false;

  type User = ReturnType<typeof renderApp>["user"];

  async function reauthenticate(user: User) {
    const reauth = await screen.findByRole("dialog", { name: "再認証" });
    await user.type(within(reauth).getByLabelText("パスワード"), TEST_PASSWORD);
    await user.click(within(reauth).getByRole("button", { name: "再認証" }));
  }

  async function rowA() {
    await waitFor(() => expect(rowWith(A_NAME)).toBeDefined());
    const row = rowWith(A_NAME);
    if (row === undefined) throw new Error("行がありません");
    return row;
  }

  async function openArchiveDialog(user: User) {
    await user.click(
      within(await rowA()).getByRole("button", { name: `${A_NAME}の操作` }),
    );
    const menu = await screen.findByRole("menu");
    await user.click(
      within(menu).getByRole("menuitem", { name: "アーカイブ" }),
    );
    return screen.findByRole("dialog", {
      name: `チャンネル「${A_NAME}」をアーカイブしますか`,
    });
  }

  async function openRestoreDialog(user: User) {
    await user.click(
      within(await rowA()).getByRole("button", { name: "復元" }),
    );
    return screen.findByRole("dialog", {
      name: `チャンネル「${A_NAME}」を復元しますか`,
    });
  }

  async function expectNoAAfterRelease(w: ReturnType<typeof world>) {
    w.gate.release();
    await waitFor(() => expect(rowWith(B_NAME)).toBeDefined());
    expect(showsA()).toBe(false);
  }

  it("#143-b 重大1 (a): S-39 で A がアーカイブのダイアログを開いたまま B に切り替えると、ダイアログが消え、B の応答を待つ間も A の名前がどこにも出ない", async () => {
    const w = world("admin");
    const { client, user } = renderApp("/channel-management");
    expect(await openArchiveDialog(user)).toBeTruthy();
    await switchToB(client, w);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(showsA()).toBe(false);
    await expectNoAAfterRelease(w);
  });

  it("#143-b 重大1 (b): S-39 で A の完了の通知が出ている状態で B に切り替えると、通知が消える", async () => {
    const w = world("admin");
    respondManageWrites();
    const { client, user } = renderApp("/channel-management");
    const dialog = await openArchiveDialog(user);
    await user.click(
      within(dialog).getByRole("button", { name: "アーカイブ" }),
    );
    await reauthenticate(user);
    expect(
      await screen.findByText(`チャンネル「${A_NAME}」をアーカイブしました`),
    ).toBeTruthy();
    await switchToB(client, w);
    await waitFor(() => expect(showsA()).toBe(false));
    await expectNoAAfterRelease(w);
  });

  it("#143-b 重大1 (c): S-38 で A の復元のダイアログを開いたまま B に切り替えると、ダイアログが消える", async () => {
    const w = world("archived");
    const { client, user } = renderApp("/archive");
    expect(await openRestoreDialog(user)).toBeTruthy();
    await switchToB(client, w);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(showsA()).toBe(false);
    await expectNoAAfterRelease(w);
  });

  it("#143-b 重大1 (c): S-38 で A の復元の完了の通知が出ている状態で B に切り替えると、通知が消える", async () => {
    const w = world("archived");
    respondManageWrites();
    const { client, user } = renderApp("/archive");
    const dialog = await openRestoreDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "復元" }));
    await reauthenticate(user);
    expect(
      await screen.findByText(`チャンネル「${A_NAME}」を復元しました`),
    ).toBeTruthy();
    await switchToB(client, w);
    await waitFor(() => expect(showsA()).toBe(false));
    await expectNoAAfterRelease(w);
  });

  it("#143-b 重大1 (d): S-39 の絞り込みの入力（検索語・状態）は、切り替えで初期の状態に戻る", async () => {
    const w = world("admin");
    const { client, user } = renderApp("/channel-management");
    await rowA();
    await user.type(screen.getByLabelText("名前で検索"), "Aの検索語");
    await user.selectOptions(screen.getByLabelText("状態"), "使用中");
    await switchToB(client, w);
    await waitFor(() =>
      expect(
        (screen.getByLabelText("名前で検索") as HTMLInputElement).value,
      ).toBe(""),
    );
    const state = screen.getByLabelText("状態");
    if (!(state instanceof HTMLSelectElement))
      throw new Error("状態の欄が select ではありません");
    expect(state.selectedOptions[0]?.textContent).toBe("すべて");
    w.gate.release();
  });
});
