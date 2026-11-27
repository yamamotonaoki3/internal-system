// #148（148-A）5-2 AC-1・AC-4・5-1 AC-11・C-184(3)、画面 S-17：案件の詳細に「やり取り」を、説明・参加者の下に見出しで縦に並べて置く（タブは作らない）。
// 中身は既存の部品（features/messages の RoomMessages・features/threads の ThreadLayout・features/unread の useMarkRoomRead）を、
// 詳細の channelId（案件専用チャンネルの部屋の ID）で使う。API は MSW。データはすべて架空（testuser_case148_・[E2E_TEST]・@example.com）。
// この層で確かめるもの（計画 148-A のテストケースの「画面」の行）：
//   参加者の S-17 にやり取り（一覧・入力欄）。0件で「まだやり取りがありません」
//   終了中は入力欄・編集・リアクションの操作が出ず、帯「終了した案件・アーカイブ（読み取り専用）」と、投稿できない案内を出す（閲覧と既読はできる）
//   非参加者・詳細が 403 では、やり取りを取得しない（メッセージの要求が飛ばない）
//   投稿が 409（ほかの人が終了した）のとき、文を出し、概要を取り直して読み取り専用になる
//   利用者の切り替え（#284 の枠・見張り）：S-17 を開いたまま A → B に替わると、A の本文・下書き・開いたスレッドが一度も描画されない
// 認可・終了中の 409 はサーバー（backend の routes/messages.case-room.test.ts）で確かめ、ここでは重ねない。
// 画面の契約（実装の担当へ。テストが決めたもの）：
//   見出し（h2）「やり取り」。中の入力欄は既存どおり textbox「メッセージ」と button「送信」。
//   終了の帯の文言 CLOSED_BANNER、投稿できない案内 CANNOT_POST、0件の文言 EMPTY（計画 148-A「画面」）。
import { act, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse, type HttpResponseResolver } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authKeys } from "../features/auth";
import { installDomStubs, type DomStubs } from "../test/app-shell-harness";
import {
  caseDetail,
  caseId,
  caseRoomId,
  caseSummary,
  outsiderSummary,
  respondCases,
} from "../test/case-handlers";
import { renderCaseRequestScreen } from "../test/case-request-handlers";
import { apiErrorResponse, message } from "../test/message-handlers";
import { server } from "../test/server";
import {
  disposeUserSwitchApps,
  renderUserSwitchApp,
} from "../test/user-switch-harness";
import { CaseDetailPage } from "./CaseDetailPage";

const CLOSED_BANNER = "終了した案件・アーカイブ（読み取り専用）";
const CANNOT_POST =
  "終了した案件のため、投稿・編集・リアクションはできません（読み取り専用）";
const EMPTY = "まだやり取りがありません";
const CLOSED_CONFLICT = "終了した案件には投稿できません";

const SELF_ID = "01JTESTUSER000000000000001";

function renderPage(n: number) {
  return renderCaseRequestScreen(<CaseDetailPage />, {
    at: `/cases/${caseId(n)}`,
    path: "/cases/:caseId",
  });
}

/** 案件の部屋のメッセージ（親）。roomId は詳細の channelId と同じ */
function caseMessage(
  n: number,
  roomN: number,
  overrides: Parameters<typeof message>[1] = {},
) {
  return message(n, {
    roomId: caseRoomId(roomN),
    body: `[E2E_TEST]148案件の投稿${n}`,
    ...overrides,
  });
}

type RoomServer = {
  requests: string[];
  posts: string[];
  reads: string[];
};

