// #341 AC-1〜AC-3・AC-5・AC-7（計画 plan-341 の 13 の T-S1〜T-S5・T-W6。利用者の決定 Q2〜Q4）：別のタブで確定した喪失の合図を、
// S-17 を表示中のタブ（本物の画面の部品）が受けたとき。受けたタブは、概要をキャッシュの外で1回取り、非参加・404 なら入口だけを呼ぶ。
// 画面の部品の onLost・片付け・下書きの消去は、受けた合図では動かない（キャッシュに書かないため。Q4）。
// 入口は test/setup.ts の vi.fn（呼ばれたことだけを見る。隠す・読み込み直すことは CaseAccessLossCrossTab.limit.test.tsx と単体）。
// 合図は、テスト専用の差し替え（test/fake-broadcast-channel.ts）で、ほかのタブから送ったものとして流す。中継は、このファイルで登録する（本番は main.tsx）。
// 偽の時計でポーリングを進める。API は MSW、保留は手で解く Promise。保存先のキーはリテラル。データはすべて架空（testuser_341_・[UNIT_TEST]）。
// 前提にした口（実装の担当へ）：features/cases の installCaseAccessLossRelay(queryClient): () => void。合図のチャンネルの名前 internal-system:access-loss:v1。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Link, MemoryRouter, Route, Routes } from "react-router";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { requestAccessLossReload } from "../features/access-loss";
import { authKeys } from "../features/auth";
import { caseKeys, installCaseAccessLossRelay } from "../features/cases";
import { TEST_USER } from "../test/auth-handlers";
import {
  CASE_TEXTS,
  PARTICIPANT_CREATOR,
  caseDetail,
  caseId,
  caseRoomId,
  caseSummary,
  outsiderSummary,
  type CaseParticipant,
} from "../test/case-handlers";
import { respondTodos, todoItem, todoTitle } from "../test/case-todo-handlers";
import {
  FakeBroadcastChannel,
  flushTasks,
  postFromOtherTab,
} from "../test/fake-broadcast-channel";
import { apiErrorResponse, message } from "../test/message-handlers";
import { server } from "../test/server";
import { CaseDetailPage } from "./CaseDetailPage";

const N = 341;
const POLL_MS = 2_000;
const CHANNEL = "internal-system:access-loss:v1";
const SECRET = "[UNIT_TEST]341別のタブで外された案件の説明";
const MESSAGE_TEXT = "[UNIT_TEST]341やり取りの本文";
const DRAFT = "[UNIT_TEST]341受けたタブの書きかけ";
const UNVERIFIED_TEXT = "案件の情報を確かめられませんでした";
const CASE_PATH = `/cases/${caseId(N)}`;
const SUMMARY_KEY = caseKeys.summary(TEST_USER.id, caseId(N));
const DETAIL_KEY = caseKeys.detail(TEST_USER.id, caseId(N));
const TODOS_KEY = caseKeys.todos(TEST_USER.id, caseId(N));
const ROOM_KEY = `internal-system:draft:v1:${TEST_USER.id}:room:${caseRoomId(N)}`;
const THREAD_KEY = `internal-system:draft:v1:${TEST_USER.id}:thread:${caseRoomId(N)}:01JTESTMSG34100000000000S3`;

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

const SELF: CaseParticipant = {
  userId: TEST_USER.id,
  displayName: TEST_USER.displayName,
  departmentName: null,
  isActive: true,
  isCreator: false,
  autoRole: null,
  removable: true,
};

type World = {
  /** サーバー（Cookie の利用者）から見て、参加者か */
  participant: boolean;
  summaryFail: number | null;
  summaryGate: Promise<void> | null;
  calls: { summary: number };
};

