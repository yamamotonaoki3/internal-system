// #341 AC-1〜AC-4・AC-7（計画 plan-341 の 6 と 13 の T-R1〜T-R7。利用者の決定 Q1〜Q5）：別のタブで確定した資格の喪失の合図を受けたタブ（中継）。
// 合図は「確かめのきっかけ」にだけ使う（Q1）。受けたタブは、知らせの利用者とセッションのキャッシュの利用者が同じで、その案件の参加者の概要を
// キャッシュに持つときだけ、概要をキャッシュの外で1回取り、非参加・404 なら、入口を { ownerId: 知らせの利用者, reason: "lost" } で呼ぶ（Q2・Q3）。
// 受けたタブは、画面を隠して読み込み直すだけ（Q4）：片付け・下書きの消去・合図の送り返しをせず、概要のキャッシュに確かめの答えを書かない。
// 参加者のまま・5xx・403・通信の失敗なら、何もしない。想定外の例外（応答の検証の失敗など）は reportError に渡す（Q5）。
// 画面を描かずに確かめる（その案件の画面を表示していないタブ。Q3）。表示中の画面との組み合わせは pages/CaseAccessLossCrossTab.test.tsx。
// 入口は test/setup.ts の vi.fn（このファイルでは、入口の状態 getAccessLossReloadState も差し替える）。チャンネルはテスト専用の差し替え。
// 否定の確かめ（通信しない・呼ばない）は、MSW の数と、タスクを何周か進めた後の状態で見る。データはすべて架空（testuser_341_・[UNIT_TEST]）。
// 前提にした口（実装の担当へ）：features/cases/case-access-loss-relay.ts の installCaseAccessLossRelay(queryClient): () => void（解除の関数を返す）。
//   入口の状態は features/access-loss の getAccessLossReloadState() で読む。概要は fetchCaseSummary（GET /api/cases/:caseId）を直接呼ぶ。
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_USER } from "../../test/auth-handlers";
import { caseSummary, outsiderSummary } from "../../test/case-handlers";
import {
  FakeBroadcastChannel,
  flushTasks,
  postFromOtherTab,
} from "../../test/fake-broadcast-channel";
import { apiErrorResponse } from "../../test/message-handlers";
import { server } from "../../test/server";

vi.mock("../access-loss/reload-after-access-loss", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requestAccessLossReload: vi.fn(() => Promise.resolve()),
  getAccessLossReloadState: vi.fn(() => "idle"),
}));

const CHANNEL = "internal-system:access-loss:v1";
const N = 341;
const USER_A = TEST_USER.id;
const USER_B = {
  id: "01JTESTUSER341B0000000000B1",
  displayName: "testuser_341_b",
  loginId: "testuser_341_b",
};
const OTHER_CASE = "01JTESTCASE341000000000OTH1";

type Entry = typeof import("../access-loss/reload-after-access-loss");
type Relay = typeof import("./case-access-loss-relay");

let entry: Entry;
let relay: Relay;
let client: QueryClient;
let uninstall: (() => void) | undefined;
let reportError: ReturnType<typeof vi.fn>;
let caseId: string;

const summaryKey = (userId: string) => ["cases", "summary", userId, caseId];
const detailKey = (userId: string) => ["cases", "detail", userId, caseId];
const todosKey = (userId: string) => ["cases", "todos", userId, caseId];
const draftKey = (userId: string, scope: string) =>
  `internal-system:draft:v1:${userId}:${scope}`;

function sessionOf(user: { id: string; displayName: string; loginId: string }) {
  return {
    user,
    mustChangePassword: false,
    reauthenticatedAt: null,
    permissions: [],
  };
}

type Answer =
  | { kind: "participant" }
  | { kind: "outsider" }
  | { kind: "status"; status: number }
  | { kind: "network" }
  | { kind: "malformed" };

type SummaryServer = {
  calls: number;
  answer: Answer;
  gate: Promise<void> | null;
};

