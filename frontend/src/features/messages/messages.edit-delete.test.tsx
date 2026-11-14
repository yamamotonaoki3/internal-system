// #134 AC-1（1-3 AC-1〜AC-4）: 部屋のメッセージ（RoomMessages）での、自分の投稿の編集・削除。API は MSW。データは架空。
// 契約（実装前の仮置き。計画 plan-134 の「8. 画面」・改訂1 の軽微5・C-57・C-170(5)）：
//   <RoomMessages roomId canPost joined canModifyOwn? />。canModifyOwn（既定は偽）が真のとき、ログイン中の利用者（auth の useSignedInUserId）が
//     投稿者（author.id）で、削除されていないメッセージにだけ、その行（一覧 role=log の中の、入れ子でない listitem）に
//     名前「編集」「削除」のボタンを出す。他人の投稿・削除済み・canModifyOwn が偽・ログインしていないときは出さない。
//   編集：「編集」を押すと、その行で本文の入った編集欄（名前「メッセージの編集」の textbox）と「保存」「キャンセル」に切り替える。
//     本文の規則は shared/message-rules.ts（空白だけ・4,001文字以上は送らず、編集欄を aria-invalid にする）。
//     元の本文から変わっていないときは「保存」を押せない（disabled）。Ctrl+Enter（Mac は Cmd+Enter）で保存、Esc でキャンセル。Enter だけは改行。
//     保存は PATCH /api/messages/:messageId { body }。保存中は「保存」を押せない。成功したら編集欄を閉じ、再読み込みなしで新しい本文と「（編集済み）」を出す。
//     422 の fields に body があれば編集欄を aria-invalid にしてサーバーの文を出す。ほかの失敗は role=alert にサーバーの文（describeError）を出し、
//     編集欄と入力は残し、一覧の表示（本文・編集済みの印）は変えない。実行中の2秒ごとの取得の結果で、編集の結果を上書きしない。
//   削除：「削除」を押すと、確認のダイアログ（role=dialog・名前「メッセージの削除」。「削除する」「キャンセル」）を出す。
//     「削除する」で再認証（auth の useReauth().withReauth。ReauthProvider のダイアログ「再認証」）を経て DELETE /api/messages/:messageId を送る。
//     キャンセル（確認・再認証のどちらでも）では送らず、表示も変えない。送信中は「削除する」を押せない。
//     成功したら、再読み込みなしで、その行の本文を「このメッセージは削除されました」に替え、ボタンを消す（投稿者の表示名は残す）。
//     失敗したら role=alert にサーバーの文を出し、表示を変えない。
//   一覧の editedAt が null でない項目には「（編集済み）」を出す。deleted が真の項目は本文の代わりに「このメッセージは削除されました」を出す。
//   編集欄は、投稿の下書き（端末への保存）と離脱の確認の対象にしない（C-170(5)）。
//   useReauth は削除の確認ダイアログの中だけで呼ぶ（既存のテストは ReauthProvider なしで RoomMessages・ChannelDetailView を描画するため）。
// 期待値は要件・計画から書く。データは架空（testuser_・[E2E_TEST]・example.com）。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TEST_PASSWORD } from "../../test/auth-handlers";
import {
  EDITED_AT,
  ROOM_ID,
  apiErrorResponse,
  message,
  respondMessages,
  type MessageServer,
} from "../../test/message-handlers";
import { server } from "../../test/server";
import { authKeys } from "../auth";
import { ReauthProvider } from "../auth/ReauthProvider";
import { RoomMessages } from "./index";

const ME = {
  id: "01JTESTUSER000000000000001",
  displayName: "testuser_001",
  loginId: "testuser_001",
};
const OTHER = {
  id: "01JTESTUSER000000000000002",
  displayName: "testuser_002",
};
const EDITED_MARK = "（編集済み）";
const DELETED_TEXT = "このメッセージは削除されました";
const DRAFT_KEY = `internal-system:draft:v1:${ME.id}:room:${ROOM_ID}`;

const mine = (n: number, body: string) =>
  message(n, { author: { id: ME.id, displayName: ME.displayName }, body });
const theirs = (n: number, body: string) => message(n, { author: OTHER, body });

