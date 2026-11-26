// #308 AC-1〜AC-3（5-1 AC-2・AC-3）、計画 plan-308 の6章・10章：案件の画面（S-17）を開いたまま、ほかの参加者に外された人の画面を、
// 自動の更新（部屋のメッセージ・TODO の2秒ごとの取り直し）が拒否（403・404）を受けたことを契機に、非公開の表示へ切り替える。
// 偽の時計でポーリングを進める（固定の待ちを使わない）。API は MSW、保留は手で解決する Promise。データはすべて架空（testuser_・[UNIT_TEST]）。
// 画面の契約（実装の担当へ。テストが決めたもの）：
//   切り替わった後：「参加者だけが見られます（非公開）」だけを出し、説明・参加者の一覧・TODO の区画・やり取り・開いていたスレッド・ダイアログは出ない。
//   参加者のままの人（概要の取り直しが参加者）：何も変えない。詳細・TODO を取り直さず、概要の取り直しは1回だけ（要求が増え続けない）。
//   概要の取り直しが失敗（5xx）：中身を隠し、role="alert" で UNVERIFIED_TEXT と、button「再試行」を出す。
//     再試行で概要が参加者なら元に戻り（詳細を新しく取り直す）、非参加なら非公開の表示。まだ失敗なら隠したまま。
//   外された後に概要が参加者へ戻った（ほかの画面の取り直しなど）ときは、元に戻る。このとき、閉じたダイアログは開いたまま戻らない。
//   本人の下書き（端末の保存）：外されたと確定したら、その案件の部屋の下書きは消す（#340・C-207 で C-190(6) を置き換え。以前は「消さない」）。
//     ほかの部屋の下書きは残す。網羅は CaseAccessLoss.drafts.test.tsx。
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
  CASE_ATTACHMENT_TEXTS,
  caseAttachment,
  caseAttachmentName,
  respondCaseAttachments,
} from "../test/case-attachment-handlers";
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

/** 別の案件 B（参加者のまま。スレッドを開く）。A の遅れた確認の結果で、B の表示が変わらないことの確認に使う */
const OTHER_N = 309;
const OTHER_SECRET = "[UNIT_TEST]308別の案件Bの説明";
const OTHER_REPLY = "[UNIT_TEST]308別の案件Bのスレッドの返信";
const otherParent = message(11, {
  roomId: caseRoomId(OTHER_N),
  body: "[UNIT_TEST]308別の案件Bの本文",
  replyCount: 1,
});
const otherReply = message(12, {
  roomId: caseRoomId(OTHER_N),
  parentMessageId: otherParent.id,
  body: OTHER_REPLY,
});

