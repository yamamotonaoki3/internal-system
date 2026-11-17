// #128（128-c）コードレビュー1回目（重大）：利用者の切り替えをまたいで、前の利用者の申請が表示されない。
// 401 の処理（unauthenticated-handler）はセッションのキャッシュだけを捨て、ほかのキャッシュは残す（0-2 AC-8）。
// そのため、申請のキーにログイン中の利用者の ID を含め、ID が確かめられる前は取得しない（C-177 の本人限定・Skill「security」）。
// 同じ QueryClient で、利用者 A → B に切り替え、B の応答を待つ間にも A の申請が出ないことを確かめる。
// 応答の保留は、解決を手で制御する（固定の時間の待ちは使わない）。データは架空。
import { act, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authKeys } from "../auth/api/query-keys";
import {
  installDomStubs,
  renderApp,
  type DomStubs,
} from "../../test/app-shell-harness";
import { server } from "../../test/server";
import { retirementRequestKeys } from "./api/query-keys";

const USER_A = {
  id: "01JTEST128CSESSA0000000001",
  displayName: "testuser_128c_a",
  loginId: "testuser_128c_a",
};
const USER_B = {
  id: "01JTEST128CSESSB0000000001",
  displayName: "testuser_128c_b",
  loginId: "testuser_128c_b",
};
const A_TARGET = "testuser_128c_a_target_表示";
const B_TARGET = "testuser_128c_b_target_表示";
const A_REASON = "[E2E_TEST]Aの申請の却下の理由";
const A_REQUESTER = "testuser_128c_a_requester_表示";
const B_REQUESTER = "testuser_128c_b_requester_表示";

let stubs: DomStubs;
beforeEach(() => {
  stubs = installDomStubs();
});
afterEach(() => {
  stubs.restore();
});

