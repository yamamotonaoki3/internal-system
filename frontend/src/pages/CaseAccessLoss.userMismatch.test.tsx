// #298・#376 AC-6（計画 plan-298 改訂3 の 8-1 の「AC-6 画面」の行・2-6・2-7。利用者の決定 Q5・Q14、統括の決定 decision-298-2b）：
// S-17 を A として開いたタブで、別のタブで B がログインし（Cookie が B）、画面の利用者と通信の利用者が食い違う。
// 模擬のサーバーの利用者を B にする：ヘッダーなしは通す・A のヘッダーは 409 SESSION_USER_MISMATCH・B は通す。
// 食い違いを、資格の喪失と取り違えない：喪失としての読み込み直し（requestAccessLossReload）・合図・A の部屋の下書きの消去をしない（表示中も、離れた後も）。
//   - 409 の後の取り直しが B：切り替えの入口（requestUserSwitchReload）が1回
//   - 取り直しを保留：保留の間も、喪失として動かない
//   - 取り直しが失敗（500）：中身を隠し「ログイン状態を確認できませんでした」と再試行（Q5）
//   - 取り直しが A のまま（Cookie は B なのに、セッションの取得は A。食い違いが続く）：3回目で unknown になり、同じく中身を隠す（決定2）
// 状態 × 出来事の表（1回目）のます：文書の利用者 A・Cookie B × 経路 a（拒否の後の確かめが 409）／経路 b（概要の取り直しが 409）／離れた後の確かめが 409／
//   定期の取得の 409 × 取り直しの結果（B・保留・500・A）。
// 入口の扱い：test/setup.ts と同じく、入口を vi.fn にする（本物の入口は文書ごとに1つの状態を持ち、1ファイルに1件しか置けないため。本物は
//   features/access-loss/reload-after-access-loss.user-switch.test.ts・user-switch.reload-overlay.test.tsx で確かめる）。ただし、資格の確かめが読む
//   isUserSwitchReloadRequested は、前提にした口（切り替えの入口が呼ばれた後、文書の間ずっと真）どおりに、vi.fn の入口の呼び出しに合わせて真にする。
// 偽の時計で 2 秒の自動の更新を進める。API は MSW。データはすべて架空（testuser_298_・[UNIT_TEST]）。
import { act, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse, type HttpResponseResolver } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  requestAccessLossReload,
  requestUserSwitchReload,
} from "../features/access-loss/reload-after-access-loss";
import { installDomStubs, type DomStubs } from "../test/app-shell-harness";
import {
  caseDetail,
  caseId,
  caseRoomId,
  caseSummary,
  outsiderSummary,
} from "../test/case-handlers";
import { FakeBroadcastChannel } from "../test/fake-broadcast-channel";
import { message } from "../test/message-handlers";
import { server } from "../test/server";
import {
  disposeUserSwitchApps,
  renderUserSwitchApp,
} from "../test/user-switch-harness";

vi.mock(
  "../features/access-loss/reload-after-access-loss",
  async (importOriginal) => {
    const actual = await importOriginal<Record<string, unknown>>();
    const requested = { value: false };
    return {
      ...actual,
      requestAccessLossReload: vi.fn(() => Promise.resolve()),
      requestUserSwitchReload: vi.fn(() => {
        requested.value = true;
      }),
      isUserSwitchReloadRequested: vi.fn(() => requested.value),
      // テストの間で印を戻すための口（このファイルだけ）
      __resetUserSwitchRequested: () => {
        requested.value = false;
      },
    };
  },
);

const N = 2981;
const POLL_MS = 2_000;
const HEADER = "X-Expected-User-Id";
const CHANNEL = "internal-system:access-loss:v1";
const USER_A = {
  id: "01JTESTCASE298USERA0000001",
  displayName: "testuser_298_ca",
  loginId: "testuser_298_ca",
};
const USER_B = {
  id: "01JTESTCASE298USERB0000001",
  displayName: "testuser_298_cb",
  loginId: "testuser_298_cb",
};
type TestUser = typeof USER_A;
const A_SECRET = "[UNIT_TEST]298A の説明（参加者だけ）";
const ROOM_DRAFT = `internal-system:draft:v1:${USER_A.id}:room:${caseRoomId(N)}`;
const CHECK_FAILED = "ログイン状態を確認できませんでした。";

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

