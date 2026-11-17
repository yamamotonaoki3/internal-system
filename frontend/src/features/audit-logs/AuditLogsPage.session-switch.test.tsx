// #156（0-6 AC-1・AC-6・Skill「security」）：全体管理者だけが見られる一覧で、利用者の切り替えをまたいで、前の利用者の一覧が表示されない。
// 401 の処理（unauthenticated-handler）はセッションのキャッシュだけを捨て、ほかのキャッシュは残す（0-2 AC-8）。
// そのため、監査ログの検索のキーにログイン中の利用者の ID を含め、ID が確かめられる前は取得しない。
// 同じ QueryClient で、利用者 A → B に切り替え、B の応答を待つ間にも A の一覧が出ないことを確かめる。
// 応答の保留は、解決を手で制御する（固定の時間の待ちは使わない）。データは架空。
// 契約：features/audit-logs/query-keys.ts の auditLogKeys = { all, search(userId, filters) }（all の配下。利用者の ID・絞り込みごとに違う）。
import { act, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installDomStubs,
  renderApp,
  type DomStubs,
} from "../../test/app-shell-harness";
import {
  AUDIT_PERMISSION,
  auditItem,
  respondAuditSearch,
} from "../../test/audit-log-handlers";
import { server } from "../../test/server";
import { authKeys } from "../auth/api/query-keys";
import { auditLogKeys } from "./query-keys";

const USER_A = {
  id: "01JTEST156FESESSA000000001",
  displayName: "testuser_156f_a",
  loginId: "testuser_156f_a",
};
const USER_B = {
  id: "01JTEST156FESESSB000000001",
  displayName: "testuser_156f_b",
  loginId: "testuser_156f_b",
};
const A_TARGET = "testuser_156f_a_target_表示";
const B_TARGET = "testuser_156f_b_target_表示";

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
    permissions: [AUDIT_PERMISSION],
    mustChangePassword: false,
    reauthenticatedAt: null,
  };
}

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

const itemFor = (n: number, label: string) =>
  auditItem(n, {
    target: {
      type: "user",
      id: `01JTEST156FESTGT0000000${String(n).padStart(3, "0")}`,
      label,
      isActive: true,
    },
  });

describe("#156 0-6 レビュー指摘の型：利用者の切り替えと監査ログのキー", () => {
  it("#156 0-6 AC-1: 全体管理者 A から B に切り替えると、B の応答を待つ間は A の一覧を出さず、応答の後は B の一覧だけを出す", async () => {
    const gate = deferred();
    let sessionUser = USER_A;
    server.use(
      http.get("/api/auth/session", () =>
        HttpResponse.json(sessionOf(sessionUser)),
      ),
    );
    const calls = respondAuditSearch(async (_body, n) => {
      if (n === 1)
        return { items: [itemFor(1, A_TARGET)], nextCursor: "cursor-of-a" };
      await gate.promise;
      return { items: [itemFor(2, B_TARGET)], nextCursor: null };
    });
    const { client } = renderApp("/audit-logs");
    expect(
      await screen.findByRole("row", { name: new RegExp(A_TARGET) }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "さらに読み込む" })).toBeTruthy();

    // 401 の処理と同じく、セッションのキャッシュだけを捨てる。その後、B としてログインし直した状態にする
    sessionUser = USER_B;
    act(() => {
      client.removeQueries({ queryKey: authKeys.session });
      client.setQueryData(authKeys.session, sessionOf(USER_B));
    });

    // B の検索が始まり、応答が保留されている間：A の行も、A の続き（cursor）も出さない
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).not.toHaveProperty("cursor");
    expect(await screen.findByText("読み込み中です")).toBeTruthy();
    expect(screen.queryByText(new RegExp(A_TARGET))).toBeNull();
    expect(screen.queryByRole("button", { name: "さらに読み込む" })).toBeNull();

    gate.release();
    expect(
      await screen.findByRole("row", { name: new RegExp(B_TARGET) }),
    ).toBeTruthy();
    expect(screen.queryByText(new RegExp(A_TARGET))).toBeNull();
  });
});

describe("#156 0-6 レビュー指摘の型：監査ログのキー（単体）", () => {
  it("#156 0-6: search のキーは、利用者の ID ごと・絞り込みごとに違い、all の配下にある", () => {
    const a = auditLogKeys.search(USER_A.id, {});
    const b = auditLogKeys.search(USER_B.id, {});
    expect(a).not.toEqual(b);
    expect(a).toContain(USER_A.id);
    expect(a.slice(0, auditLogKeys.all.length)).toEqual([...auditLogKeys.all]);
    expect(
      auditLogKeys.search(USER_A.id, { action: "account.create" }),
    ).not.toEqual(a);
    expect(auditLogKeys.search(USER_A.id, { result: "failure" })).not.toEqual(
      auditLogKeys.search(USER_A.id, { result: "success" }),
    );
  });
});
