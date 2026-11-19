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
    ...renderCaseRequestScreen(<CaseDetailPage />, {
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
    renderCaseRequestScreen(<CaseDetailPage />, {
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