function respondSummary(answer: Answer): SummaryServer {
  const state: SummaryServer = { calls: 0, answer, gate: null };
  server.use(
    http.get("/api/cases/:caseId", async () => {
      state.calls += 1;
      if (state.gate !== null) await state.gate;
      const current = state.answer;
      switch (current.kind) {
        case "participant":
          return HttpResponse.json(caseSummary(N));
        case "outsider":
          return HttpResponse.json(outsiderSummary(N));
        case "network":
          return HttpResponse.error();
        case "malformed":
          return HttpResponse.json({ id: 341, isParticipant: "no" });
        case "status":
          return apiErrorResponse(
            current.status,
            current.status === 404
              ? "NOT_FOUND"
              : current.status === 403
                ? "FORBIDDEN"
                : "INTERNAL_ERROR",
            "[UNIT_TEST]341失敗",
          );
      }
    }),
  );
  return state;
}

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** 受けたタブの状態：利用者 A のセッション、その案件の参加者の概要・詳細・TODO のキャッシュ、その部屋の下書き */
function primeParticipantTab() {
  client.setQueryData(["auth", "session"], sessionOf(TEST_USER));
  client.setQueryData(summaryKey(USER_A), caseSummary(N));
  client.setQueryData(detailKey(USER_A), {
    sentinel: "[UNIT_TEST]341詳細",
  });
  client.setQueryData(todosKey(USER_A), { sentinel: "[UNIT_TEST]341TODO" });
}

const ROOM_DRAFT = () => draftKey(USER_A, `room:${caseSummary(N).channelId}`);
const THREAD_DRAFT = () =>
  draftKey(
    USER_A,
    `thread:${caseSummary(N).channelId}:01JTESTMSG34100000000000T1`,
  );

function writeDrafts() {
  for (const key of [ROOM_DRAFT(), THREAD_DRAFT()])
    window.localStorage.setItem(
      key,
      JSON.stringify({
        body: "[UNIT_TEST]341書きかけ",
        updatedAt: Date.now(),
      }),
    );
}

function hint(overrides: Record<string, unknown> = {}) {
  return { v: 1, userId: USER_A, caseId, ...overrides };
}

function entryCalls() {
  return vi.mocked(entry.requestAccessLossReload).mock.calls;
}

/** 中継（アプリのモジュール）が送った合図。受けたタブは送り返さない */
function relaySent() {
  return FakeBroadcastChannel.sent(CHANNEL);
}

beforeEach(async () => {
  FakeBroadcastChannel.closeAll();
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
  reportError = vi.fn();
  vi.stubGlobal("reportError", reportError);
  vi.resetModules();
  entry = await import("../access-loss/reload-after-access-loss");
  relay = await import("./case-access-loss-relay");
  caseId = caseSummary(N).id;
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  // vi.mock の差し替えの vi.fn は、vi.resetModules の後も同じものが使われる。前のテストの呼び出しの記録を持ち越さない
  vi.mocked(entry.requestAccessLossReload).mockClear();
  vi.mocked(entry.getAccessLossReloadState).mockClear();
  vi.mocked(entry.getAccessLossReloadState).mockReturnValue("idle");
  uninstall = relay.installCaseAccessLossRelay(client);
});
afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  client.clear();
  FakeBroadcastChannel.closeAll();
  vi.unstubAllGlobals();
});