/** 案件 B の応答（world の後に登録し、B の要求だけを受ける）。最初の取得（after なし）の回数を数える：取り除かれると増える */
function respondOtherCase() {
  const calls = { detail: 0, roomInitial: 0, repliesInitial: 0 };
  server.use(
    http.get("/api/cases/:caseId", ({ params }) =>
      params.caseId === caseId(OTHER_N)
        ? HttpResponse.json(caseSummary(OTHER_N))
        : undefined,
    ),
    http.get("/api/cases/:caseId/detail", ({ params }) => {
      if (params.caseId !== caseId(OTHER_N)) return undefined;
      calls.detail += 1;
      return HttpResponse.json(
        caseDetail(OTHER_N, {
          description: OTHER_SECRET,
          participants: [PARTICIPANT_CREATOR, SELF],
        }),
      );
    }),
    http.get("/api/rooms/:roomId/messages", ({ params, request }) => {
      if (params.roomId !== caseRoomId(OTHER_N)) return undefined;
      const after = new URL(request.url).searchParams.get("after");
      if (after === null) calls.roomInitial += 1;
      return HttpResponse.json({
        items: after === null ? [otherParent] : [],
        nextCursor: null,
        hasMore: false,
      });
    }),
    http.get("/api/messages/:messageId/replies", ({ params, request }) => {
      if (params.messageId !== otherParent.id) return undefined;
      const after = new URL(request.url).searchParams.get("after");
      if (after === null) calls.repliesInitial += 1;
      return HttpResponse.json({
        items: after === null ? [otherReply] : [],
        nextCursor: null,
        hasMore: false,
        parent: otherParent,
        replyBlockedReason: null,
        caseRoom: true,
        caseId: caseId(OTHER_N),
        joined: true,
        roomWritable: true,
      });
    }),
  );
  return calls;
}

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
  /** 詳細の取得の失敗（null なら通常） */
  detailFail: Failure | null;
  /** 概要・詳細の応答の保留 */
  gate: Promise<void> | null;
  /** 概要だけの応答の保留（詳細は保留しない） */
  summaryGate: Promise<void> | null;
  /** 詳細だけの応答の保留（概要は保留しない） */
  detailGate: Promise<void> | null;
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
    detailFail: null,
    gate: null,
    summaryGate: null,
    detailGate: null,
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
      if (w.summaryGate !== null) await w.summaryGate;
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
      if (w.detailGate !== null) await w.detailGate;
      if (w.detailFail !== null) return failureResponse(w.detailFail);
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
        caseRoom: true,
        caseId: caseId(N),
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
        <Link to={`/cases/${caseId(OTHER_N)}?thread=${otherParent.id}`}>
          別の案件へ移る
        </Link>
        <Link to={`/cases/${caseId(N)}`}>元の案件へ戻る</Link>
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

  // #340（C-207。利用者の決定 2026-11-20）：C-190(6)「下書きは消さない」を、資格を失った案件の部屋のメッセージの下書きに限って置き換えた。
  // 以前の期待（切り替わっても消えず、参加者に戻ったとき入力欄に復元される）を、消える・戻っても空、に改めた。ほかの部屋の下書きは残る
  it("#308 AC-1・#340 AC-1（本人の下書き。C-207）: 切り替わったら、その案件の部屋の下書きは端末から消え、参加者に戻っても入力欄は空。ほかの部屋の下書きは残る", async () => {
    const otherRoomKey = `internal-system:draft:v1:${TEST_USER.id}:room:${caseRoomId(OTHER_N)}`;
    window.localStorage.setItem(
      otherRoomKey,
      JSON.stringify({
        body: "[UNIT_TEST]308ほかの部屋の下書き",
        updatedAt: Date.now(),
      }),
    );
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
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
    expect(window.localStorage.getItem(otherRoomKey)).toContain(
      "[UNIT_TEST]308ほかの部屋の下書き",
    );
    w.restore();
    void client.invalidateQueries({ queryKey: caseKeys.all });
    await waitForFullView();
    const input = await screen.findByRole<HTMLTextAreaElement>("textbox", {
      name: "メッセージ",
    });
    expect(input.value).toBe("");
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
    // 概要の取り直しは、検出の1回だけ（TODO・部屋が同時に 403 でも重ねない）
    expect(w.calls.summary).toBe(summaryBefore + 1);
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

describe("#308 コードレビュー1回目 重大1 画面を離れた後の確認の結果は、移動先の画面に影響しない", () => {
  it.each([
    ["非参加", "lost"],
    ["失敗（500）", "failed"],
  ] as const)(
    "#308 AC-1: 案件 A の概要の取り直しを保留したまま案件 B のスレッドへ移り、A の結果が%sで返っても、B のスレッド・詳細・TODO・やり取りは消えず、取り直されない",
    async (_name, outcome) => {
      const w = world();
      const other = respondOtherCase();
      const { user } = renderPage();
      await waitForFullView();
      const gate = deferred();
      w.summaryGate = gate.promise;
      const summaryBefore = w.calls.summary;
      w.revoke();
      await advance(POLL_MS);
      await waitFor(() =>
        expect(w.calls.summary).toBeGreaterThan(summaryBefore),
      );

      await user.click(screen.getByRole("link", { name: "別の案件へ移る" }));
      await screen.findByText(OTHER_SECRET);
      await screen.findByText(OTHER_REPLY);
      const before = { ...other };

      // A の結果が、B を表示している間に返る
      if (outcome === "failed") w.summaryFail = { status: 500 };
      w.summaryGate = null;
      gate.release();
      await advance(500);

      expect(screen.getByText(OTHER_SECRET)).toBeTruthy();
      expect(screen.getByText(OTHER_REPLY)).toBeTruthy();
      expect(screen.getByRole("region", { name: "TODO" })).toBeTruthy();
      expect(screen.getByRole("heading", { name: "やり取り" })).toBeTruthy();
      expect(screen.queryByText(UNVERIFIED_TEXT)).toBeNull();
      expect(screen.queryByText(PRIVATE_TEXT)).toBeNull();
      expect(other).toEqual(before);
    },
  );

  it.each([
    ["非参加", "lost"],
    ["失敗（500）", "failed"],
  ] as const)(
    "#308 AC-1: 概要の取り直しを保留したまま一覧へ移り、結果が%sで返っても、例外・エラーの出力なしで、一覧側の表示は変わらない",
    async (_name, outcome) => {
      const w = world();
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      const { user } = renderPage();
      await waitForFullView();
      const gate = deferred();
      w.summaryGate = gate.promise;
      const summaryBefore = w.calls.summary;
      w.revoke();
      await advance(POLL_MS);
      await waitFor(() =>
        expect(w.calls.summary).toBeGreaterThan(summaryBefore),
      );
      await user.click(screen.getByRole("link", { name: "一覧へ移る" }));
      await screen.findByRole("link", { name: "案件に戻る" });
      if (outcome === "failed") w.summaryFail = { status: 500 };
      w.summaryGate = null;
      gate.release();
      await advance(500);
      expect(screen.getByRole("link", { name: "案件に戻る" })).toBeTruthy();
      expect(screen.queryByText(UNVERIFIED_TEXT)).toBeNull();
      expect(errors).not.toHaveBeenCalled();
      errors.mockRestore();
    },
  );
});

describe("#308 コードレビュー1回目 重大2 詳細の読み込みに失敗した状態でも、外されたら切り替わる", () => {
  const DETAIL_ERROR_TEXT = MESSAGES[500] ?? "";

  it("#308 AC-1: 概要は参加者で詳細が 500（エラーの表示）のまま外されたら、自動の更新と概要の取り直しの後に、非公開の表示に切り替わる", async () => {
    const w = world();
    w.detailFail = { status: 500 };
    renderPage();
    expect(await screen.findByText(DETAIL_ERROR_TEXT)).toBeTruthy();
    w.revokeAll();
    await advance(POLL_MS);
    await waitFor(() => {
      expect(screen.queryByText(DETAIL_ERROR_TEXT)).toBeNull();
      expect(screen.getByText(PRIVATE_TEXT)).toBeTruthy();
    });
    expectNothingShown();
  });

  it("#308 AC-3: 詳細が 500 のままで、参加者のままの人には、TODO が 403 を返し続けても、要求が増え続けず、エラーの表示のまま", async () => {
    const w = world();
    w.detailFail = { status: 500 };
    renderPage();
    expect(await screen.findByText(DETAIL_ERROR_TEXT)).toBeTruthy();
    const summaryBefore = w.calls.summary;
    w.todos.failWith = {
      status: 403,
      code: "FORBIDDEN",
      message: PRIVATE_TEXT,
    };
    await advance(POLL_MS * 3);
    const settled = {
      summary: w.calls.summary,
      detail: w.calls.detail,
      todo: w.todos.requests.length,
      room: w.calls.room,
    };
    expect(settled.summary).toBeLessThanOrEqual(summaryBefore + 1);
    for (let i = 0; i < 15; i += 1) await advance(POLL_MS);
    expect(w.calls.summary).toBe(settled.summary);
    expect(w.calls.detail).toBe(settled.detail);
    expect(w.todos.requests.length).toBe(settled.todo);
    expect(w.calls.room).toBe(settled.room);
    expect(screen.getByText(DETAIL_ERROR_TEXT)).toBeTruthy();
    expect(screen.queryByText(PRIVATE_TEXT)).toBeNull();
  });
});

describe("#308 コードレビュー1回目 軽微3 参加者のままなら、重ねない印を残す", () => {
  it("#308 AC-3: TODO の 403 → 概要は参加者のまま → 遅れて部屋の 403 が届いても、概要の追加の取得は起きない（印を残す）", async () => {
    const w = world();
    renderPage();
    await waitForFullView();
    const base = w.calls.summary;
    w.todos.failWith = {
      status: 403,
      code: "FORBIDDEN",
      message: PRIVATE_TEXT,
    };
    await advance(POLL_MS);
    await waitFor(() => expect(w.calls.summary).toBe(base + 1));
    await advance(300);
    expect(w.calls.summary).toBe(base + 1);
    // ずれて、部屋も 403 を返し始める
    const roomBefore = w.calls.room;
    w.roomFail = { status: 403 };
    await advance(POLL_MS);
    await waitFor(() => expect(w.calls.room).toBeGreaterThan(roomBefore));
    for (let i = 0; i < 5; i += 1) await advance(POLL_MS);
    expect(w.calls.summary).toBe(base + 1);
    expect(screen.getByText(SECRET)).toBeTruthy();
  });
});

describe("#308 コードレビュー2回目 重大 離れた後の確認が失敗で終わっても、元の案件の詳細・TODO を残さない", () => {
  it.each([
    ["500", { status: 500 }, "参加者に戻った", true],
    ["500", { status: 500 }, "非参加の", false],
    ["通信の失敗", "network", "参加者に戻った", true],
    ["通信の失敗", "network", "非参加の", false],
  ] as const)(
    "#308 AC-2: A の確認を保留して B へ移り、確認が%sで終わった後、%s A を開き直しても、詳細の応答を待つ間に古い説明・参加者・TODO が出ず、詳細を新しく取りにいく。B は影響を受けない",
    async (_name, failure, _state, returns) => {
      const w = world();
      const other = respondOtherCase();
      const { user } = renderPage();
      await waitForFullView();
      const gate = deferred();
      w.summaryGate = gate.promise;
      const summaryBefore = w.calls.summary;
      w.revoke();
      await advance(POLL_MS);
      await waitFor(() =>
        expect(w.calls.summary).toBeGreaterThan(summaryBefore),
      );
      await user.click(screen.getByRole("link", { name: "別の案件へ移る" }));
      await screen.findByText(OTHER_SECRET);
      await screen.findByText(OTHER_REPLY);
      const before = { ...other };

      // A の確認が、B を表示している間に失敗で終わる
      w.summaryFail = failure;
      w.summaryGate = null;
      gate.release();
      await advance(500);
      expect(screen.getByText(OTHER_SECRET)).toBeTruthy();
      expect(screen.getByText(OTHER_REPLY)).toBeTruthy();
      expect(other).toEqual(before);

      // A を開き直す：概要は成功し、詳細の応答は保留する
      w.summaryFail = null;
      if (returns) w.restore();
      const detailGate = deferred();
      w.detailGate = detailGate.promise;
      const detailBefore = w.calls.detail;
      const summaryAtReopen = w.calls.summary;
      await user.click(screen.getByRole("link", { name: "元の案件へ戻る" }));
      await waitFor(() =>
        expect(w.calls.summary).toBeGreaterThan(summaryAtReopen),
      );
      if (returns)
        await waitFor(() =>
          expect(w.calls.detail).toBeGreaterThan(detailBefore),
        );
      await advance(300);
      expect(screen.queryByText(SECRET)).toBeNull();
      expect(screen.queryByRole("list", { name: "参加者" })).toBeNull();
      expect(screen.queryByRole("region", { name: "TODO" })).toBeNull();
      expect(screen.queryByText(todoTitle(1))).toBeNull();
      expect(screen.queryByText(PARTICIPANT_CREATOR.displayName)).toBeNull();

      w.detailGate = null;
      detailGate.release();
      if (returns) expect(await screen.findByText(SECRET)).toBeTruthy();
      else await waitForSwitched();
    },
  );
});

describe("#308 148-B-1 添付の一覧のキャッシュも、資格を失ったときに取り除く", () => {
  const FILE = caseAttachmentName(1);
  const attachmentsRegion = () =>
    screen.queryByRole("region", { name: CASE_ATTACHMENT_TEXTS.heading });

  /** 添付の一覧の応答を、手で解放するまで保留する（respondCaseAttachments の応答の前に差し込む） */
  function holdAttachments() {
    const gate = deferred();
    let holding = true;
    const arrived = { count: 0 };
    server.use(
      http.get("/api/cases/:caseId/attachments", async () => {
        arrived.count += 1;
        if (holding) await gate.promise;
        return undefined;
      }),
    );
    return {
      arrived,
      release() {
        holding = false;
        gate.release();
      },
    };
  }

  it("#308 AC-1・AC-2: 添付の一覧を表示中に外されたら、区画・ファイル名が出ず、参加者に戻って開き直すと、応答を保留している間に古いファイル名が出ず、一覧を新しく取りにいく", async () => {
    const w = world();
    respondCaseAttachments([caseAttachment(1)]);
    const { user } = renderPage();
    await waitForFullView();
    expect(await screen.findByRole("link", { name: FILE })).toBeTruthy();
    w.revoke();
    await advance(POLL_MS);
    await waitForSwitched();
    expect(attachmentsRegion()).toBeNull();
    expect(screen.queryByText(FILE)).toBeNull();

    await user.click(screen.getByRole("link", { name: "一覧へ移る" }));
    const back = await screen.findByRole("link", { name: "案件に戻る" });
    w.restore();
    const hold = holdAttachments();
    await user.click(back);
    expect(await screen.findByText(SECRET)).toBeTruthy();
    // 一覧を新しく取りにいく（キャッシュを使わない）。応答は保留中
    await waitFor(() => expect(hold.arrived.count).toBeGreaterThan(0));
    await advance(300);
    expect(screen.queryByText(FILE)).toBeNull();
    hold.release();
    expect(await screen.findByRole("link", { name: FILE })).toBeTruthy();
  });

  it("#308 AC-2: 画面を離れた後に確認の結果が返った場合も、元の案件の添付の一覧のキャッシュを取り除き、開き直した間に古いファイル名が出ない", async () => {
    const w = world();
    respondCaseAttachments([caseAttachment(1)]);
    respondOtherCase();
    const { user } = renderPage();
    await waitForFullView();
    await screen.findByRole("link", { name: FILE });
    const gate = deferred();
    w.summaryGate = gate.promise;
    const summaryBefore = w.calls.summary;
    w.revoke();
    await advance(POLL_MS);
    await waitFor(() => expect(w.calls.summary).toBeGreaterThan(summaryBefore));
    await user.click(screen.getByRole("link", { name: "別の案件へ移る" }));
    await screen.findByText(OTHER_SECRET);
    w.summaryGate = null;
    gate.release();
    await advance(500);

    w.restore();
    const hold = holdAttachments();
    await user.click(screen.getByRole("link", { name: "元の案件へ戻る" }));
    expect(await screen.findByText(SECRET)).toBeTruthy();
    await waitFor(() => expect(hold.arrived.count).toBeGreaterThan(0));
    await advance(300);
    expect(screen.queryByText(FILE)).toBeNull();
    hold.release();
    expect(await screen.findByRole("link", { name: FILE })).toBeTruthy();
  });
});

// #148（148-B-2）5-2 AC-9・計画 6.8「資格を失ったとき」：公開範囲の変更の後の取り直しで、添付の一覧が 403 になったら、
// 概要を確かめて非公開の表示に切り替え、ファイル名・ダイアログを残さない（useCaseAccessLoss の監視の対象に添付の一覧を足す）。
// 注：変更の後は caseKeys.all を取り直すため、概要の取り直しでも切り替わりうる。ここでは利用者から見える結果（切り替わる・何も残らない）を固定する。
describe("#148 AC-9 公開範囲の変更の後に、外されていたとき", () => {
  it("#148 AC-9: 変更が 404 で、添付の一覧の取り直しが 403 なら、非公開の表示に切り替わり、ファイル名もダイアログも出ない", async () => {
    const w = world();
    const attachments = respondCaseAttachments([
      caseAttachment(1, { canChangeVisibility: true }),
    ]);
    const { user } = renderPage();
    await waitForFullView();
    const region = await screen.findByRole("region", {
      name: CASE_ATTACHMENT_TEXTS.heading,
    });
    await within(region).findByText(caseAttachmentName(1));
    w.participant = false;
    attachments.failWith = {
      status: 403,
      code: "FORBIDDEN",
      message: PRIVATE_TEXT,
    };
    attachments.patchFailWith = {
      status: 404,
      code: "NOT_FOUND",
      message: "添付が見つかりません",
    };
    await user.click(
      within(region).getByRole("button", {
        name: `${caseAttachmentName(1)} の公開範囲を変更`,
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "公開範囲を変更",
    });
    await user.click(
      within(dialog).getByRole("radio", {
        name: "全社員公開アーカイブで公開できる",
      }),
    );
    await user.click(within(dialog).getByRole("button", { name: "変更" }));
    await waitForSwitched();
    expect(screen.queryByText(caseAttachmentName(1))).toBeNull();
    expect(screen.queryByRole("dialog", { hidden: true })).toBeNull();
  });
});

// #363 AC-1・AC-2：参加者として概要を受け取った後に、概要の取り直しだけが失敗したとき。
// 5xx・通信の失敗は、資格を失った証拠ではない（既存の概要の失敗の表示に任せ、詳細・TODO のキャッシュは片付けない）。404 は、これまでどおり片付ける。
// 概要の取り直しは、概要のクエリだけを無効にして起こす（部屋・TODO の拒否は起こさない）。
describe("#363 概要の取り直しだけが失敗したとき、資格の喪失と取り違えない", () => {
  const SUMMARY_KEY = caseKeys.summary(TEST_USER.id, caseId(N));
  const DETAIL_KEY = caseKeys.detail(TEST_USER.id, caseId(N));
  const TODOS_KEY = caseKeys.todos(TEST_USER.id, caseId(N));

  async function failSummaryOnly(failure: Failure) {
    const w = world();
    const rendered = renderPage();
    await waitForFullView();
    expect(rendered.client.getQueryData(DETAIL_KEY)).toBeDefined();
    expect(rendered.client.getQueryData(TODOS_KEY)).toBeDefined();
    w.summaryFail = failure;
    await act(async () => {
      await rendered.client.invalidateQueries({ queryKey: SUMMARY_KEY });
    });
    return { w, ...rendered };
  }

  it.each([
    ["500", { status: 500 }],
    ["通信の失敗", "network"],
  ] as const)(
    "#363 AC-1: 参加者のまま、概要の取り直しだけが%sになっても、片付けず、詳細・TODO のキャッシュが残り、非公開の表示にも確かめられない表示にもならない",
    async (_name, failure) => {
      const { client } = await failSummaryOnly(failure);
      // 既存の概要の失敗の表示（role=alert）が出る
      await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
      expect(screen.queryByText(PRIVATE_TEXT)).toBeNull();
      expect(screen.queryByText(UNVERIFIED_TEXT)).toBeNull();
      // 後片付けの効果が走る時間を与え、ポーリングが続いた後も残っていることを確かめる
      await advance(POLL_MS * 2);
      expect(client.getQueryData(DETAIL_KEY)).toBeDefined();
      expect(client.getQueryData(TODOS_KEY)).toBeDefined();
    },
  );

  it("#363 AC-2: 参加者としての概要を受け取った後、概要の取り直しが 404 になったら、これまでどおり片付け、詳細・TODO のキャッシュが消える", async () => {
    const { client } = await failSummaryOnly({ status: 404 });
    expect(await screen.findByText(CASE_TEXTS.notFound)).toBeTruthy();
    await waitFor(() => {
      expect(client.getQueryData(DETAIL_KEY)).toBeUndefined();
      expect(client.getQueryData(TODOS_KEY)).toBeUndefined();
    });
  });
});

// #363 コードレビュー（重大）の直し：概要の取り直しが失敗している間に、画面が作り直された（別の画面へ移って戻る）場合。
// キャッシュには、以前の参加者としての概要・詳細・TODO が残っている。その後に 404・非参加が確かめられたら、AC-2・AC-3 のとおり片付ける。
// 概要がまた 5xx・通信の失敗なら、AC-1 のとおり片付けない。「参加者だったことの記録」の持ち方は、テストの前提にしない（画面を通して確かめる）。
describe("#363 概要の失敗の間に画面が作り直されても、後で確かめられた喪失は片付ける", () => {
  const SUMMARY_KEY = caseKeys.summary(TEST_USER.id, caseId(N));
  const DETAIL_KEY = caseKeys.detail(TEST_USER.id, caseId(N));
  const TODOS_KEY = caseKeys.todos(TEST_USER.id, caseId(N));

  async function summaryFailedThenRemount(
    first: Failure,
    next: (w: World) => void,
  ) {
    const w = world();
    const rendered = renderPage();
    await waitForFullView();
    expect(rendered.client.getQueryData(DETAIL_KEY)).toBeDefined();
    expect(rendered.client.getQueryData(TODOS_KEY)).toBeDefined();
    w.summaryFail = first;
    await act(async () => {
      await rendered.client.invalidateQueries({ queryKey: SUMMARY_KEY });
    });
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    // 片付けていない（AC-1）。ここから画面を外して、同じ QueryClient のまま戻る
    expect(rendered.client.getQueryData(DETAIL_KEY)).toBeDefined();
    expect(rendered.client.getQueryData(TODOS_KEY)).toBeDefined();
    await rendered.user.click(screen.getByRole("link", { name: "一覧へ移る" }));
    await screen.findByRole("link", { name: "案件に戻る" });
    next(w);
    await rendered.user.click(screen.getByRole("link", { name: "案件に戻る" }));
    return { w, ...rendered };
  }

  it.each([
    ["500", { status: 500 }],
    ["通信の失敗", "network"],
  ] as const)(
    "#363 R-1 AC-2: 概要の取り直しが%sの間に画面を作り直し、その後 404 が確かめられたら、詳細・TODO のキャッシュが消える",
    async (_name, first) => {
      const { client } = await summaryFailedThenRemount(first, (w) => {
        w.summaryFail = { status: 404 };
      });
      expect(await screen.findByText(CASE_TEXTS.notFound)).toBeTruthy();
      await waitFor(() => {
        expect(client.getQueryData(DETAIL_KEY)).toBeUndefined();
        expect(client.getQueryData(TODOS_KEY)).toBeUndefined();
      });
    },
  );

  it("#363 R-2 AC-3: 概要の取り直しが 500 の間に画面を作り直し、その後、概要が成功して参加者でなくなっていたら、詳細・TODO のキャッシュが消え、非公開の表示になる", async () => {
    const { client } = await summaryFailedThenRemount({ status: 500 }, (w) => {
      w.summaryFail = null;
      w.participant = false;
    });
    await waitForSwitched();
    await waitFor(() => {
      expect(client.getQueryData(DETAIL_KEY)).toBeUndefined();
      expect(client.getQueryData(TODOS_KEY)).toBeUndefined();
    });
  });

  it("#363 R-3 AC-1・AC-2: 画面を作り直さずに、概要の取り直しが 500 になった後、404 になったら、片付ける（500 の間は残る）", async () => {
    const w = world();
    const { client } = renderPage();
    await waitForFullView();
    w.summaryFail = { status: 500 };
    await act(async () => {
      await client.invalidateQueries({ queryKey: SUMMARY_KEY });
    });
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(client.getQueryData(DETAIL_KEY)).toBeDefined();
    expect(client.getQueryData(TODOS_KEY)).toBeDefined();
    w.summaryFail = { status: 404 };
    await act(async () => {
      await client.invalidateQueries({ queryKey: SUMMARY_KEY });
    });
    expect(await screen.findByText(CASE_TEXTS.notFound)).toBeTruthy();
    await waitFor(() => {
      expect(client.getQueryData(DETAIL_KEY)).toBeUndefined();
      expect(client.getQueryData(TODOS_KEY)).toBeUndefined();
    });
  });

  it.each([
    ["500", { status: 500 }],
    ["通信の失敗", "network"],
  ] as const)(
    "#363 R-4 AC-1: 概要の取り直しが失敗の間に画面を作り直し、概要がまた%sなら、片付けず、詳細・TODO のキャッシュが残る",
    async (_name, failure) => {
      const { client } = await summaryFailedThenRemount(failure, (w) => {
        w.summaryFail = failure;
      });
      await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
      expect(screen.queryByText(PRIVATE_TEXT)).toBeNull();
      expect(screen.queryByText(UNVERIFIED_TEXT)).toBeNull();
      await advance(POLL_MS * 2);
      expect(client.getQueryData(DETAIL_KEY)).toBeDefined();
      expect(client.getQueryData(TODOS_KEY)).toBeDefined();
    },
  );

  // コードレビュー2回目（重大）：画面を外している間に、概要のキャッシュが 404・非参加になった（購読者がいないので、片付けは走らない）。
  // 戻ったときには、すでに 404 または非参加で作り直される。5xx の時点で片付けていた main と同じく、前の参加者としての詳細・TODO は消える（AC-2・AC-3）。
  // 画面を外している間に、同じ QueryClient で概要だけを取り直し、キャッシュの状態を条件で待ってから戻る。
  async function leaveWithSummaryFailed500() {
    const w = world();
    const rendered = renderPage();
    await waitForFullView();
    w.summaryFail = { status: 500 };
    await act(async () => {
      await rendered.client.invalidateQueries({ queryKey: SUMMARY_KEY });
    });
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(rendered.client.getQueryData(DETAIL_KEY)).toBeDefined();
    expect(rendered.client.getQueryData(TODOS_KEY)).toBeDefined();
    await rendered.user.click(screen.getByRole("link", { name: "一覧へ移る" }));
    await screen.findByRole("link", { name: "案件に戻る" });
    return { w, ...rendered };
  }

  async function backToCase(user: ReturnType<typeof renderPage>["user"]) {
    await user.click(screen.getByRole("link", { name: "案件に戻る" }));
  }

  it("#363 R-6 AC-2: 500 の後に画面を外し、外れている間に概要のキャッシュが 404 の失敗になってから戻ると、詳細・TODO のキャッシュが消える", async () => {
    const { w, client, user } = await leaveWithSummaryFailed500();
    w.summaryFail = { status: 404 };
    await act(async () => {
      await client.refetchQueries({ queryKey: SUMMARY_KEY, exact: true });
    });
    await waitFor(() => {
      const state = client.getQueryState(SUMMARY_KEY);
      expect(state?.status).toBe("error");
      expect((state?.error as { status?: number } | null)?.status).toBe(404);
    });
    // 前の参加者としての値が、まだ残っている（この条件で戻る）
    expect(client.getQueryData(DETAIL_KEY)).toBeDefined();
    await backToCase(user);
    expect(await screen.findByText(CASE_TEXTS.notFound)).toBeTruthy();
    await waitFor(() => {
      expect(client.getQueryData(DETAIL_KEY)).toBeUndefined();
      expect(client.getQueryData(TODOS_KEY)).toBeUndefined();
    });
  });

  // R-7：期待は AC-3（非参加になったら、参加者だけの中身を取り除く）と、main の動き（5xx で参加者でなくなった時点で、詳細・TODO を取り除いていた）から決めた。
  // この場合、キャッシュの data 自体が非参加に置き換わるので、「キャッシュの概要が参加者」だけでは、参加者だったことは分からない。
  it("#363 R-7 AC-3: 500 の後に画面を外し、外れている間に概要が成功して参加者でなくなってから戻ると、詳細・TODO のキャッシュが消え、非公開の表示になる", async () => {
    const { w, client, user } = await leaveWithSummaryFailed500();
    w.summaryFail = null;
    w.participant = false;
    await act(async () => {
      await client.refetchQueries({ queryKey: SUMMARY_KEY, exact: true });
    });
    await waitFor(() => {
      const state = client.getQueryState(SUMMARY_KEY);
      expect(state?.status).toBe("success");
      expect(
        client.getQueryData<{ isParticipant: boolean }>(SUMMARY_KEY)
          ?.isParticipant,
      ).toBe(false);
    });
    expect(client.getQueryData(DETAIL_KEY)).toBeDefined();
    await backToCase(user);
    await waitForSwitched();
    await waitFor(() => {
      expect(client.getQueryData(DETAIL_KEY)).toBeUndefined();
      expect(client.getQueryData(TODOS_KEY)).toBeUndefined();
    });
  });

  // R-8：喪失の応答（404）の取得が、画面を離れる前から続いていて、離れた後に返る。
  it("#363 R-8 AC-2: 500 の後、概要の取り直し（404）の応答を保留したまま画面を外し、離れてから応答が返り、戻ると、詳細・TODO のキャッシュが消える", async () => {
    const w = world();
    const { client, user } = renderPage();
    await waitForFullView();
    w.summaryFail = { status: 500 };
    await act(async () => {
      await client.invalidateQueries({ queryKey: SUMMARY_KEY });
    });
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    // 次の取り直しは 404 だが、応答を保留する
    const gate = deferred();
    w.summaryFail = { status: 404 };
    w.summaryGate = gate.promise;
    const summaryBefore = w.calls.summary;
    void client.refetchQueries({ queryKey: SUMMARY_KEY, exact: true });
    await waitFor(() => expect(w.calls.summary).toBeGreaterThan(summaryBefore));
    await user.click(screen.getByRole("link", { name: "一覧へ移る" }));
    await screen.findByRole("link", { name: "案件に戻る" });
    expect(client.getQueryData(DETAIL_KEY)).toBeDefined();
    // 応答を返す（画面は外れたまま）
    w.summaryGate = null;
    gate.release();
    await waitFor(() => {
      const state = client.getQueryState(SUMMARY_KEY);
      expect(state?.status).toBe("error");
      expect((state?.error as { status?: number } | null)?.status).toBe(404);
    });
    await backToCase(user);
    expect(await screen.findByText(CASE_TEXTS.notFound)).toBeTruthy();
    await waitFor(() => {
      expect(client.getQueryData(DETAIL_KEY)).toBeUndefined();
      expect(client.getQueryData(TODOS_KEY)).toBeUndefined();
    });
  });

  // R-9：片付けが済んだ後に、作り直しを重ねても、壊れない
  it("#363 R-9 AC-2: 404 で片付いた後、一覧へ移って戻ることを2回重ねても、エラーにならず、「案件が見つかりません」のまま、詳細・TODO のキャッシュは消えたまま", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const w = world();
    const { client, user } = renderPage();
    await waitForFullView();
    w.summaryFail = { status: 500 };
    await act(async () => {
      await client.invalidateQueries({ queryKey: SUMMARY_KEY });
    });
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    w.summaryFail = { status: 404 };
    await act(async () => {
      await client.invalidateQueries({ queryKey: SUMMARY_KEY });
    });
    expect(await screen.findByText(CASE_TEXTS.notFound)).toBeTruthy();
    await waitFor(() => {
      expect(client.getQueryData(DETAIL_KEY)).toBeUndefined();
      expect(client.getQueryData(TODOS_KEY)).toBeUndefined();
    });
    for (let round = 0; round < 2; round += 1) {
      await user.click(screen.getByRole("link", { name: "一覧へ移る" }));
      await screen.findByRole("link", { name: "案件に戻る" });
      await backToCase(user);
      expect(await screen.findByText(CASE_TEXTS.notFound)).toBeTruthy();
      await advance(POLL_MS);
      expect(client.getQueryData(DETAIL_KEY)).toBeUndefined();
      expect(client.getQueryData(TODOS_KEY)).toBeUndefined();
    }
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  // R-5：統括の決定（設計）。概要で「参加者でない」ことが確かめられた（成功して非参加・404）ときは、この画面で参加者だったかに関わらず、
  // 参加者だけの中身（詳細・TODO のキャッシュ）を消す。根拠：Skill「security」（資格のない人に、中身を残さない）。
  // 記録を別に持たないので、作り直し・応答と離脱の重なりのどの順序でも取りこぼさない。main は消さなかったが、確かめられた非参加の人に中身を残さない方へそろえる。
  // 「資格を失った」ことの表示（確かめられない表示）は、参加者だったことを見ていないので出ない。
  it("#363 R-5 AC-3: 参加者だったことがない案件を、最初から非参加で開くと、非公開の表示になり、キャッシュにある詳細（目印の値）は消える", async () => {
    const w = world();
    w.participant = false;
    const rendered = renderPage();
    const sentinelDetail = { sentinel: "[UNIT_TEST]363既存の詳細" };
    rendered.client.setQueryData(DETAIL_KEY, sentinelDetail);
    await waitForSwitched();
    await waitFor(() =>
      expect(rendered.client.getQueryData(DETAIL_KEY)).toBeUndefined(),
    );
    await advance(POLL_MS * 2);
    expect(rendered.client.getQueryData(DETAIL_KEY)).toBeUndefined();
    expect(screen.queryByText(UNVERIFIED_TEXT)).toBeNull();
  });

  it("#363 R-5b AC-2: 参加者だったことがない案件を、最初から 404 で開くと、「案件が見つかりません」になり、キャッシュにある詳細（目印の値）は消える", async () => {
    const w = world();
    w.summaryFail = { status: 404 };
    const rendered = renderPage();
    const sentinelDetail = { sentinel: "[UNIT_TEST]363既存の詳細404" };
    rendered.client.setQueryData(DETAIL_KEY, sentinelDetail);
    expect(await screen.findByText(CASE_TEXTS.notFound)).toBeTruthy();
    await waitFor(() =>
      expect(rendered.client.getQueryData(DETAIL_KEY)).toBeUndefined(),
    );
    await advance(POLL_MS * 2);
    expect(rendered.client.getQueryData(DETAIL_KEY)).toBeUndefined();
    expect(screen.queryByText(UNVERIFIED_TEXT)).toBeNull();
  });
});
