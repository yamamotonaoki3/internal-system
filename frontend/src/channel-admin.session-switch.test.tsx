// #143-b b-AC-1・b-AC-2（計画 #143-b 8.2 の F8。Skill「frontend-state」「security」）: 利用者の切り替えをまたいで、前の利用者のチャンネル管理（S-39）・
// アーカイブ（S-38）の一覧を出さない。401 の処理はセッションのキャッシュだけを捨て、ほかのキャッシュは残す（0-2 AC-8）ため、
// 一覧のキーにログイン中の利用者の ID を入れ、ID が確かめられる前は取得しない。前のデータは同じ利用者のときだけ残す。
// 契約（計画 5.5「キャッシュ」）：キーは channelKeys.admin(userId, filter) = ["channels", "admin", userId, filter]、
//   channelKeys.archived(userId) = ["channels", "archived", userId]。
// 同じ QueryClient で利用者 A → B に切り替え、B の応答を保留している間にも A の行が出ないことを確かめる（固定の時間の待ちは使わない）。
// データはすべて架空。
import { act, screen, waitFor } from "@testing-library/react";
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
} from "./test/channel-admin-handlers";
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
    await user.click(screen.getByRole("button", { name: "検索" }));
    expect(rowWith(A_NAME)).toBeDefined();
    gate.release();
    await waitFor(() => expect(rowWith(B_NAME)).toBeDefined());
  });
});