function world(): World {
  const w: World = {
    participant: true,
    summaryFail: null,
    summaryGate: null,
    calls: { summary: 0 },
  };
  respondTodos([todoItem(1)]);
  server.use(
    http.get("/api/auth/session", () =>
      HttpResponse.json(sessionOf(TEST_USER)),
    ),
    http.get("/api/cases/:caseId", async () => {
      w.calls.summary += 1;
      if (w.summaryGate !== null) await w.summaryGate;
      if (w.summaryFail !== null)
        return apiErrorResponse(
          w.summaryFail,
          w.summaryFail === 404 ? "NOT_FOUND" : "INTERNAL_ERROR",
          w.summaryFail === 404 ? CASE_TEXTS.notFound : "[UNIT_TEST]341失敗",
        );
      return HttpResponse.json(
        w.participant ? caseSummary(N) : outsiderSummary(N),
      );
    }),
    // 部屋・TODO・詳細は、200 のまま（受けたタブ自身の検出は起きない）
    http.get("/api/cases/:caseId/detail", () =>
      HttpResponse.json(
        caseDetail(N, {
          description: SECRET,
          participants: [PARTICIPANT_CREATOR, SELF],
        }),
      ),
    ),
    http.get("/api/rooms/:roomId/messages", ({ request }) => {
      const after = new URL(request.url).searchParams.get("after");
      return HttpResponse.json({
        items:
          after === null
            ? [message(1, { roomId: caseRoomId(N), body: MESSAGE_TEXT })]
            : [],
        nextCursor: null,
        hasMore: false,
      });
    }),
    http.put(
      "/api/rooms/:roomId/read-position",
      () => new HttpResponse(null, { status: 204 }),
    ),
  );
  return w;
}

function sessionOf(user: { id: string; displayName: string; loginId: string }) {
  return {
    user,
    mustChangePassword: false,
    reauthenticatedAt: null,
    permissions: [],
  };
}

function newClient() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  client.setQueryData(authKeys.session, sessionOf(TEST_USER));
  return client;
}

const uninstalls: (() => void)[] = [];

function relayOn(client: QueryClient) {
  uninstalls.push(installCaseAccessLossRelay(client));
}

function renderPage() {
  const client = newClient();
  relayOn(client);
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[CASE_PATH]}>
        <Routes>
          <Route path="/cases/:caseId" element={<CaseDetailPage />} />
          <Route
            path="/cases"
            element={<Link to={CASE_PATH}>案件に戻る</Link>}
          />
        </Routes>
        <Link to="/cases">一覧へ移る</Link>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, user };
}

async function waitForFullView() {
  await screen.findByText(SECRET);
  const region = await screen.findByRole("region", { name: "TODO" });
  await within(region).findByText(todoTitle(1));
  await screen.findAllByText(MESSAGE_TEXT);
}

function hintFromOtherTab() {
  postFromOtherTab(CHANNEL, { v: 1, userId: TEST_USER.id, caseId: caseId(N) });
}

function entryCallsFor(client: QueryClient) {
  return vi
    .mocked(requestAccessLossReload)
    .mock.calls.filter(([calledWith]) => calledWith === client);
}

function writeDraft(key: string, body: string) {
  window.localStorage.setItem(
    key,
    JSON.stringify({ body, updatedAt: Date.now() }),
  );
}