function sessionOf(user: TestUser) {
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

type SessionAnswer = "cookie" | "A" | 500;

/**
 * 模擬のサーバー。cookie は Cookie のセッションの利用者。A のヘッダーの要求は、cookie が A でなければ 409。
 * session はセッションの取得の答え（"cookie" なら cookie の利用者、"A" なら食い違いのまま A、500 なら失敗）。
 * B は、この案件の参加者ではない（ヘッダーの無い要求には、B としての非参加・403 を返す。#376 の取り違えの元）。
 */
function respondMismatchCaseWorld() {
  const world = {
    cookie: USER_A as TestUser,
    session: "cookie" as SessionAnswer,
    sessionHold: null as Promise<void> | null,
    summaryHold: null as Promise<void> | null,
    /** 次の TODO の取得に、A としての 403 を1回返し、その応答の直前に Cookie を B に替える（経路 a の契機） */
    forbidTodosOnceThenSwitch: false,
    summaryRequests: [] as (string | null)[],
  };
  const mismatched = () =>
    HttpResponse.json(
      { code: "SESSION_USER_MISMATCH", message: "[UNIT_TEST]298食い違い" },
      { status: 409 },
    );
  /** ヘッダーで断るか（断るなら応答を返す）。通すなら null */
  const gate = (request: Parameters<HttpResponseResolver>[0]["request"]) => {
    const header = request.headers.get(HEADER);
    if (header !== null && header !== world.cookie.id) return mismatched();
    return null;
  };
  const bIsServed = () => world.cookie.id === USER_B.id;
  server.use(
    http.get("/api/auth/session", async () => {
      const hold = world.sessionHold;
      if (hold !== null) await hold;
      if (world.session === 500)
        return HttpResponse.json(
          { code: "INTERNAL_ERROR", message: "x" },
          { status: 500 },
        );
      return HttpResponse.json(
        sessionOf(world.session === "A" ? USER_A : world.cookie),
      );
    }),
    http.get("/api/cases/:caseId", async ({ request }) => {
      world.summaryRequests.push(request.headers.get(HEADER));
      const hold = world.summaryHold;
      if (hold !== null) await hold;
      return (
        gate(request) ??
        HttpResponse.json(bIsServed() ? outsiderSummary(N) : caseSummary(N))
      );
    }),
    http.get(
      "/api/cases/:caseId/detail",
      ({ request }) =>
        gate(request) ??
        (bIsServed()
          ? HttpResponse.json(
              { code: "FORBIDDEN", message: "x" },
              { status: 403 },
            )
          : HttpResponse.json(caseDetail(N, { description: A_SECRET }))),
    ),
    http.get("/api/cases/:caseId/todos", ({ request }) => {
      if (world.forbidTodosOnceThenSwitch) {
        world.forbidTodosOnceThenSwitch = false;
        world.cookie = USER_B;
        return HttpResponse.json(
          { code: "FORBIDDEN", message: "x" },
          { status: 403 },
        );
      }
      return (
        gate(request) ??
        HttpResponse.json({ items: [], nextCursor: null, progress: null })
      );
    }),
    http.get(
      "/api/rooms/:roomId/messages",
      ({ request }) =>
        gate(request) ??
        HttpResponse.json({
          items: [
            message(1, { roomId: caseRoomId(N), body: "[UNIT_TEST]298本文" }),
          ],
          nextCursor: null,
          hasMore: false,
        }),
    ),
  );
  return world;
}

function shows(text: string): boolean {
  return document.body.textContent?.includes(text) ?? false;
}

/** 喪失と取り違えていない：喪失の読み込み直し・合図・下書きの消去が無い */
function expectNotTakenAsLoss() {
  expect(requestAccessLossReload).not.toHaveBeenCalled();
  expect(FakeBroadcastChannel.sent(CHANNEL)).toEqual([]);
  expect(window.localStorage.getItem(ROOM_DRAFT)).not.toBeNull();
  expect(window.sessionStorage.length).toBe(0);
}

let stubs: DomStubs;

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  stubs = installDomStubs();
  vi.mocked(requestAccessLossReload).mockClear();
  vi.mocked(requestUserSwitchReload).mockClear();
  const mocked =
    (await import("../features/access-loss/reload-after-access-loss")) as unknown as {
      __resetUserSwitchRequested: () => void;
    };
  mocked.__resetUserSwitchRequested();
  FakeBroadcastChannel.clearSent();
  window.localStorage.setItem(
    ROOM_DRAFT,
    JSON.stringify({
      body: "[UNIT_TEST]298A の書きかけ",
      updatedAt: Date.now(),
    }),
  );
});
afterEach(() => {
  disposeUserSwitchApps();
  stubs.restore();
  vi.useRealTimers();
});

/** A として S-17 を開き、参加者の中身が出るまで待つ */
async function openAsA() {
  const world = respondMismatchCaseWorld();
  const app = renderUserSwitchApp(`/cases/${caseId(N)}`, { needles: [] });
  await waitFor(() => expect(shows(A_SECRET)).toBe(true));
  return { world, app };
}