function sessionOf(user: typeof USER_A, permissions: string[]) {
  return {
    user,
    permissions,
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

type Item = {
  id: string;
  status: "pending" | "rejected";
  target: { id: string; displayName: string };
  department: { id: string; name: string };
  requester?: { id: string; displayName: string };
  decisionReason: string | null;
  createdAt: string;
  decidedAt: string | null;
};

const DEPT = { id: "01JTEST128CDEPT00000000010", name: "[E2E_TEST]128c部署" };

function item(
  suffix: string,
  displayName: string,
  overrides: Partial<Item> = {},
): Item {
  return {
    id: `01JTEST128CSREQ000000000${suffix}`,
    status: "pending",
    target: { id: `01JTEST128CSTGT000000000${suffix}`, displayName },
    department: DEPT,
    decisionReason: null,
    createdAt: "2026-11-17T00:00:00.000Z",
    decidedAt: null,
    ...overrides,
  };
}

describe("#128（128-c）レビュー1回目（重大）：利用者の切り替えと申請のキー", () => {
  it("#128 C-177（U-1）・レビュー1回目（重大）: 自分の申請：A から B に切り替えると、B の応答を待つ間は A の申請の対象・却下の理由を出さず、応答の後は B の申請だけを出す", async () => {
    const gate = deferred();
    let sessionUser = USER_A;
    let calls = 0;
    server.use(
      http.get("/api/auth/session", () =>
        HttpResponse.json(sessionOf(sessionUser, [])),
      ),
      http.get("/api/retirement-requests/mine", async () => {
        calls += 1;
        if (calls === 1)
          return HttpResponse.json({
            items: [
              item("A1", A_TARGET, {
                status: "rejected",
                decisionReason: A_REASON,
                decidedAt: "2026-11-17T01:00:00.000Z",
              }),
            ],
            nextCursor: null,
          });
        await gate.promise;
        return HttpResponse.json({
          items: [item("B1", B_TARGET)],
          nextCursor: null,
        });
      }),
    );
    const { client } = renderApp("/retirement-requests/mine");
    const aRow = await screen.findByRole("row", {
      name: new RegExp(A_TARGET),
    });
    expect(within(aRow).getByText(A_REASON)).toBeTruthy();

    // 401 の処理と同じく、セッションのキャッシュだけを捨てる。その後、B としてログインし直した状態にする
    sessionUser = USER_B;
    act(() => {
      client.removeQueries({ queryKey: authKeys.session });
      client.setQueryData(authKeys.session, sessionOf(USER_B, []));
    });

    // B の一覧の取得が始まり、応答が保留されている間
    await waitFor(() => expect(calls).toBe(2));
    expect(await screen.findByText("読み込み中です")).toBeTruthy();
    expect(screen.queryByText(new RegExp(A_TARGET))).toBeNull();
    expect(screen.queryByText(A_REASON)).toBeNull();

    gate.release();
    expect(
      await screen.findByRole("row", { name: new RegExp(B_TARGET) }),
    ).toBeTruthy();
    expect(screen.queryByText(new RegExp(A_TARGET))).toBeNull();
    expect(screen.queryByText(A_REASON)).toBeNull();
  });

  it("#128 C-177（U-8）・レビュー1回目（重大）: 審査の一覧（S-22 のタブ）：全体管理者 A から B に切り替えると、B の応答を待つ間は A の申請の対象・申請者を出さず、応答の後は B の申請だけを出す", async () => {
    const gate = deferred();
    let sessionUser = USER_A;
    let calls = 0;
    const permissions = ["perm.account.create"];
    server.use(
      http.get("/api/auth/session", () =>
        HttpResponse.json(sessionOf(sessionUser, permissions)),
      ),
      http.get("/api/admin/accounts", () =>
        HttpResponse.json({ items: [], nextCursor: null }),
      ),
      http.get("/api/admin/retirement-requests", async () => {
        calls += 1;
        if (calls === 1)
          return HttpResponse.json({
            items: [
              item("A2", A_TARGET, {
                requester: {
                  id: "01JTEST128CRQSTA0000000001",
                  displayName: A_REQUESTER,
                },
              }),
            ],
            nextCursor: null,
          });
        await gate.promise;
        return HttpResponse.json({
          items: [
            item("B2", B_TARGET, {
              requester: {
                id: "01JTEST128CRQSTB0000000001",
                displayName: B_REQUESTER,
              },
            }),
          ],
          nextCursor: null,
        });
      }),
    );
    const { client } = renderApp("/accounts?tab=retirement-requests");
    expect(
      await screen.findByRole("row", { name: new RegExp(A_TARGET) }),
    ).toBeTruthy();

    sessionUser = USER_B;
    act(() => {
      client.removeQueries({ queryKey: authKeys.session });
      client.setQueryData(authKeys.session, sessionOf(USER_B, permissions));
    });

    await waitFor(() => expect(calls).toBe(2));
    expect(await screen.findByText("読み込み中です")).toBeTruthy();
    expect(screen.queryByText(new RegExp(A_TARGET))).toBeNull();
    expect(screen.queryByText(A_REQUESTER)).toBeNull();

    gate.release();
    expect(
      await screen.findByRole("row", { name: new RegExp(B_TARGET) }),
    ).toBeTruthy();
    expect(screen.queryByText(new RegExp(A_TARGET))).toBeNull();
    expect(screen.queryByText(A_REQUESTER)).toBeNull();
  });
});

describe("#128（128-c）レビュー1回目（重大）：申請のキー（単体）", () => {
  it("#128 C-177・レビュー1回目（重大）: mine のキーは、利用者の ID ごとに違い、書き込み後の取り直し（all）の配下にある", () => {
    const a = retirementRequestKeys.mine(USER_A.id);
    const b = retirementRequestKeys.mine(USER_B.id);
    expect(a).not.toEqual(b);
    expect(a).toContain(USER_A.id);
    expect(a.slice(0, retirementRequestKeys.all.length)).toEqual([
      ...retirementRequestKeys.all,
    ]);
  });

  it("#128 C-177・レビュー1回目（重大）: review のキーは、利用者の ID・状態ごとに違い、all の配下にある", () => {
    const a = retirementRequestKeys.review(USER_A.id, "pending");
    const b = retirementRequestKeys.review(USER_B.id, "pending");
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(retirementRequestKeys.review(USER_A.id, "approved"));
    expect(a).toContain(USER_A.id);
    expect(a.slice(0, retirementRequestKeys.all.length)).toEqual([
      ...retirementRequestKeys.all,
    ]);
    // mine と review は別のキー
    expect(retirementRequestKeys.mine(USER_A.id)).not.toEqual(
      retirementRequestKeys.review(USER_A.id, "pending"),
    );
  });
});
