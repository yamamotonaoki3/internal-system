// #342 AC-1〜AC-9（計画 plan342a2 の 7 節の V1〜V4）：画面の接続の確かめ。復元の守り（main.tsx と同じ組み立て）・境界・実際の画面
// （S-17 の案件の画面・S-35 のスレッド一覧）・共通の確定の入口・切り替えの入口・離脱の確認をつなぐ。
// 判定と分岐の網羅は、単体（page-restore-guard.test.tsx・case-access-loss-monitor.restore.test.ts など）に任せ、ここでは部品の間の接続と、入力の保持だけを見る。
// 合成した pagehide・pageshow は、実際の bfcache の保存・復元の証拠ではない（実復元は E2E と通常のブラウザでの確かめ）。
// 読み込み直しの状態は、このファイルで、手で切り替えられる差し替えにする（本物は idle から戻れないため）。入口は vi.fn。
// 実際の読み込み直し（location）は browser-location の差し替えで数える。データはすべて架空（testuser_・[UNIT_TEST]・[E2E_TEST]）。
// 前提にした口（実装の担当へ）：test/page-restore-harness.tsx の冒頭と同じ。失敗の案内と「再試行」のボタン
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AccessLossBoundary,
  requestAccessLossReload,
  requestUserSwitchReload,
} from "../features/access-loss";
import { reloadPage } from "../features/access-loss/browser-location";
import { getPageRestoreState } from "../features/access-loss/page-restore-guard";
import { RequireAuth } from "../features/auth/components/RequireAuth";
import { restoreBeforeUnload } from "../features/leave-guard";
import { TEST_USER } from "../test/auth-handlers";
import {
  PARTICIPANT_CREATOR,
  caseDetail,
  caseId,
  caseRoomId,
} from "../test/case-handlers";
import { respondTodos, todoItem } from "../test/case-todo-handlers";
import {
  FakeBroadcastChannel,
  flushTasks,
} from "../test/fake-broadcast-channel";
import {
  RESTORE_FAILED_TEXT,
  RESTORE_OTHER_USER,
  RETRY_BUTTON,
  cacheParticipantSummary,
  firePageHide,
  firePageShow,
  gate,
  installRestoreGuardLikeMain,
  isCovered,
  isUncovered,
  newRestoreClient,
  respondRestoreWorld,
  waitForSessionAnswered,
  type RestoreWorld,
} from "../test/page-restore-harness";
import { server } from "../test/server";
import { respondMyThreads, threadItem } from "../test/thread-handlers";
import { renderInApp } from "../test/thread-harness";
import { CaseDetailPage } from "./CaseDetailPage";
import { ThreadsPage } from "./ThreadsPage";

const reloadState = vi.hoisted(() => {
  let value: "idle" | "waiting" | "reloading" = "idle";
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: "idle" | "waiting" | "reloading") {
      value = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
});

vi.mock(
  "../features/access-loss/reload-after-access-loss",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    requestAccessLossReload: vi.fn(() => Promise.resolve()),
    requestUserSwitchReload: vi.fn(),
    noteDraftsRemain: vi.fn(),
    getAccessLossReloadState: reloadState.get,
    subscribeAccessLossReloadState: reloadState.subscribe,
    retryReloadNavigationAfterPageRestore: vi.fn(),
  }),
);
vi.mock("../features/access-loss/browser-location", () => ({
  reloadPage: vi.fn(),
  replacePage: vi.fn(),
}));

const USER = TEST_USER.id;
const CHANNEL = "internal-system:access-loss:v1";
const SECRET = "[UNIT_TEST]342案件の画面の説明";
const TYPED = "342書きかけ";
const roomDraftKey = (n: number) =>
  `internal-system:draft:v1:${USER}:room:${caseRoomId(n)}`;
const announced = () => FakeBroadcastChannel.sent(CHANNEL);
/** スレッド一覧の1件目の親の本文（test/thread-handlers.ts の threadItem の既定） */
const LIST_PARENT_TEXT = "[E2E_TEST]親1";

beforeEach(() => {
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
  vi.stubGlobal("reportError", vi.fn());
  FakeBroadcastChannel.clearSent();
  reloadState.set("idle");
  vi.mocked(requestAccessLossReload).mockClear();
  vi.mocked(requestUserSwitchReload).mockClear();
  vi.mocked(reloadPage).mockClear();
});
afterEach(() => {
  // 守りの読み込み直しが立てた、離脱の確認の抑止を、次のテストに持ち越さない
  restoreBeforeUnload();
  vi.unstubAllGlobals();
});

