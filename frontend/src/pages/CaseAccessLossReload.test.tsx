// #338 AC-1・AC-3・AC-4・AC-5（計画 plan-338 の 5-2・7-3 の P-1〜P-14）：S-17 で資格を失ったと確定したら、いまの片付けの後に、
// 読み込み直しの入口（requestAccessLossReload）を呼ぶ。呼ぶのは (a) 中身の拒否の後の確かめで喪失が確定したとき（画面を離れた後も）、
// (b) この画面で参加者だったことを見た後に外されたとき、(c) 本人の退出、だけ。参加者だったことを見ていない片付け（最初から非参加・404、
// 古い非参加の概要のキャッシュ、作り直しの経路）では呼ばない（参加していない案件を開くたびに読み込み直す退行を検出する。P-7〜P-7d）。
// 入口はこのファイルで vi.fn に差し替え、呼ばれた引数と、呼ばれた時点のキャッシュ・場所を記録する（待ち方・持ち主の判定は単体の U-*）。
// 偽の時計でポーリングを進める。API は MSW、保留は手で解く Promise。データはすべて架空（testuser_・[UNIT_TEST]）。
// 前提にした口（実装の担当へ）：features/access-loss/reload-after-access-loss.ts の
//   requestAccessLossReload(queryClient, { ownerId, reason: "lost" | "left", leftCasePath? })。
//   (c) の leftCasePath は `/cases/<caseId>`。ownerId は、(a)(b) は確定を始めた時点の画面の userId、(c) は押した時点の actorId。
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestAccessLossReload } from "../features/access-loss";
import { authKeys } from "../features/auth";
import { caseKeys } from "../features/cases";
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
import {
  respondTodos,
  todoItem,
  todoTitle,
  type TodoServerState,
} from "../test/case-todo-handlers";
import { apiErrorResponse, message } from "../test/message-handlers";
import { server } from "../test/server";
import { CaseDetailPage } from "./CaseDetailPage";

vi.mock(
  "../features/access-loss/reload-after-access-loss",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    requestAccessLossReload: vi.fn(() => Promise.resolve()),
  }),
);

const N = 338;
const POLL_MS = 2_000;
const SECRET = "[UNIT_TEST]338外されると見えなくなる説明";
const MESSAGE_TEXT = "[UNIT_TEST]338やり取りの本文";
const PRIVATE_TEXT = CASE_TEXTS.participantsOnly;
const UNVERIFIED_TEXT = "案件の情報を確かめられませんでした";
const CASE_PATH = `/cases/${caseId(N)}`;
const DETAIL_KEY = caseKeys.detail(TEST_USER.id, caseId(N));
const TODOS_KEY = caseKeys.todos(TEST_USER.id, caseId(N));
const SUMMARY_KEY = caseKeys.summary(TEST_USER.id, caseId(N));
const USER_B = {
  id: "01JTESTUSER338B00000000001",
  displayName: "testuser_338_b",
  loginId: "testuser_338_b",
};

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

type Failure = { status: number } | "network";
const CODES: Record<number, string> = {
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  500: "INTERNAL_ERROR",
};

