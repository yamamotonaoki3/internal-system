// #150（150-A）計画 6.6「開いているスレッドの表示」・10章（計画レビュー1回目の軽微への対応）：
// S-17 でスレッドを開いたまま終了・再開すると、ポーリングの次の回を待たずに、スレッドの返信の入力欄・自分の返信の編集・リアクションの操作の可否が切り替わる。
// 返信の可否は、概要ではなく返信のキャッシュ（replyBlockedReason・roomWritable）で決まるため、終了・再開の mutation の定義で、
// 案件のキャッシュに加えて、部屋のメッセージとスレッドのキャッシュも取り直す（成功・失敗とも）。
// 確かめ方：ポーリング（MESSAGE_POLL_INTERVAL_MS ごと）の1回が返った直後に操作し、次のポーリングの前（1秒以内）に、
//   返信の取り直しの要求が出て表示が切り替わることを確かめる（固定の時間の待ちは使わない）。API は MSW。データはすべて架空。
import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { MESSAGE_POLL_INTERVAL_MS } from "../features/messages";
import {
  caseDetail,
  caseId,
  caseRoomId,
  caseSummary,
  respondCases,
  type CaseDetail,
  type CaseSummary,
} from "../test/case-handlers";
import { renderCaseRequestScreen } from "../test/case-request-handlers";
import { message } from "../test/message-handlers";
import { server } from "../test/server";
import { CaseDetailPage } from "./CaseDetailPage";

const N = 42;
const SELF = { id: "01JTESTUSER000000000000001", displayName: "テスト太郎" };
const OTHER = {
  id: "01JTESTCASE150PARTNER00001",
  displayName: "testuser_150_partner",
};
const CLOSED_REPLY_TEXT = "終了した案件のため、返信できません";

const parent = message(1, {
  roomId: caseRoomId(N),
  body: "[E2E_TEST]150スレッドの親",
  replyCount: 1,
  author: OTHER,
});
const ownReply = message(2, {
  roomId: caseRoomId(N),
  parentMessageId: parent.id,
  body: "[E2E_TEST]150自分の返信",
  author: SELF,
});

/** 案件・部屋・スレッドの架空のサーバー。終了・再開の POST で、概要・詳細・返信の状態を切り替える */
function world(initial: "active" | "closed") {
  const state = { status: initial, replyGets: 0 };
  const summaries: CaseSummary[] = [
    caseSummary(N, {
      status: initial,
      canEditDueDate: initial === "active",
    }),
  ];
  const details: CaseDetail[] = [caseDetail(N, summaries[0])];
  respondCases({ summaries, details });
  const setStatus = (status: "active" | "closed") => {
    state.status = status;
    summaries[0] = caseSummary(N, {
      status,
      canEditDueDate: status === "active",
    });
    details[0] = caseDetail(N, summaries[0]);
  };
  server.use(
    http.get("/api/rooms/:roomId/messages", ({ request }) => {
      const after = new URL(request.url).searchParams.get("after");
      return HttpResponse.json({
        items: after === null ? [parent] : [],
        nextCursor: null,
        hasMore: false,
      });
    }),
    http.get("/api/messages/:messageId/replies", ({ request }) => {
      state.replyGets += 1;
      const closed = state.status === "closed";
      // 続き（after）の取得では、新しい返信はない
      const after = new URL(request.url).searchParams.get("after");
      return HttpResponse.json({
        items: after === null ? [ownReply] : [],
        nextCursor: null,
        hasMore: false,
        parent,
        replyBlockedReason: closed ? "case_closed" : null,
        joined: true,
        roomWritable: !closed,
      });
    }),
    http.put(
      "/api/messages/:messageId/thread-read-position",
      () => new HttpResponse(null, { status: 204 }),
    ),
    http.post("/api/cases/:caseId/close", () => {
      setStatus("closed");
      return HttpResponse.json({ caseId: caseId(N), status: "closed" });
    }),
    http.post("/api/cases/:caseId/reopen", () => {
      setStatus("active");
      return HttpResponse.json({ caseId: caseId(N), status: "active" });
    }),
  );
  return state;
}

function renderWithThread() {
  return renderCaseRequestScreen(<CaseDetailPage />, {
    at: `/cases/${caseId(N)}?thread=${parent.id}`,
    path: "/cases/:caseId",
  });
}

const pane = () => screen.getByRole("region", { name: "スレッド" });

function expectWritable(region: HTMLElement) {
  expect(
    within(region).queryByRole("textbox", { name: "返信" }),
  ).not.toBeNull();
  expect(within(region).queryByRole("button", { name: "編集" })).not.toBeNull();
  expect(
    within(region).queryAllByRole("button", { name: /^リアクションを付ける/ })
      .length,
  ).toBeGreaterThan(0);
  expect(within(region).queryByText(CLOSED_REPLY_TEXT)).toBeNull();
}

function expectReadOnly(region: HTMLElement) {
  expect(within(region).queryByRole("textbox", { name: "返信" })).toBeNull();
  expect(within(region).queryByRole("button", { name: "編集" })).toBeNull();
  expect(
    within(region).queryAllByRole("button", { name: /^リアクションを付ける/ }),
  ).toEqual([]);
  expect(within(region).getByText(CLOSED_REPLY_TEXT)).toBeTruthy();
}

/** ポーリングの1回が返るのを待つ（その直後から次のポーリングまで、MESSAGE_POLL_INTERVAL_MS の間がある） */
async function waitForPoll(state: { replyGets: number }) {
  const before = state.replyGets;
  await waitFor(() => expect(state.replyGets).toBeGreaterThan(before), {
    timeout: MESSAGE_POLL_INTERVAL_MS * 2,
  });
}

/** ポーリングの間隔の半分以内に切り替わること（次のポーリングを待たない） */
const BEFORE_NEXT_POLL = { timeout: MESSAGE_POLL_INTERVAL_MS / 2 };

describe("#150 150-A 6.6 スレッドを開いたまま終了・再開する", () => {
  it(
    "#150 5-1 AC-11: スレッドを開いたまま終了すると、次のポーリングを待たずに、返信の入力欄・自分の返信の編集・リアクションの操作が消え、再開すると戻る",
    async () => {
      const state = world("active");
      const { user } = renderWithThread();
      await screen.findByText("[E2E_TEST]150自分の返信");
      expectWritable(pane());

      await waitForPoll(state);
      const beforeClose = state.replyGets;
      await user.click(screen.getByRole("button", { name: "案件を終了" }));
      const closeDialog = await screen.findByRole("dialog", {
        name: "案件の終了",
      });
      await user.click(
        within(closeDialog).getByRole("button", { name: "終了する" }),
      );
      await waitFor(() => expectReadOnly(pane()), BEFORE_NEXT_POLL);
      expect(state.replyGets).toBeGreaterThan(beforeClose);

      await waitForPoll(state);
      const beforeReopen = state.replyGets;
      await user.click(
        await screen.findByRole("button", { name: "案件を再開" }),
      );
      const reopenDialog = await screen.findByRole("dialog", {
        name: "案件の再開",
      });
      await user.click(
        within(reopenDialog).getByRole("button", { name: "再開する" }),
      );
      await waitFor(() => expectWritable(pane()), BEFORE_NEXT_POLL);
      expect(state.replyGets).toBeGreaterThan(beforeReopen);
    },
    MESSAGE_POLL_INTERVAL_MS * 8,
  );
});
