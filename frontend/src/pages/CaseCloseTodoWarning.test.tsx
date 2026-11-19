// #309 AC-1〜AC-3：案件の終了の確認のダイアログに、未完了の TODO の件数の警告を出す（利用者の決定：警告を出して、終了はできる）。
// API は MSW。データはすべて架空（[UNIT_TEST]）。サーバーの終了の判定は変えない（この層では確かめない）。
// 画面の契約（実装の担当へ。テストが決めたもの）：
//   警告の文言は「未完了の TODO が n 件あります」（n は半角の数字）。終了の確認のダイアログの中の、既存の本文の後に、別の要素として出す。
//   役割は role="status"（エラーではないので alert にしない）。再開の確認のダイアログには出さない。
//   件数は、TODO の一覧の取得の結果の進捗（サーバーが返す progress の total - done）から出す。画面に出ている行は数えない。
//   読み込み中・取得の失敗・進捗なし（TODO が0件）・未完了が0件のときは出さない。
//   ダイアログを開いている間にポーリングで進捗が変わったら、開いたままで最新の件数に変わる。
import { act, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  caseDetail,
  caseId,
  caseSummary,
  respondCases,
} from "../test/case-handlers";
import { renderCaseRequestScreen } from "../test/case-request-handlers";
import {
  respondTodos,
  todoItem,
  type TodoItem,
} from "../test/case-todo-handlers";
import { server } from "../test/server";
import { CaseDetailPage } from "./CaseDetailPage";

const POLL_MS = 2_000;

const TEXTS = {
  close: "案件を終了",
  reopen: "案件を再開",
  closeDialog: "案件の終了",
  reopenDialog: "案件の再開",
  closeConfirm: "終了する",
  closed: "案件を終了しました",
} as const;

const warning = (count: number) => `未完了の TODO が ${count} 件あります`;
const WARNING_PATTERN = /未完了の TODO が/;

const FAIL_500 = {
  status: 500,
  code: "INTERNAL_ERROR",
  message: "サーバーでエラーが起きました",
};
const LOAD_ERROR_WAIT = { timeout: 8_000 };

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

/** n 件の TODO のうち、先頭から done 件を完了にしたもの */
const todos = (total: number, done: number): TodoItem[] =>
  Array.from({ length: total }, (_, i) =>
    todoItem(i + 1, { completed: i < done }),
  );

function renderPage(n: number, status: "active" | "closed" = "active") {
  const summary = caseSummary(n, {
    status,
    ...(status === "closed" ? { canEditDueDate: false } : {}),
  });
  const writes: { path: string; body: unknown }[] = [];
  const summaries = [summary];
  const details = [caseDetail(n, summary)];
  const cases = respondCases({ summaries, details });
  server.use(
    http.post("/api/cases/:caseId/close", async ({ request }) => {
      const text = await request.text();
      writes.push({
        path: new URL(request.url).pathname,
        body: text === "" ? undefined : (JSON.parse(text) as unknown),
      });
      summaries[0] = { ...summaries[0]!, status: "closed" };
      details[0] = { ...details[0]!, status: "closed" };
      return HttpResponse.json({ caseId: caseId(n), status: "closed" });
    }),
  );
  const rendered = renderCaseRequestScreen(<CaseDetailPage />, {
    at: `/cases/${caseId(n)}`,
    path: "/cases/:caseId",
  });
  return { ...rendered, ...cases, writes };
}

async function openCloseDialog(
  user: ReturnType<typeof renderPage>["user"],
  heading: string = TEXTS.closeDialog,
) {
  const button = await screen.findByRole("button", {
    name: heading === TEXTS.closeDialog ? TEXTS.close : TEXTS.reopen,
  });
  await user.click(button);
  return screen.findByRole("dialog", { name: heading });
}

/** 進捗が画面に出る（ヘッダー）まで待つ。取得の結果が届いてからダイアログを開くため */
async function waitForProgress(text: string) {
  const header = (await screen.findByRole("heading", { level: 1 })).closest(
    "header",
  );
  if (header === null) throw new Error("ヘッダーがありません");
  await within(header).findByText(text);
}