/** 部屋のメッセージ・既読の模擬。postStatus を 409 にすると、投稿を「案件が終了中」で拒否する */
function respondRoom(
  items: ReturnType<typeof message>[],
  options: { postStatus?: 201 | 409 } = {},
): RoomServer {
  const state: RoomServer = { requests: [], posts: [], reads: [] };
  server.use(
    http.get("/api/rooms/:roomId/messages", ({ request, params }) => {
      state.requests.push(String(params.roomId));
      const after = new URL(request.url).searchParams.get("after");
      return HttpResponse.json({
        items: after === null ? [...items].reverse() : [],
        nextCursor: null,
        hasMore: false,
      });
    }),
    http.post("/api/rooms/:roomId/messages", async ({ request, params }) => {
      const { body } = (await request.json()) as { body: string };
      state.posts.push(body);
      if (options.postStatus === 409)
        return apiErrorResponse(409, "CONFLICT", CLOSED_CONFLICT);
      return HttpResponse.json(
        {
          id: "01JTESTMSG0000000000009999",
          roomId: String(params.roomId),
          createdAt: "2026-11-18T00:00:00.000Z",
        },
        { status: 201 },
      );
    }),
    http.put("/api/rooms/:roomId/read-position", ({ params }) => {
      state.reads.push(String(params.roomId));
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return state;
}

const conversation = () =>
  screen.findByRole("heading", { level: 2, name: "やり取り" });

describe("#148 S-17 やり取り（参加者）", () => {
  it("#148 5-2 AC-1・C-184(3): 参加者の S-17 に、見出し「やり取り」と、案件の部屋のメッセージ・入力欄を出す（部屋の ID は詳細の channelId）", async () => {
    respondCases({
      summaries: [caseSummary(1)],
      details: [caseDetail(1)],
    });
    const room = respondRoom([caseMessage(1, 1)]);
    renderPage(1);
    expect(await conversation()).toBeTruthy();
    expect(await screen.findByText("[E2E_TEST]148案件の投稿1")).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "メッセージ" })).toBeTruthy();
    expect(new Set(room.requests)).toEqual(new Set([caseRoomId(1)]));
    // タブは作らない（C-184(3)）
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("#148 S-17: やり取りが0件なら「まだやり取りがありません」", async () => {
    respondCases({ summaries: [caseSummary(2)], details: [caseDetail(2)] });
    respondRoom([]);
    renderPage(2);
    await conversation();
    expect(await screen.findByText(EMPTY)).toBeTruthy();
  });

  it("#148 5-2 AC-1: 入力欄から投稿すると、案件の部屋（channelId）に送る", async () => {
    respondCases({ summaries: [caseSummary(3)], details: [caseDetail(3)] });
    const room = respondRoom([]);
    const { user } = renderPage(3);
    await conversation();
    await user.type(
      await screen.findByRole("textbox", { name: "メッセージ" }),
      "148の投稿",
    );
    await user.click(screen.getByRole("button", { name: "送信" }));
    await waitFor(() => expect(room.posts).toEqual(["148の投稿"]));
  });

  it("#148 既読: 参加者がやり取りを表示すると、案件の部屋の既読を進める", async () => {
    respondCases({ summaries: [caseSummary(4)], details: [caseDetail(4)] });
    const room = respondRoom([caseMessage(1, 4)]);
    renderPage(4);
    await screen.findByText("[E2E_TEST]148案件の投稿1");
    await waitFor(() => expect(room.reads).toContain(caseRoomId(4)));
  });
});

describe("#148 5-1 AC-11 終了した案件の S-17（読み取り専用）", () => {
  it("#148 5-1 AC-11: 終了中は入力欄・編集・リアクションの操作を出さず、帯と投稿できない案内を出す。メッセージは読める", async () => {
    respondCases({
      summaries: [caseSummary(5, { status: "closed" })],
      details: [caseDetail(5, { status: "closed" })],
    });
    respondRoom([
      caseMessage(1, 5, {
        author: { id: SELF_ID, displayName: "テスト太郎" },
      }),
    ]);
    renderPage(5);
    await conversation();
    expect(await screen.findByText("[E2E_TEST]148案件の投稿1")).toBeTruthy();
    expect(screen.getByText(CLOSED_BANNER)).toBeTruthy();
    expect(screen.getByText(CANNOT_POST)).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "メッセージ" })).toBeNull();
    expect(screen.queryByRole("button", { name: "編集" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /^リアクションを付ける/ }),
    ).toBeNull();
  });

  it("#148 5-1 AC-11: 終了中も、表示したら既読は進める", async () => {
    respondCases({
      summaries: [caseSummary(6, { status: "closed" })],
      details: [caseDetail(6, { status: "closed" })],
    });
    const room = respondRoom([caseMessage(1, 6)]);
    renderPage(6);
    await screen.findByText("[E2E_TEST]148案件の投稿1");
    await waitFor(() => expect(room.reads).toContain(caseRoomId(6)));
  });

  it("#148 5-1 AC-11: 投稿が 409（ほかの人が終了した）のとき、文を出し、概要を取り直して読み取り専用に切り替わる", async () => {
    const summaries = [caseSummary(7)];
    const details = [caseDetail(7)];
    const cases = respondCases({ summaries, details });
    respondRoom([], { postStatus: 409 });
    const { user } = renderPage(7);
    await conversation();
    // サーバーの状態を「終了」にしてから投稿する（取り直しで終了が返る）
    summaries[0] = caseSummary(7, { status: "closed" });
    details[0] = caseDetail(7, { status: "closed" });
    const summaryCallsBefore = cases.summaryCalls.length;
    await user.type(
      await screen.findByRole("textbox", { name: "メッセージ" }),
      "148の投稿",
    );
    await user.click(screen.getByRole("button", { name: "送信" }));
    expect(await screen.findByText(CLOSED_CONFLICT)).toBeTruthy();
    await waitFor(() =>
      expect(cases.summaryCalls.length).toBeGreaterThan(summaryCallsBefore),
    );
    expect(await screen.findByText(CLOSED_BANNER)).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "メッセージ" })).toBeNull(),
    );
  });
});