function writeDraft(key: string) {
  window.localStorage.setItem(
    key,
    JSON.stringify({
      body: "[UNIT_TEST]342保存済みの下書き",
      updatedAt: Date.now(),
    }),
  );
}

/** 境界の包み：描画の入れ物の直下の要素のうち、画面の中身（text）を含むもの */
function wrapperContaining(container: HTMLElement, text: string): HTMLElement {
  const node = screen.getByText(text);
  const wrapper = [...container.children].find((child) => child.contains(node));
  if (!(wrapper instanceof HTMLElement))
    throw new Error("境界の包みがありません");
  return wrapper;
}

type CasePage = {
  world: RestoreWorld;
  composer: () => HTMLTextAreaElement | HTMLInputElement;
  wrapper: HTMLElement;
  baseline: { session: number; summary: number };
};

/** S-17（参加者）を、境界・守りと一緒に描画し、表示が落ち着くまで待つ */
async function renderCasePage(n: number): Promise<CasePage> {
  respondTodos([todoItem(1)]);
  const world = respondRestoreWorld();
  world.addCase(n);
  server.use(
    http.get("/api/cases/:caseId/detail", () =>
      HttpResponse.json(
        caseDetail(n, {
          description: SECRET,
          participants: [PARTICIPANT_CREATOR],
        }),
      ),
    ),
    http.get("/api/rooms/:roomId/messages", () =>
      HttpResponse.json({ items: [], nextCursor: null, hasMore: false }),
    ),
    http.put(
      "/api/rooms/:roomId/read-position",
      () => new HttpResponse(null, { status: 204 }),
    ),
  );
  const client = newRestoreClient();
  installRestoreGuardLikeMain(client);
  const { container } = render(
    <QueryClientProvider client={client}>
      <AccessLossBoundary>
        <MemoryRouter initialEntries={[`/cases/${caseId(n)}`]}>
          <Routes>
            <Route path="/cases/:caseId" element={<CaseDetailPage />} />
          </Routes>
        </MemoryRouter>
      </AccessLossBoundary>
    </QueryClientProvider>,
  );
  await screen.findByText(SECRET);
  await screen.findByRole("textbox", { name: "メッセージ" });
  await flushTasks(5);
  const wrapper = wrapperContaining(container, SECRET);
  return {
    world,
    composer: () =>
      screen.getByRole("textbox", { name: "メッセージ", hidden: true }) as
        HTMLTextAreaElement | HTMLInputElement,
    wrapper,
    baseline: {
      session: world.session.calls,
      summary: world.summaryCalls.length,
    },
  };
}

const newSummaryCalls = (page: CasePage) =>
  page.world.summaryCalls.slice(page.baseline.summary);

async function restoreAndWait(page: CasePage) {
  firePageHide(true);
  expect(isCovered(page.wrapper)).toBe(true);
  firePageShow(true);
  await waitForSessionAnswered(page.world, page.baseline.session + 1);
}

describe("#342 AC-1・AC-4 V1 資格があれば、実際の入力を保ったまま外す", () => {
  it("#342 AC-1・AC-4 V1: S-17 で入力したまま離れて戻ると、確かめの間は隠れ、参加者と確かめた後に外れる。入力欄は同じ要素で、入力は残る", async () => {
    const page = await renderCasePage(3431);
    const input = page.composer();
    await userEvent.setup().type(input, TYPED);
    const held = gate();
    page.world.session.gates.push(held.promise);
    firePageHide(true);
    expect(isCovered(page.wrapper)).toBe(true);
    firePageShow(true);
    await waitFor(() =>
      expect(page.world.session.calls).toBe(page.baseline.session + 1),
    );
    expect(isCovered(page.wrapper)).toBe(true);
    held.release();
    await waitFor(() => expect(isUncovered(page.wrapper)).toBe(true));
    expect(page.composer()).toBe(input);
    expect(input.value).toBe(TYPED);
    expect(newSummaryCalls(page)).toEqual([caseId(3431)]);
    expect(requestAccessLossReload).not.toHaveBeenCalled();
    expect(reloadPage).not.toHaveBeenCalled();
  });
});