describe("#298・#376 AC-6 S-17 を A で開いたまま、Cookie が B になる", () => {
  it("#376 AC-6 定期の取得の 409 → 取り直しが B：切り替えの入口が1回。喪失の読み込み直し・合図・下書きの消去が無い", async () => {
    const { world } = await openAsA();
    world.cookie = USER_B;
    await advance(POLL_MS);
    await waitFor(() =>
      expect(requestUserSwitchReload).toHaveBeenCalledTimes(1),
    );
    await advance(POLL_MS);
    expect(requestUserSwitchReload).toHaveBeenCalledTimes(1);
    expectNotTakenAsLoss();
  });

  it("#376 AC-6 経路 a（表示中）: A としての 403 の直後に Cookie が B になり、確かめの概要の取り直しが 409：取り直しが B を返して切り替え。喪失として扱わない", async () => {
    const { world } = await openAsA();
    world.forbidTodosOnceThenSwitch = true;
    const before = world.summaryRequests.length;
    await advance(POLL_MS);
    await waitFor(() =>
      expect(world.summaryRequests.length).toBeGreaterThan(before),
    );
    // 確かめの取り直しは A のヘッダーで送られる（だから 409 になる）
    expect(world.summaryRequests.slice(before)).toContain(USER_A.id);
    await waitFor(() =>
      expect(requestUserSwitchReload).toHaveBeenCalledTimes(1),
    );
    await advance(POLL_MS);
    expectNotTakenAsLoss();
  });

  it("#376 AC-6 経路 a（画面を離れた後）: 確かめの概要の取り直しを保留したまま画面を離れ、その後 409 → 取り直しが B：喪失として扱わない", async () => {
    const { world, app } = await openAsA();
    const summaryGate = deferred();
    world.summaryHold = summaryGate.promise;
    world.forbidTodosOnceThenSwitch = true;
    const before = world.summaryRequests.length;
    await advance(POLL_MS);
    await waitFor(() =>
      expect(world.summaryRequests.length).toBeGreaterThan(before),
    );
    await act(async () => {
      await app.router.navigate("/channels");
    });
    world.summaryHold = null;
    summaryGate.release();
    await waitFor(() =>
      expect(requestUserSwitchReload).toHaveBeenCalledTimes(1),
    );
    await advance(POLL_MS);
    expectNotTakenAsLoss();
  });

  it("#376 AC-6 経路 b: Cookie が B のときに、A の画面の概要を取り直しても 409 で、B としての非参加が A の概要に書かれず、(b) の喪失が動かない", async () => {
    const { world, app } = await openAsA();
    world.cookie = USER_B;
    await act(async () => {
      await app.client.refetchQueries({
        predicate: (query) =>
          query.queryKey[0] === "cases" && query.queryKey[1] === "summary",
      });
    });
    await waitFor(() =>
      expect(requestUserSwitchReload).toHaveBeenCalledTimes(1),
    );
    expect(
      app.client.getQueryData(["cases", "summary", USER_A.id, caseId(N)]),
    ).not.toMatchObject({ isParticipant: false });
    await advance(POLL_MS);
    expectNotTakenAsLoss();
  });

  it("#376 AC-6: 409 の後の取り直しを保留している間は、喪失として動かない。保留を解き B が返ると、切り替えの入口が1回", async () => {
    const { world } = await openAsA();
    const sessionGate = deferred();
    world.sessionHold = sessionGate.promise;
    world.cookie = USER_B;
    world.forbidTodosOnceThenSwitch = false;
    await advance(POLL_MS);
    await advance(POLL_MS);
    expect(requestUserSwitchReload).not.toHaveBeenCalled();
    expectNotTakenAsLoss();
    world.sessionHold = null;
    sessionGate.release();
    await waitFor(() =>
      expect(requestUserSwitchReload).toHaveBeenCalledTimes(1),
    );
    expectNotTakenAsLoss();
  });

  it("#298 AC-4・AC-6（Q5）: 409 の後の取り直しが失敗（500）：中身を隠し「ログイン状態を確認できませんでした」と再試行を出す。喪失として扱わず、切り替えの入口も呼ばない", async () => {
    const { world } = await openAsA();
    world.cookie = USER_B;
    world.session = 500;
    await advance(POLL_MS);
    await waitFor(() => expect(shows(CHECK_FAILED)).toBe(true));
    expect(shows(A_SECRET)).toBe(false);
    expect(screen.getByRole("button", { name: "再試行" })).toBeTruthy();
    expect(requestUserSwitchReload).not.toHaveBeenCalled();
    expectNotTakenAsLoss();
  });

  it("#298 AC-6（決定2）: 409 の後の取り直しが A のまま（食い違いが続く）：3回目で unknown になり、中身を隠して「ログイン状態を確認できませんでした」と再試行を出す。喪失として扱わない", async () => {
    const { world } = await openAsA();
    world.cookie = USER_B;
    world.session = "A";
    // 2 秒ごとの定期の取得の 409 で、取り直しが続く。3回目の same で unknown になるまで進める（上限は余裕をもって8回）
    for (let n = 0; n < 8 && !shows(CHECK_FAILED); n += 1)
      await advance(POLL_MS);
    await waitFor(() => expect(shows(CHECK_FAILED)).toBe(true));
    expect(shows(A_SECRET)).toBe(false);
    expect(screen.getByRole("button", { name: "再試行" })).toBeTruthy();
    expect(requestUserSwitchReload).not.toHaveBeenCalled();
    expectNotTakenAsLoss();
  });
});
