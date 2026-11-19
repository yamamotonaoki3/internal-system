// #308 AC-1〜AC-3（5-1 AC-2・AC-3）、計画 plan-308 の6章・10章：案件の画面（S-17）を開いたまま、ほかの参加者に外された人の画面を、
// 自動の更新（部屋のメッセージ・TODO の2秒ごとの取り直し）が拒否（403・404）を受けたことを契機に、非公開の表示へ切り替える。
// 偽の時計でポーリングを進める（固定の待ちを使わない）。API は MSW、保留は手で解決する Promise。データはすべて架空（testuser_・[UNIT_TEST]）。
// 画面の契約（実装の担当へ。テストが決めたもの）：
//   切り替わった後：「参加者だけが見られます（非公開）」だけを出し、説明・参加者の一覧・TODO の区画・やり取り・開いていたスレッド・ダイアログは出ない。
//   参加者のままの人（概要の取り直しが参加者）：何も変えない。詳細・TODO を取り直さず、概要の取り直しは1回だけ（要求が増え続けない）。
//   概要の取り直しが失敗（5xx）：中身を隠し、role="alert" で UNVERIFIED_TEXT と、button「再試行」を出す。
//     再試行で概要が参加者なら元に戻り（詳細を新しく取り直す）、非参加なら非公開の表示。まだ失敗なら隠したまま。
//   外された後に概要が参加者へ戻った（ほかの画面の取り直しなど）ときは、元に戻る。このとき、閉じたダイアログは開いたまま戻らない。
//   本人の下書き（端末の保存）は、切り替えでも消さない。
// 利用者が替わったときの扱いは CaseAccessLoss.userSwitch.test.tsx。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { Link, MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  todoTitle,
  todoItem,
  type TodoServerState,
} from "../test/case-todo-handlers";
import { apiErrorResponse, message } from "../test/message-handlers";
import { server } from "../test/server";
import { CaseDetailPage } from "./CaseDetailPage";

const N = 308;
const POLL_MS = 2_000;
const SECRET = "[UNIT_TEST]308外されると見えなくなる説明";
const MESSAGE_TEXT = "[UNIT_TEST]308やり取りの本文";
const REPLY_TEXT = "[UNIT_TEST]308スレッドの返信";
const PRIVATE_TEXT = CASE_TEXTS.participantsOnly;
const UNVERIFIED_TEXT = "案件の情報を確かめられませんでした";
const RETRY = "再試行";
const DRAFT_TEXT = "308の下書きの文";
const DRAFT_KEY = `internal-system:draft:v1:${TEST_USER.id}:room:${caseRoomId(N)}`;

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
  500: "INTERNAL_ERROR",
};
const MESSAGES: Record<number, string> = {
  401: "ログインしてください",
  403: PRIVATE_TEXT,
  404: CASE_TEXTS.notFound,
  500: "サーバーでエラーが発生しました",
};

function failureResponse(failure: Failure) {
  if (failure === "network") return HttpResponse.error();
  return apiErrorResponse(
    failure.status,
    CODES[failure.status] ?? "ERROR",
    MESSAGES[failure.status],
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
  replyCount: 1,
});
const threadReply = message(2, {
  roomId: caseRoomId(N),
  parentMessageId: parentMessage.id,
  body: REPLY_TEXT,
});

type World = {
  /** サーバーでの、この利用者の参加の状態 */
  participant: boolean;
  status: "active" | "closed";
  /** 概要の取得の失敗（null なら通常）。participant に依らず優先 */
  summaryFail: Failure | null;
  /** 部屋のメッセージの取得の失敗 */
  roomFail: Failure | null;
  /** 概要・詳細の応答の保留 */
  gate: Promise<void> | null;
  messages: ReturnType<typeof message>[];
  calls: { summary: number; detail: number; room: number };
  todos: TodoServerState;
  /** 外された状態にする：概要は非参加、詳細・部屋は 403（TODO は通ったまま。部屋の側の契機だけを確かめるため） */
  revoke(): void;
  /** revoke に加えて、TODO も 403 にする（実際にサーバーが返す状態） */
  revokeAll(): void;
  /** 参加者に戻った状態にする */
  restore(): void;
};