describe("#341 AC-1 T-R4 非参加・404：入口だけを呼ぶ（Q2・Q3・Q4）", () => {
  it.each([
    ["成功して非参加", { kind: "outsider" } as Answer],
    ["404", { kind: "status", status: 404 } as Answer],
  ])(
    "#341 AC-1・AC-2 T-R4: 確かめが%s：概要の GET は1回、入口は { ownerId: 知らせの利用者, reason: lost } で1回。概要のキャッシュは参加者のまま、中身のキャッシュ・部屋とスレッドの返信の下書きは消さず、合図を送り返さない",
    async (_name, answer) => {
      const summary = respondSummary(answer);
      primeParticipantTab();
      writeDrafts();
      const before = client.getQueryState(summaryKey(USER_A));
      postFromOtherTab(CHANNEL, hint());
      await vi.waitFor(() => expect(entryCalls()).toHaveLength(1));
      expect(summary.calls).toBe(1);
      expect(entryCalls()[0]?.[0]).toBe(client);
      expect(entryCalls()[0]?.[1]).toStrictEqual({
        ownerId: USER_A,
        reason: "lost",
      });
      await flushTasks();
      expect(entryCalls()).toHaveLength(1);
      // 概要のキャッシュに確かめの答えを書かない（表示中の画面の (b) を動かさない。計画 6 の 5）
      expect(
        client.getQueryData<{ isParticipant: boolean }>(summaryKey(USER_A))
          ?.isParticipant,
      ).toBe(true);
      expect(client.getQueryState(summaryKey(USER_A))?.dataUpdatedAt).toBe(
        before?.dataUpdatedAt,
      );
      expect(client.getQueryState(summaryKey(USER_A))?.status).toBe("success");
      // 片付けない（読み込み直しで文書ごと消える）
      expect(client.getQueryData(detailKey(USER_A))).toBeDefined();
      expect(client.getQueryData(todosKey(USER_A))).toBeDefined();
      // 下書きを消さない（答えを返した利用者を証明できないため。Q4）
      expect(window.localStorage.getItem(ROOM_DRAFT())).not.toBeNull();
      expect(window.localStorage.getItem(THREAD_DRAFT())).not.toBeNull();
      // 送り返さない
      expect(relaySent()).toEqual([]);
      expect(reportError).not.toHaveBeenCalled();
    },
  );

  it("#341 AC-1 T-R4: 確かめの間は概要のキャッシュを取り直し中にしない（キャッシュの外で取る）", async () => {
    const summary = respondSummary({ kind: "outsider" });
    const gate = deferred();
    summary.gate = gate.promise;
    primeParticipantTab();
    postFromOtherTab(CHANNEL, hint());
    await vi.waitFor(() => expect(summary.calls).toBe(1));
    expect(client.getQueryState(summaryKey(USER_A))?.fetchStatus).toBe("idle");
    summary.gate = null;
    gate.release();
    await vi.waitFor(() => expect(entryCalls()).toHaveLength(1));
  });
});

describe("#341 AC-2 T-R1 利用者が違う・分からない：通信しない", () => {
  it("#341 AC-2 T-R1: 知らせの利用者が、セッションのキャッシュの利用者と違う：GET は0回、入口なし", async () => {
    const summary = respondSummary({ kind: "outsider" });
    primeParticipantTab();
    postFromOtherTab(CHANNEL, hint({ userId: USER_B.id }));
    await flushTasks();
    expect(summary.calls).toBe(0);
    expect(entryCalls()).toHaveLength(0);
  });

  it("#341 AC-2 T-R1: セッションのキャッシュが無い（ログアウトの後・401 の後）：GET は0回、入口なし", async () => {
    const summary = respondSummary({ kind: "outsider" });
    primeParticipantTab();
    client.removeQueries({ queryKey: ["auth", "session"] });
    postFromOtherTab(CHANNEL, hint());
    await flushTasks();
    expect(summary.calls).toBe(0);
    expect(entryCalls()).toHaveLength(0);
  });

  it("#341 AC-2 T-R1: B のセッションのタブに、B の概要のキャッシュが参加者であっても、A の知らせでは GET は0回", async () => {
    const summary = respondSummary({ kind: "outsider" });
    client.setQueryData(["auth", "session"], sessionOf(USER_B));
    client.setQueryData(summaryKey(USER_B.id), caseSummary(N));
    postFromOtherTab(CHANNEL, hint());
    await flushTasks();
    expect(summary.calls).toBe(0);
    expect(entryCalls()).toHaveLength(0);
  });
});

describe("#341 AC-4 T-R2 参加者の概要を持たない：通信しない", () => {
  it("#341 AC-4 T-R2: その案件の概要のキャッシュが無い：GET は0回、入口なし", async () => {
    const summary = respondSummary({ kind: "outsider" });
    client.setQueryData(["auth", "session"], sessionOf(TEST_USER));
    postFromOtherTab(CHANNEL, hint());
    await flushTasks();
    expect(summary.calls).toBe(0);
    expect(entryCalls()).toHaveLength(0);
  });

  it("#341 AC-4 T-R2: その案件の概要のキャッシュが非参加：GET は0回、入口なし", async () => {
    const summary = respondSummary({ kind: "outsider" });
    client.setQueryData(["auth", "session"], sessionOf(TEST_USER));
    client.setQueryData(summaryKey(USER_A), outsiderSummary(N));
    postFromOtherTab(CHANNEL, hint());
    await flushTasks();
    expect(summary.calls).toBe(0);
    expect(entryCalls()).toHaveLength(0);
  });

  it("#341 AC-4 T-R2: 別の案件の参加者の概要だけを持つ：知らせの案件では GET は0回", async () => {
    const summary = respondSummary({ kind: "outsider" });
    primeParticipantTab();
    postFromOtherTab(CHANNEL, hint({ caseId: OTHER_CASE }));
    await flushTasks();
    expect(summary.calls).toBe(0);
    expect(entryCalls()).toHaveLength(0);
  });

  it("#341 AC-6 T-B2: 版の違う合図・形の違う合図は、捨てる（GET は0回）", async () => {
    const summary = respondSummary({ kind: "outsider" });
    primeParticipantTab();
    postFromOtherTab(CHANNEL, hint({ v: 2 }));
    postFromOtherTab(CHANNEL, { v: 1, userId: USER_A });
    await flushTasks();
    expect(summary.calls).toBe(0);
    expect(entryCalls()).toHaveLength(0);
    expect(reportError).not.toHaveBeenCalled();
  });
});