type RenderOptions = {
  canModifyOwn?: boolean;
  canPost?: boolean;
  /** null はログインしていない */
  signedIn?: boolean;
  reauthenticatedAt?: string | null;
  fakeTimers?: boolean;
};

function renderRoom(options: RenderOptions = {}) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  if (options.signedIn !== false)
    client.setQueryData(authKeys.session, {
      user: ME,
      permissions: [],
      mustChangePassword: false,
      reauthenticatedAt: options.reauthenticatedAt ?? null,
    });
  const user = userEvent.setup(
    options.fakeTimers ? { advanceTimers: vi.advanceTimersByTime } : {},
  );
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ReauthProvider>
          <RoomMessages
            roomId={ROOM_ID}
            canPost={options.canPost ?? true}
            joined
            canModifyOwn={options.canModifyOwn ?? true}
          />
        </ReauthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user, client };
}

const log = () => screen.getByRole("log");
/** メッセージの行（本文の中の箇条書きの li を除く） */
const rows = () =>
  within(log())
    .getAllByRole("listitem")
    .filter((li) => li.parentElement?.closest("li") === null);
async function rowWith(text: string): Promise<HTMLElement> {
  return waitFor(() => {
    const row = rows().find((li) => (li.textContent ?? "").includes(text));
    if (row === undefined) throw new Error(`「${text}」の行がありません`);
    return row;
  });
}
const editButton = (row: HTMLElement) =>
  within(row).queryByRole("button", { name: "編集" });
const deleteButton = (row: HTMLElement) =>
  within(row).queryByRole("button", { name: "削除" });
const editBox = () =>
  screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: "メッセージの編集",
  });
const saveButton = () =>
  screen.getByRole<HTMLButtonElement>("button", { name: "保存" });
const composer = () =>
  screen.getByRole<HTMLTextAreaElement>("textbox", { name: "メッセージ" });
const savedDraftBody = (): unknown => {
  const raw = window.localStorage.getItem(DRAFT_KEY);
  if (raw === null) return null;
  const saved: unknown = JSON.parse(raw);
  return typeof saved === "object" && saved !== null && "body" in saved
    ? saved.body
    : null;
};
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

function respondReauth() {
  const passwords: string[] = [];
  server.use(
    http.post("/api/auth/reauthenticate", async ({ request }) => {
      passwords.push(((await request.json()) as { password: string }).password);
      return HttpResponse.json({ reauthenticatedAt: new Date().toISOString() });
    }),
  );
  return passwords;
}

async function openEdit(
  user: ReturnType<typeof userEvent.setup>,
  original: string,
) {
  const row = await rowWith(original);
  const button = editButton(row);
  if (button === null) throw new Error("「編集」がありません");
  await user.click(button);
  return editBox();
}

