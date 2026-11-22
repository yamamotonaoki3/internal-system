// #341 AC-1・AC-5（計画 plan-341 の 13 の T-S5 の「入口の本物の版」。利用者の決定 Q4）：合図を受けたタブで、確かめが非参加になり、
// 本物の入口が待機に入った後は、画面（入力欄）が隠れて、入力できない。受けたタブは下書きを消さないので、待機の前に保存し直された下書きは残る（既知の限界）。
// 本物の入口は文書ごとに1つの状態（idle → waiting → reloading。以後 idle に戻らない）を持つため、このファイルは1件だけにする。
// 実際の読み込み直し（location）は browser-location の差し替えで数える。チャンネルはテスト専用の差し替え。データはすべて架空。
// 前提にした口（実装の担当へ）：features/cases の installCaseAccessLossRelay(queryClient): () => void。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessLossBoundary } from "../features/access-loss";
import { reloadPage } from "../features/access-loss/browser-location";
import { authKeys } from "../features/auth";
import { installCaseAccessLossRelay } from "../features/cases";
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
import {
  FakeBroadcastChannel,
  postFromOtherTab,
} from "../test/fake-broadcast-channel";
import { server } from "../test/server";
import { CaseDetailPage } from "./CaseDetailPage";

// test/setup.ts の入口の差し替えを外し、本物の入口を使う（project-rules の #338 の項目）
vi.unmock("../features/access-loss/reload-after-access-loss");
vi.mock("../features/access-loss/browser-location", () => ({
  reloadPage: vi.fn(),
  replacePage: vi.fn(),
}));

const N = 3412;
const CHANNEL = "internal-system:access-loss:v1";
const SECRET = "[UNIT_TEST]341本物の入口で隠れる案件の説明";
const DRAFT = "[UNIT_TEST]341待機の前の書きかけ";
const ROOM_KEY = `internal-system:draft:v1:${TEST_USER.id}:room:${caseRoomId(N)}`;

const session = {
  user: TEST_USER,
  mustChangePassword: false,
  reauthenticatedAt: null,
  permissions: [],
};

let uninstall: (() => void) | undefined;

beforeEach(() => {
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
  vi.stubGlobal("reportError", vi.fn());
  FakeBroadcastChannel.clearSent();
});
afterEach(() => {
  uninstall?.();
  vi.unstubAllGlobals();
});

describe("#341 AC-5 T-S5 本物の入口：待機に入った後は入力できない", () => {
  it("#341 AC-1・AC-5 T-S5: 合図 → 確かめの保留中に入力（キーが保存し直される）→ 非参加：画面が隠れて入力欄に届かず、読み込み直しは1回、保存し直された下書きは残る", async () => {
    const state = { participant: true };
    let releaseSummary!: () => void;
    let gate: Promise<void> | null = null;
    respondTodos([todoItem(1)]);
    server.use(
      http.get("/api/auth/session", () => HttpResponse.json(session)),
      http.get("/api/cases/:caseId", async () => {
        if (gate !== null) await gate;
        return HttpResponse.json(
          state.participant ? caseSummary(N) : outsiderSummary(N),
        );
      }),
      http.get("/api/cases/:caseId/detail", () =>
        HttpResponse.json(
          caseDetail(N, {
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
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnWindowFocus: false },
        mutations: { retry: false },
      },
    });
    client.setQueryData(authKeys.session, session);
    uninstall = installCaseAccessLossRelay(client);
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={client}>
        <AccessLossBoundary>
          <MemoryRouter initialEntries={[`/cases/${caseId(N)}`]}>
            <Routes>
              <Route path="/cases/:caseId" element={<CaseDetailPage />} />
            </Routes>
          </MemoryRouter>
        </AccessLossBoundary>
      </QueryClientProvider>,
    );
    await screen.findByText(SECRET);
    gate = new Promise<void>((resolve) => {
      releaseSummary = resolve;
    });
    state.participant = false;
    postFromOtherTab(CHANNEL, {
      v: 1,
      userId: TEST_USER.id,
      caseId: caseId(N),
    });
    // 確かめの往復の間は、まだ入力できる（隙間）
    const input = await screen.findByRole("textbox", { name: "メッセージ" });
    await user.type(input, DRAFT.replace(/[[{]/g, "$&$&"));
    await waitFor(() =>
      expect(window.localStorage.getItem(ROOM_KEY)).toContain(DRAFT),
    );
    gate = null;
    releaseSummary();
    await waitFor(() => expect(reloadPage).toHaveBeenCalledTimes(1));
    // 隠れている：入力欄は読み上げ・操作の対象にならない
    expect(screen.queryByRole("textbox", { name: "メッセージ" })).toBeNull();
    expect(
      screen.getByRole("dialog", { name: "画面を読み込み直しています" }),
    ).toBeTruthy();
    // 受けたタブは消さない（既知の限界。7日・ログアウトで消える）
    expect(window.localStorage.getItem(ROOM_KEY)).toContain(DRAFT);
    // 本物の入口は、知らせの種類 lost を書く（Q2）
    expect(
      Object.keys(window.sessionStorage).map((key) =>
        window.sessionStorage.getItem(key),
      ),
    ).toEqual(["lost"]);
  });
});