describe("#341 AC-3 T-R3 確かめが参加者のまま・失敗：何もしない", () => {
  it.each([
    ["参加者のまま", { kind: "participant" } as Answer],
    ["500", { kind: "status", status: 500 } as Answer],
    ["503", { kind: "status", status: 503 } as Answer],
    ["403", { kind: "status", status: 403 } as Answer],
    ["通信の失敗", { kind: "network" } as Answer],
  ])(
    "#341 AC-3 T-R3: 確かめが%s：入口なし、概要のキャッシュは前のまま（書かれていない）、中身のキャッシュと下書きが残る、reportError なし",
    async (_name, answer) => {
      const summary = respondSummary(answer);
      primeParticipantTab();
      writeDrafts();
      const before = client.getQueryState(summaryKey(USER_A));
      postFromOtherTab(CHANNEL, hint());
      await vi.waitFor(() => expect(summary.calls).toBe(1));
      await flushTasks(10);
      expect(entryCalls()).toHaveLength(0);
      expect(client.getQueryState(summaryKey(USER_A))?.dataUpdatedAt).toBe(
        before?.dataUpdatedAt,
      );
      expect(client.getQueryState(summaryKey(USER_A))?.error ?? null).toBe(
        null,
      );
      expect(client.getQueryData(detailKey(USER_A))).toBeDefined();
      expect(client.getQueryData(todosKey(USER_A))).toBeDefined();
      expect(window.localStorage.getItem(ROOM_DRAFT())).not.toBeNull();
      expect(window.localStorage.getItem(THREAD_DRAFT())).not.toBeNull();
      expect(relaySent()).toEqual([]);
      expect(reportError).not.toHaveBeenCalled();
    },
  );
});

describe("#341 AC-2 T-R5 確かめの途中の切り替え・入口の状態の変化", () => {
  it("#341 AC-2 T-R5: 確かめの途中に B へ切り替わる → 非参加が届く：入口なし（比べ直しで捨てる）", async () => {
    const summary = respondSummary({ kind: "outsider" });
    const gate = deferred();
    summary.gate = gate.promise;
    primeParticipantTab();
    postFromOtherTab(CHANNEL, hint());
    await vi.waitFor(() => expect(summary.calls).toBe(1));
    client.setQueryData(["auth", "session"], sessionOf(USER_B));
    summary.gate = null;
    gate.release();
    await flushTasks(10);
    expect(entryCalls()).toHaveLength(0);
  });

  it("#341 AC-2 T-R5: 確かめの途中にセッションが消える（ログアウト）→ 非参加が届く：入口なし", async () => {
    const summary = respondSummary({ kind: "outsider" });
    const gate = deferred();
    summary.gate = gate.promise;
    primeParticipantTab();
    postFromOtherTab(CHANNEL, hint());
    await vi.waitFor(() => expect(summary.calls).toBe(1));
    client.removeQueries({ queryKey: ["auth", "session"] });
    summary.gate = null;
    gate.release();
    await flushTasks(10);
    expect(entryCalls()).toHaveLength(0);
  });

  it("#341 AC-7 T-R5: 確かめの途中に入口が idle でなくなる（自分の検出で待機に入った）→ 非参加が届く：入口を重ねて呼ばない", async () => {
    const summary = respondSummary({ kind: "outsider" });
    const gate = deferred();
    summary.gate = gate.promise;
    primeParticipantTab();
    postFromOtherTab(CHANNEL, hint());
    await vi.waitFor(() => expect(summary.calls).toBe(1));
    vi.mocked(entry.getAccessLossReloadState).mockReturnValue("waiting");
    summary.gate = null;
    gate.release();
    await flushTasks(10);
    expect(entryCalls()).toHaveLength(0);
  });
});