describe("#298 AC-5 投稿の 409 は、コードが CONFLICT のときだけ「終了した」の扱いにする", () => {
  it("#298 AC-5: 投稿が 409 でも、コードが SESSION_USER_MISMATCH なら、概要・詳細を取り直さず、読み取り専用に切り替えない。入力欄は残る", async () => {
    const summaries = [caseSummary(41)];
    const details = [caseDetail(41)];
    const cases = respondCases({ summaries, details });
    respondRoom([]);
    server.use(
      http.post("/api/rooms/:roomId/messages", () =>
        apiErrorResponse(
          409,
          "SESSION_USER_MISMATCH",
          "[UNIT_TEST_298]別の利用者のセッションです",
        ),
      ),
    );
    const { user, client } = renderPage(41);
    await conversation();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    // サーバーの状態を「終了」にしておく。競合として扱えば、取り直しで終了が返り、読み取り専用に切り替わってしまう
    summaries[0] = caseSummary(41, { status: "closed" });
    details[0] = caseDetail(41, { status: "closed" });
    const summaryBefore = cases.summaryCalls.length;
    const detailBefore = cases.detailCalls.length;
    await user.type(
      await screen.findByRole("textbox", { name: "メッセージ" }),
      "298の投稿",
    );
    await user.click(screen.getByRole("button", { name: "送信" }));
    // ふつうの失敗と同じく、入力欄がサーバーの文を出す
    expect(
      await screen.findByText("[UNIT_TEST_298]別の利用者のセッションです"),
    ).toBeTruthy();
    // 取り直しの要求は、失敗の処理の中で同期的に出される。エラーの表示の後に、この案件の取り直しが出されていないことを確かめる
    expect(
      invalidate.mock.calls.filter(([filters]) =>
        JSON.stringify(filters?.queryKey ?? []).includes(caseId(41)),
      ),
    ).toEqual([]);
    expect(cases.summaryCalls.length).toBe(summaryBefore);
    expect(cases.detailCalls.length).toBe(detailBefore);
    expect(screen.queryByText(CLOSED_BANNER)).toBeNull();
    expect(screen.getByRole("textbox", { name: "メッセージ" })).toBeTruthy();
  });
});

