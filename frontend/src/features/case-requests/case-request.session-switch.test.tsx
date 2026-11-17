// #146（146-B）コードレビュー1回目（重大）：利用者の切り替えをまたいで、前の利用者の申請が表示されない。
// 401 の処理（unauthenticated-handler）はセッションのキャッシュだけを捨て、ほかのキャッシュは残す（0-2 AC-8）。
// そのため、案件の申請のキー（審査の一覧・自分の申請の一覧）にログイン中の利用者の ID を含め、ID が確かめられる前は取得しない
// （5-3 の審査範囲・本人限定。Skill「security」「frontend-state」）。先例：retirement-requests/retirement-request.session-switch.test.tsx。
// 同じ QueryClient で、利用者 A → B に切り替え、B の応答を待つ間にも A の申請が出ないことを確かめる。
// 同じ利用者の中で状態を切り替えたときは、既存の動き（新しい一覧が届くまで前の一覧を残す）が保たれることも確かめる。
// 応答の保留は、解決を手で制御する（固定の時間の待ちは使わない）。データはすべて架空。
import { act, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authKeys } from "../auth/api/query-keys";
import {
  installDomStubs,
  renderApp,
  type DomStubs,
} from "../../test/app-shell-harness";
import {
  APPROVE_PERMISSION,
  reviewCaseRequest,
} from "../../test/case-approval-handlers";
import { respondChoices } from "../../test/case-request-handlers";
import { server } from "../../test/server";
import { caseRequestKeys } from "./api/query-keys";

const USER_A = {
  id: "01JTEST146BSESSA0000000001",
  displayName: "testuser_146b_a",
  loginId: "testuser_146b_a",
};
const USER_B = {
  id: "01JTEST146BSESSB0000000001",
  displayName: "testuser_146b_b",
  loginId: "testuser_146b_b",
};
const A_TITLE = "[UNIT_TEST]146bAの申請の件名";
const B_TITLE = "[UNIT_TEST]146bBの申請の件名";
const A_REQUESTER = "テスト申請者146bA";
const B_REQUESTER = "テスト申請者146bB";
const A_CANDIDATE = "テスト候補146bA";

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