function world(
  options: { status?: "active" | "closed"; messages?: boolean } = {},
): World {
  const todos = respondTodos([todoItem(1)]);
  const w: World = {
    participant: true,
    status: options.status ?? "active",
    summaryFail: null,
    roomFail: null,
    gate: null,
    messages: options.messages === false ? [] : [parentMessage],
    calls: { summary: 0, detail: 0, room: 0 },
    todos,
    revoke() {
      w.participant = false;
      w.roomFail = { status: 403 };
    },
    revokeAll() {
      w.revoke();
      todos.failWith = {
        status: 403,
        code: "FORBIDDEN",
        message: PRIVATE_TEXT,
      };
    },
    restore() {
      w.participant = true;
      w.roomFail = null;
      todos.failWith = null;
    },
  };
  const closed = () => w.status === "closed";
  server.use(
    http.get("/api/cases/:caseId", async () => {
      w.calls.summary += 1;
      if (w.gate !== null) await w.gate;
      if (w.summaryFail !== null) return failureResponse(w.summaryFail);
      return HttpResponse.json(
        w.participant
          ? caseSummary(N, {
              status: w.status,
              canEditDueDate: !closed(),
            })
          : outsiderSummary(N, { status: w.status }),
      );
    }),
    http.get("/api/cases/:caseId/detail", async () => {
      w.calls.detail += 1;
      if (w.gate !== null) await w.gate;
      if (!w.participant) return failureResponse({ status: 403 });
      return HttpResponse.json(
        caseDetail(N, {
          status: w.status,
          canEditDueDate: !closed(),
          description: SECRET,
          participants: [PARTICIPANT_CREATOR, SELF],
        }),
      );
    }),
    http.get("/api/rooms/:roomId/messages", ({ request }) => {
      w.calls.room += 1;
      if (w.roomFail !== null) return failureResponse(w.roomFail);
      const after = new URL(request.url).searchParams.get("after");
      return HttpResponse.json({
        items: after === null ? [...w.messages].reverse() : [],
        nextCursor: null,
        hasMore: false,
      });
    }),
    http.put(
      "/api/rooms/:roomId/read-position",
      () => new HttpResponse(null, { status: 204 }),
    ),
    http.get("/api/messages/:messageId/replies", ({ request }) => {
      const after = new URL(request.url).searchParams.get("after");
      return HttpResponse.json({
        items: after === null ? [threadReply] : [],
        nextCursor: null,
        hasMore: false,
        parent: parentMessage,
        replyBlockedReason: closed() ? "case_closed" : null,
        joined: true,
        roomWritable: !closed(),
      });
    }),
    http.put(
      "/api/messages/:messageId/thread-read-position",
      () => new HttpResponse(null, { status: 204 }),
    ),
  );
  return w;
}

