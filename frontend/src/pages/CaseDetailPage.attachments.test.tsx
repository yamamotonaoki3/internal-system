// #148（148-B-1）5-2 AC-7（参加者の部分）・5-1 AC-11・C-62・C-184(3)・C-184(4)、画面 S-17：案件の詳細の「添付ファイル」の区画。
// API は MSW。データはすべて架空（testuser_148b_・[UNIT_TEST]・[E2E_TEST]）。認可・判定の順はサーバー（backend の routes/cases.attachments.test.ts）で確かめ、ここでは重ねない。
// この層で確かめるもの（計画 148-B-1 のテストケースの「AC-7 画面」「画面の組み立て」の行。部品のテストとページのテストを、ページを描画するこの1つにまとめる）：
//   見出し「添付ファイル」の区画を、参加者の下・やり取りの上に置く（タブは作らない）。4つの状態（読み込み中・エラーと再試行・0件・あり）。
//   行の項目（ファイル名＝取得のリンク・大きさ・投稿者〔退職者の併記〕・日時）。「元のメッセージへ」で ?thread= のスレッドが開く
//   （トップレベルは自分の ID、返信は親の ID。親が削除済みでも開き、返信が見える）。「次のページ」で続きを読む。
//   非参加者・詳細が 403 では区画を出さず要求も飛ばない。終了した案件でも見られる。自分の添付つきの投稿が成功したら一覧を取り直す。
//   利用者の切り替え（#284 の枠・見張り）：A の添付の一覧が、B に替わった後に一度も描画されない。
// 画面の契約（実装の担当へ。テストが決めたもの）：
//   区画は名前「添付ファイル」の region（section に aria-labelledby で見出し h2「添付ファイル」）。行は区画の中の listitem。
//   読み込み中「添付ファイルを読み込み中です」、失敗「添付ファイルを読み込めませんでした」と button「再試行」、0件「添付ファイルはありません」。
//   ファイル名は link（名前＝ファイル名、href＝/api/attachments/{id}、download 属性つき）。大きさは送信前の一覧と同じ MB（10^6 バイト・小数1桁）。
//   投稿者は表示名、無効な人は「{表示名}（退職者）」。日時は time 要素（dateTime＝uploadedAt）。
//   「元のメッセージへ」（行ごと。link でも button でもよい）を押すと、URL の ?thread= に threadParentId ?? messageId を入れる。
//   続きは button「次のページ」。
import { act, screen, waitFor, within } from "@testing-library/react";
import { delay, http, HttpResponse, type HttpResponseResolver } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authKeys } from "../features/auth";
import { ReauthProvider } from "../features/auth/ReauthProvider";
import { installDomStubs, type DomStubs } from "../test/app-shell-harness";
import {
  CASE_ATTACHMENT_TEXTS,
  UPLOADER,
  caseAttachment,
  caseAttachmentId,
  caseAttachmentName,
  caseMessageId,
  respondCaseAttachments,
} from "../test/case-attachment-handlers";
import {
  caseDetail,
  caseId,
  caseRoomId,
  caseSummary,
  outsiderSummary,
  respondCases,
} from "../test/case-handlers";
import { renderCaseRequestScreen } from "../test/case-request-handlers";
import { message } from "../test/message-handlers";
import { server } from "../test/server";
import {
  disposeUserSwitchApps,
  renderUserSwitchApp,
} from "../test/user-switch-harness";
import { CaseDetailPage } from "./CaseDetailPage";

// 削除・編集のダイアログが再認証の提供元を使うため、ページを ReauthProvider の中に描画する
const withReauth = (
  <ReauthProvider>
    <CaseDetailPage />
  </ReauthProvider>
);

function renderPage(
  n: number,
  options: { status?: "active" | "closed"; outsider?: boolean } = {},
) {
  const summary = options.outsider
    ? outsiderSummary(n)
    : caseSummary(n, { status: options.status ?? "active" });
  const cases = respondCases({
    summaries: [summary],
    details: options.outsider ? [] : [caseDetail(n, { ...summary })],
  });
  return {
    cases,
    ...renderCaseRequestScreen(withReauth, {
      at: `/cases/${caseId(n)}`,
      path: "/cases/:caseId",
    }),
  };
}