async function replaceText(
  user: ReturnType<typeof userEvent.setup>,
  box: HTMLTextAreaElement,
  text: string,
) {
  await user.clear(box);
  await user.type(box, text);
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("#134 AC-1（1-3 AC-1・AC-2）編集・削除のボタン", () => {
  it("#134 AC-1（1-3 AC-1・AC-2）: 自分の投稿にだけ「編集」「削除」を出し、他人の投稿には出さない", async () => {
    respondMessages([
      mine(1, "[E2E_TEST]自分の投稿"),
      theirs(2, "[E2E_TEST]他人の投稿"),
    ]);
    renderRoom();
    const own = await rowWith("[E2E_TEST]自分の投稿");
    const other = await rowWith("[E2E_TEST]他人の投稿");
    expect(editButton(own)).not.toBeNull();
    expect(deleteButton(own)).not.toBeNull();
    expect(editButton(other)).toBeNull();
    expect(deleteButton(other)).toBeNull();
  });

  it("#134 AC-1（1-3 AC-1）: 投稿できない部屋（canPost が偽）でも、canModifyOwn が真なら自分の投稿に「編集」「削除」を出す", async () => {
    respondMessages([mine(1, "[E2E_TEST]元オーナーの投稿")]);
    renderRoom({ canPost: false });
    const own = await rowWith("[E2E_TEST]元オーナーの投稿");
    expect(editButton(own)).not.toBeNull();
    expect(deleteButton(own)).not.toBeNull();
  });

  it("#134 AC-1: canModifyOwn が偽なら、自分の投稿にも「編集」「削除」を出さない", async () => {
    respondMessages([mine(1, "[E2E_TEST]自分の投稿")]);
    renderRoom({ canModifyOwn: false });
    const own = await rowWith("[E2E_TEST]自分の投稿");
    expect(editButton(own)).toBeNull();
    expect(deleteButton(own)).toBeNull();
  });

  it("#134 AC-1: canModifyOwn を渡さなければ（既定）、「編集」「削除」を出さない", async () => {
    respondMessages([mine(1, "[E2E_TEST]自分の投稿")]);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(authKeys.session, {
      user: ME,
      permissions: [],
      mustChangePassword: false,
      reauthenticatedAt: null,
    });
    render(
      <QueryClientProvider client={client}>
        <RoomMessages roomId={ROOM_ID} canPost joined />
      </QueryClientProvider>,
    );
    const own = await rowWith("[E2E_TEST]自分の投稿");
    expect(editButton(own)).toBeNull();
    expect(deleteButton(own)).toBeNull();
  });

  it("#134 AC-1: ログインしていない（利用者が分からない）ときは、どの投稿にも出さない", async () => {
    respondMessages([mine(1, "[E2E_TEST]自分の投稿")]);
    renderRoom({ signedIn: false });
    const row = await rowWith("[E2E_TEST]自分の投稿");
    expect(editButton(row)).toBeNull();
    expect(deleteButton(row)).toBeNull();
  });
});

describe("#134 AC-1（1-3 AC-1・AC-3・C-57）編集済み・削除済みの表示", () => {
  it("#134 AC-1（1-3 AC-3）: editedAt がある投稿に「（編集済み）」を出し、ない投稿には出さない", async () => {
    respondMessages([
      message(1, {
        author: OTHER,
        body: "[E2E_TEST]編集した投稿",
        editedAt: EDITED_AT,
      }),
      theirs(2, "[E2E_TEST]編集していない投稿"),
    ]);
    renderRoom();
    const edited = await rowWith("[E2E_TEST]編集した投稿");
    const plain = await rowWith("[E2E_TEST]編集していない投稿");
    expect(edited.textContent).toContain(EDITED_MARK);
    expect(plain.textContent).not.toContain(EDITED_MARK);
  });

  it("#134 AC-1（1-3 AC-1・C-57）: 削除済みの投稿は、本文の代わりに「このメッセージは削除されました」を出し、投稿者の表示名は残す。自分の投稿でも「編集」「削除」を出さない", async () => {
    respondMessages([
      message(1, {
        author: { id: ME.id, displayName: ME.displayName },
        body: null,
        deleted: true,
      }),
      theirs(2, "[E2E_TEST]後の投稿"),
    ]);
    renderRoom();
    await rowWith("[E2E_TEST]後の投稿");
    const deleted = rows()[0];
    if (deleted === undefined) throw new Error("削除済みの行がありません");
    expect(deleted.textContent).toContain(DELETED_TEXT);
    expect(deleted.textContent).toContain(ME.displayName);
    expect(deleted.textContent).not.toContain(EDITED_MARK);
    expect(editButton(deleted)).toBeNull();
    expect(deleteButton(deleted)).toBeNull();
  });
});

describe("#134 AC-1（1-3 AC-1・AC-3）編集", () => {
  it("#134 AC-1（1-3 AC-1・AC-3）: 「編集」でその場の編集欄に本文が入り、保存すると PATCH を1回送り、再読み込みなしで新しい本文と「（編集済み）」を出す", async () => {
    const state = respondMessages([mine(1, "[E2E_TEST]元の本文")]);
    const { user } = renderRoom();
    const box = await openEdit(user, "[E2E_TEST]元の本文");
    expect(box.value).toBe("[E2E_TEST]元の本文");
    await replaceText(user, box, "[[E2E_TEST]直した本文");
    await user.click(saveButton());
    await waitFor(() =>
      expect(state.edits).toEqual([
        { messageId: message(1).id, body: "[E2E_TEST]直した本文" },
      ]),
    );
    const row = await rowWith("[E2E_TEST]直した本文");
    expect(row.textContent).toContain(EDITED_MARK);
    expect(row.textContent).not.toContain("[E2E_TEST]元の本文");
    await waitFor(() =>
      expect(
        screen.queryByRole("textbox", { name: "メッセージの編集" }),
      ).toBeNull(),
    );
    // 一覧の取り直し（after なし）を2回目に送っていない＝その場で反映した
    expect(
      state.requests.filter((url) => !url.searchParams.has("after")),
    ).toHaveLength(1);
  });

  it("#134 AC-1: 本文を変えていないときは「保存」を押せない（開いた直後・元に戻した後）。Ctrl+Enter でも送らない", async () => {
    const state = respondMessages([mine(1, "[E2E_TEST]元の本文")]);
    const { user } = renderRoom();
    const box = await openEdit(user, "[E2E_TEST]元の本文");
    expect(saveButton().disabled).toBe(true);
    await user.type(box, "追記");
    expect(saveButton().disabled).toBe(false);
    await user.type(box, "{Backspace}{Backspace}");
    expect(box.value).toBe("[E2E_TEST]元の本文");
    expect(saveButton().disabled).toBe(true);
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(state.edits).toEqual([]);
  });

  it.each([[""], [" \n  "]])(
    "#134 AC-1（1-1 AC-5 の規則）: 空白だけ（%j）の本文は送らず、編集欄にエラーを出す",
    async (value) => {
      const state = respondMessages([mine(1, "[E2E_TEST]元の本文")]);
      const { user } = renderRoom();
      const box = await openEdit(user, "[E2E_TEST]元の本文");
      fireEvent.change(box, { target: { value } });
      fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
      if (!saveButton().disabled) await user.click(saveButton());
      await waitFor(() =>
        expect(box.getAttribute("aria-invalid")).toBe("true"),
      );
      expect(state.edits).toEqual([]);
    },
  );

  it("#134 AC-1（1-1 AC-5 の規則）: 4,001文字の本文は送らず、編集欄にエラーを出す", async () => {
    const state = respondMessages([mine(1, "[E2E_TEST]元の本文")]);
    const { user } = renderRoom();
    const box = await openEdit(user, "[E2E_TEST]元の本文");
    fireEvent.change(box, { target: { value: "あ".repeat(4001) } });
    await user.click(saveButton());
    await waitFor(() => expect(box.getAttribute("aria-invalid")).toBe("true"));
    expect(state.edits).toEqual([]);
  });

  it("#134 AC-1（1-1 AC-5 の規則）: 4,000文字の本文は送る（境界）", async () => {
    const state = respondMessages([mine(1, "[E2E_TEST]元の本文")]);
    const { user } = renderRoom();
    const box = await openEdit(user, "[E2E_TEST]元の本文");
    const body = "あ".repeat(4000);
    fireEvent.change(box, { target: { value: body } });
    await user.click(saveButton());
    await waitFor(() =>
      expect(state.edits).toEqual([{ messageId: message(1).id, body }]),
    );
  });

  it.each([
    ["Ctrl+Enter", { ctrlKey: true }],
    ["Cmd+Enter（Mac）", { metaKey: true }],
  ])("#134 AC-1: %s で保存する", async (_label, modifier) => {
    const state = respondMessages([mine(1, "[E2E_TEST]元の本文")]);
    const { user } = renderRoom();
    const box = await openEdit(user, "[E2E_TEST]元の本文");
    await replaceText(user, box, "[[E2E_TEST]キーで保存");
    fireEvent.keyDown(box, { key: "Enter", ...modifier });
    await waitFor(() =>
      expect(state.edits).toEqual([
        { messageId: message(1).id, body: "[E2E_TEST]キーで保存" },
      ]),
    );
    expect((await rowWith("[E2E_TEST]キーで保存")).textContent).toContain(
      EDITED_MARK,
    );
  });

  it("#134 AC-1: 編集欄で Enter だけでは保存しない（改行）", async () => {
    const state = respondMessages([mine(1, "[E2E_TEST]元の本文")]);
    const { user } = renderRoom();
    const box = await openEdit(user, "[E2E_TEST]元の本文");
    await user.type(box, "{Enter}二行目");
    expect(box.value).toBe("[E2E_TEST]元の本文\n二行目");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(state.edits).toEqual([]);
  });

  it.each([
    ["Esc", "escape"],
    ["「キャンセル」", "button"],
  ])(
    "#134 AC-1: %s で編集をやめると、送らずに編集欄を閉じ、元の本文に戻る",
    async (_label, how) => {
      const state = respondMessages([mine(1, "[E2E_TEST]元の本文")]);
      const { user } = renderRoom();
      const box = await openEdit(user, "[E2E_TEST]元の本文");
      await replaceText(user, box, "[[E2E_TEST]捨てる本文");
      if (how === "escape") fireEvent.keyDown(box, { key: "Escape" });
      else await user.click(screen.getByRole("button", { name: "キャンセル" }));
      await waitFor(() =>
        expect(
          screen.queryByRole("textbox", { name: "メッセージの編集" }),
        ).toBeNull(),
      );
      const row = await rowWith("[E2E_TEST]元の本文");
      expect(row.textContent).not.toContain("[E2E_TEST]捨てる本文");
      expect(row.textContent).not.toContain(EDITED_MARK);
      expect(state.edits).toEqual([]);
    },
  );

  it("#134 AC-1: 保存中は「保存」を押せず、続けて押しても二重に送らない", async () => {
    respondMessages([mine(1, "[E2E_TEST]元の本文")]);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const edits: string[] = [];
    server.use(
      http.patch("/api/messages/:messageId", async ({ request, params }) => {
        const { body } = (await request.json()) as { body: string };
        edits.push(body);
        await gate;
        return HttpResponse.json({
          id: String(params.messageId),
          body,
          editedAt: EDITED_AT,
        });
      }),
    );
    const { user } = renderRoom();
    const box = await openEdit(user, "[E2E_TEST]元の本文");
    await replaceText(user, box, "[[E2E_TEST]一度だけ");
    await user.click(saveButton());
    await waitFor(() => expect(saveButton().disabled).toBe(true));
    fireEvent.click(saveButton());
    fireEvent.keyDown(editBox(), { key: "Enter", ctrlKey: true });
    release();
    await rowWith("[E2E_TEST]一度だけ");
    expect(edits).toEqual(["[E2E_TEST]一度だけ"]);
  });

  it("#134 AC-1: サーバーが422（fields に body）を返したら、編集欄にエラーを出し、入力を残す", async () => {
    respondMessages([mine(1, "[E2E_TEST]元の本文")]);
    server.use(
      http.patch("/api/messages/:messageId", () =>
        apiErrorResponse(
          422,
          "VALIDATION_ERROR",
          "本文を確かめてください（テスト）",
          {
            fields: ["body"],
          },
        ),
      ),
    );
    const { user } = renderRoom();
    const box = await openEdit(user, "[E2E_TEST]元の本文");
    await replaceText(user, box, "[[E2E_TEST]直した本文");
    await user.click(saveButton());
    await waitFor(() => expect(box.getAttribute("aria-invalid")).toBe("true"));
    expect(screen.getByText("本文を確かめてください（テスト）")).toBeDefined();
    expect(editBox().value).toBe("[E2E_TEST]直した本文");
  });

  it.each([
    [500, "INTERNAL", "一時的に保存できませんでした（テスト）"],
    [403, "FORBIDDEN", "このメッセージは編集できません（テスト）"],
    [409, "CONFLICT", "このメッセージは削除済みです（テスト）"],
  ])(
    "#134 AC-1: 保存が %i で失敗したら、role=alert にサーバーの文を出し、編集欄と入力を残し、一覧の表示を変えない",
    async (status, code, text) => {
      respondMessages([mine(1, "[E2E_TEST]元の本文")]);
      server.use(
        http.patch("/api/messages/:messageId", () =>
          apiErrorResponse(status, code, text),
        ),
      );
      const { user } = renderRoom();
      const box = await openEdit(user, "[E2E_TEST]元の本文");
      await replaceText(user, box, "[[E2E_TEST]保存できない本文");
      await user.click(saveButton());
      const alert = await screen.findByText(new RegExp(text));
      expect(alert.closest("[role='alert']")).not.toBeNull();
      expect(editBox().value).toBe("[E2E_TEST]保存できない本文");
      await user.click(screen.getByRole("button", { name: "キャンセル" }));
      const row = await rowWith("[E2E_TEST]元の本文");
      expect(row.textContent).not.toContain(EDITED_MARK);
      expect(row.textContent).not.toContain("[E2E_TEST]保存できない本文");
    },
  );

  it("#134 AC-1: 保存の途中で始まっていた2秒ごとの取得の結果で、編集の結果を上書きしない", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const state = respondMessages([mine(1, "[E2E_TEST]元の本文")]);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = 0;
    server.use(
      http.get("/api/rooms/:roomId/messages", async ({ request }) => {
        const url = new URL(request.url);
        state.requests.push(url);
        if (!url.searchParams.has("after"))
          return HttpResponse.json({
            items: state.messages.slice(-50).reverse(),
            nextCursor: null,
            hasMore: false,
          });
        // 最初の新着の取得だけを止める（保存より前に始まり、保存の後に終わる取得）
        if (held === 0) {
          held += 1;
          await gate;
        }
        return HttpResponse.json({
          items: [],
          nextCursor: null,
          hasMore: false,
        });
      }),
    );
    const { user } = renderRoom({ fakeTimers: true });
    const box = await openEdit(user, "[E2E_TEST]元の本文");
    await replaceText(user, box, "[[E2E_TEST]直した本文");
    await advance(2500);
    await waitFor(() => expect(held).toBe(1));
    await user.click(saveButton());
    await rowWith("[E2E_TEST]直した本文");
    release();
    await advance(100);
    await advance(2500);
    const row = await rowWith("[E2E_TEST]直した本文");
    expect(row.textContent).toContain(EDITED_MARK);
    expect(row.textContent).not.toContain("[E2E_TEST]元の本文");
  });
});

