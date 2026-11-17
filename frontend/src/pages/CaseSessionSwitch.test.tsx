// #147（147-A）キャッシュ（計画 147-A の画面「キャッシュ」）：利用者を切り替えたとき、前の利用者の案件の一覧・概要・詳細が一瞬も出ないこと。
// 401 の処理（unauthenticated-handler）はセッションのキャッシュだけを捨て、ほかのキャッシュは残す（0-2 AC-8）。そのため、案件のキーに利用者の ID を含め、
// ID が確かめられる前は取得しない（Skill「security」「frontend-state」）。先例：features/case-requests/case-request.session-switch.test.tsx。
// 契約（実装の担当へ。テストが決めたもの）：
//   features/cases/index.ts が caseKeys を公開する：
//     caseKeys = { all: ["cases"], list(userId, scope, status), summary(userId, caseId), detail(userId, caseId) }
//     list・summary・detail は all の配下で、利用者の ID を含み、利用者・引数ごとに違う
//   前のデータを残すのは同じ利用者のときだけ（placeholderData で判定）。
// 応答の保留は、解決を手で制御する（固定の時間の待ちは使わない）。データはすべて架空。
import { act, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authKeys } from "../features/auth";
import { caseKeys } from "../features/cases";
import {
  installDomStubs,
  renderApp,
  type DomStubs,
} from "../test/app-shell-harness";
import { caseDetail, caseId, caseSummary } from "../test/case-handlers";
import { server } from "../test/server";

const USER_A = {
  id: "01JTESTCASE147AVSERA00001A",
  displayName: "testuser_147a_a",
  loginId: "testuser_147a_a",
};
const USER_B = {
  id: "01JTESTCASE147AVSERB00001A",
  displayName: "testuser_147a_b",
  loginId: "testuser_147a_b",
};
const A_TITLE = "[UNIT_TEST]147A利用者Aの案件";
const B_TITLE = "[UNIT_TEST]147A利用者Bの案件";
const A_DESCRIPTION = "[UNIT_TEST]147A利用者Aだけの説明";

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
    permissions: [],
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

