// #340 AC-1〜AC-4（計画 plan-340 改訂1 のテストケースの表の「画面」の行と D-1・D-2、利用者の決定 Q1・Q2）：S-17 の実際の入力欄で書いた下書きが、
// 資格の喪失が確定したときに、端末の保存先（localStorage）から消えること。消してはいけないものが残ること。
//   消す：その案件の部屋への投稿の下書きと、その部屋のスレッドの返信の下書き（持ち主のものだけ）。
//   残す：ほかの部屋（チャンネル・ほかの案件の部屋・部屋の ID が前方一致するだけの部屋）・申請・ほかの利用者の下書き、
//         確定していない場合（Q2 の確かめられない・参加者のままの 403・この画面で参加者だったことを見ていない非参加）。
// 入力欄の実際のキーと、消すキーが一致することは、画面の層でしか確かめられない（計画の表）。
// 読み込み直しの入口は test/setup.ts の vi.fn のまま（実際の読み込み直しは CaseAccessLossReload.waiting.test.tsx）。
// 偽の時計でポーリングを進める。API は MSW、保留は手で解く Promise。キーは本番の関数を使わずリテラルで書く。データは架空（testuser_・[UNIT_TEST]）。
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
  todoItem,
  todoTitle,
  type TodoServerState,
} from "../test/case-todo-handlers";
import { apiErrorResponse, message } from "../test/message-handlers";
import { server } from "../test/server";
import { CaseDetailPage } from "./CaseDetailPage";

const N = 340;
const OTHER_N = 341;
const POLL_MS = 2_000;
const SECRET = "[UNIT_TEST]340外されると見えなくなる説明";
const MESSAGE_TEXT = "[UNIT_TEST]340やり取りの本文";
const REPLY_TEXT = "[UNIT_TEST]340スレッドの返信";
const PRIVATE_TEXT = CASE_TEXTS.participantsOnly;
const UNVERIFIED_TEXT = "案件の情報を確かめられませんでした";
// user.type は「[」「{」をキーの指定として読むため、打つ文には含めない
const ROOM_DRAFT = "340の部屋への書きかけ";
const REPLY_DRAFT = "340の返信の書きかけ";
const CASE_PATH = `/cases/${caseId(N)}`;
const SUMMARY_KEY = caseKeys.summary(TEST_USER.id, caseId(N));
const DETAIL_KEY = caseKeys.detail(TEST_USER.id, caseId(N));

const USER_B = {
  id: "01JTESTUSER340B00000000001",
  displayName: "testuser_340_b",
  loginId: "testuser_340_b",
};
const CHANNEL_ROOM = "01JTESTROOM340000000000CH1";

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

const keyOf = (userId: string, scope: string) =>
  `internal-system:draft:v1:${userId}:${scope}`;
const ROOM_KEY = keyOf(TEST_USER.id, `room:${caseRoomId(N)}`);
const THREAD_KEY = keyOf(
  TEST_USER.id,
  `thread:${caseRoomId(N)}:${parentMessage.id}`,
);
/** 以前の文書で保存した、同じ部屋の別のスレッドの返信の下書き */
const OTHER_THREAD_KEY = keyOf(
  TEST_USER.id,
  `thread:${caseRoomId(N)}:01JTESTMSG3400000000000PX9`,
);
/** 残すもの（事前に保存先に置く） */
const KEPT = [
  keyOf(TEST_USER.id, `room:${CHANNEL_ROOM}`),
  keyOf(TEST_USER.id, `room:${caseRoomId(OTHER_N)}`),
  keyOf(TEST_USER.id, `room:${caseRoomId(N)}0`),
  keyOf(TEST_USER.id, `thread:${caseRoomId(N)}0:${parentMessage.id}`),
  keyOf(TEST_USER.id, "case-request:new"),
  keyOf(USER_B.id, `room:${caseRoomId(N)}`),
  keyOf(USER_B.id, `thread:${caseRoomId(N)}:${parentMessage.id}`),
];

