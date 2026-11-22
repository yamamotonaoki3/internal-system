// #340 AC-4・AC-5（計画 plan-340 改訂1 のテストケースの表の「画面（CaseAccessLossReload.waiting.test.tsx に1件）」と D-3・D-5）：
// 外されて下書きを消した後、読み込み直しを待つ間に、保留中の投稿が失敗しても、その部屋の下書きは保存先に書き戻されない（P-15 の対）。
// あわせて、消せなかった（削除が SecurityError）ときは、読み込み直す時点の知らせが「下書きが残っている」種類（lostDraftsRemain）になる。
// 本物の入口は文書ごとに1つの状態（idle → waiting → reloading）を持つため、同じファイルの前のテストの状態を持ち越さないよう、
// テストごとに新しく読み込んだ本物の入口へ渡す（CaseAccessLossReload.test.tsx の useRealEntry と同じ方法）。そのため P-15 のファイルとは分けた。
// 実際の読み込み直し（location）は browser-location の差し替えで数える。偽の時計で進め、保留は手で解く Promise。保存先のキーはリテラル。データは架空。
// 前提にした口（実装の担当へ）：reload-after-access-loss.ts の requestAccessLossReload・noteDraftsRemain(ownerId)、
//   知らせの種類 "lostDraftsRemain"（sessionStorage に書く値は種類の文字列だけ）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reloadPage } from "../features/access-loss/browser-location";
import {
  noteDraftsRemain,
  requestAccessLossReload,
} from "../features/access-loss/reload-after-access-loss";
import { authKeys } from "../features/auth";
import { TEST_USER } from "../test/auth-handlers";
import {
  PARTICIPANT_CREATOR,
  caseDetail,
  caseId,
  caseRoomId,
  caseSummary,
  outsiderSummary,
} from "../test/case-handlers";
import { respondTodos, todoItem } from "../test/case-todo-handlers";
import { apiErrorResponse } from "../test/message-handlers";
import { server } from "../test/server";
import { CaseDetailPage } from "./CaseDetailPage";

vi.mock(
  "../features/access-loss/reload-after-access-loss",
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    requestAccessLossReload: vi.fn(() => Promise.resolve()),
    noteDraftsRemain: vi.fn(),
  }),
);
vi.mock("../features/access-loss/browser-location", () => ({
  reloadPage: vi.fn(),
  replacePage: vi.fn(),
}));

const N = 3401;
const POLL_MS = 2_000;
const SECRET = "[UNIT_TEST]340投稿を保留した案件の説明";
const DRAFT = "[UNIT_TEST]340送信が失敗する投稿";
const PRIVATE_TEXT = "参加者だけが見られます（非公開）";
const ROOM_KEY = `internal-system:draft:v1:${TEST_USER.id}:room:${caseRoomId(N)}`;
const THREAD_KEY = `internal-system:draft:v1:${TEST_USER.id}:thread:${caseRoomId(N)}:01JTESTMSG3400000000000WT1`;

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

/** 新しい文書の本物の入口へ渡す（呼び出しの記録は vi.fn に残る） */
async function useRealEntry() {
  vi.resetModules();
  const actual = await vi.importActual<
    typeof import("../features/access-loss/reload-after-access-loss")
  >("../features/access-loss/reload-after-access-loss");
  vi.mocked(requestAccessLossReload).mockImplementation((client, request) =>
    actual.requestAccessLossReload(client, request),
  );
  vi.mocked(noteDraftsRemain).mockImplementation((ownerId: string) =>
    actual.noteDraftsRemain(ownerId),
  );
}

type AtReload = {
  room: string | null;
  thread: string | null;
  notice: string[];
};