describe("#342 AC-2・AC-3・AC-5 V2 共通の確定・切り替えの入口へつなぐ", () => {
  it("#342 AC-5 V2: S-17 で戻ったときの概要が非参加なら、共通の確定（入口・合図・その部屋の下書きの消去）へ進み、覆ったまま", async () => {
    const page = await renderCasePage(3432);
    writeDraft(roomDraftKey(3432));
    page.world.caseOf(caseId(3432)).answers.push({ kind: "outsider" });
    await restoreAndWait(page);
    await waitFor(() =>
      expect(requestAccessLossReload).toHaveBeenCalledWith(expect.anything(), {
        ownerId: USER,
        reason: "lost",
      }),
    );
    await waitFor(() =>
      expect(window.localStorage.getItem(roomDraftKey(3432))).toBeNull(),
    );
    expect(announced()).toEqual([{ v: 1, userId: USER, caseId: caseId(3432) }]);
    expect(isCovered(page.wrapper)).toBe(true);
  });

  it("#342 AC-3 V2: S-17 で戻ったときのセッションが別の利用者なら、切り替えの入口を1回呼び、案件を確かめない（喪失の入口・合図・下書きの消去なし）", async () => {
    const page = await renderCasePage(3433);
    writeDraft(roomDraftKey(3433));
    page.world.session.answers.push({ kind: "user", user: RESTORE_OTHER_USER });
    await restoreAndWait(page);
    await waitFor(() =>
      expect(requestUserSwitchReload).toHaveBeenCalledTimes(1),
    );
    await flushTasks(3);
    expect(newSummaryCalls(page)).toEqual([]);
    expect(requestAccessLossReload).not.toHaveBeenCalled();
    expect(announced()).toEqual([]);
    expect(window.localStorage.getItem(roomDraftKey(3433))).not.toBeNull();
    expect(isCovered(page.wrapper)).toBe(true);
  });

  it("#342 AC-2・AC-5 V2: S-17 を開かず、概要を取得していない S-35 で、一覧の複数の案件と、別の画面で取得した参加者の概要を、全件確かめる。非参加の案件だけを共通の確定へ渡す", async () => {
    const [A, B, C] = [3434, 3435, 3436];
    const world = respondRestoreWorld();
    world.addCase(A);
    world.addCase(B, { kind: "outsider" });
    world.addCase(C);
    respondMyThreads(
      [A, B].map((n, index) =>
        threadItem(index + 1, {
          room: {
            kind: "channel",
            id: caseRoomId(n),
            name: `[E2E_TEST]342案件の部屋${n}`,
          },
          caseId: caseId(n),
        }),
      ),
    );
    for (const n of [A, B]) writeDraft(roomDraftKey(n));
    const client = newRestoreClient();
    // 別の画面（S-17 など）で取得した参加者の概要が、キャッシュに残っている
    cacheParticipantSummary(client, C);
    installRestoreGuardLikeMain(client);
    const { container } = renderInApp(
      <AccessLossBoundary>
        <ThreadsPage />
      </AccessLossBoundary>,
      { path: "/threads", client },
    );
    expect(await screen.findByText(LIST_PARENT_TEXT)).toBeTruthy();
    const wrapper = wrapperContaining(container, LIST_PARENT_TEXT);
    expect(world.summaryCalls).toEqual([]);
    firePageHide(true);
    firePageShow(true);
    await waitFor(() =>
      expect(requestAccessLossReload).toHaveBeenCalledWith(expect.anything(), {
        ownerId: USER,
        reason: "lost",
      }),
    );
    await waitFor(() =>
      expect([...world.summaryCalls].sort()).toEqual(
        [caseId(A), caseId(B), caseId(C)].sort(),
      ),
    );
    expect(announced()).toEqual([{ v: 1, userId: USER, caseId: caseId(B) }]);
    await waitFor(() =>
      expect(window.localStorage.getItem(roomDraftKey(B))).toBeNull(),
    );
    expect(window.localStorage.getItem(roomDraftKey(A))).not.toBeNull();
    expect(isCovered(wrapper)).toBe(true);
  });
});

describe("#342 AC-8・AC-9・AC-10 V3 401・読み込み直しの最中・離脱の確認", () => {
  it("#342 AC-8・AC-10 V3: 入力中（離脱の確認がある）の S-17 で戻ったときのセッションが 401 なら、覆ったまま読み込み直しを1回。そのとき、離脱の確認（beforeunload）を止める", async () => {
    const page = await renderCasePage(3437);
    await userEvent.setup().type(page.composer(), TYPED);
    // 対照：戻る前は、入力中なので離脱の確認が働く
    const before = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(true);
    page.world.session.answers.push({
      kind: "status",
      status: 401,
      code: "UNAUTHENTICATED",
    });
    await restoreAndWait(page);
    await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1));
    const after = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
    expect(isCovered(page.wrapper)).toBe(true);
    expect(newSummaryCalls(page)).toEqual([]);
  });

  it("#342 AC-9 V3: 読み込み直しの待機（waiting）の最中に戻ったら、案件を確かめず、外さない", async () => {
    const page = await renderCasePage(3438);
    act(() => {
      reloadState.set("waiting");
    });
    await restoreAndWait(page);
    await flushTasks(3);
    expect(newSummaryCalls(page)).toEqual([]);
    expect(isCovered(page.wrapper)).toBe(true);
    expect(reloadPage).not.toHaveBeenCalled();
  });
});