beforeAll(() => {
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
});
afterAll(() => {
  vi.unstubAllGlobals();
});
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal("reportError", vi.fn());
  FakeBroadcastChannel.clearSent();
  vi.mocked(requestAccessLossReload).mockClear();
});
afterEach(() => {
  uninstalls.splice(0).forEach((uninstall) => uninstall());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("#341 AC-1 T-S1 表示中の S-17 が合図を受ける", () => {
  it("#341 AC-1 T-S1: 部屋・TODO の自動の更新は 200 のまま → 合図 → キャッシュの外の概要が非参加：概要の GET は1回、入口が { ownerId: A, reason: lost } で1回。画面の部品は動かない（表示・概要のキャッシュは参加者のまま）", async () => {
    const w = world();
    const { client } = renderPage();
    await waitForFullView();
    const before = w.calls.summary;
    w.participant = false;
    hintFromOtherTab();
    await waitFor(() => expect(entryCallsFor(client)).toHaveLength(1));
    expect(w.calls.summary - before).toBe(1);
    expect(entryCallsFor(client)[0]?.[1]).toStrictEqual({
      ownerId: TEST_USER.id,
      reason: "lost",
    });
    await advance(POLL_MS * 2);
    expect(entryCallsFor(client)).toHaveLength(1);
    // 入口は差し替えなので、表示は変わらない（onLost・片付けは、受けた合図では動かない）
    expect(screen.getByText(SECRET)).toBeTruthy();
    expect(screen.queryByText(CASE_TEXTS.participantsOnly)).toBeNull();
    expect(
      client.getQueryData<{ isParticipant: boolean }>(SUMMARY_KEY)
        ?.isParticipant,
    ).toBe(true);
    expect(client.getQueryData(DETAIL_KEY)).toBeDefined();
    // 受けたタブは送り返さない
    expect(FakeBroadcastChannel.sent(CHANNEL)).toEqual([]);
  });
});

describe("#341 AC-3 T-S2 受けた確かめが失敗", () => {
  it("#341 AC-3 T-S2: キャッシュの外の概要が 500：表示が変わらない（概要の失敗の表示も、確かめられない表示も出ない）、入口なし", async () => {
    const w = world();
    const { client } = renderPage();
    await waitForFullView();
    const before = w.calls.summary;
    w.summaryFail = 500;
    hintFromOtherTab();
    await waitFor(() => expect(w.calls.summary - before).toBe(1));
    await advance(POLL_MS * 2);
    expect(entryCallsFor(client)).toHaveLength(0);
    expect(screen.getByText(SECRET)).toBeTruthy();
    expect(screen.queryByText(UNVERIFIED_TEXT)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(client.getQueryState(SUMMARY_KEY)?.status).toBe("success");
  });
});

describe("#341 AC-2 T-S3 画面は A、通信の利用者（Cookie）は B（#298・#376 の状態）", () => {
  it("#341 AC-2 T-S3: 画面・セッションのキャッシュは A、サーバーは「B として非参加」を返す → A の合図：入口だけが呼ばれ、A の部屋とスレッドの返信の下書き・A の中身のキャッシュは残る", async () => {
    const w = world();
    writeDraft(THREAD_KEY, "[UNIT_TEST]341前の返信");
    const { client, user } = renderPage();
    await waitForFullView();
    const input = await screen.findByRole("textbox", { name: "メッセージ" });
    await user.type(input, DRAFT.replace(/[[{]/g, "$&$&"));
    await waitFor(() =>
      expect(window.localStorage.getItem(ROOM_KEY)).toContain(DRAFT),
    );
    // Cookie が B に替わった：サーバーの答えは B から見た非参加
    w.participant = false;
    hintFromOtherTab();
    await waitFor(() => expect(entryCallsFor(client)).toHaveLength(1));
    await advance(POLL_MS);
    expect(window.localStorage.getItem(ROOM_KEY)).toContain(DRAFT);
    expect(window.localStorage.getItem(THREAD_KEY)).not.toBeNull();
    expect(client.getQueryData(DETAIL_KEY)).toBeDefined();
    expect(client.getQueryData(TODOS_KEY)).toBeDefined();
    expect(
      client.getQueryData<{ isParticipant: boolean }>(SUMMARY_KEY)
        ?.isParticipant,
    ).toBe(true);
  });
});

describe("#341 AC-1 T-S4 画面の部品が参加者を見ていない（作り直した画面）", () => {
  it("#341 AC-1 T-S4（計画レビュー1回目 重大2）: 概要が 500 → 画面を作り直す（部品は参加者を見ていない、キャッシュのデータは参加者）→ 合図 → 非参加：中継が入口を呼ぶ", async () => {
    const w = world();
    const { client, user } = renderPage();
    await waitForFullView();
    w.summaryFail = 500;
    await act(async () => {
      await client.invalidateQueries({ queryKey: SUMMARY_KEY });
    });
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    await user.click(screen.getByRole("link", { name: "一覧へ移る" }));
    await user.click(await screen.findByRole("link", { name: "案件に戻る" }));
    await waitFor(() =>
      expect(client.getQueryState(SUMMARY_KEY)?.fetchStatus).toBe("idle"),
    );
    expect(
      client.getQueryData<{ isParticipant: boolean }>(SUMMARY_KEY)
        ?.isParticipant,
    ).toBe(true);
    expect(entryCallsFor(client)).toHaveLength(0);
    w.summaryFail = null;
    w.participant = false;
    hintFromOtherTab();
    await waitFor(() => expect(entryCallsFor(client)).toHaveLength(1));
    expect(entryCallsFor(client)[0]?.[1]).toStrictEqual({
      ownerId: TEST_USER.id,
      reason: "lost",
    });
  });
});

describe("#341 AC-5 T-S5 書き戻しの限界を固定する（受けたタブは下書きを消さない。Q4）", () => {
  it("#341 AC-5 T-S5: 受けたタブの確かめを保留 → 送った側がキーを消す → 受けたタブで入力してキーが再び存在する → 非参加：入口は呼ばれ、キーは残る（既知の限界）", async () => {
    const w = world();
    const { client, user } = renderPage();
    await waitForFullView();
    const gate = deferred();
    w.summaryGate = gate.promise;
    const before = w.calls.summary;
    w.participant = false;
    hintFromOtherTab();
    await waitFor(() => expect(w.calls.summary - before).toBe(1));
    // 送った側のタブが、同じ保存先（localStorage）から、その部屋の下書きを消した
    window.localStorage.removeItem(ROOM_KEY);
    const input = await screen.findByRole("textbox", { name: "メッセージ" });
    await user.type(input, DRAFT.replace(/[[{]/g, "$&$&"));
    await waitFor(() =>
      expect(window.localStorage.getItem(ROOM_KEY)).toContain(DRAFT),
    );
    w.summaryGate = null;
    gate.release();
    await waitFor(() => expect(entryCallsFor(client)).toHaveLength(1));
    await advance(POLL_MS);
    expect(window.localStorage.getItem(ROOM_KEY)).toContain(DRAFT);
  });
});

describe("#341 AC-7 T-W6 本人の退出の合図（1〜2回）を受けたタブの読み込み直しは1回", () => {
  it("#341 AC-7 T-W6: タブ1で本人が退出に成功 → 合図は1〜2回、中身は版・利用者・案件だけ → 同じ合図をタブ2（参加者の概要を持つ。画面なし）に流す：タブ2の入口は1回", async () => {
    const w = world();
    server.use(
      http.delete("/api/cases/:caseId/participants/:userId", () => {
        w.participant = false;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { user } = renderPage();
    await waitForFullView();
    // タブ2：同じ利用者・その案件の参加者の概要をキャッシュに持つ（S-17 は表示していない。Q3）
    const tab2 = newClient();
    tab2.setQueryData(SUMMARY_KEY, caseSummary(N));
    relayOn(tab2);
    await user.click(screen.getByRole("button", { name: "参加者を管理" }));
    const manager = await screen.findByRole("dialog", { name: "参加者を管理" });
    const selfRow = within(manager)
      .getAllByRole("listitem")
      .find((row) => row.textContent?.includes(SELF.displayName));
    if (selfRow === undefined) throw new Error("本人の行がありません");
    await user.click(within(selfRow).getByRole("button", { name: "退出する" }));
    const confirm = await screen.findByRole("dialog", {
      name: "案件からの退出",
    });
    await user.click(within(confirm).getByRole("button", { name: "退出する" }));
    await waitFor(() =>
      expect(FakeBroadcastChannel.sent(CHANNEL).length).toBeGreaterThan(0),
    );
    await advance(POLL_MS * 2);
    const sent = FakeBroadcastChannel.sent(CHANNEL);
    expect(sent.length).toBeGreaterThanOrEqual(1);
    expect(sent.length).toBeLessThanOrEqual(2);
    for (const data of sent)
      expect(data).toStrictEqual({
        v: 1,
        userId: TEST_USER.id,
        caseId: caseId(N),
      });
    // 別の文書のタブ2へ、届いた順に流す（同じ文書の中では、自分のチャンネルに届かないため、手で渡す）
    const before = w.calls.summary;
    for (const data of sent) postFromOtherTab(CHANNEL, data);
    await waitFor(() => expect(entryCallsFor(tab2)).toHaveLength(1));
    await flushTasks();
    await advance(POLL_MS);
    expect(entryCallsFor(tab2)).toHaveLength(1);
    expect(entryCallsFor(tab2)[0]?.[1]).toStrictEqual({
      ownerId: TEST_USER.id,
      reason: "lost",
    });
    expect(w.calls.summary - before).toBe(1);
  });
});
