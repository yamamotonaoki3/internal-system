// #148（148-B-2）5-2 AC-8・計画 6.8：S-17（案件の詳細）のやり取りの入力欄と、開いたスレッド（?thread=）の返信の入力欄で、
// 添付ごとに公開範囲を選べる（案内つき）。API は MSW。データは架空（testuser_・[E2E_TEST]）。
// 画面の契約（実装の担当へ。テストが決めたもの）：CaseConversation が features/cases の設定（CASE_ATTACHMENT_PUBLICATION）を
//   RoomMessages と ThreadLayout（→ThreadPane→ThreadReplies）に渡す。選択欄は combobox「{ファイル名} の公開範囲」。
import { screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import {
  recordReplyPosts,
  respondAttachments,
  sizedFile,
} from "../test/attachment-handlers";
import { respondCaseAttachments } from "../test/case-attachment-handlers";
import {
  caseDetail,
  caseId,
  caseRoomId,
  caseSummary,
  respondCases,
} from "../test/case-handlers";
import { renderCaseRequestScreen } from "../test/case-request-handlers";
import { message, respondReplies } from "../test/message-handlers";
import { server } from "../test/server";
import { CaseDetailPage } from "./CaseDetailPage";

const HINT = "全社員公開が承認されるまでは、参加者だけが見られます";
const PUBLIC = "全社員公開アーカイブで公開できる";
const N = 61;

function respondRoom(items: ReturnType<typeof message>[]) {
  server.use(
    http.get("/api/rooms/:roomId/messages", ({ request }) => {
      const after = new URL(request.url).searchParams.get("after");
      return HttpResponse.json({
        items: after === null ? [...items].reverse() : [],
        nextCursor: null,
        hasMore: false,
      });
    }),
    http.put(
      "/api/rooms/:roomId/read-position",
      () => new HttpResponse(null, { status: 204 }),
    ),
  );
}

function build(thread?: string) {
  const summary = caseSummary(N, { status: "active" });
  respondCases({
    summaries: [summary],
    details: [caseDetail(N, { ...summary })],
  });
  respondCaseAttachments([]);
  const parent = message(1, {
    roomId: caseRoomId(N),
    body: "[E2E_TEST]148b2案件の親",
  });
  respondRoom([parent]);
  respondReplies({ parent, replies: [], caseRoom: true, caseId: caseId(N) });
  const api = respondAttachments();
  recordReplyPosts(api, parent.id);
  const view = renderCaseRequestScreen(<CaseDetailPage />, {
    at: `/cases/${caseId(N)}${thread === undefined ? "" : `?thread=${thread}`}`,
    path: "/cases/:caseId",
  });
  return { ...view, api, parent };
}

describe("#148 AC-8 S-17 の入力欄の公開範囲", () => {
  it("#148 AC-8: やり取りの入力欄で、ファイルごとに選択と案内が出て、選んだ値がクエリに乗る", async () => {
    const { api, user } = build();
    const box = await screen.findByRole("textbox", { name: "メッセージ" });
    const form = box.closest("form") as HTMLElement;
    await user.upload(
      within(form).getByLabelText("ファイルを添付"),
      sizedFile("c148.txt", 10),
    );
    const select = await within(form).findByRole("combobox", {
      name: "c148.txt の公開範囲",
    });
    expect(valueOf(select)).toBe("participants_only");
    expect(within(form).getByText(HINT)).toBeTruthy();
    await user.selectOptions(select, PUBLIC);
    await user.type(box, "[[E2E_TEST]148b2");
    await user.click(within(form).getByRole("button", { name: "送信" }));
    await waitFor(() => expect(api.messagePosts).toHaveLength(1));
    expect(api.uploads.map((u) => [u.entry, u.publicationVisibility])).toEqual([
      ["room", "public_archive"],
    ]);
  });

  it("#148 AC-8: 開いたスレッドの返信の入力欄にも、選択と案内が出る", async () => {
    const parentId = message(1).id;
    const { user } = build(parentId);
    const replyBox = await screen.findByRole("textbox", { name: "返信" });
    const form = replyBox.closest("form") as HTMLElement;
    await user.upload(
      within(form).getByLabelText("ファイルを添付"),
      sizedFile("t148.txt", 10),
    );
    expect(
      await within(form).findByRole("combobox", {
        name: "t148.txt の公開範囲",
      }),
    ).toBeTruthy();
    expect(within(form).getByText(HINT)).toBeTruthy();
  });
});

/** 選択欄のいまの値 */
function valueOf(element: HTMLElement): string {
  return (element as unknown as { value: string }).value;
}