function put(key: string, label: string) {
  window.localStorage.setItem(
    key,
    JSON.stringify({ body: `[UNIT_TEST]340${label}`, updatedAt: Date.now() }),
  );
}

function seedKept() {
  KEPT.forEach((key, index) => put(key, `残す${index}`));
}

/** 以前の文書で保存した、この案件の部屋の下書き（入力欄を使わずに置く） */
function seedCaseRoomDrafts() {
  put(ROOM_KEY, "前の文書の部屋");
  put(THREAD_KEY, "前の文書の返信");
  put(OTHER_THREAD_KEY, "前の文書の別の返信");
}

const present = (list: string[]) =>
  list.filter((key) => window.localStorage.getItem(key) !== null);

function expectKeptIntact() {
  expect(present(KEPT)).toEqual(KEPT);
}

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
    failure.status === 403
      ? PRIVATE_TEXT
      : failure.status === 404
        ? CASE_TEXTS.notFound
        : "[UNIT_TEST]340失敗",
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

type World = {
  participant: boolean;
  summaryFail: Failure | null;
  detailFail: Failure | null;
  roomFail: Failure | null;
  summaryGate: Promise<void> | null;
  calls: { summary: number };
  todos: TodoServerState;
};

function world(): World {
  const todos = respondTodos([todoItem(1)]);
  const w: World = {
    participant: true,
    summaryFail: null,
    detailFail: null,
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
      return HttpResponse.json(
        w.participant ? caseSummary(N) : outsiderSummary(N),
      );
    }),
    http.get("/api/cases/:caseId/detail", () => {
      if (w.detailFail !== null) return failureResponse(w.detailFail);
      if (!w.participant) return failureResponse({ status: 403 });
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
    http.get("/api/messages/:messageId/replies", ({ request }) => {
      const after = new URL(request.url).searchParams.get("after");
      return HttpResponse.json({
        items: after === null ? [threadReply] : [],
        nextCursor: null,
        hasMore: false,
        parent: parentMessage,
        replyBlockedReason: null,
        caseRoom: true,
        joined: true,
        roomWritable: true,
      });
    }),
    http.put(
      "/api/messages/:messageId/thread-read-position",
      () => new HttpResponse(null, { status: 204 }),
    ),
  );
  return w;
}

function revoke(w: World) {
  w.participant = false;
  w.roomFail = { status: 403 };
  w.todos.failWith = { status: 403, code: "FORBIDDEN", message: PRIVATE_TEXT };
}

function sessionOf(user: { id: string; displayName: string; loginId: string }) {
  return {
    user,
    mustChangePassword: false,
    reauthenticatedAt: null,
    permissions: [],
  };
}

function renderPage(
  options: { thread?: boolean; prime?: (client: QueryClient) => void } = {},
) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  client.setQueryData(authKeys.session, sessionOf(TEST_USER));
  options.prime?.(client);
  server.use(
    http.get("/api/auth/session", () =>
      HttpResponse.json(sessionOf(TEST_USER)),
    ),
  );
  const user = userEvent.setup();
  const search = options.thread === true ? `?thread=${parentMessage.id}` : "";
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`${CASE_PATH}${search}`]}>
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

/** 実際の入力欄に、部屋への投稿と、スレッドの返信の下書きを書く（thread: true で描いたとき） */
async function typeDrafts(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    await screen.findByRole("textbox", { name: "メッセージ" }),
    ROOM_DRAFT,
  );
  const thread = await screen.findByRole("region", { name: "スレッド" });
  await user.type(
    await within(thread).findByRole("textbox", { name: "返信" }),
    REPLY_DRAFT,
  );
  // 入力欄が書いたキーが、テストの決めたキーと一致する（否定の確認が空振りしない）
  expect(window.localStorage.getItem(ROOM_KEY)).toContain(ROOM_DRAFT);
  expect(window.localStorage.getItem(THREAD_KEY)).toContain(REPLY_DRAFT);
}

