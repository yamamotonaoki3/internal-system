// #339 AC-1（計画 plan-339 の 5 節「S-17を開かずS-35の返信拒否から覆いまで進む」）：画面の接続の確かめ。
// 案件の画面（S-17）を一度も開かず、スレッド一覧（S-35）で案件の部屋のスレッドを開いている。外された後、返信の取り直しが 404 になると、
// 全体の見張り（installCaseAccessLossMonitor。main.tsx と同じく登録する）が、直前に成功した返信のデータの caseId で概要を確かめ、
// 非参加なら、本物の入口（requestAccessLossReload）が待機に入り、全画面の覆いが出て、読み込み直す（1回）。
// API・フック・全体の見張り・入口の接続だけを見る（判定と副作用の分岐の網羅は、単体の case-access-loss-monitor.test.ts に任せる）。
// 本物の入口は文書ごとに1つの状態（idle → waiting → reloading。以後 idle に戻らない）を持つため、このファイルは1件だけにする。
// 実際の読み込み直し（location）は browser-location の差し替えで数える。チャンネルはテスト専用の差し替え。偽の時計で取り直しを進める。
// 前提にした口（実装の担当へ）：features/cases（index）の installCaseAccessLossMonitor(queryClient): () => void。
//   返信の取得の成功応答の caseId（test/message-handlers.ts の respondReplies の caseId）・スレッド一覧の行の caseId。
// データはすべて架空（testuser_・[E2E_TEST]・[UNIT_TEST]）。
import { act, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessLossBoundary } from "../features/access-loss";
import { reloadPage } from "../features/access-loss/browser-location";
import { installCaseAccessLossMonitor } from "../features/cases";
import { caseId, caseRoomId, outsiderSummary } from "../test/case-handlers";
import { FakeBroadcastChannel } from "../test/fake-broadcast-channel";
import {
  apiErrorResponse,
  reply,
  respondReplies,
} from "../test/message-handlers";
import { server } from "../test/server";
import { respondMyThreads, threadItem } from "../test/thread-handlers";
import { newClient, renderInApp, respondSelf } from "../test/thread-harness";
import { ThreadsPage } from "./ThreadsPage";

// test/setup.ts の入口の差し替えを外し、本物の入口を使う（project-rules の #338 の項目）
vi.unmock("../features/access-loss/reload-after-access-loss");
vi.mock("../features/access-loss/browser-location", () => ({
  reloadPage: vi.fn(),
  replacePage: vi.fn(),
}));

const N = 3394;
const CASE = caseId(N);
const ROOM = caseRoomId(N);
const OVERLAY = "画面を読み込み直しています";

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

let uninstall: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.stubGlobal("BroadcastChannel", FakeBroadcastChannel);
  vi.stubGlobal("reportError", vi.fn());
  FakeBroadcastChannel.clearSent();
  respondSelf();
});
afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("#339 AC-1 S-35 の返信の拒否から、覆いと読み込み直しまで", () => {
  it("#339 AC-1: S-17を開かずS-35の返信拒否から覆いまで進む：返信の 404 → 概要の確かめが非参加 → 覆いが出て、読み込み直しは1回", async () => {
    const row = threadItem(1, {
      room: { kind: "channel", id: ROOM, name: "[E2E_TEST]339案件の部屋" },
      caseId: CASE,
    });
    respondMyThreads([row]);
    const thread = respondReplies({
      parent: row.parent,
      replies: [reply(row.parent, 1, { body: "[E2E_TEST]339案件の返信" })],
      caseRoom: true,
      caseId: CASE,
    });
    const summaryCalls: string[] = [];
    server.use(
      http.get("/api/cases/:caseId", ({ params }) => {
        summaryCalls.push(String(params.caseId));
        return HttpResponse.json(outsiderSummary(N));
      }),
    );
    const client = newClient();
    uninstall = installCaseAccessLossMonitor(client);
    renderInApp(
      <AccessLossBoundary>
        <ThreadsPage />
      </AccessLossBoundary>,
      { path: `/threads?thread=${row.parent.id}`, client, fakeTimers: true },
    );
    expect(await screen.findByText("[E2E_TEST]339案件の返信")).toBeTruthy();
    expect(thread.requests.length).toBeGreaterThan(0);
    expect(summaryCalls).toEqual([]);
    expect(screen.queryByRole("dialog", { name: OVERLAY })).toBeNull();

    // 外された：返信の取り直しは 404（エラー応答に案件の ID は無い）
    server.use(
      http.get("/api/messages/:messageId/replies", () =>
        apiErrorResponse(404, "NOT_FOUND", "[UNIT_TEST]339見つかりません"),
      ),
    );
    await advance(2500);
    await waitFor(() => expect(summaryCalls).toEqual([CASE]));
    expect(
      await screen.findByRole("dialog", { name: OVERLAY, hidden: true }),
    ).toBeTruthy();
    await advance(100);
    await waitFor(() => expect(vi.mocked(reloadPage)).toHaveBeenCalledTimes(1));
    await advance(6000);
    expect(vi.mocked(reloadPage)).toHaveBeenCalledTimes(1);
    expect(summaryCalls).toEqual([CASE]);
  });
});