describe("#148 コードレビュー1回目の軽微2 添付つきの送信で、アップロードが 409（終了）", () => {
  it("#148 5-1 AC-11・C-184: 添付つきの送信で、アップロードが 409「終了した案件には添付できません」なら、理由を出し、概要・詳細を取り直して読み取り専用に切り替わる", async () => {
    const summaries = [caseSummary(10)];
    const details = [caseDetail(10)];
    const cases = respondCases({ summaries, details });
    const room = respondRoom([]);
    const uploads: string[] = [];
    server.use(
      http.post("/api/rooms/:roomId/attachments", ({ params }) => {
        uploads.push(String(params.roomId));
        return apiErrorResponse(
          409,
          "CONFLICT",
          "終了した案件には添付できません",
        );
      }),
    );
    const { user } = renderPage(10);
    await conversation();
    // サーバーの状態を「終了」にしてから送る（取り直しで終了が返る）
    summaries[0] = caseSummary(10, { status: "closed" });
    details[0] = caseDetail(10, { status: "closed" });
    const summaryBefore = cases.summaryCalls.length;
    const detailBefore = cases.detailCalls.length;
    await user.upload(
      screen.getByLabelText<HTMLInputElement>("ファイルを添付"),
      new File(["[E2E_TEST]148"], "memo148.txt", { type: "text/plain" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "メッセージ" }),
      "148の添付つき",
    );
    await user.click(screen.getByRole("button", { name: "送信" }));
    await waitFor(() => expect(uploads).toEqual([caseRoomId(10)]));
    expect(
      await screen.findByText("終了した案件には添付できません", {
        exact: false,
      }),
    ).toBeTruthy();
    await waitFor(() => {
      expect(cases.summaryCalls.length).toBeGreaterThan(summaryBefore);
      expect(cases.detailCalls.length).toBeGreaterThan(detailBefore);
    });
    expect(await screen.findByText(CLOSED_BANNER)).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "メッセージ" })).toBeNull(),
    );
    expect(room.posts).toEqual([]);
  });
});

describe("#148 5-2 AC-3 参加者でなければ、やり取りを取得しない", () => {
  it("#148 5-2 AC-3: 非参加者には「やり取り」を出さず、メッセージの要求が飛ばない", async () => {
    respondCases({ summaries: [outsiderSummary(8)] });
    const room = respondRoom([caseMessage(1, 8)]);
    renderPage(8);
    expect(
      await screen.findByText("参加者だけが見られます（非公開）"),
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "やり取り" })).toBeNull();
    expect(room.requests).toEqual([]);
    expect(room.reads).toEqual([]);
  });

  it("#148 5-2 AC-3: 詳細が 403（外された後）なら、やり取りを出さず、メッセージの要求が飛ばない", async () => {
    respondCases({ summaries: [caseSummary(9)], denied: [caseId(9)] });
    const room = respondRoom([caseMessage(1, 9)]);
    renderPage(9);
    expect(
      await screen.findByText("参加者だけが見られます（非公開）"),
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "やり取り" })).toBeNull();
    expect(room.requests).toEqual([]);
  });
});

// ---- 利用者の切り替え（#284 の枠と見張り） ----

const USER_A = {
  id: "01JTESTCASE148VSERA0000001",
  displayName: "testuser_case148_a",
  loginId: "testuser_case148_a",
};
const USER_B = {
  id: "01JTESTCASE148VSERB0000001",
  displayName: "testuser_case148_b",
  loginId: "testuser_case148_b",
};
type TestUser = typeof USER_A;
const A_MARK = "[E2E_TEST]148A";
const B_MARK = "[E2E_TEST]148B";
const markOf = (user: TestUser) => (user === USER_A ? A_MARK : B_MARK);
const N = 48;

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