function renderPage(options: { thread?: boolean } = {}) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  const session = {
    user: TEST_USER,
    mustChangePassword: false,
    reauthenticatedAt: null,
    permissions: [],
  };
  client.setQueryData(authKeys.session, session);
  server.use(http.get("/api/auth/session", () => HttpResponse.json(session)));
  const user = userEvent.setup();
  const search = options.thread === true ? `?thread=${parentMessage.id}` : "";
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/cases/${caseId(N)}${search}`]}>
        <Routes>
          <Route path="/cases/:caseId" element={<CaseDetailPage />} />
          <Route
            path="/cases"
            element={<Link to={`/cases/${caseId(N)}`}>案件に戻る</Link>}
          />
        </Routes>
        <Link to="/cases">一覧へ移る</Link>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user, client };
}

/** 参加者として、説明・TODO・やり取りが出るまで待つ */
async function waitForFullView(options: { messages?: boolean } = {}) {
  await screen.findByText(SECRET);
  const region = await screen.findByRole("region", { name: "TODO" });
  await within(region).findByText(todoTitle(1));
  // スレッドを開いているときは、親が一覧とスレッドの両方に出る
  if (options.messages !== false) await screen.findAllByText(MESSAGE_TEXT);
}

/** 非公開の表示に切り替わったことを待つ（TODO の欄の 403 の表示と区別するため、説明が消えたことも見る） */
async function waitForSwitched() {
  await waitFor(() => {
    expect(screen.queryByText(SECRET)).toBeNull();
    expect(screen.getByText(PRIVATE_TEXT)).toBeTruthy();
  });
}

function expectNothingShown() {
  expect(screen.queryByText(SECRET)).toBeNull();
  expect(screen.queryByText(PARTICIPANT_CREATOR.displayName)).toBeNull();
  expect(screen.queryByRole("list", { name: "参加者" })).toBeNull();
  expect(screen.queryByRole("region", { name: "TODO" })).toBeNull();
  expect(screen.queryByText(todoTitle(1))).toBeNull();
  expect(screen.queryByRole("heading", { name: "やり取り" })).toBeNull();
  expect(screen.queryAllByText(MESSAGE_TEXT)).toEqual([]);
  expect(screen.queryByText(REPLY_TEXT)).toBeNull();
  expect(screen.queryByRole("region", { name: "スレッド" })).toBeNull();
  expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
}

function expectFullViewShown() {
  expect(screen.getByText(SECRET)).toBeTruthy();
  expect(screen.getByRole("list", { name: "参加者" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "TODO" })).toBeTruthy();
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("#308 AC-1 外された後、操作・再読み込みなしで、自動の更新の1回の後に非公開の表示に切り替わる", () => {
  it.each([
    ["部屋のメッセージの取得が 403", "room"],
    ["TODO の取得が 403（部屋は通る）", "todos"],
    ["部屋・TODO の両方が 403", "both"],
  ] as const)(
    "#308 AC-1: %s のとき、2秒の自動の更新の後に、非公開の表示に切り替わり、説明・参加者・TODO・やり取りが出ない",
    async (_name, which) => {
      const w = world();
      renderPage();
      await waitForFullView();
      w.participant = false;
      if (which !== "todos") w.roomFail = { status: 403 };
      if (which !== "room")
        w.todos.failWith = {
          status: 403,
          code: "FORBIDDEN",
          message: PRIVATE_TEXT,
        };
      await advance(POLL_MS);
      await waitForSwitched();
      expectNothingShown();
    },
  );

  it.each([
    [
      "スレッドを開いている",
      { thread: true },
      { messages: true, status: "active" },
    ],
    ["やり取りが0件", { thread: false }, { messages: false, status: "active" }],
    ["終了した案件", { thread: false }, { messages: true, status: "closed" }],
  ] as const)(
    "#308 AC-1: %s の場合でも、自動の更新の後に切り替わる",
    async (_name, render, setup) => {
      const w = world({ status: setup.status, messages: setup.messages });
      renderPage(render);
      await waitForFullView({ messages: setup.messages });
      if (render.thread) await screen.findByText(REPLY_TEXT);
      w.revoke();
      await advance(POLL_MS);
      await waitForSwitched();
      expectNothingShown();
    },
  );

  it("#308 AC-1: 概要の取り直しが 404（案件が見えない）なら、案件が見つからない表示になる（存在を明かさない）", async () => {
    const w = world();
    renderPage();
    await waitForFullView();
    w.revoke();
    w.summaryFail = { status: 404 };
    await advance(POLL_MS);
    expect(await screen.findByText(CASE_TEXTS.notFound)).toBeTruthy();
    expectNothingShown();
  });

  it.each([
    ["参加者を管理", "参加者を管理"],
    ["納期を変更", "納期の変更"],
    ["案件を終了", "案件の終了"],
  ] as const)(
    "#308 AC-1: 「%s」のダイアログを開いていても、切り替わると閉じ、参加者に戻ったときも開いたまま戻らない",
    async (button, dialogName) => {
      const w = world();
      const { user, client } = renderPage();
      await waitForFullView();
      await user.click(screen.getByRole("button", { name: button }));
      expect(
        await screen.findByRole("dialog", { name: dialogName }),
      ).toBeTruthy();
      w.revoke();
      await advance(POLL_MS);
      await waitForSwitched();
      expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
      // ほかの画面の取り直しなどで、参加者に戻ったと分かったとき：古いダイアログは開かない
      w.restore();
      void client.invalidateQueries({ queryKey: caseKeys.all });
      expect(await screen.findByText(SECRET)).toBeTruthy();
      expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
    },
  );

  it("#308 AC-1（印の外し方）: 外された → 参加者に戻った（概要が参加者になる）→ また外された、でも、2回目も切り替わる", async () => {
    const w = world();
    const { client } = renderPage();
    await waitForFullView();
    w.revoke();
    await advance(POLL_MS);
    await waitForSwitched();
    w.restore();
    void client.invalidateQueries({ queryKey: caseKeys.all });
    await waitForFullView();
    w.revoke();
    await advance(POLL_MS);
    await waitForSwitched();
    expectNothingShown();
  });

  it("#308 AC-1（本人の下書き）: 切り替わっても端末の下書きは消えず、参加者に戻ったとき入力欄に復元される", async () => {
    const w = world();
    const { user, client } = renderPage();
    await waitForFullView();
    await user.type(
      await screen.findByRole("textbox", { name: "メッセージ" }),
      DRAFT_TEXT,
    );
    expect(window.localStorage.getItem(DRAFT_KEY)).toContain(DRAFT_TEXT);
    w.revoke();
    await advance(POLL_MS);
    await waitForSwitched();
    expect(window.localStorage.getItem(DRAFT_KEY)).toContain(DRAFT_TEXT);
    w.restore();
    void client.invalidateQueries({ queryKey: caseKeys.all });
    await waitForFullView();
    const input = await screen.findByRole<HTMLTextAreaElement>("textbox", {
      name: "メッセージ",
    });
    expect(input.value).toBe(DRAFT_TEXT);
  });
});

describe("#308 AC-1 概要の取り直しが失敗したとき（安全な側に倒す）", () => {
  async function failVerification() {
    const w = world();
    const rendered = renderPage();
    await waitForFullView();
    w.revoke();
    w.summaryFail = { status: 500 };
    await advance(POLL_MS);
    expect(await screen.findByText(UNVERIFIED_TEXT)).toBeTruthy();
    return { w, ...rendered };
  }

  it("#308 AC-1: 部屋が 403 → 概要の取り直しが 500 のとき、中身を隠し、「案件の情報を確かめられませんでした」を role=alert と「再試行」で出す", async () => {
    await failVerification();
    expect(screen.getByRole("alert").textContent).toContain(UNVERIFIED_TEXT);
    expect(screen.getByRole("button", { name: RETRY })).toBeTruthy();
    expectNothingShown();
    expect(screen.queryByText(PRIVATE_TEXT)).toBeNull();
  });

  it("#308 AC-1: 再試行で、概要が参加者のままなら、元の表示に戻り（詳細を新しく取り直す）、確かめられない表示は消える", async () => {
    const { w, user } = await failVerification();
    const detailBefore = w.calls.detail;
    w.restore();
    w.summaryFail = null;
    await user.click(screen.getByRole("button", { name: RETRY }));
    await waitForFullView();
    expect(screen.queryByText(UNVERIFIED_TEXT)).toBeNull();
    expect(w.calls.detail).toBeGreaterThan(detailBefore);
    expectFullViewShown();
  });

  it("#308 AC-1: 再試行で、概要が非参加なら、非公開の表示に切り替わる", async () => {
    const { w, user } = await failVerification();
    w.summaryFail = null;
    await user.click(screen.getByRole("button", { name: RETRY }));
    await waitForSwitched();
    expect(screen.queryByText(UNVERIFIED_TEXT)).toBeNull();
    expectNothingShown();
  });

  it("#308 AC-1: 再試行もまた失敗したら、隠したまま（確かめられない表示を出し続ける）", async () => {
    const { user } = await failVerification();
    await user.click(screen.getByRole("button", { name: RETRY }));
    expect(await screen.findByText(UNVERIFIED_TEXT)).toBeTruthy();
    expect(screen.getByRole("button", { name: RETRY })).toBeTruthy();
    expectNothingShown();
  });

  it("#308 AC-1（印の外し方）: 再試行で参加者のまま戻った後に、本当に外されたら、2秒の自動の更新の後に切り替わる", async () => {
    const { w, user } = await failVerification();
    w.restore();
    w.summaryFail = null;
    await user.click(screen.getByRole("button", { name: RETRY }));
    await waitForFullView();
    w.revoke();
    await advance(POLL_MS);
    await waitForSwitched();
    expectNothingShown();
  });
});

describe("#308 AC-2 開き直しても、古い説明・参加者が出ない", () => {
  it("#308 AC-2: 切り替わった後に別の画面へ移り、参加者に戻って開き直すと、応答を保留している間に古い説明・参加者・メッセージが出ず、詳細を新しく取りにいく", async () => {
    const w = world();
    const { user } = renderPage();
    await waitForFullView();
    const summaryBeforeRevoke = w.calls.summary;
    w.revoke();
    await advance(POLL_MS);
    await waitForSwitched();
    await waitFor(() =>
      expect(w.calls.summary).toBeGreaterThan(summaryBeforeRevoke),
    );
    await user.click(screen.getByRole("link", { name: "一覧へ移る" }));
    const back = await screen.findByRole("link", { name: "案件に戻る" });

    // 参加者に戻った後に、開き直す。概要・詳細の応答を保留する
    w.restore();
    const gate = deferred();
    w.gate = gate.promise;
    const detailBefore = w.calls.detail;
    await user.click(back);
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "案件に戻る" })).toBeNull(),
    );
    expect(screen.queryByText(SECRET)).toBeNull();
    expect(screen.queryByRole("list", { name: "参加者" })).toBeNull();
    expect(screen.queryAllByText(MESSAGE_TEXT)).toEqual([]);
    expect(screen.queryByText(PARTICIPANT_CREATOR.displayName)).toBeNull();

    w.gate = null;
    gate.release();
    expect(await screen.findByText(SECRET)).toBeTruthy();
    expect(w.calls.detail).toBeGreaterThan(detailBefore);
  });

  it("#308 AC-2: 切り替わった後に開き直して、まだ外されたままなら、非公開の表示（古い説明は出ない）", async () => {
    const w = world();
    const { user } = renderPage();
    await waitForFullView();
    w.revoke();
    await advance(POLL_MS);
    await waitForSwitched();
    await user.click(screen.getByRole("link", { name: "一覧へ移る" }));
    await user.click(await screen.findByRole("link", { name: "案件に戻る" }));
    await waitForSwitched();
    expectNothingShown();
  });
});

describe("#308 AC-3 参加者のままの人の画面は変わらない", () => {
  it("#308 AC-3: 参加者のままで、部屋・TODO が 403 を返し続けても、説明・参加者は残り、取り直しが落ち着いた後は、概要・詳細・TODO・部屋の要求が増え続けない", async () => {
    const w = world();
    renderPage();
    await waitForFullView();
    const summaryBefore = w.calls.summary;
    w.roomFail = { status: 403 };
    w.todos.failWith = {
      status: 403,
      code: "FORBIDDEN",
      message: PRIVATE_TEXT,
    };
    await advance(POLL_MS);
    // 概要の取り直しで、参加者のままと確かめる
    await waitFor(() => expect(w.calls.summary).toBeGreaterThan(summaryBefore));
    await advance(POLL_MS);
    expect(screen.getByText(SECRET)).toBeTruthy();
    expect(screen.getByRole("list", { name: "参加者" })).toBeTruthy();
    // 概要の取り直しは、検出の1回（TODO の欄の既存の取り直しと重なっても数回）に収まる
    expect(w.calls.summary).toBeLessThanOrEqual(summaryBefore + 2);
    const settled = {
      summary: w.calls.summary,
      detail: w.calls.detail,
      todo: w.todos.requests.length,
      room: w.calls.room,
    };
    // 数十秒進めても、要求は増えない（403 → 概要の取り直し → 参加者のまま → 取り直し …の循環をしない）
    for (let i = 0; i < 15; i += 1) await advance(POLL_MS);
    expect(w.calls.summary).toBe(settled.summary);
    expect(w.calls.detail).toBe(settled.detail);
    expect(w.todos.requests.length).toBe(settled.todo);
    expect(w.calls.room).toBe(settled.room);
    expect(screen.getByText(SECRET)).toBeTruthy();
    expect(screen.getByRole("list", { name: "参加者" })).toBeTruthy();
  });

  it.each([
    ["部屋の取得が 500", "room", { status: 500 }],
    ["部屋の取得が通信の失敗", "room", "network"],
    ["TODO の取得が 500", "todos", { status: 500 }],
  ] as const)(
    "#308 AC-3: %s のときは、非公開に切り替えず、概要を取り直さず、内容が残る。次の更新で成功すれば元どおり",
    async (_name, target, failure) => {
      const w = world();
      renderPage();
      await waitForFullView();
      const summaryBefore = w.calls.summary;
      const requestsBefore =
        target === "room" ? w.calls.room : w.todos.requests.length;
      if (target === "room") w.roomFail = failure;
      else
        w.todos.failWith = {
          status: 500,
          code: "INTERNAL_ERROR",
          message: MESSAGES[500] ?? "",
        };
      await advance(POLL_MS);
      await waitFor(() =>
        expect(
          target === "room" ? w.calls.room : w.todos.requests.length,
        ).toBeGreaterThan(requestsBefore),
      );
      await advance(POLL_MS);
      expect(screen.getByText(SECRET)).toBeTruthy();
      expect(screen.getByRole("list", { name: "参加者" })).toBeTruthy();
      expect(screen.queryByText(UNVERIFIED_TEXT)).toBeNull();
      expect(w.calls.summary).toBe(summaryBefore);
      // ポーリングは止まらず続き、成功すれば元どおり
      w.roomFail = null;
      w.todos.failWith = null;
      await advance(POLL_MS);
      await waitForFullView();
      expect(w.calls.summary).toBe(summaryBefore);
    },
  );

  it("#308 AC-3: 401 では、この部品は何もしない（概要を取り直さず、非公開にも切り替えない。セッション切れは共通の処理に任せる）", async () => {
    const w = world();
    renderPage();
    await waitForFullView();
    const summaryBefore = w.calls.summary;
    const roomBefore = w.calls.room;
    w.roomFail = { status: 401 };
    await advance(POLL_MS);
    await waitFor(() => expect(w.calls.room).toBeGreaterThan(roomBefore));
    await advance(POLL_MS);
    expect(w.calls.summary).toBe(summaryBefore);
    expect(screen.getByText(SECRET)).toBeTruthy();
    expect(screen.queryByText(UNVERIFIED_TEXT)).toBeNull();
  });
});

describe("#308 本人の退出との関係（既存の動きを変えない）", () => {
  it("#308 AC-1・退出の維持: 本人が退出すると、一覧へ移る既存の動きのまま、退出の後に概要の余分な取り直しが起きない（退出の後は部屋・TODO が 403 になっても）", async () => {
    const w = world();
    server.use(
      http.delete("/api/cases/:caseId/participants/:userId", () => {
        w.revokeAll();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { user } = renderPage();
    await waitForFullView();
    const summaryBefore = w.calls.summary;
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
    expect(
      await screen.findByRole("link", { name: "案件に戻る" }),
    ).toBeTruthy();
    await advance(POLL_MS * 3);
    expect(w.calls.summary).toBe(summaryBefore);
  });

  it("#308 AC-1・退出の維持: 概要が既に非参加（退出の後片付けの後）のとき、進行中のポーリングが 403 で返っても、概要を取り直さない", async () => {
    const w = world();
    const { client } = renderPage();
    await waitForFullView();
    const summaryBefore = w.calls.summary;
    // 退出の後片付けと同じ：概要を非参加に書き換える（取り直しはしない）
    act(() => {
      client.setQueryData(
        caseKeys.summary(TEST_USER.id, caseId(N)),
        outsiderSummary(N),
      );
    });
    w.revoke();
    await advance(POLL_MS * 3);
    await waitForSwitched();
    expect(w.calls.summary).toBe(summaryBefore);
  });
});