describe("#134 AC-1（1-3 AC-1・AC-4）削除", () => {
  async function openDeleteDialog(
    user: ReturnType<typeof userEvent.setup>,
    body: string,
  ) {
    const row = await rowWith(body);
    const button = deleteButton(row);
    if (button === null) throw new Error("「削除」がありません");
    await user.click(button);
    return screen.findByRole("dialog", { name: "メッセージの削除" });
  }

  it("#134 AC-1（1-3 AC-4）: 「削除」で確認のダイアログを出し、キャンセルでは送らず、表示も変えない", async () => {
    const state = respondMessages([mine(1, "[E2E_TEST]消さない投稿")]);
    const reauths = respondReauth();
    const { user } = renderRoom();
    const dialog = await openDeleteDialog(user, "[E2E_TEST]消さない投稿");
    await user.click(
      within(dialog).getByRole("button", { name: "キャンセル" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "メッセージの削除" }),
      ).toBeNull(),
    );
    expect(screen.queryByRole("dialog", { name: "再認証" })).toBeNull();
    expect(state.deletes).toEqual([]);
    expect(reauths).toEqual([]);
    const row = await rowWith("[E2E_TEST]消さない投稿");
    expect(row.textContent).not.toContain(DELETED_TEXT);
  });

  it("#134 AC-1（1-3 AC-1・AC-4・C-57）: 確認の後に再認証を求め、パスワードを入れると DELETE を1回送り、再読み込みなしで「このメッセージは削除されました」に替わる", async () => {
    const state = respondMessages([
      mine(1, "[E2E_TEST]消す投稿"),
      theirs(2, "[E2E_TEST]残る投稿"),
    ]);
    const reauths = respondReauth();
    const { user } = renderRoom({ reauthenticatedAt: null });
    const dialog = await openDeleteDialog(user, "[E2E_TEST]消す投稿");
    await user.click(within(dialog).getByRole("button", { name: "削除する" }));
    const reauth = await screen.findByRole("dialog", { name: "再認証" });
    expect(state.deletes).toEqual([]);
    await user.type(within(reauth).getByLabelText("パスワード"), TEST_PASSWORD);
    await user.click(within(reauth).getByRole("button", { name: "再認証" }));
    await waitFor(() => expect(state.deletes).toEqual([message(1).id]));
    expect(reauths).toEqual([TEST_PASSWORD]);
    await waitFor(() => expect(rows()[0]?.textContent).toContain(DELETED_TEXT));
    const deleted = rows()[0];
    if (deleted === undefined) throw new Error("行がありません");
    expect(deleted.textContent).toContain(ME.displayName);
    expect(editButton(deleted)).toBeNull();
    expect(deleteButton(deleted)).toBeNull();
    expect(screen.queryByText("[E2E_TEST]消す投稿")).toBeNull();
    expect((await rowWith("[E2E_TEST]残る投稿")).textContent).not.toContain(
      DELETED_TEXT,
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "メッセージの削除" }),
      ).toBeNull(),
    );
    // 一覧の取り直し（after なし）を2回目に送っていない＝その場で反映した
    expect(
      state.requests.filter((url) => !url.searchParams.has("after")),
    ).toHaveLength(1);
  });

  it("#134 AC-1（1-3 AC-4）: 再認証をキャンセルすると、DELETE を送らず、表示も変えない", async () => {
    const state = respondMessages([mine(1, "[E2E_TEST]消さない投稿")]);
    const reauths = respondReauth();
    const { user } = renderRoom({ reauthenticatedAt: null });
    const dialog = await openDeleteDialog(user, "[E2E_TEST]消さない投稿");
    await user.click(within(dialog).getByRole("button", { name: "削除する" }));
    const reauth = await screen.findByRole("dialog", { name: "再認証" });
    await user.click(
      within(reauth).getByRole("button", { name: "キャンセル" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "再認証" })).toBeNull(),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(state.deletes).toEqual([]);
    expect(reauths).toEqual([]);
    const row = await rowWith("[E2E_TEST]消さない投稿");
    expect(row.textContent).not.toContain(DELETED_TEXT);
  });

  it("#134 AC-1（1-3 AC-4・0-5）: 5分以内に再認証していれば、再認証を出さずに DELETE を送る", async () => {
    const state = respondMessages([mine(1, "[E2E_TEST]消す投稿")]);
    const reauths = respondReauth();
    const { user } = renderRoom({
      reauthenticatedAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const dialog = await openDeleteDialog(user, "[E2E_TEST]消す投稿");
    await user.click(within(dialog).getByRole("button", { name: "削除する" }));
    await waitFor(() => expect(state.deletes).toEqual([message(1).id]));
    expect(screen.queryByRole("dialog", { name: "再認証" })).toBeNull();
    expect(reauths).toEqual([]);
    await waitFor(() => expect(rows()[0]?.textContent).toContain(DELETED_TEXT));
  });

  it("#134 AC-1: 削除の送信中は「削除する」を押せず、続けて押しても二重に送らない", async () => {
    respondMessages([mine(1, "[E2E_TEST]消す投稿")]);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deletes: string[] = [];
    server.use(
      http.delete("/api/messages/:messageId", async ({ params }) => {
        deletes.push(String(params.messageId));
        await gate;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { user } = renderRoom({
      reauthenticatedAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const dialog = await openDeleteDialog(user, "[E2E_TEST]消す投稿");
    const confirm = within(dialog).getByRole<HTMLButtonElement>("button", {
      name: "削除する",
    });
    await user.click(confirm);
    await waitFor(() => expect(confirm.disabled).toBe(true));
    fireEvent.click(confirm);
    release();
    await waitFor(() => expect(rows()[0]?.textContent).toContain(DELETED_TEXT));
    expect(deletes).toEqual([message(1).id]);
  });

  it.each([
    [500, "INTERNAL", "一時的に削除できませんでした（テスト）"],
    [409, "CONFLICT", "このメッセージは削除済みです（テスト）"],
    [403, "FORBIDDEN", "このメッセージは削除できません（テスト）"],
  ])(
    "#134 AC-1: 削除が %i で失敗したら、role=alert にサーバーの文を出し、表示を変えない",
    async (status, code, text) => {
      respondMessages([mine(1, "[E2E_TEST]消せない投稿")]);
      server.use(
        http.delete("/api/messages/:messageId", () =>
          apiErrorResponse(status, code, text),
        ),
      );
      const { user } = renderRoom({
        reauthenticatedAt: new Date(Date.now() - 60_000).toISOString(),
      });
      const dialog = await openDeleteDialog(user, "[E2E_TEST]消せない投稿");
      await user.click(
        within(dialog).getByRole("button", { name: "削除する" }),
      );
      const alert = await screen.findByText(new RegExp(text));
      expect(alert.closest("[role='alert']")).not.toBeNull();
      const row = await rowWith("[E2E_TEST]消せない投稿");
      expect(row.textContent).not.toContain(DELETED_TEXT);
    },
  );
});

describe("#134 AC-1（改訂1 の軽微5 ③・C-170(5)）投稿の下書きとの関係", () => {
  it("#134 AC-1（C-170(5)）: 編集欄の入力は、投稿の下書きとして端末に保存しない", async () => {
    respondMessages([mine(1, "[E2E_TEST]元の本文")]);
    const { user } = renderRoom();
    const box = await openEdit(user, "[E2E_TEST]元の本文");
    await user.type(box, "追記");
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });

  it("#134 AC-1（C-170(5)）: 編集欄に書きかけがあっても、離脱の確認（beforeunload）の対象にしない", async () => {
    respondMessages([mine(1, "[E2E_TEST]元の本文")]);
    const { user } = renderRoom();
    const box = await openEdit(user, "[E2E_TEST]元の本文");
    await user.type(box, "追記");
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("#134 AC-1（改訂1 の軽微5 ③）: 編集を保存しても、投稿の入力欄の書きかけと端末の下書きを変えない", async () => {
    respondMessages([mine(1, "[E2E_TEST]元の本文")]);
    const { user } = renderRoom();
    await user.type(composer(), "[[E2E_TEST]投稿の下書き");
    expect(savedDraftBody()).toBe("[E2E_TEST]投稿の下書き");
    const box = await openEdit(user, "[E2E_TEST]元の本文");
    await replaceText(user, box, "[[E2E_TEST]直した本文");
    await user.click(saveButton());
    await rowWith("[E2E_TEST]直した本文");
    expect(composer().value).toBe("[E2E_TEST]投稿の下書き");
    expect(savedDraftBody()).toBe("[E2E_TEST]投稿の下書き");
  });

  it("#134 AC-1（改訂1 の軽微5 ③）: 編集をキャンセルしても、投稿の入力欄の書きかけと端末の下書きを変えない", async () => {
    respondMessages([mine(1, "[E2E_TEST]元の本文")]);
    const { user } = renderRoom();
    await user.type(composer(), "[[E2E_TEST]投稿の下書き");
    const box = await openEdit(user, "[E2E_TEST]元の本文");
    await replaceText(user, box, "[[E2E_TEST]捨てる本文");
    await user.click(screen.getByRole("button", { name: "キャンセル" }));
    await rowWith("[E2E_TEST]元の本文");
    expect(composer().value).toBe("[E2E_TEST]投稿の下書き");
    expect(savedDraftBody()).toBe("[E2E_TEST]投稿の下書き");
  });
});

describe("#134 AC-1（改訂1 の軽微5 ④）編集中の新着", () => {
  it("#134 AC-1（改訂1 の軽微5 ④）: 編集中に届いた新着を失わず、編集欄の入力も残し、次の新着の取得（after）も続ける", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const state: MessageServer = respondMessages([
      mine(1, "[E2E_TEST]元の本文"),
    ]);
    const { user } = renderRoom({ fakeTimers: true });
    const box = await openEdit(user, "[E2E_TEST]元の本文");
    await replaceText(user, box, "[[E2E_TEST]書きかけの編集");
    state.messages.push(theirs(2, "[E2E_TEST]編集中の新着"));
    await advance(2500);
    await rowWith("[E2E_TEST]編集中の新着");
    expect(editBox().value).toBe("[E2E_TEST]書きかけの編集");
    state.messages.push(theirs(3, "[E2E_TEST]その次の新着"));
    await advance(2500);
    await rowWith("[E2E_TEST]その次の新着");
    expect(
      state.requests
        .map((url) => url.searchParams.get("after"))
        .filter((after) => after !== null),
    ).toContain(message(2).id);
    expect(editBox().value).toBe("[E2E_TEST]書きかけの編集");
  });
});