const section = () =>
  screen.findByRole("region", { name: CASE_ATTACHMENT_TEXTS.heading });
const rowOf = (region: HTMLElement, name: string) => {
  const row = within(region)
    .getAllByRole("listitem")
    .find((item) => item.textContent?.includes(name));
  if (row === undefined) throw new Error(`${name} の行がありません`);
  return row;
};

type RepliesServer = { requested: string[] };

/** スレッド（S-07 の ?thread=）の返信の取得の模擬。親が削除済みなら parent は body: null・deleted: true */
function respondThread(
  parentN: number,
  replyN: number,
  options: { parentDeleted?: boolean; roomN: number },
): RepliesServer {
  const state: RepliesServer = { requested: [] };
  const parentId = caseMessageId(parentN);
  const parent = options.parentDeleted
    ? message(parentN, {
        id: parentId,
        roomId: caseRoomId(options.roomN),
        body: null,
        deleted: true,
        replyCount: 1,
      })
    : message(parentN, {
        id: parentId,
        roomId: caseRoomId(options.roomN),
        body: `[E2E_TEST]148B親${parentN}`,
        replyCount: 1,
      });
  server.use(
    http.get("/api/messages/:messageId/replies", ({ params }) => {
      state.requested.push(String(params.messageId));
      return HttpResponse.json({
        items: [
          message(replyN, {
            id: caseMessageId(replyN),
            roomId: caseRoomId(options.roomN),
            parentMessageId: parentId,
            body: `[E2E_TEST]148B返信${replyN}`,
          }),
        ],
        nextCursor: null,
        hasMore: false,
        parent,
        replyBlockedReason: options.parentDeleted ? "deleted_parent" : null,
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
  return state;
}

describe("#148 AC-7 S-17 添付ファイルの区画：配置と4つの状態", () => {
  it("#148 AC-7 C-184(3) 決定 Q4: 参加者の S-17 に見出し「添付ファイル」の区画を、参加者の下・やり取りの上に置く（タブは作らない）", async () => {
    respondCaseAttachments([caseAttachment(1)]);
    renderPage(1);
    const region = await section();
    expect(await within(region).findByText(caseAttachmentName(1))).toBeTruthy();
    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);
    const at = (name: string) => headings.findIndex((h) => h === name);
    expect(at(CASE_ATTACHMENT_TEXTS.heading)).toBeGreaterThan(at("参加者"));
    expect(at("参加者")).toBeGreaterThanOrEqual(0);
    expect(at("やり取り")).toBeGreaterThan(at(CASE_ATTACHMENT_TEXTS.heading));
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("#148 AC-7: 0件なら「添付ファイルはありません」", async () => {
    respondCaseAttachments([]);
    renderPage(2);
    const region = await section();
    expect(
      await within(region).findByText(CASE_ATTACHMENT_TEXTS.empty),
    ).toBeTruthy();
    expect(within(region).queryAllByRole("listitem")).toEqual([]);
  });

  it("#148 AC-7: 取得の間は「添付ファイルを読み込み中です」", async () => {
    server.use(
      http.get("/api/cases/:caseId/attachments", async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
    );
    renderPage(3);
    const region = await section();
    expect(
      await within(region).findByText(CASE_ATTACHMENT_TEXTS.loading),
    ).toBeTruthy();
  });

  it("#148 AC-7: 取得に失敗したら区画の中に「添付ファイルを読み込めませんでした」と「再試行」（0件とは出さない）。再試行で取り直して出す", async () => {
    const state = respondCaseAttachments([caseAttachment(1)], {
      failWith: { status: 500, code: "INTERNAL_ERROR", message: "x" },
    });
    const { user } = renderPage(4);
    const region = await section();
    expect(
      await within(region).findByText(CASE_ATTACHMENT_TEXTS.loadError),
    ).toBeTruthy();
    expect(within(region).queryByText(CASE_ATTACHMENT_TEXTS.empty)).toBeNull();
    state.failWith = null;
    await user.click(
      within(region).getByRole("button", { name: CASE_ATTACHMENT_TEXTS.retry }),
    );
    expect(await within(region).findByText(caseAttachmentName(1))).toBeTruthy();
    expect(
      within(region).queryByText(CASE_ATTACHMENT_TEXTS.loadError),
    ).toBeNull();
  });
});

describe("#148 AC-7 S-17 添付ファイルの行", () => {
  it("#148 AC-7 C-62: 行にファイル名（取得のリンク）・大きさ・投稿者・日時を出し、要求は表示中の案件の ID", async () => {
    const state = respondCaseAttachments([
      caseAttachment(1, { uploadedAt: "2026-11-18T01:02:03.000Z" }),
    ]);
    renderPage(5);
    const region = await section();
    await within(region).findByText(caseAttachmentName(1));
    const row = rowOf(region, caseAttachmentName(1));
    const link = within(row).getByRole("link", {
      name: caseAttachmentName(1),
    });
    expect(link.getAttribute("href")).toBe(
      `/api/attachments/${caseAttachmentId(1)}`,
    );
    expect(link.hasAttribute("download")).toBe(true);
    expect(within(row).getByText("2.5 MB", { exact: false })).toBeTruthy();
    expect(
      within(row).getByText(UPLOADER.displayName, { exact: false }),
    ).toBeTruthy();
    const time = row.querySelector("time");
    expect(time?.getAttribute("dateTime")).toBe("2026-11-18T01:02:03.000Z");
    expect(state.requests.map((r) => r.caseId)).toContain(caseId(5));
  });

  it("#148 AC-7 C-75: 投稿者が無効（退職）なら「{表示名}（退職者）」", async () => {
    respondCaseAttachments([
      caseAttachment(1, {
        uploader: {
          id: "01JTESTUSER148B00000000002",
          displayName: "testuser_148b_retired",
          isActive: false,
        },
      }),
    ]);
    renderPage(6);
    const region = await section();
    await within(region).findByText(caseAttachmentName(1));
    expect(
      within(rowOf(region, caseAttachmentName(1))).getByText(
        `testuser_148b_retired（${CASE_ATTACHMENT_TEXTS.retired}）`,
        { exact: false },
      ),
    ).toBeTruthy();
  });

  it("#148 AC-7: 続きがあれば「次のページ」。押すと cursor を付けて続きを読み、前のページの行も残る", async () => {
    const items = Array.from({ length: 3 }, (_, i) => caseAttachment(i + 1));
    const state = respondCaseAttachments(items, { pageSize: 2 });
    const { user } = renderPage(7);
    const region = await section();
    await within(region).findByText(caseAttachmentName(2));
    expect(within(region).queryByText(caseAttachmentName(3))).toBeNull();
    await user.click(
      within(region).getByRole("button", { name: CASE_ATTACHMENT_TEXTS.more }),
    );
    expect(await within(region).findByText(caseAttachmentName(3))).toBeTruthy();
    expect(within(region).getByText(caseAttachmentName(1))).toBeTruthy();
    expect(state.requests.map((r) => r.cursor)).toContain("p2");
    await waitFor(() =>
      expect(
        within(region).queryByRole("button", {
          name: CASE_ATTACHMENT_TEXTS.more,
        }),
      ).toBeNull(),
    );
  });

  it("#148 AC-7 5-1 AC-11: 終了した案件でも、参加者は一覧を見られる", async () => {
    const state = respondCaseAttachments([caseAttachment(1)]);
    renderPage(8, { status: "closed" });
    const region = await section();
    expect(await within(region).findByText(caseAttachmentName(1))).toBeTruthy();
    expect(state.requests.length).toBeGreaterThan(0);
  });
});

describe("#148 AC-7 C-184(4) 元のメッセージへの移動（?thread=）", () => {
  const jumpIn = (row: HTMLElement) =>
    within(row).getByText(CASE_ATTACHMENT_TEXTS.jump);

  it("#148 AC-7 C-184(4): トップレベルの投稿の添付の「元のメッセージへ」で、その投稿を親にしたスレッドが開く", async () => {
    respondCaseAttachments([
      caseAttachment(1, { messageId: caseMessageId(11), threadParentId: null }),
    ]);
    const thread = respondThread(11, 12, { roomN: 9 });
    const { user } = renderPage(9);
    const region = await section();
    await within(region).findByText(caseAttachmentName(1));
    await user.click(jumpIn(rowOf(region, caseAttachmentName(1))));
    await waitFor(() => expect(thread.requested).toContain(caseMessageId(11)));
    expect(
      await within(
        await screen.findByRole("region", { name: "スレッド" }),
      ).findByText("[E2E_TEST]148B親11"),
    ).toBeTruthy();
  });

  it("#148 AC-7 C-184(4): 返信の添付の「元のメッセージへ」で、親のスレッドが開き、その返信が見える（返信の ID ではなく親の ID を開く）", async () => {
    respondCaseAttachments([
      caseAttachment(1, {
        messageId: caseMessageId(22),
        threadParentId: caseMessageId(21),
      }),
    ]);
    const thread = respondThread(21, 22, { roomN: 10 });
    const { user } = renderPage(10);
    const region = await section();
    await within(region).findByText(caseAttachmentName(1));
    await user.click(jumpIn(rowOf(region, caseAttachmentName(1))));
    const pane = await screen.findByRole("region", { name: "スレッド" });
    expect(await within(pane).findByText("[E2E_TEST]148B返信22")).toBeTruthy();
    expect(thread.requested).toContain(caseMessageId(21));
    expect(thread.requested).not.toContain(caseMessageId(22));
  });

  it("#148 AC-7 計画 確認4: 親が削除済みの返信の添付からも、スレッドが開き、返信が見える", async () => {
    respondCaseAttachments([
      caseAttachment(1, {
        messageId: caseMessageId(32),
        threadParentId: caseMessageId(31),
      }),
    ]);
    const thread = respondThread(31, 32, { roomN: 11, parentDeleted: true });
    const { user } = renderPage(11);
    const region = await section();
    await within(region).findByText(caseAttachmentName(1));
    await user.click(jumpIn(rowOf(region, caseAttachmentName(1))));
    const pane = await screen.findByRole("region", { name: "スレッド" });
    expect(await within(pane).findByText("[E2E_TEST]148B返信32")).toBeTruthy();
    expect(thread.requested).toContain(caseMessageId(31));
  });
});

describe("#148 AC-7 R-62 参加者でなければ、添付の一覧を取得しない", () => {
  it("#148 AC-7 5-1 AC-2: 非参加者には区画を出さず、添付の一覧の要求が飛ばない", async () => {
    const state = respondCaseAttachments([caseAttachment(1)]);
    renderPage(12, { outsider: true });
    expect(
      await screen.findByText("参加者だけが見られます（非公開）"),
    ).toBeTruthy();
    expect(
      screen.queryByRole("region", { name: CASE_ATTACHMENT_TEXTS.heading }),
    ).toBeNull();
    expect(screen.queryByText(caseAttachmentName(1))).toBeNull();
    expect(state.requests).toEqual([]);
  });

  it("#148 AC-7 147-A: 詳細が 403（外された後）なら、区画を出さず、添付の一覧の要求が飛ばない", async () => {
    const state = respondCaseAttachments([caseAttachment(1)]);
    respondCases({ summaries: [caseSummary(13)], denied: [caseId(13)] });
    renderCaseRequestScreen(withReauth, {
      at: `/cases/${caseId(13)}`,
      path: "/cases/:caseId",
    });
    expect(
      await screen.findByText("参加者だけが見られます（非公開）"),
    ).toBeTruthy();
    expect(
      screen.queryByRole("region", { name: CASE_ATTACHMENT_TEXTS.heading }),
    ).toBeNull();
    expect(state.requests).toEqual([]);
  });
});

describe("#148 AC-7 計画「取り直し」 自分の添付つきの投稿の成功", () => {
  it("#148 AC-7: やり取りの入力欄から添付つきで投稿に成功したら、添付の一覧を取り直し、新しい添付が出る", async () => {
    const state = respondCaseAttachments([]);
    server.use(
      http.post("/api/rooms/:roomId/attachments", () =>
        HttpResponse.json(
          {
            id: caseAttachmentId(90),
            name: "memo148b.txt",
            kind: "document",
            contentType: "text/plain; charset=utf-8",
            size: 13,
            // #148（148-B-2）案件の部屋のアップロードの応答（指定なしは参加者限定）
            publicationVisibility: "participants_only",
          },
          { status: 201 },
        ),
      ),
      http.post("/api/rooms/:roomId/messages", ({ params }) => {
        state.items = [
          caseAttachment(90, {
            name: "memo148b.txt",
            messageId: "01JTESTMSG148B000000009999",
          }),
        ];
        return HttpResponse.json(
          {
            id: "01JTESTMSG148B000000009999",
            roomId: String(params.roomId),
            createdAt: "2026-11-18T00:00:00.000Z",
          },
          { status: 201 },
        );
      }),
    );
    const { user } = renderPage(14);
    const region = await section();
    await within(region).findByText(CASE_ATTACHMENT_TEXTS.empty);
    const before = state.requests.length;
    await user.upload(
      screen.getByLabelText<HTMLInputElement>("ファイルを添付"),
      new File(["[E2E_TEST]148B"], "memo148b.txt", { type: "text/plain" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "メッセージ" }),
      "148Bの添付つき",
    );
    await user.click(screen.getByRole("button", { name: "送信" }));
    await waitFor(() => expect(state.requests.length).toBeGreaterThan(before));
    expect(await within(region).findByText("memo148b.txt")).toBeTruthy();
  });
});

describe("#148 AC-7 計画「取り直し」 スレッドでの添付つきの返信の成功", () => {
  it("#148 AC-7: 案件の画面のスレッド（?thread=）で添付つきの返信に成功したら、添付の一覧を取り直し、新しい添付の行が出る（元のメッセージへは親の ID）", async () => {
    const state = respondCaseAttachments([]);
    const thread = respondThread(41, 42, { roomN: 15 });
    server.use(
      http.post("/api/messages/:messageId/replies/attachments", () =>
        HttpResponse.json(
          {
            id: caseAttachmentId(91),
            name: "reply148b.txt",
            kind: "document",
            contentType: "text/plain; charset=utf-8",
            size: 13,
            // #148（148-B-2）案件の部屋のアップロードの応答（指定なしは参加者限定）
            publicationVisibility: "participants_only",
          },
          { status: 201 },
        ),
      ),
      http.post("/api/messages/:messageId/replies", ({ params }) => {
        state.items = [
          caseAttachment(91, {
            name: "reply148b.txt",
            messageId: caseMessageId(43),
            threadParentId: String(params.messageId),
          }),
        ];
        return HttpResponse.json(
          {
            id: caseMessageId(43),
            parentMessageId: String(params.messageId),
            createdAt: "2026-11-18T00:00:00.000Z",
          },
          { status: 201 },
        );
      }),
    );
    respondCases({ summaries: [caseSummary(15)], details: [caseDetail(15)] });
    const { user } = renderCaseRequestScreen(withReauth, {
      at: `/cases/${caseId(15)}?thread=${caseMessageId(41)}`,
      path: "/cases/:caseId",
    });
    const region = await section();
    await within(region).findByText(CASE_ATTACHMENT_TEXTS.empty);
    const pane = await screen.findByRole("region", { name: "スレッド" });
    await within(pane).findByText("[E2E_TEST]148B返信42");
    const before = state.requests.length;
    await user.upload(
      within(pane).getByLabelText<HTMLInputElement>("ファイルを添付"),
      new File(["[E2E_TEST]148B"], "reply148b.txt", { type: "text/plain" }),
    );
    await user.type(
      within(pane).getByRole("textbox", { name: "返信" }),
      "148Bの返信の添付つき",
    );
    await user.click(within(pane).getByRole("button", { name: "送信" }));
    await waitFor(() => expect(state.requests.length).toBeGreaterThan(before));
    expect(await within(region).findByText("reply148b.txt")).toBeTruthy();
    // 返信の行の「元のメッセージへ」は親の ID のスレッド
    await user.click(
      within(rowOf(region, "reply148b.txt")).getByText(
        CASE_ATTACHMENT_TEXTS.jump,
      ),
    );
    await waitFor(() =>
      expect(thread.requested.every((id) => id === caseMessageId(41))).toBe(
        true,
      ),
    );
  });
});

// ---- コードレビュー1回目の軽微：削除・編集の後の一覧 ----

const SELF = { id: "01JTESTUSER000000000000001", displayName: "テスト太郎" };
const fileOf = (n: number) => ({
  id: caseAttachmentId(n),
  name: caseAttachmentName(n),
  kind: "document" as const,
  contentType: "text/plain; charset=utf-8",
  size: 13,
});

/** 案件の部屋のメッセージ（自分の投稿）。削除は 204、編集は 200 */
function respondOwnRoom(items: ReturnType<typeof message>[]) {
  const deletes: string[] = [];
  server.use(
    http.get("/api/rooms/:roomId/messages", ({ request }) => {
      const after = new URL(request.url).searchParams.get("after");
      return HttpResponse.json({
        items: after === null ? [...items].reverse() : [],
        nextCursor: null,
        hasMore: false,
      });
    }),
    http.delete("/api/messages/:messageId", ({ params }) => {
      deletes.push(String(params.messageId));
      return new HttpResponse(null, { status: 204 });
    }),
    http.patch("/api/messages/:messageId", async ({ request, params }) => {
      const { body } = (await request.json()) as { body: string };
      return HttpResponse.json({
        id: String(params.messageId),
        body,
        editedAt: "2026-11-18T02:00:00.000Z",
        mentions: [],
      });
    }),
  );
  return { deletes };
}

type Rendered = ReturnType<typeof renderCaseRequestScreen>;

async function deleteIn(
  scope: HTMLElement,
  text: string,
  { user, client }: Pick<Rendered, "user" | "client">,
) {
  // 直前に再認証した状態にする（削除は再認証の有効期間の中なら、そのまま送る）
  client.setQueryData(authKeys.session, (session: object | undefined) => ({
    ...session,
    reauthenticatedAt: new Date().toISOString(),
  }));
  const row = within(scope)
    .getAllByRole("listitem")
    .find((item) => item.textContent?.includes(text));
  if (row === undefined) throw new Error(`${text} の行がありません`);
  await user.click(within(row).getByRole("button", { name: "削除" }));
  const dialog = await screen.findByRole("dialog", {
    name: "メッセージの削除",
  });
  await user.click(within(dialog).getByRole("button", { name: "削除する" }));
}

describe("#148 AC-7 コードレビュー1回目（軽微） 削除・編集の後の添付の一覧", () => {
  it("#148 AC-7: 添付つきの投稿を削除すると、添付の一覧を取り直し、その行が消える", async () => {
    const posted = message(51, {
      id: caseMessageId(51),
      roomId: caseRoomId(16),
      body: "[E2E_TEST]148B削除する投稿",
      author: SELF,
      attachments: [fileOf(1)],
    });
    const room = respondOwnRoom([posted]);
    const state = respondCaseAttachments([
      caseAttachment(1, { messageId: caseMessageId(51) }),
    ]);
    const rendered = renderPage(16);
    const region = await section();
    await within(region).findByText(caseAttachmentName(1));
    const log = await screen.findByRole("log", { name: "メッセージ一覧" });
    await within(log).findByText("[E2E_TEST]148B削除する投稿");
    state.items = [];
    await deleteIn(log, "[E2E_TEST]148B削除する投稿", rendered);
    await waitFor(() => expect(room.deletes).toEqual([caseMessageId(51)]));
    await waitFor(() =>
      expect(within(region).queryByText(caseAttachmentName(1))).toBeNull(),
    );
  });

  it("#148 AC-7: スレッドで添付つきの返信を削除すると、その行が消える", async () => {
    const state = respondCaseAttachments([
      caseAttachment(2, {
        messageId: caseMessageId(62),
        threadParentId: caseMessageId(61),
      }),
    ]);
    const deletes: string[] = [];
    server.use(
      http.get("/api/messages/:messageId/replies", () =>
        HttpResponse.json({
          items: [
            message(62, {
              id: caseMessageId(62),
              roomId: caseRoomId(17),
              parentMessageId: caseMessageId(61),
              body: "[E2E_TEST]148B削除する返信",
              author: SELF,
              attachments: [fileOf(2)],
            }),
          ],
          nextCursor: null,
          hasMore: false,
          parent: message(61, {
            id: caseMessageId(61),
            roomId: caseRoomId(17),
            body: "[E2E_TEST]148B親61",
            replyCount: 1,
          }),
          replyBlockedReason: null,
          caseRoom: true,
          joined: true,
          roomWritable: true,
        }),
      ),
      http.put(
        "/api/messages/:messageId/thread-read-position",
        () => new HttpResponse(null, { status: 204 }),
      ),
      http.delete("/api/messages/:messageId", ({ params }) => {
        deletes.push(String(params.messageId));
        return new HttpResponse(null, { status: 204 });
      }),
    );
    respondCases({ summaries: [caseSummary(17)], details: [caseDetail(17)] });
    const rendered = renderCaseRequestScreen(withReauth, {
      at: `/cases/${caseId(17)}?thread=${caseMessageId(61)}`,
      path: "/cases/:caseId",
    });
    const region = await section();
    await within(region).findByText(caseAttachmentName(2));
    const pane = await screen.findByRole("region", { name: "スレッド" });
    await within(pane).findByText("[E2E_TEST]148B削除する返信");
    state.items = [];
    await deleteIn(pane, "[E2E_TEST]148B削除する返信", rendered);
    await waitFor(() => expect(deletes).toEqual([caseMessageId(62)]));
    await waitFor(() =>
      expect(within(region).queryByText(caseAttachmentName(2))).toBeNull(),
    );
  });

  it("#148 AC-7 計画（削除済みの親）: 親だけを削除しても、残っている返信の添付の行は残る（取り直しの応答も返信の添付を返す）", async () => {
    const parent = message(71, {
      id: caseMessageId(71),
      roomId: caseRoomId(18),
      body: "[E2E_TEST]148B削除する親",
      author: SELF,
      replyCount: 1,
    });
    const room = respondOwnRoom([parent]);
    respondCaseAttachments([
      caseAttachment(3, {
        messageId: caseMessageId(72),
        threadParentId: caseMessageId(71),
      }),
    ]);
    const rendered = renderPage(18);
    const region = await section();
    await within(region).findByText(caseAttachmentName(3));
    const log = await screen.findByRole("log", { name: "メッセージ一覧" });
    await within(log).findByText("[E2E_TEST]148B削除する親");
    await deleteIn(log, "[E2E_TEST]148B削除する親", rendered);
    await waitFor(() => expect(room.deletes).toEqual([caseMessageId(71)]));
    await within(log).findByText("このメッセージは削除されました");
    expect(within(region).getByText(caseAttachmentName(3))).toBeTruthy();
  });

  it("#148 AC-7: 本文だけの編集では、添付の一覧の中身は変わらない", async () => {
    const posted = message(81, {
      id: caseMessageId(81),
      roomId: caseRoomId(19),
      body: "[E2E_TEST]148B編集する投稿",
      author: SELF,
      attachments: [fileOf(4)],
    });
    respondOwnRoom([posted]);
    respondCaseAttachments([
      caseAttachment(4, { messageId: caseMessageId(81) }),
    ]);
    const { user } = renderPage(19);
    const region = await section();
    await within(region).findByText(caseAttachmentName(4));
    const log = await screen.findByRole("log", { name: "メッセージ一覧" });
    const text = await within(log).findByText("[E2E_TEST]148B編集する投稿");
    const row = text.closest("li");
    if (row === null) throw new Error("投稿の行がありません");
    await user.click(within(row).getByRole("button", { name: "編集" }));
    const input = await within(log).findByRole("textbox", {
      name: "メッセージの編集",
    });
    await user.clear(input);
    await user.type(input, "148B編集後");
    await user.click(within(log).getByRole("button", { name: "保存" }));
    await within(log).findByText("148B編集後");
    expect(within(region).getByText(caseAttachmentName(4))).toBeTruthy();
    expect(within(region).getAllByRole("listitem")).toHaveLength(1);
  });
});

// ---- 文書の担当の気づき：「次のページ」の失敗 ----

const MORE_ERROR = "添付ファイルの続きを読み込めませんでした";

describe("#148 AC-7 「次のページ」の読み込みの失敗", () => {
  it("#148 AC-7: 「次のページ」が 500 でも読み込み済みの行は残り、続きの失敗（role=alert）と「再試行」を出す。再試行が成功すると続きの行が足される", async () => {
    const items = Array.from({ length: 3 }, (_, i) => caseAttachment(i + 1));
    const server500 = { failNext: true };
    server.use(
      http.get("/api/cases/:caseId/attachments", ({ request }) => {
        const cursor = new URL(request.url).searchParams.get("cursor");
        if (cursor === null)
          return HttpResponse.json({
            items: items.slice(0, 2),
            nextCursor: "p2",
          });
        if (server500.failNext)
          return HttpResponse.json(
            { code: "INTERNAL_ERROR", message: "x" },
            { status: 500 },
          );
        return HttpResponse.json({ items: items.slice(2), nextCursor: null });
      }),
    );
    const { user } = renderPage(20);
    const region = await section();
    await within(region).findByText(caseAttachmentName(2));
    await user.click(
      within(region).getByRole("button", { name: CASE_ATTACHMENT_TEXTS.more }),
    );
    const alert = await within(region).findByRole("alert");
    expect(alert.textContent).toContain(MORE_ERROR);
    expect(within(region).getByText(caseAttachmentName(1))).toBeTruthy();
    expect(within(region).getByText(caseAttachmentName(2))).toBeTruthy();
    expect(
      within(region).queryByText(CASE_ATTACHMENT_TEXTS.loadError),
    ).toBeNull();
    server500.failNext = false;
    await user.click(
      within(region).getByRole("button", { name: CASE_ATTACHMENT_TEXTS.retry }),
    );
    expect(await within(region).findByText(caseAttachmentName(3))).toBeTruthy();
    expect(within(region).getByText(caseAttachmentName(1))).toBeTruthy();
    await waitFor(() =>
      expect(within(region).queryByText(MORE_ERROR)).toBeNull(),
    );
  });
});

// ---- 利用者の切り替え（#284 の枠と見張り） ----

const USER_A = {
  id: "01JTESTCASE148BVSERA000001",
  displayName: "testuser_case148b_a",
  loginId: "testuser_case148b_a",
};
const USER_B = {
  id: "01JTESTCASE148BVSERB000001",
  displayName: "testuser_case148b_b",
  loginId: "testuser_case148b_b",
};
type TestUser = typeof USER_A;
const A_MARK = "[UNIT_TEST]148BA";
const B_MARK = "[UNIT_TEST]148BB";
const markOf = (user: TestUser) => (user === USER_A ? A_MARK : B_MARK);
const N = 49;

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
  server.use(
    http.get("/api/auth/session", () =>
      HttpResponse.json(sessionOf(world.user)),
    ),
    http.get(
      "/api/cases",
      serve(() => ({ items: [], nextCursor: null })),
    ),
    http.get(
      "/api/cases/:caseId/attachments",
      serve((user) => ({
        items: [
          caseAttachment(1, {
            name: `${markOf(user)}の添付.txt`,
            uploader: {
              id: user.id,
              displayName: user.displayName,
              isActive: true,
            },
          }),
        ],
        nextCursor: null,
      })),
    ),
    http.get(
      "/api/cases/:caseId/detail",
      serve(() => caseDetail(N)),
    ),
    http.get(
      "/api/cases/:caseId",
      serve(() => caseSummary(N)),
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

describe("#148 #284 S-17 を開いたまま利用者が替わる（添付ファイル）", () => {
  beforeEach(() => {
    stubs = installDomStubs();
  });
  afterEach(() => {
    disposeUserSwitchApps();
    stubs.restore();
  });

  it("#148 AC-7 #284: A の添付の一覧を表示したまま B に替わると、A の添付が一度も描画されず、B の添付が出る（キーに利用者の ID）", async () => {
    const world = respondSwitchWorld();
    const app = renderUserSwitchApp(`/cases/${caseId(N)}`, {
      needles: [A_MARK],
    });
    await waitFor(() => expect(shows(`${A_MARK}の添付.txt`)).toBe(true));

    const gate = deferred();
    world.user = USER_B;
    world.hold = gate.promise;
    app.watch.arm();
    act(() => {
      app.client.setQueryData(authKeys.session, sessionOf(USER_B));
    });
    expect(app.watch.hits).toEqual([]);
    gate.release();
    await waitFor(() => expect(shows(`${B_MARK}の添付.txt`)).toBe(true));
    expect(app.watch.hits).toEqual([]);
  });
});