describe("#147 147-A キャッシュ：利用者の切り替え", () => {
  it("#147 キャッシュ: S-16 で A から B に切り替えると、B の応答を待つ間は A の案件を（一覧にもサイドバーにも）出さず、応答の後は B の案件だけを出す", async () => {
    const gate = deferred();
    let sessionUser = USER_A;
    server.use(
      http.get("/api/auth/session", () =>
        HttpResponse.json(sessionOf(sessionUser)),
      ),
      http.get("/api/cases", async () => {
        if (sessionUser === USER_A)
          return HttpResponse.json({
            items: [caseSummary(1, { title: A_TITLE })],
            nextCursor: null,
          });
        await gate.promise;
        return HttpResponse.json({
          items: [caseSummary(2, { title: B_TITLE })],
          nextCursor: null,
        });
      }),
    );
    const { client } = renderApp("/cases");
    // ログイン状態の確認中の main は枠の main に置き換わるため、枠のメニューが出てから main を取る
    await screen.findByRole("navigation", { name: "メインメニュー" });
    const main = screen.getByRole("main");
    expect(
      await within(main).findByRole("link", { name: A_TITLE }),
    ).toBeTruthy();

    sessionUser = USER_B;
    act(() => {
      client.removeQueries({ queryKey: authKeys.session });
      client.setQueryData(authKeys.session, sessionOf(USER_B));
    });

    expect(await screen.findByText("読み込み中です")).toBeTruthy();
    expect(screen.queryByText(A_TITLE)).toBeNull();
    expect(
      screen.queryAllByRole("link", { name: new RegExp("147A利用者Aの案件") }),
    ).toHaveLength(0);

    gate.release();
    expect(
      await within(screen.getByRole("main")).findByRole("link", {
        name: B_TITLE,
      }),
    ).toBeTruthy();
    expect(screen.queryByText(A_TITLE)).toBeNull();
  });

  it("#147 キャッシュ: S-17 で A から B に切り替えると、B の応答を待つ間に A の説明・件名を出さない", async () => {
    const gate = deferred();
    let sessionUser = USER_A;
    server.use(
      http.get("/api/auth/session", () =>
        HttpResponse.json(sessionOf(sessionUser)),
      ),
      http.get("/api/cases/:caseId/detail", async () => {
        if (sessionUser === USER_A)
          return HttpResponse.json(
            caseDetail(1, { title: A_TITLE, description: A_DESCRIPTION }),
          );
        await gate.promise;
        return HttpResponse.json(
          { code: "FORBIDDEN", message: "参加者だけが見られます（非公開）" },
          { status: 403 },
        );
      }),
      http.get("/api/cases/:caseId", async () => {
        if (sessionUser === USER_A)
          return HttpResponse.json(caseSummary(1, { title: A_TITLE }));
        await gate.promise;
        return HttpResponse.json(
          caseSummary(1, {
            title: A_TITLE,
            isParticipant: false,
            participantCount: null,
          }),
        );
      }),
    );
    const { client } = renderApp(`/cases/${caseId(1)}`);
    expect(await screen.findByText(A_DESCRIPTION)).toBeTruthy();

    sessionUser = USER_B;
    act(() => {
      client.removeQueries({ queryKey: authKeys.session });
      client.setQueryData(authKeys.session, sessionOf(USER_B));
    });

    await waitFor(() => expect(screen.queryByText(A_DESCRIPTION)).toBeNull());
    expect(screen.queryByRole("list", { name: "参加者" })).toBeNull();

    gate.release();
    expect(
      await screen.findByText("参加者だけが見られます（非公開）"),
    ).toBeTruthy();
    expect(screen.queryByText(A_DESCRIPTION)).toBeNull();
  });

  it("#147 キャッシュ: 利用者の ID が確かめられる前は、案件の一覧・概要・詳細の要求を送らない", async () => {
    const gate = deferred();
    let caseCalls = 0;
    server.use(
      http.get("/api/auth/session", async () => {
        await gate.promise;
        return HttpResponse.json(sessionOf(USER_A));
      }),
      http.get("/api/cases", () => {
        caseCalls += 1;
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
      http.get("/api/cases/:caseId", () => {
        caseCalls += 1;
        return HttpResponse.json(caseSummary(1));
      }),
      http.get("/api/cases/:caseId/detail", () => {
        caseCalls += 1;
        return HttpResponse.json(caseDetail(1));
      }),
    );
    renderApp(`/cases/${caseId(1)}`);
    // セッションの応答を保留している間
    await act(async () => {
      await Promise.resolve();
    });
    expect(caseCalls).toBe(0);

    gate.release();
    await waitFor(() => expect(caseCalls).toBeGreaterThan(0));
    // 概要と詳細の取得が終わってから終える（テストの後に要求が残らないように）
    expect(await screen.findByText("[UNIT_TEST]147A案件1の説明")).toBeTruthy();
  });

  it("#147 キャッシュ: 同じ利用者の中で表示する案件を切り替えたときは、新しい一覧が届くまで前の一覧を残す（読み込み中の表示にしない）", async () => {
    const gate = deferred();
    server.use(
      http.get("/api/auth/session", () => HttpResponse.json(sessionOf(USER_A))),
      http.get("/api/cases", async ({ request }) => {
        if (new URL(request.url).searchParams.get("scope") === "all") {
          await gate.promise;
          return HttpResponse.json({
            items: [caseSummary(2, { title: B_TITLE })],
            nextCursor: null,
          });
        }
        return HttpResponse.json({
          items: [caseSummary(1, { title: A_TITLE })],
          nextCursor: null,
        });
      }),
    );
    const { user } = renderApp("/cases");
    // ログイン状態の確認中の main は枠の main に置き換わるため、枠のメニューが出てから main を取る
    await screen.findByRole("navigation", { name: "メインメニュー" });
    const main = screen.getByRole("main");
    await within(main).findByRole("link", { name: A_TITLE });
    await user.click(screen.getByRole("radio", { name: "すべての案件" }));
    expect(
      (screen.getByRole("radio", { name: "すべての案件" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect(within(main).getByRole("link", { name: A_TITLE })).toBeTruthy();
    expect(within(main).queryByText("読み込み中です")).toBeNull();

    gate.release();
    expect(
      await within(main).findByRole("link", { name: B_TITLE }),
    ).toBeTruthy();
  });
});

describe("#147 147-A キャッシュ：案件のキー（単体）", () => {
  it("#147 キャッシュ: list のキーは、利用者・scope・status ごとに違い、利用者の ID を含み、all の配下にある", () => {
    const a = caseKeys.list(USER_A.id, "joined", "active");
    expect(a).not.toEqual(caseKeys.list(USER_B.id, "joined", "active"));
    expect(a).not.toEqual(caseKeys.list(USER_A.id, "all", "active"));
    expect(a).not.toEqual(caseKeys.list(USER_A.id, "joined", "closed"));
    expect(a).toContain(USER_A.id);
    expect(a.slice(0, caseKeys.all.length)).toEqual([...caseKeys.all]);
  });

  it("#147 キャッシュ: summary・detail のキーは、利用者・案件ごとに違い、利用者の ID を含み、all の配下にある。summary と detail は別のキー", () => {
    for (const key of [caseKeys.summary, caseKeys.detail]) {
      const a = key(USER_A.id, caseId(1));
      expect(a).not.toEqual(key(USER_B.id, caseId(1)));
      expect(a).not.toEqual(key(USER_A.id, caseId(2)));
      expect(a).toContain(USER_A.id);
      expect(a.slice(0, caseKeys.all.length)).toEqual([...caseKeys.all]);
    }
    expect(caseKeys.summary(USER_A.id, caseId(1))).not.toEqual(
      caseKeys.detail(USER_A.id, caseId(1)),
    );
  });
});