function failureResponse(failure: Failure) {
  if (failure === "network") return HttpResponse.error();
  return apiErrorResponse(
    failure.status,
    CODES[failure.status] ?? "ERROR",
    failure.status === 403 ? PRIVATE_TEXT : "[UNIT_TEST]338失敗",
  );
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

const parentMessage = message(1, {
  roomId: caseRoomId(N),
  body: MESSAGE_TEXT,
});

type World = {
  participant: boolean;
  /** 外された後も、管理の資格（全体管理者・担当部署のオーナーなど）が残る（P-14） */
  manageAfterRevoke: boolean;
  summaryFail: Failure | null;
  roomFail: Failure | null;
  summaryGate: Promise<void> | null;
  calls: { summary: number };
  todos: TodoServerState;
};

function world(): World {
  const todos = respondTodos([todoItem(1)]);
  const w: World = {
    participant: true,
    manageAfterRevoke: false,
    summaryFail: null,
    roomFail: null,
    summaryGate: null,
    calls: { summary: 0 },
    todos,
  };
  server.use(
    http.get("/api/cases/:caseId", async () => {
      w.calls.summary += 1;
      if (w.summaryGate !== null) await w.summaryGate;
      if (w.summaryFail !== null) return failureResponse(w.summaryFail);
      if (w.participant) return HttpResponse.json(caseSummary(N));
      return HttpResponse.json(
        outsiderSummary(N, w.manageAfterRevoke ? { canManage: true } : {}),
      );
    }),
    http.get("/api/cases/:caseId/detail", () => {
      if (!w.participant && !w.manageAfterRevoke)
        return failureResponse({ status: 403 });
      return HttpResponse.json(
        caseDetail(N, {
          description: SECRET,
          participants: [PARTICIPANT_CREATOR, SELF],
        }),
      );
    }),
    http.get("/api/rooms/:roomId/messages", ({ request }) => {
      if (w.roomFail !== null) return failureResponse(w.roomFail);
      const after = new URL(request.url).searchParams.get("after");
      return HttpResponse.json({
        items: after === null ? [parentMessage] : [],
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

function CurrentPath() {
  return <output data-testid="path">{useLocation().pathname}</output>;
}

type Recorded = {
  request: { ownerId: string; reason: string; leftCasePath?: string };
  detailCached: boolean;
  todosCached: boolean;
  path: string;
};

let current: { client: QueryClient | null } = { client: null };
let recorded: Recorded[] = [];

function renderPage(options: { prime?: (client: QueryClient) => void } = {}) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  client.setQueryData(authKeys.session, sessionOf(TEST_USER));
  options.prime?.(client);
  current = { client };
  server.use(
    http.get("/api/auth/session", () =>
      HttpResponse.json(sessionOf(TEST_USER)),
    ),
  );
  const user = userEvent.setup();
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
        <CurrentPath />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user, client };
}

async function waitForFullView() {
  await screen.findByText(SECRET);
  const region = await screen.findByRole("region", { name: "TODO" });
  await within(region).findByText(todoTitle(1));
  await screen.findAllByText(MESSAGE_TEXT);
}

async function waitForSwitched() {
  await waitFor(() => {
    expect(screen.queryByText(SECRET)).toBeNull();
    expect(screen.getByText(PRIVATE_TEXT)).toBeTruthy();
  });
}

function denyTodos(w: World) {
  w.todos.failWith = { status: 403, code: "FORBIDDEN", message: PRIVATE_TEXT };
}

/** 入口が呼ばれた回数（理由ごと） */
function calls(reason?: "lost" | "left"): Recorded[] {
  return reason === undefined
    ? recorded
    : recorded.filter((entry) => entry.request.reason === reason);
}

/** 本人が「参加者を管理」から退出する（確認のダイアログで確定する） */
async function leaveSelf(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await user.click(screen.getByRole("button", { name: "参加者を管理" }));
  const manager = await screen.findByRole("dialog", {
    name: "参加者を管理",
  });
  const selfRow = within(manager)
    .getAllByRole("listitem")
    .find((row) => row.textContent?.includes(SELF.displayName));
  if (selfRow === undefined) throw new Error("本人の行がありません");
  await user.click(within(selfRow).getByRole("button", { name: "退出する" }));
  const confirm = await screen.findByRole("dialog", {
    name: "案件からの退出",
  });
  await user.click(within(confirm).getByRole("button", { name: "退出する" }));
}
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  recorded = [];
  vi.mocked(requestAccessLossReload).mockReset();
  vi.mocked(requestAccessLossReload).mockImplementation((client, request) => {
    recorded.push({
      request: request as Recorded["request"],
      detailCached: client.getQueryData(DETAIL_KEY) !== undefined,
      todosCached: client.getQueryData(TODOS_KEY) !== undefined,
      path: screen.queryByTestId("path")?.textContent ?? "",
    });
    return Promise.resolve();
  });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("#338 AC-1 (a) 中身の拒否の後の確かめで、喪失が確定したら、片付けの後に入口を呼ぶ", () => {
  it("#338 AC-1 P-1: TODO の 403 → 概要が非参加：片付け（詳細・TODO のキャッシュの消去）の後に、入口が1回（理由 lost・持ち主はこの画面の利用者）", async () => {
    const w = world();
    renderPage();
    await waitForFullView();
    w.participant = false;
    denyTodos(w);
    await advance(POLL_MS);
    await waitForSwitched();
    await waitFor(() => expect(calls()).toHaveLength(1));
    expect(calls()[0]?.request).toEqual({
      ownerId: TEST_USER.id,
      reason: "lost",
    });
    expect(calls()[0]?.detailCached).toBe(false);
    expect(calls()[0]?.todosCached).toBe(false);
    expect(vi.mocked(requestAccessLossReload).mock.calls[0]?.[0]).toBe(
      current.client,
    );
    await advance(POLL_MS * 2);
    expect(calls()).toHaveLength(1);
  });

  it("#338 AC-1 P-2: 部屋の 404 → 概要が 404：片付けの後に、入口が1回", async () => {
    const w = world();
    renderPage();
    await waitForFullView();
    w.participant = false;
    w.roomFail = { status: 404 };
    w.summaryFail = { status: 404 };
    await advance(POLL_MS);
    expect(await screen.findByText(CASE_TEXTS.notFound)).toBeTruthy();
    await waitFor(() => expect(calls("lost")).toHaveLength(1));
    expect(calls()[0]?.detailCached).toBe(false);
    await advance(POLL_MS * 2);
    expect(calls()).toHaveLength(1);
  });

  it("#338 AC-1 P-3: TODO の 403 → 概要が 500（確かめられない）：中身を隠し、片付けの後に、入口が1回（#323 の決定2）", async () => {
    const w = world();
    renderPage();
    await waitForFullView();
    w.participant = false;
    denyTodos(w);
    w.summaryFail = { status: 500 };
    await advance(POLL_MS);
    expect(await screen.findByText(UNVERIFIED_TEXT)).toBeTruthy();
    await waitFor(() => expect(calls("lost")).toHaveLength(1));
    expect(calls()[0]?.detailCached).toBe(false);
    await advance(POLL_MS * 2);
    expect(calls()).toHaveLength(1);
  });

  it("#338 AC-1 P-10: 確かめの途中に S-17 を離れ、その後に非参加が届いても、片付けの後に、入口が1回（利用者の決定 2026-11-21）", async () => {
    const w = world();
    const { user } = renderPage();
    await waitForFullView();
    const gate = deferred();
    w.summaryGate = gate.promise;
    const before = w.calls.summary;
    w.participant = false;
    denyTodos(w);
    await advance(POLL_MS);
    await waitFor(() => expect(w.calls.summary).toBeGreaterThan(before));
    await user.click(screen.getByRole("link", { name: "一覧へ移る" }));
    await screen.findByRole("link", { name: "案件に戻る" });
    expect(calls()).toHaveLength(0);
    w.summaryGate = null;
    gate.release();
    await waitFor(() => expect(calls("lost")).toHaveLength(1));
    expect(calls()[0]?.request.ownerId).toBe(TEST_USER.id);
    expect(calls()[0]?.detailCached).toBe(false);
    expect(calls()[0]?.path).toBe("/cases");
  });

  it("#338 AC-1 P-14: 外されても管理の資格が残る人（概要が非参加で canManage）：入口が1回", async () => {
    const w = world();
    renderPage();
    await waitForFullView();
    w.participant = false;
    w.manageAfterRevoke = true;
    w.roomFail = { status: 403 };
    denyTodos(w);
    await advance(POLL_MS);
    await waitFor(() => expect(calls("lost")).toHaveLength(1));
    await advance(POLL_MS * 2);
    expect(calls()).toHaveLength(1);
  });
});

describe("#338 AC-1・AC-4 (b) この画面で参加者だったことを見た後に、外された", () => {
  it("#338 AC-1・AC-4 P-4: 概要が先に非参加になり、続いて拒否が届いても、入口は1回だけ", async () => {
    const w = world();
    const { client } = renderPage();
    await waitForFullView();
    w.participant = false;
    await act(async () => {
      await client.invalidateQueries({ queryKey: SUMMARY_KEY });
    });
    await waitForSwitched();
    await waitFor(() => expect(calls("lost")).toHaveLength(1));
    expect(calls()[0]?.request).toEqual({
      ownerId: TEST_USER.id,
      reason: "lost",
    });
    // 片付け（効果の中の forgetCaseContent）の後に呼ぶ
    expect(calls()[0]?.detailCached).toBe(false);
    w.roomFail = { status: 403 };
    denyTodos(w);
    await advance(POLL_MS * 3);
    expect(calls()).toHaveLength(1);
  });
});

describe("#338 AC-4 読み込み直さない（参加していない案件を開くたびに読み込み直す退行を防ぐ）", () => {
  it("#338 AC-4 P-6: 参加者のままの 403（TODO が 403 で、概要は参加者）：入口は0回", async () => {
    const w = world();
    renderPage();
    await waitForFullView();
    denyTodos(w);
    await advance(POLL_MS * 3);
    expect(screen.getByText(SECRET)).toBeTruthy();
    expect(calls()).toHaveLength(0);
  });

  it("#338 AC-4 P-7: はじめから非参加の案件を開く（#363 の R-5 と同じ開き方）：非公開の表示になり、片付けは走るが、入口は0回", async () => {
    const w = world();
    w.participant = false;
    const rendered = renderPage({
      prime: (client) =>
        client.setQueryData(DETAIL_KEY, {
          sentinel: "[UNIT_TEST]338既存の詳細",
        }),
    });
    await waitForSwitched();
    await waitFor(() =>
      expect(rendered.client.getQueryData(DETAIL_KEY)).toBeUndefined(),
    );
    await advance(POLL_MS * 3);
    expect(calls()).toHaveLength(0);
  });

  it("#338 AC-4 P-7b: 古い非参加の概要のキャッシュで開き、サーバーは参加者を返す（#363 の R-10 と同じ開き方）：参加者の表示に戻り、入口は0回", async () => {
    world();
    renderPage({
      prime: (client) => client.setQueryData(SUMMARY_KEY, outsiderSummary(N)),
    });
    await waitForFullView();
    await advance(POLL_MS * 2);
    expect(screen.getByText(SECRET)).toBeTruthy();
    expect(calls()).toHaveLength(0);
  });

  it("#338 AC-4 P-7c: はじめから 404 で開く（#363 の R-5b と同じ）：「案件が見つかりません」になり、入口は0回", async () => {
    const w = world();
    w.summaryFail = { status: 404 };
    renderPage();
    expect(await screen.findByText(CASE_TEXTS.notFound)).toBeTruthy();
    await advance(POLL_MS * 3);
    expect(calls()).toHaveLength(0);
  });

  it.each([
    ["404 の失敗", "notFound"],
    ["成功して非参加", "outsider"],
  ] as const)(
    "#338 AC-4 P-7d: 作り直しの経路（概要の 500 → 画面を離れる → 離れている間に概要が%sに置き換わる → 戻る。#363 の R-6・R-7 と同じ順）：中身の片付けは走り、入口は0回",
    async (_name, next) => {
      const w = world();
      const { client, user } = renderPage();
      await waitForFullView();
      w.summaryFail = { status: 500 };
      await act(async () => {
        await client.invalidateQueries({ queryKey: SUMMARY_KEY });
      });
      await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
      await user.click(screen.getByRole("link", { name: "一覧へ移る" }));
      await screen.findByRole("link", { name: "案件に戻る" });
      if (next === "notFound") w.summaryFail = { status: 404 };
      else {
        w.summaryFail = null;
        w.participant = false;
      }
      await act(async () => {
        await client.refetchQueries({ queryKey: SUMMARY_KEY, exact: true });
      });
      await waitFor(() => {
        const state = client.getQueryState(SUMMARY_KEY);
        expect(state?.fetchStatus).toBe("idle");
        expect(state?.status).toBe(next === "notFound" ? "error" : "success");
      });
      await user.click(screen.getByRole("link", { name: "案件に戻る" }));
      await waitFor(() => {
        expect(client.getQueryData(DETAIL_KEY)).toBeUndefined();
        expect(client.getQueryData(TODOS_KEY)).toBeUndefined();
      });
      await advance(POLL_MS * 3);
      expect(calls()).toHaveLength(0);
    },
  );

  it("#338 AC-4 P-9: 操作なしで画面を離れる：入口は0回", async () => {
    world();
    const { user } = renderPage();
    await waitForFullView();
    await user.click(screen.getByRole("link", { name: "一覧へ移る" }));
    await screen.findByRole("link", { name: "案件に戻る" });
    await advance(POLL_MS * 3);
    expect(calls()).toHaveLength(0);
  });
});

describe("#338 AC-1・AC-5 (c) 本人の退出", () => {
  it("#338 AC-1・AC-5 P-8: S-17 で退出に成功すると、片付けより先に、理由 left・退出した案件の場所つきで入口を呼ぶ。後から lost が求められても、最初の要求は left（合流は入口の役目。U-17）", async () => {
    const w = world();
    server.use(
      http.delete("/api/cases/:caseId/participants/:userId", () => {
        w.participant = false;
        w.roomFail = { status: 403 };
        denyTodos(w);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { user } = renderPage();
    await waitForFullView();
    await leaveSelf(user);
    await waitFor(() => expect(calls("left")).toHaveLength(1));
    expect(calls()[0]?.request).toEqual({
      ownerId: TEST_USER.id,
      reason: "left",
      leftCasePath: CASE_PATH,
    });
    // 片付け（forgetCaseAfterLeave）より先に呼ぶ：呼んだ時点では、まだ詳細のキャッシュがある
    expect(calls()[0]?.detailCached).toBe(true);
    // 一覧への移動（既存の動き）は残る
    expect(
      await screen.findByRole("link", { name: "案件に戻る" }),
    ).toBeTruthy();
    await advance(POLL_MS * 3);
    expect(calls("left")).toHaveLength(1);
    // lost が求められる場合も、同じ持ち主で、left より後
    for (const entry of calls("lost"))
      expect(entry.request.ownerId).toBe(TEST_USER.id);
  });

  it("#338 AC-1・AC-5 P-8b: 退出の成功の後、案件の一覧の取得・取り直しを5秒より長く保留しても、一覧への移動より先に、理由 left・退出した案件の場所つきで入口を呼ぶ", async () => {
    const w = world();
    const listGate = deferred();
    server.use(
      http.delete("/api/cases/:caseId/participants/:userId", () => {
        w.participant = false;
        return new HttpResponse(null, { status: 204 });
      }),
      http.get("/api/cases", async () => {
        await listGate.promise;
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
    );
    const { user, client } = renderPage();
    await waitForFullView();
    // 一覧（参加中の案件）を購読しておく：退出の後片付けの取り直しが、保留した応答を待つ
    const listObserver = new QueryObserver(client, {
      queryKey: ["cases", "list", TEST_USER.id, "participating"],
      queryFn: () =>
        listGate.promise.then(() => ({ items: [], nextCursor: null })),
    });
    const unsubscribe = listObserver.subscribe(() => undefined);
    await leaveSelf(user);
    await waitFor(() => expect(calls("left")).toHaveLength(1));
    expect(calls()[0]?.request).toEqual({
      ownerId: TEST_USER.id,
      reason: "left",
      leftCasePath: CASE_PATH,
    });
    expect(calls()[0]?.path).toBe(CASE_PATH);
    await advance(6_000);
    // 最初の要求は left のまま（lost が先に来ない）
    expect(calls()[0]?.request.reason).toBe("left");
    listGate.release();
    unsubscribe();
  });

  it("#338 AC-1・AC-4 P-9: 退出の失敗（409）では、入口は0回", async () => {
    world();
    server.use(
      http.delete("/api/cases/:caseId/participants/:userId", () =>
        failureResponse({ status: 409 }),
      ),
    );
    const { user } = renderPage();
    await waitForFullView();
    await leaveSelf(user);
    await advance(POLL_MS * 2);
    expect(screen.getByText(SECRET)).toBeTruthy();
    expect(calls()).toHaveLength(0);
  });
});

describe("#338 AC-3 利用者の切り替え・401 との組み合わせ（持ち主は、確定を始めた時点の利用者）", () => {
  it("#338 AC-3 P-11: A の確かめを保留 → B に切り替え → A が非参加：入口を呼ぶなら持ち主は A（B として読み込み直させない）。A の詳細・TODO の片付けは走る", async () => {
    const w = world();
    const { client } = renderPage();
    await waitForFullView();
    const gate = deferred();
    w.summaryGate = gate.promise;
    const before = w.calls.summary;
    w.participant = false;
    denyTodos(w);
    await advance(POLL_MS);
    await waitFor(() => expect(w.calls.summary).toBeGreaterThan(before));
    act(() => {
      client.setQueryData(authKeys.session, sessionOf(USER_B));
    });
    w.summaryGate = null;
    gate.release();
    await advance(POLL_MS);
    await waitFor(() => {
      expect(client.getQueryData(DETAIL_KEY)).toBeUndefined();
      expect(client.getQueryData(TODOS_KEY)).toBeUndefined();
    });
    for (const entry of calls())
      expect(entry.request.ownerId).toBe(TEST_USER.id);
    expect(calls().some((entry) => entry.request.ownerId === USER_B.id)).toBe(
      false,
    );
  });

  it("#338 AC-3 P-12: A の退出を保留 → B に切り替え → 退出が成功：入口を呼ぶなら持ち主は A（押した時点の利用者）", async () => {
    world();
    const gate = deferred();
    server.use(
      http.delete("/api/cases/:caseId/participants/:userId", async () => {
        await gate.promise;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { user, client } = renderPage();
    await waitForFullView();
    await leaveSelf(user);
    act(() => {
      client.setQueryData(authKeys.session, sessionOf(USER_B));
    });
    gate.release();
    await advance(POLL_MS);
    await waitFor(() => expect(calls("left").length).toBeGreaterThan(0));
    for (const entry of calls())
      expect(entry.request.ownerId).toBe(TEST_USER.id);
  });

  it("#338 AC-3 P-13: A → 401（セッションが消える）→ A が再ログイン → 保留した確かめが非参加：入口が1回（持ち主 A）", async () => {
    const w = world();
    const { client } = renderPage();
    await waitForFullView();
    const gate = deferred();
    w.summaryGate = gate.promise;
    const before = w.calls.summary;
    w.participant = false;
    denyTodos(w);
    await advance(POLL_MS);
    await waitFor(() => expect(w.calls.summary).toBeGreaterThan(before));
    act(() => {
      client.removeQueries({ queryKey: authKeys.session });
    });
    act(() => {
      client.setQueryData(authKeys.session, sessionOf(TEST_USER));
    });
    w.summaryGate = null;
    gate.release();
    await waitFor(() => expect(calls("lost")).toHaveLength(1));
    expect(calls()[0]?.request.ownerId).toBe(TEST_USER.id);
  });
});