describe("#341 AC-7 T-R6 重ね", () => {
  it("#341 AC-7 T-R6: 同じ知らせが続けて2回（1回目の確かめの途中）：GET は1回、入口は1回", async () => {
    const summary = respondSummary({ kind: "outsider" });
    const gate = deferred();
    summary.gate = gate.promise;
    primeParticipantTab();
    postFromOtherTab(CHANNEL, hint());
    await vi.waitFor(() => expect(summary.calls).toBe(1));
    postFromOtherTab(CHANNEL, hint());
    await flushTasks();
    expect(summary.calls).toBe(1);
    summary.gate = null;
    gate.release();
    await vi.waitFor(() => expect(entryCalls()).toHaveLength(1));
    await flushTasks();
    expect(summary.calls).toBe(1);
    expect(entryCalls()).toHaveLength(1);
  });

  it.each(["waiting", "reloading"] as const)(
    "#341 AC-7 T-R6: 入口が %s のときの知らせ：GET は0回、入口なし",
    async (state) => {
      const summary = respondSummary({ kind: "outsider" });
      primeParticipantTab();
      vi.mocked(entry.getAccessLossReloadState).mockReturnValue(state);
      postFromOtherTab(CHANNEL, hint());
      await flushTasks();
      expect(summary.calls).toBe(0);
      expect(entryCalls()).toHaveLength(0);
    },
  );

  // 計画レビュー3回目の軽微：最初の確かめで非参加・404 なら GET は1回。失敗の後に、次の合図が届けば、もう一度取りうる。読み込み直し（入口）は1回
  it("#341 AC-7 T-R6: 最初の確かめが 500 で終わった後に、次の合図が届く：もう一度確かめ（GET 2回）、非参加なら入口は1回", async () => {
    const summary = respondSummary({ kind: "status", status: 500 });
    primeParticipantTab();
    postFromOtherTab(CHANNEL, hint());
    await vi.waitFor(() => expect(summary.calls).toBe(1));
    await flushTasks(10);
    expect(entryCalls()).toHaveLength(0);
    summary.answer = { kind: "outsider" };
    postFromOtherTab(CHANNEL, hint());
    await vi.waitFor(() => expect(entryCalls()).toHaveLength(1));
    expect(summary.calls).toBe(2);
    expect(entryCalls()[0]?.[1]).toStrictEqual({
      ownerId: USER_A,
      reason: "lost",
    });
  });

  it("#341 AC-7 T-R6: 解除した後は、知らせを受けても GET は0回", async () => {
    const summary = respondSummary({ kind: "outsider" });
    primeParticipantTab();
    uninstall?.();
    uninstall = undefined;
    postFromOtherTab(CHANNEL, hint());
    await flushTasks();
    expect(summary.calls).toBe(0);
    expect(entryCalls()).toHaveLength(0);
  });
});

describe("#341 Q5 T-R7 想定外の例外", () => {
  it("#341 Q5 T-R7: 概要の応答が検証に通らない：入口なし、reportError に1回渡す（未処理の Promise にしない）", async () => {
    const summary = respondSummary({ kind: "malformed" });
    primeParticipantTab();
    postFromOtherTab(CHANNEL, hint());
    await vi.waitFor(() => expect(reportError).toHaveBeenCalledTimes(1));
    expect(summary.calls).toBe(1);
    expect(reportError.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    await flushTasks();
    expect(entryCalls()).toHaveLength(0);
    expect(client.getQueryData(detailKey(USER_A))).toBeDefined();
  });

  it("#341 Q5 T-R7: 確かめが想定外の例外で終わった後も、次の知らせで確かめ直せる（確かめ中の印が残らない）", async () => {
    const summary = respondSummary({ kind: "malformed" });
    primeParticipantTab();
    postFromOtherTab(CHANNEL, hint());
    await vi.waitFor(() => expect(reportError).toHaveBeenCalledTimes(1));
    summary.answer = { kind: "outsider" };
    postFromOtherTab(CHANNEL, hint());
    await vi.waitFor(() => expect(entryCalls()).toHaveLength(1));
    expect(summary.calls).toBe(2);
  });
});
