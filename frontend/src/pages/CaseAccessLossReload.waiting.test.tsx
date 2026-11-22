// #338 AC-2・AC-5（計画 plan-338 の 7-3 の P-15・P-16）：本物の入口（requestAccessLossReload）を通す画面のテスト。
// 実際の読み込み直し（location）だけを browser-location の差し替えで数える。偽の時計で進め、保留は手で解く Promise。データはすべて架空。
// P-15：実際の入力欄で投稿を保留したまま資格を失う → 保留を解いた後、その部屋の下書きが消えてから読み込み直す（5秒の上限の前に終わる操作は待つ）。
// P-16：保存先に lost の知らせを入れて起動 → 共通レイアウトに知らせが1つ出る。
// 前提にした口（実装の担当へ）：browser-location の reloadPage()・replacePage(to)、access-loss の writeAccessLossNotice(kind)・
//   takeAccessLossNotice(queryClient)、AppShell の LogoutFailureNotice の直後に AccessLossNotice を置く。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import {
  takeAccessLossNotice,
  writeAccessLossNotice,
} from "../features/access-loss";
import {
  reloadPage,
  replacePage,
} from "../features/access-loss/browser-location";
import { authKeys } from "../features/auth";
import {
  findHome,
  installDomStubs,
  respondShellUser,
  type DomStubs,
} from "../test/app-shell-harness";
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
import { apiErrorResponse, message } from "../test/message-handlers";
import { server } from "../test/server";
import { CaseDetailPage } from "./CaseDetailPage";

vi.mock("../features/access-loss/browser-location", () => ({
  reloadPage: vi.fn(),
  replacePage: vi.fn(),
}));

const N = 3381;
const POLL_MS = 2_000;
const SECRET = "[UNIT_TEST]338投稿を保留した案件の説明";
const DRAFT_TEXT = "[UNIT_TEST]338送信中の投稿";
const DRAFT_KEY = `internal-system:draft:v1:${TEST_USER.id}:room:${caseRoomId(N)}`;
const LOST_TEXT =
  "この案件を表示できなくなったため、画面を読み込み直しました。保存していない入力は消えています。";

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

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("#338 AC-2 P-15 進行中の投稿を待ってから読み込み直す", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it("#338 AC-2 P-15: 実際の入力欄で投稿を保留したまま外される → 保留を解くまで読み込み直さず、解いた後、その部屋の下書きが消えてから1回だけ読み込み直す", async () => {
    const state = { participant: true };
    const todos = respondTodos([todoItem(1)]);
    const postGate = deferred();
    let posted = false;
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
          : apiErrorResponse(
              403,
              "FORBIDDEN",
              "参加者だけが見られます（非公開）",
            ),
      ),
      http.get("/api/rooms/:roomId/messages", () =>
        state.participant
          ? HttpResponse.json({ items: [], nextCursor: null, hasMore: false })
          : apiErrorResponse(
              403,
              "FORBIDDEN",
              "参加者だけが見られます（非公開）",
            ),
      ),
      http.put(
        "/api/rooms/:roomId/read-position",
        () => new HttpResponse(null, { status: 204 }),
      ),
      http.post("/api/rooms/:roomId/messages", async () => {
        await postGate.promise;
        posted = true;
        const created = message(1, { roomId: caseRoomId(N), body: DRAFT_TEXT });
        return HttpResponse.json(
          {
            id: created.id,
            roomId: caseRoomId(N),
            createdAt: created.createdAt,
          },
          { status: 201 },
        );
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
    const draftAtReload: (string | null)[] = [];
    vi.mocked(reloadPage).mockImplementation(() => {
      draftAtReload.push(window.localStorage.getItem(DRAFT_KEY));
    });
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
    await user.type(input, DRAFT_TEXT);
    expect(window.localStorage.getItem(DRAFT_KEY)).toContain(DRAFT_TEXT);
    await user.click(screen.getByRole("button", { name: "送信" }));

    // 送信中に外される：自動の更新が拒否を受け、概要の確かめで非参加が確定する
    state.participant = false;
    todos.failWith = {
      status: 403,
      code: "FORBIDDEN",
      message: "参加者だけが見られます（非公開）",
    };
    await advance(POLL_MS);
    await advance(1_000);
    expect(posted).toBe(false);
    expect(reloadPage).not.toHaveBeenCalled();

    postGate.release();
    await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1));
    expect(draftAtReload).toEqual([null]);
    expect(replacePage).not.toHaveBeenCalled();
    await advance(POLL_MS * 3);
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });
});

describe("#338 AC-5 P-16 読み込み直した後の文書で、知らせを1つ出す", () => {
  let stubs: DomStubs;
  beforeEach(() => {
    stubs = installDomStubs();
  });
  afterEach(() => {
    stubs.restore();
  });

  it("#338 AC-5 P-16: 保存先に lost の知らせを入れて起動すると、共通レイアウトに知らせが1つ出て、「閉じる」で消える", async () => {
    writeAccessLossNotice("lost");
    respondShellUser();
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    // main.tsx と同じく、描画の前に読む
    takeAccessLossNotice(client);
    expect(window.sessionStorage.length).toBe(0);
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/"]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await findHome();
    await waitFor(() => expect(screen.getAllByText(LOST_TEXT)).toHaveLength(1));
    // 知らせの文を含み、「閉じる」を持つ、いちばん近い祖先（ほかの「閉じる」と取り違えない）
    let notice: HTMLElement | null = screen.getByText(LOST_TEXT);
    while (
      notice !== null &&
      within(notice).queryByRole("button", { name: "閉じる" }) === null
    )
      notice = notice.parentElement;
    if (notice === null) throw new Error("知らせの「閉じる」がありません");
    await user.click(within(notice).getByRole("button", { name: "閉じる" }));
    expect(screen.queryByText(LOST_TEXT)).toBeNull();
  });
});