describe("#309 AC-1 未完了があるとき、終了の確認に件数の警告を出す", () => {
  it("#309 AC-1: 5件中2件が完了なら、「未完了の TODO が 3 件あります」を、本文の後に role=status で出す", async () => {
    respondTodos(todos(5, 2));
    const { user } = renderPage(1);
    await waitForProgress("2/5");
    const dialog = await openCloseDialog(user);
    const notice = within(dialog).getByText(warning(3));
    expect(notice.getAttribute("role")).toBe("status");
    expect(within(dialog).queryByRole("alert")).toBeNull();
    const body = within(dialog).getByText(/終了すると、メッセージ/);
    expect(
      body.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(body.contains(notice)).toBe(false);
  });

  it("#309 AC-1: 未完了が1件（境界）でも、「未完了の TODO が 1 件あります」を出す", async () => {
    respondTodos(todos(4, 3));
    const { user } = renderPage(2);
    await waitForProgress("3/4");
    const dialog = await openCloseDialog(user);
    expect(within(dialog).getByText(warning(1))).toBeTruthy();
  });

  it("#309 AC-1: 全部が未完了なら、総数の件数を出す", async () => {
    respondTodos(todos(2, 0));
    const { user } = renderPage(3);
    await waitForProgress("0/2");
    const dialog = await openCloseDialog(user);
    expect(within(dialog).getByText(warning(2))).toBeTruthy();
  });

  it("#309 AC-1: 件数は、取得の結果の進捗から出す。150件のうち40件が完了なら、1ページ目の行（未完了60行）ではなく 110 件になる", async () => {
    respondTodos(todos(150, 40));
    const { user } = renderPage(4);
    await waitForProgress("40/150");
    const dialog = await openCloseDialog(user);
    expect(within(dialog).getByText(warning(110))).toBeTruthy();
    expect(within(dialog).queryByText(warning(60))).toBeNull();
  });
});

describe("#309 AC-2 警告を出さないとき", () => {
  it("#309 AC-2: 全部完了（未完了が0件）なら、警告を出さない。確認の本文と「終了する」は出る", async () => {
    respondTodos(todos(3, 3));
    const { user } = renderPage(5);
    await waitForProgress("3/3");
    const dialog = await openCloseDialog(user);
    expect(within(dialog).queryByText(WARNING_PATTERN)).toBeNull();
    expect(
      within(dialog).getByRole("button", { name: TEXTS.closeConfirm }),
    ).toBeTruthy();
  });

  it("#309 AC-2: TODO が0件なら、警告を出さない", async () => {
    const state = respondTodos([]);
    const { user } = renderPage(6);
    await waitFor(() => expect(state.requests.length).toBeGreaterThan(0));
    const dialog = await openCloseDialog(user);
    expect((await screen.findAllByText("項目なし")).length).toBeGreaterThan(0);
    expect(within(dialog).queryByText(WARNING_PATTERN)).toBeNull();
  });

  it("#309 AC-2: TODO の読み込み中は、件数が分からないので、警告を出さない（誤った数を出さない）", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const state = respondTodos(todos(5, 2));
    server.use(
      http.get("/api/cases/:caseId/todos", async () => {
        await gate;
        return HttpResponse.json({
          items: state.items,
          nextCursor: null,
          progress: { done: 2, total: 5 },
        });
      }),
    );
    const { user } = renderPage(7);
    const dialog = await openCloseDialog(user);
    expect(within(dialog).queryByText(WARNING_PATTERN)).toBeNull();
    release();
    // 読み込みが終われば、開いたままで警告が出る
    expect(await within(dialog).findByText(warning(3))).toBeTruthy();
  });

  it("#309 AC-2: TODO の読み込みに失敗しているときは、警告を出さない", async () => {
    respondTodos(todos(5, 2), { failWith: FAIL_500 });
    const { user } = renderPage(8);
    // 読み込み中ではなく、取得のエラーの表示になってから確かめる
    await screen.findAllByText(
      "TODOを読み込めませんでした",
      {},
      LOAD_ERROR_WAIT,
    );
    const dialog = await openCloseDialog(user);
    expect(within(dialog).queryByText(WARNING_PATTERN)).toBeNull();
  });

  it("#309: 再開の確認のダイアログには、未完了があっても警告を出さない", async () => {
    respondTodos(todos(5, 2));
    const { user } = renderPage(9, "closed");
    await waitForProgress("2/5");
    const dialog = await openCloseDialog(user, TEXTS.reopenDialog);
    expect(within(dialog).queryByText(WARNING_PATTERN)).toBeNull();
  });
});

describe("#309 AC-3 警告が出ていても終了できる", () => {
  it("#309 AC-3: 警告が出ていても、「終了する」で POST /close を本文なしで1回送り、「案件を終了しました」を出す", async () => {
    respondTodos(todos(5, 2));
    const { user, writes } = renderPage(10);
    await waitForProgress("2/5");
    const dialog = await openCloseDialog(user);
    expect(within(dialog).getByText(warning(3))).toBeTruthy();
    const confirm = within(dialog).getByRole<HTMLButtonElement>("button", {
      name: TEXTS.closeConfirm,
    });
    expect(confirm.disabled).toBe(false);
    await user.click(confirm);
    expect(await screen.findByText(TEXTS.closed)).toBeTruthy();
    expect(writes).toHaveLength(1);
    expect(writes[0]?.path).toBe(`/api/cases/${caseId(10)}/close`);
    expect(writes[0]?.body ?? {}).toEqual({});
    expect(
      screen.queryByRole("dialog", { name: TEXTS.closeDialog }),
    ).toBeNull();
  });
});

describe("#309 AC-1 ポーリングで進捗が変わったとき", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("#309 AC-1: 開く前に進捗が変わったら、次に開いたダイアログは新しい件数になり、開いている間に変わっても最新の件数に変わる", async () => {
    const state = respondTodos(todos(5, 2));
    const { user } = renderPage(11);
    await waitForProgress("2/5");
    state.items = todos(5, 3);
    await advance(POLL_MS);
    await waitForProgress("3/5");
    const dialog = await openCloseDialog(user);
    expect(within(dialog).getByText(warning(2))).toBeTruthy();
    state.items = todos(5, 5);
    await advance(POLL_MS);
    await waitFor(() =>
      expect(within(dialog).queryByText(WARNING_PATTERN)).toBeNull(),
    );
  });

  it("#309 AC-2: 取得に成功して警告が出た後、ポーリングの取得が失敗したら、取得のエラーの表示に合わせて警告が消える（開いているダイアログでも、開き直しても）", async () => {
    const state = respondTodos(todos(5, 2));
    const { user } = renderPage(12);
    await waitForProgress("2/5");
    const dialog = await openCloseDialog(user);
    expect(within(dialog).getByText(warning(3))).toBeTruthy();
    state.failWith = FAIL_500;
    await advance(POLL_MS);
    await screen.findAllByText(
      "TODOを読み込めませんでした",
      {},
      LOAD_ERROR_WAIT,
    );
    await waitFor(() =>
      expect(within(dialog).queryByText(WARNING_PATTERN)).toBeNull(),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "キャンセル" }),
    );
    const reopened = await openCloseDialog(user);
    expect(within(reopened).queryByText(WARNING_PATTERN)).toBeNull();
  });
});