describe("#342 AC-5・AC-6 V4 概要の 403 と、通信の失敗の違い", () => {
  it("#342 AC-5 V4: S-17 で戻ったときの概要が 403 なら、覆いを保ったまま読み込み直しの入口へ進む。保存済みの下書きは消さず、合図も送らない", async () => {
    const page = await renderCasePage(3439);
    writeDraft(roomDraftKey(3439));
    page.world.caseOf(caseId(3439)).answers.push({
      kind: "status",
      status: 403,
      code: "FORBIDDEN",
    });
    await restoreAndWait(page);
    await waitFor(() =>
      expect(requestAccessLossReload).toHaveBeenCalledWith(expect.anything(), {
        ownerId: USER,
        reason: "lost",
      }),
    );
    await flushTasks(3);
    expect(window.localStorage.getItem(roomDraftKey(3439))).not.toBeNull();
    expect(announced()).toEqual([]);
    expect(isCovered(page.wrapper)).toBe(true);
    expect(screen.queryByRole("button", { name: RETRY_BUTTON })).toBeNull();
  });

  it("#342 AC-6 V4: 概要が通信の失敗なら、同じ入力を残したまま隠し、再試行のボタンを出す。再試行で参加者と確かめれば外れ、入力は残る", async () => {
    const page = await renderCasePage(3440);
    const input = page.composer();
    await userEvent.setup().type(input, TYPED);
    page.world.caseOf(caseId(3440)).answers.push({ kind: "network" });
    await restoreAndWait(page);
    const retry = await screen.findByRole("button", { name: RETRY_BUTTON });
    expect(screen.getByText(RESTORE_FAILED_TEXT)).toBeTruthy();
    expect(isCovered(page.wrapper)).toBe(true);
    expect(requestAccessLossReload).not.toHaveBeenCalled();
    expect(input.value).toBe(TYPED);
    await userEvent.setup().click(retry);
    await waitFor(() => expect(isUncovered(page.wrapper)).toBe(true));
    expect(page.composer()).toBe(input);
    expect(input.value).toBe(TYPED);
    expect(requestAccessLossReload).not.toHaveBeenCalled();
    expect(reloadPage).not.toHaveBeenCalled();
  });
});

// 計画レビュー3回目の軽微1（既知の限界）：セッションのキャッシュが無い文書は、復元で確かめない（対象0件）。
// そのとき、メモリには案件のキャッシュが残りうるが、認証の枠（RequireAuth）が子を描かないので、画面には出ない。この組み合わせを固定する
describe("#342 AC-2・AC-10 計画レビュー3回目の軽微1 セッションのキャッシュが無い文書", () => {
  it("#342 AC-2・AC-10 軽微1: セッションを確かめられない間は、認証の枠が案件の画面を描かず、案件のキャッシュが残っていても、離れて戻ったときに確かめず、覆わない", async () => {
    const world = respondRestoreWorld();
    world.addCase(3441);
    // 認証の枠のセッションの取得は、答えが無い（通信の失敗）
    world.session.fallback = { kind: "network" };
    const client = newRestoreClient(false);
    cacheParticipantSummary(client, 3441);
    installRestoreGuardLikeMain(client);
    const { container } = render(
      <QueryClientProvider client={client}>
        <AccessLossBoundary>
          <MemoryRouter initialEntries={[`/cases/${caseId(3441)}`]}>
            <RequireAuth>
              <p>{SECRET}</p>
            </RequireAuth>
          </MemoryRouter>
        </AccessLossBoundary>
      </QueryClientProvider>,
    );
    const failure =
      await screen.findByText("ログイン状態を確認できませんでした。");
    expect(screen.queryByText(SECRET)).toBeNull();
    const calls = world.session.calls;
    firePageHide(true);
    expect(getPageRestoreState()).toBe("idle");
    firePageShow(true);
    // 確かめを始めていない（始めれば verifying になる）。覆わず、セッションを取り直さない
    expect(getPageRestoreState()).toBe("idle");
    expect(world.session.calls).toBe(calls);
    expect(
      isUncovered(wrapperContaining(container, failure.textContent ?? "")),
    ).toBe(true);
    expect(screen.queryByText(SECRET)).toBeNull();
    expect(world.summaryCalls).toEqual([]);
  });
});