describe("#146（146-B）レビュー1回目（重大）：利用者の切り替えと申請のキー", () => {
  it("#146 5-3 AC-3・S-29・レビュー1回目（重大）: 審査の一覧：オーナー A から B に切り替えると、B の応答を待つ間は A の申請の件名・申請者・候補を出さず、応答の後は B の申請だけを出す", async () => {
    const gate = deferred();
    let sessionUser = USER_A;
    let calls = 0;
    const permissions = [APPROVE_PERMISSION];
    server.use(
      http.get("/api/auth/session", () =>
        HttpResponse.json(sessionOf(sessionUser, permissions)),
      ),
      http.get("/api/case-requests", async () => {
        calls += 1;
        if (calls === 1)
          return HttpResponse.json({
            items: [
              reviewCaseRequest("A1", {
                title: A_TITLE,
                requesterDisplayName: A_REQUESTER,
                candidates: [
                  {
                    userId: "01JTEST146BCAND00000000001",
                    displayName: A_CANDIDATE,
                    isActive: true,
                  },
                ],
              }),
            ],
            nextCursor: null,
          });
        await gate.promise;
        return HttpResponse.json({
          items: [
            reviewCaseRequest("B1", {
              title: B_TITLE,
              requesterDisplayName: B_REQUESTER,
            }),
          ],
          nextCursor: null,
        });
      }),
    );
    const { client } = renderApp("/case-approvals");
    expect(await screen.findByText(A_TITLE)).toBeTruthy();
    expect(screen.getByText(new RegExp(A_REQUESTER))).toBeTruthy();

    // 401 の処理と同じく、セッションのキャッシュだけを捨てる。その後、B としてログインし直した状態にする
    sessionUser = USER_B;
    act(() => {
      client.removeQueries({ queryKey: authKeys.session });
      client.setQueryData(authKeys.session, sessionOf(USER_B, permissions));
    });

    // B の一覧の取得が始まり、応答が保留されている間
    await waitFor(() => expect(calls).toBe(2));
    expect(await screen.findByText("読み込み中です")).toBeTruthy();
    expect(screen.queryByText(A_TITLE)).toBeNull();
    expect(screen.queryByText(new RegExp(A_REQUESTER))).toBeNull();
    expect(screen.queryByText(new RegExp(A_CANDIDATE))).toBeNull();

    gate.release();
    expect(await screen.findByText(B_TITLE)).toBeTruthy();
    expect(screen.getByText(new RegExp(B_REQUESTER))).toBeTruthy();
    expect(screen.queryByText(A_TITLE)).toBeNull();
    expect(screen.queryByText(new RegExp(A_REQUESTER))).toBeNull();
  });

  it("#146 5-1 AC-6・S-18・レビュー1回目（重大）: 自分の申請：A から B に切り替えると、B の応答を待つ間は A の申請の件名を出さず、応答の後は B の申請だけを出す", async () => {
    const gate = deferred();
    let sessionUser = USER_A;
    let calls = 0;
    respondChoices();
    server.use(
      http.get("/api/auth/session", () =>
        HttpResponse.json(sessionOf(sessionUser, [])),
      ),
      http.get("/api/case-requests/mine", async () => {
        calls += 1;
        if (calls === 1)
          return HttpResponse.json({
            items: [reviewCaseRequest("A2", { title: A_TITLE })],
            nextCursor: null,
          });
        await gate.promise;
        return HttpResponse.json({
          items: [reviewCaseRequest("B2", { title: B_TITLE })],
          nextCursor: null,
        });
      }),
    );
    const { client } = renderApp("/case-requests");
    expect(await screen.findByText(A_TITLE)).toBeTruthy();

    sessionUser = USER_B;
    act(() => {
      client.removeQueries({ queryKey: authKeys.session });
      client.setQueryData(authKeys.session, sessionOf(USER_B, []));
    });

    await waitFor(() => expect(calls).toBe(2));
    expect(await screen.findByText("読み込み中です")).toBeTruthy();
    expect(screen.queryByText(A_TITLE)).toBeNull();

    gate.release();
    expect(await screen.findByText(B_TITLE)).toBeTruthy();
    expect(screen.queryByText(A_TITLE)).toBeNull();
  });

  it("#146 S-29・レビュー1回目（重大）: 同じ利用者の中で状態を切り替えたときは、新しい一覧が届くまで前の一覧を残す（読み込み中の表示にしない）", async () => {
    const gate = deferred();
    const permissions = [APPROVE_PERMISSION];
    server.use(
      http.get("/api/auth/session", () =>
        HttpResponse.json(sessionOf(USER_A, permissions)),
      ),
      http.get("/api/case-requests", async ({ request }) => {
        if (new URL(request.url).searchParams.get("status") === "rejected") {
          await gate.promise;
          return HttpResponse.json({
            items: [
              reviewCaseRequest("A3", {
                title: B_TITLE,
                status: "rejected",
                canApprove: false,
                rejectReason: "理由146b",
              }),
            ],
            nextCursor: null,
          });
        }
        return HttpResponse.json({
          items: [reviewCaseRequest("A1", { title: A_TITLE })],
          nextCursor: null,
        });
      }),
    );
    const { user } = renderApp("/case-approvals");
    expect(await screen.findByText(A_TITLE)).toBeTruthy();

    await user.selectOptions(
      screen.getByRole("combobox", { name: "状態" }),
      "却下",
    );
    // 応答が保留されている間も、同じ利用者の前の一覧は残る
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "状態" })).toHaveProperty(
        "value",
        "rejected",
      ),
    );
    expect(screen.getByText(A_TITLE)).toBeTruthy();
    expect(screen.queryByText("読み込み中です")).toBeNull();

    gate.release();
    expect(await screen.findByText(B_TITLE)).toBeTruthy();
    expect(screen.queryByText(A_TITLE)).toBeNull();
  });
});

describe("#146（146-B）レビュー1回目（重大）：案件の申請のキー（単体）", () => {
  it("#146 レビュー1回目（重大）: mine のキーは、利用者の ID ごとに違い、書き込み後の取り直し（all）の配下にある", () => {
    const a = caseRequestKeys.mine(USER_A.id);
    const b = caseRequestKeys.mine(USER_B.id);
    expect(a).not.toEqual(b);
    expect(a).toContain(USER_A.id);
    expect(a.slice(0, caseRequestKeys.all.length)).toEqual([
      ...caseRequestKeys.all,
    ]);
  });

  it("#146 レビュー1回目（重大）: review のキーは、利用者の ID・状態ごとに違い、all の配下にある", () => {
    const a = caseRequestKeys.review(USER_A.id, "pending");
    expect(a).not.toEqual(caseRequestKeys.review(USER_B.id, "pending"));
    expect(a).not.toEqual(caseRequestKeys.review(USER_A.id, "rejected"));
    expect(a).toContain(USER_A.id);
    expect(a.slice(0, caseRequestKeys.all.length)).toEqual([
      ...caseRequestKeys.all,
    ]);
    // mine と review は別のキー
    expect(caseRequestKeys.mine(USER_A.id)).not.toEqual(a);
  });
});