async function loseWhilePosting() {
  const state = { participant: true };
  const todos = respondTodos([todoItem(1)]);
  const postGate = deferred();
  server.use(
    http.get("/api/auth/session", () =>
      HttpResponse.json({
        user: TEST_USER,
        permissions: [],
        mustChangePassword: false,
        reauthenticatedAt: null,
      }),
    ),
    http.get("/api/cases/:caseId", () =>
      HttpResponse.json(
        state.participant ? caseSummary(N) : outsiderSummary(N),
      ),
    ),
    http.get("/api/cases/:caseId/detail", () =>
      state.participant
        ? HttpResponse.json(
            caseDetail(N, {
              description: SECRET,
              participants: [PARTICIPANT_CREATOR],
            }),
          )
        : apiErrorResponse(403, "FORBIDDEN", PRIVATE_TEXT),
    ),
    http.get("/api/rooms/:roomId/messages", () =>
      state.participant
        ? HttpResponse.json({ items: [], nextCursor: null, hasMore: false })
        : apiErrorResponse(403, "FORBIDDEN", PRIVATE_TEXT),
    ),
    http.put(
      "/api/rooms/:roomId/read-position",
      () => new HttpResponse(null, { status: 204 }),
    ),
    // 保留した投稿は、外された後に 403 で失敗する
    http.post("/api/rooms/:roomId/messages", async () => {
      await postGate.promise;
      return apiErrorResponse(403, "FORBIDDEN", PRIVATE_TEXT);
    }),
  );
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  client.setQueryData(authKeys.session, {
    user: TEST_USER,
    permissions: [],
    mustChangePassword: false,
    reauthenticatedAt: null,
  });
  const atReload: AtReload[] = [];
  vi.mocked(reloadPage).mockImplementation(() => {
    atReload.push({
      room: window.localStorage.getItem(ROOM_KEY),
      thread: window.localStorage.getItem(THREAD_KEY),
      notice: Object.keys(window.sessionStorage).map(
        (key) => window.sessionStorage.getItem(key) ?? "",
      ),
    });
  });
  // 以前の文書で保存した、同じ部屋のスレッドの返信の下書き
  window.localStorage.setItem(
    THREAD_KEY,
    JSON.stringify({ body: "[UNIT_TEST]340前の返信", updatedAt: Date.now() }),
  );
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/cases/${caseId(N)}`]}>
        <Routes>
          <Route path="/cases/:caseId" element={<CaseDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByText(SECRET);
  const input = await screen.findByRole("textbox", { name: "メッセージ" });
  // user.type は「[」「{」をキーの指定として読むため、文字として打つよう重ねる
  await user.type(input, DRAFT.replace(/[[{]/g, "$&$&"));
  expect(window.localStorage.getItem(ROOM_KEY)).toContain(DRAFT);
  await user.click(screen.getByRole("button", { name: "送信" }));
  // 送信中に外される：自動の更新が拒否を受け、概要の確かめで非参加が確定する
  state.participant = false;
  todos.failWith = { status: 403, code: "FORBIDDEN", message: PRIVATE_TEXT };
  await advance(POLL_MS);
  await advance(1_000);
  // 投稿を待っている（読み込み直していない）
  expect(requestAccessLossReload).toHaveBeenCalled();
  expect(reloadPage).not.toHaveBeenCalled();
  return { postGate, atReload };
}

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.mocked(requestAccessLossReload).mockClear();
  vi.mocked(noteDraftsRemain).mockClear();
  vi.mocked(reloadPage).mockClear();
  await useRealEntry();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("#340 AC-4・AC-5 消した後に書き戻さない・消せなかったら知らせの種類を変える", () => {
  it("#340 AC-4: 投稿を保留したまま外されると、その間に下書きが消える。保留を 403 で失敗させても、読み込み直す時点で、その部屋の下書き（投稿・スレッドの返信）は保存先に無く、知らせは lost", async () => {
    const { postGate, atReload } = await loseWhilePosting();
    // 読み込み直しを待つ間に、もう消えている
    expect(window.localStorage.getItem(ROOM_KEY)).toBeNull();
    expect(window.localStorage.getItem(THREAD_KEY)).toBeNull();
    postGate.release();
    await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1));
    expect(atReload).toEqual([{ room: null, thread: null, notice: ["lost"] }]);
  });

  it("#340 AC-5 D-3・D-5: 削除が SecurityError で消せなかったら、読み込み直しは止まらず、読み込み直す時点の知らせの種類が lostDraftsRemain になる（値は種類だけで、利用者の ID・本文を含まない）", async () => {
    const original = Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (
      this: Storage,
      key: string,
    ) {
      if (
        this === window.localStorage &&
        key.startsWith("internal-system:draft:")
      )
        throw new DOMException("denied", "SecurityError");
      original.call(this, key);
    });
    const { postGate, atReload } = await loseWhilePosting();
    postGate.release();
    await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1));
    expect(atReload[0]?.notice).toEqual(["lostDraftsRemain"]);
    for (const value of atReload[0]?.notice ?? []) {
      expect(value).not.toContain(TEST_USER.id);
      expect(value).not.toContain("[UNIT_TEST]");
    }
  });
});