/** いまの利用者のデータを返す模擬。hold がある間は、セッション以外の応答を保留する */
function respondSwitchWorld() {
  const world = {
    user: USER_A as TestUser,
    hold: null as Promise<void> | null,
  };
  const serve =
    (make: (user: TestUser) => unknown): HttpResponseResolver =>
    async () => {
      if (world.hold !== null) await world.hold;
      const body = make(world.user);
      if (body === null) return new HttpResponse(null, { status: 204 });
      return HttpResponse.json(body);
    };
  const parentOf = (user: TestUser) =>
    caseMessage(1, N, {
      body: `${markOf(user)}の本文`,
      replyCount: 1,
      author: { id: user.id, displayName: user.displayName },
    });
  server.use(
    http.get("/api/auth/session", () =>
      HttpResponse.json(sessionOf(world.user)),
    ),
    http.get(
      "/api/cases",
      serve(() => ({ items: [], nextCursor: null })),
    ),
    http.get(
      "/api/cases/:caseId/detail",
      serve((user) => caseDetail(N, { description: `${markOf(user)}の説明` })),
    ),
    http.get(
      "/api/cases/:caseId",
      serve(() => caseSummary(N)),
    ),
    http.get(
      "/api/rooms/:roomId/messages",
      serve((user) => ({
        items: [parentOf(user)],
        nextCursor: null,
        hasMore: false,
      })),
    ),
    http.put(
      "/api/rooms/:roomId/read-position",
      serve(() => null),
    ),
    http.get(
      "/api/messages/:messageId/replies",
      serve((user) => ({
        items: [
          message(2, {
            roomId: caseRoomId(N),
            parentMessageId: parentOf(user).id,
            body: `${markOf(user)}の返信`,
            author: { id: user.id, displayName: user.displayName },
          }),
        ],
        nextCursor: null,
        hasMore: false,
        parent: parentOf(user),
        replyBlockedReason: null,
        caseRoom: true,
        caseId: caseId(N),
        joined: true,
        roomWritable: true,
      })),
    ),
    http.put(
      "/api/messages/:messageId/thread-read-position",
      serve(() => null),
    ),
    http.get(
      "/api/me/unread",
      serve(() => ({ items: [], nextCursor: null })),
    ),
    http.get(
      "/api/me/notifications/unread-count",
      serve(() => ({ count: 0 })),
    ),
    http.get(
      "/api/me/notifications",
      serve(() => ({ items: [], nextCursor: null })),
    ),
    http.get(
      "/api/channels",
      serve(() => ({ items: [], nextCursor: null })),
    ),
    http.get(
      "/api/dms",
      serve(() => ({ items: [], nextCursor: null })),
    ),
  );
  return world;
}

function shows(text: string): boolean {
  if (document.body.textContent?.includes(text)) return true;
  return [...document.querySelectorAll("[aria-label]")].some((element) =>
    element.getAttribute("aria-label")?.includes(text),
  );
}

let stubs: DomStubs;

describe("#148 #284 S-17 を開いたまま利用者が替わる", () => {
  beforeEach(() => {
    stubs = installDomStubs();
  });
  afterEach(() => {
    disposeUserSwitchApps();
    stubs.restore();
  });

  it("#148 #284: A がスレッドを開き、入力欄に下書きを入れたまま B に替わると、A の本文・返信・下書きが一度も描画されず、B のやり取りが出る", async () => {
    const world = respondSwitchWorld();
    const parentId = caseMessage(1, N).id;
    const app = renderUserSwitchApp(`/cases/${caseId(N)}?thread=${parentId}`, {
      needles: [A_MARK, "148Aの下書き"],
    });
    await waitFor(() => expect(shows(`${A_MARK}の本文`)).toBe(true));
    await waitFor(() => expect(shows(`${A_MARK}の返信`)).toBe(true));
    const main = screen.getByRole("main");
    const inputs = within(main).getAllByRole("textbox", {
      name: "メッセージ",
    });
    await app.user.type(inputs[0] as HTMLElement, "148Aの下書き");

    const gate = deferred();
    world.user = USER_B;
    world.hold = gate.promise;
    app.watch.arm();
    act(() => {
      app.client.setQueryData(authKeys.session, sessionOf(USER_B));
    });
    expect(app.watch.hits).toEqual([]);
    gate.release();
    await waitFor(() => expect(shows(`${B_MARK}の本文`)).toBe(true));
    expect(app.watch.hits).toEqual([]);
    expect(shows("148Aの下書き")).toBe(false);
  });
});