/** 本人が「参加者を管理」から退出する（確認のダイアログで確定する） */
async function leaveSelf(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "参加者を管理" }));
  const manager = await screen.findByRole("dialog", { name: "参加者を管理" });
  const selfRow = within(manager)
    .getAllByRole("listitem")
    .find((row) => row.textContent?.includes(SELF.displayName));
  if (selfRow === undefined) throw new Error("本人の行がありません");
  await user.click(within(selfRow).getByRole("button", { name: "退出する" }));
  const confirm = await screen.findByRole("dialog", { name: "案件からの退出" });
  await user.click(within(confirm).getByRole("button", { name: "退出する" }));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  seedKept();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("#340 AC-1 喪失が確定したら、実際の入力欄で書いた、その部屋の下書きが消える", () => {
  it("#340 AC-1 (a) 表示中: 部屋への投稿とスレッドの返信を書いた後に外される（拒否 → 確かめで非参加）と、2つとも消える。チャンネル・ほかの案件の部屋・前方一致の部屋・申請・ほかの利用者の下書きは残る", async () => {
    const w = world();
    const { user } = renderPage({ thread: true });
    await waitForFullView();
    await typeDrafts(user);
    revoke(w);
    await advance(POLL_MS);
    await waitForSwitched();
    await waitFor(() => expect(present([ROOM_KEY, THREAD_KEY])).toEqual([]));
    expectKeptIntact();
  });

  it("#340 AC-1 (a) 表示中: 確かめが 404 でも、その部屋の下書き（以前の文書のスレッドの返信を含む）が消える", async () => {
    const w = world();
    const { user } = renderPage({ thread: true });
    await waitForFullView();
    await typeDrafts(user);
    put(OTHER_THREAD_KEY, "前の文書の別の返信");
    revoke(w);
    w.summaryFail = { status: 404 };
    await advance(POLL_MS);
    expect(await screen.findByText(CASE_TEXTS.notFound)).toBeTruthy();
    await waitFor(() =>
      expect(present([ROOM_KEY, THREAD_KEY, OTHER_THREAD_KEY])).toEqual([]),
    );
    expectKeptIntact();
  });

  it("#340 AC-1 (b): 概要の取り直しが先に非参加になっても（この画面で参加者として見た後）、その部屋の下書きが消える", async () => {
    const w = world();
    const { user, client } = renderPage({ thread: true });
    await waitForFullView();
    await typeDrafts(user);
    w.participant = false;
    await act(async () => {
      await client.invalidateQueries({ queryKey: SUMMARY_KEY });
    });
    await waitForSwitched();
    expect(present([ROOM_KEY, THREAD_KEY])).toEqual([]);
    expectKeptIntact();
  });

  it.each([
    ["非参加", "lost"],
    ["404", "notFound"],
  ] as const)(
    "#340 AC-1 (a) 画面を離れた後: 確かめの途中に S-17 を離れ、その後に%sが届いても、その部屋の下書きが消える",
    async (_name, verdict) => {
      const w = world();
      const { user } = renderPage({ thread: true });
      await waitForFullView();
      await typeDrafts(user);
      const gate = deferred();
      w.summaryGate = gate.promise;
      const before = w.calls.summary;
      revoke(w);
      if (verdict === "notFound") w.summaryFail = { status: 404 };
      await advance(POLL_MS);
      await waitFor(() => expect(w.calls.summary).toBeGreaterThan(before));
      await user.click(screen.getByRole("link", { name: "一覧へ移る" }));
      await screen.findByRole("link", { name: "案件に戻る" });
      expect(present([ROOM_KEY, THREAD_KEY])).toEqual([ROOM_KEY, THREAD_KEY]);
      w.summaryGate = null;
      gate.release();
      await waitFor(() => expect(present([ROOM_KEY, THREAD_KEY])).toEqual([]));
      expectKeptIntact();
    },
  );

  it.each([
    ["非参加", "lost"],
    ["404", "notFound"],
  ] as const)(
    "#340 AC-1 D-1: 詳細が 500 のまま取得できず、参加者の概要だけを受け取った後に、概要が%sになると、以前の文書で保存した、その部屋の下書き（投稿・スレッドの返信）が消える",
    async (_name, verdict) => {
      const w = world();
      w.detailFail = { status: 500 };
      seedCaseRoomDrafts();
      const { client } = renderPage();
      await waitFor(() => {
        expect(client.getQueryData(SUMMARY_KEY)).toEqual(
          expect.objectContaining({ isParticipant: true }),
        );
        expect(client.getQueryState(DETAIL_KEY)?.status).toBe("error");
      });
      // 入力欄は描かれていない（詳細を受け取っていない）
      expect(screen.queryByRole("textbox", { name: "メッセージ" })).toBeNull();
      if (verdict === "lost") w.participant = false;
      else w.summaryFail = { status: 404 };
      await act(async () => {
        await client.invalidateQueries({ queryKey: SUMMARY_KEY });
      });
      await waitFor(() =>
        expect(present([ROOM_KEY, THREAD_KEY, OTHER_THREAD_KEY])).toEqual([]),
      );
      expectKeptIntact();
    },
  );

  it("#340 AC-1 (c) Q1: S-17 で本人が退出に成功すると、その部屋の下書きが消える", async () => {
    const w = world();
    server.use(
      http.delete("/api/cases/:caseId/participants/:userId", () => {
        revoke(w);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { user } = renderPage({ thread: true });
    await waitForFullView();
    await typeDrafts(user);
    await leaveSelf(user);
    await waitFor(() => expect(present([ROOM_KEY, THREAD_KEY])).toEqual([]));
    expectKeptIntact();
  });
});

describe("#340 AC-3 確定していない場合・この画面で参加者だったことを見ていない場合は、消さない", () => {
  it("#340 AC-3 Q2: 確かめが 500（確かめられない）のまま読み込み直しを求める場合は、その部屋の下書きは残る", async () => {
    const w = world();
    const { user } = renderPage({ thread: true });
    await waitForFullView();
    await typeDrafts(user);
    revoke(w);
    w.summaryFail = { status: 500 };
    await advance(POLL_MS);
    expect(await screen.findByText(UNVERIFIED_TEXT)).toBeTruthy();
    await advance(POLL_MS * 2);
    expect(present([ROOM_KEY, THREAD_KEY])).toEqual([ROOM_KEY, THREAD_KEY]);
    expectKeptIntact();
  });

  it("#340 AC-3 Q2: 確かめが通信の失敗なら、その部屋の下書きは残る", async () => {
    const w = world();
    const { user } = renderPage({ thread: true });
    await waitForFullView();
    await typeDrafts(user);
    revoke(w);
    w.summaryFail = "network";
    await advance(POLL_MS);
    expect(await screen.findByText(UNVERIFIED_TEXT)).toBeTruthy();
    expect(present([ROOM_KEY, THREAD_KEY])).toEqual([ROOM_KEY, THREAD_KEY]);
  });

  it("#340 AC-3: 参加者のままの 403（TODO が 403 で、概要は参加者）では、下書きは残る", async () => {
    const w = world();
    const { user } = renderPage({ thread: true });
    await waitForFullView();
    await typeDrafts(user);
    w.todos.failWith = {
      status: 403,
      code: "FORBIDDEN",
      message: PRIVATE_TEXT,
    };
    await advance(POLL_MS * 3);
    expect(screen.getByText(SECRET)).toBeTruthy();
    expect(present([ROOM_KEY, THREAD_KEY])).toEqual([ROOM_KEY, THREAD_KEY]);
  });

  it("#340 AC-3 D-2: 最初から非参加の案件を開く（以前の文書の下書きがある）と、非公開の表示になっても、下書きは残る", async () => {
    const w = world();
    w.participant = false;
    seedCaseRoomDrafts();
    renderPage();
    await waitForSwitched();
    await advance(POLL_MS * 3);
    expect(present([ROOM_KEY, THREAD_KEY, OTHER_THREAD_KEY])).toEqual([
      ROOM_KEY,
      THREAD_KEY,
      OTHER_THREAD_KEY,
    ]);
    expectKeptIntact();
  });

  it("#340 AC-3 D-2: 古い非参加の概要のキャッシュ（詳細のキャッシュもある）で開き、サーバーは参加者を返す：参加者の表示に戻り、下書きは残る", async () => {
    world();
    seedCaseRoomDrafts();
    renderPage({
      prime: (client) => {
        client.setQueryData(SUMMARY_KEY, outsiderSummary(N));
        client.setQueryData(
          DETAIL_KEY,
          caseDetail(N, {
            description: SECRET,
            participants: [PARTICIPANT_CREATOR, SELF],
          }),
        );
      },
    });
    await waitForFullView();
    await advance(POLL_MS * 2);
    expect(present([ROOM_KEY, THREAD_KEY, OTHER_THREAD_KEY])).toEqual([
      ROOM_KEY,
      THREAD_KEY,
      OTHER_THREAD_KEY,
    ]);
  });

  it.each([
    ["404 の失敗", "notFound"],
    ["成功して非参加", "outsider"],
  ] as const)(
    "#340 AC-3 D-2: 作り直しの経路（概要の 500 → 画面を離れる → 離れている間に概要が%sに置き換わる → 戻る。#363）：下書きは残る",
    async (_name, next) => {
      const w = world();
      const { client, user } = renderPage({ thread: true });
      await waitForFullView();
      await typeDrafts(user);
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
      await waitFor(() =>
        expect(client.getQueryState(SUMMARY_KEY)?.fetchStatus).toBe("idle"),
      );
      await user.click(screen.getByRole("link", { name: "案件に戻る" }));
      await waitFor(() =>
        expect(client.getQueryData(DETAIL_KEY)).toBeUndefined(),
      );
      await advance(POLL_MS * 3);
      expect(present([ROOM_KEY, THREAD_KEY])).toEqual([ROOM_KEY, THREAD_KEY]);
    },
  );

  it("#340 AC-3: 退出の失敗（409）では、下書きは残る", async () => {
    world();
    server.use(
      http.delete("/api/cases/:caseId/participants/:userId", () =>
        failureResponse({ status: 409 }),
      ),
    );
    const { user } = renderPage({ thread: true });
    await waitForFullView();
    await typeDrafts(user);
    await leaveSelf(user);
    await advance(POLL_MS * 2);
    expect(screen.getByText(SECRET)).toBeTruthy();
    expect(present([ROOM_KEY, THREAD_KEY])).toEqual([ROOM_KEY, THREAD_KEY]);
  });
});

describe("#340 AC-2 利用者が替わった後に、前の利用者の処理が確定しても、新しい利用者の下書きには触れない", () => {
  it("#340 AC-2: A の確かめを保留 → B に切り替え → A の非参加が確定：A のその部屋の下書きは消え、B の同じ部屋の下書きは残る", async () => {
    const w = world();
    const { user, client } = renderPage({ thread: true });
    await waitForFullView();
    await typeDrafts(user);
    const gate = deferred();
    w.summaryGate = gate.promise;
    const before = w.calls.summary;
    revoke(w);
    await advance(POLL_MS);
    await waitFor(() => expect(w.calls.summary).toBeGreaterThan(before));
    act(() => {
      client.setQueryData(authKeys.session, sessionOf(USER_B));
    });
    w.summaryGate = null;
    gate.release();
    await advance(POLL_MS);
    await waitFor(() => expect(present([ROOM_KEY, THREAD_KEY])).toEqual([]));
    expect(
      present([
        keyOf(USER_B.id, `room:${caseRoomId(N)}`),
        keyOf(USER_B.id, `thread:${caseRoomId(N)}:${parentMessage.id}`),
      ]),
    ).toHaveLength(2);
    expectKeptIntact();
  });
});
