// #149（149-C）5-4 AC-6・AC-7・AC-9・AC-10・AC-11・AC-12・AC-13・AC-14、#308、計画 plan-149c 5.5・9.8（F1〜F14）、計画レビュー1回目の軽微3：
// S-17 の TODO の区画の「履歴」（行の下に展開）・「削除済みのTODO」（開閉・読み取り専用）・「復元」。API は MSW（test/case-todo-handlers.ts）。
// 偽の時計で取り直しを進める（固定の待ちを使わない）。データはすべて架空（testuser_149c_・[UNIT_TEST]）。
// 認可・判定の順はサーバー（backend の routes/case-todos.history.test.ts）で確かめ、ここでは重ねない。
// 画面の契約（実装前の仮置き。テストが決めたもの。実装の担当へ。文言は test/case-todo-handlers.ts の CASE_TODO_HISTORY_TEXTS）：
//   行のボタン「履歴」：aria-label「{題名}の履歴」・aria-expanded。進行中・終了中・送信中のどれでも押せる（読み取りだけ）。
//     押すと、その行（listitem）の中に region「{題名}の変更履歴」を開く。もう一度押すと閉じる。詳細画面には移らない。
//   履歴の region：記録1件＝listitem 1つ。各 listitem に <time dateTime={createdAt}>、操作した人の名前、内容の文言。
//     内容の文言（空白を除いて照合する）：
//       create「追加（担当：{名前}）」・title_change「題名を「{前}」から「{後}」に変更」・assignee_change「担当を{前}から{後}に変更」
//       （後がなければ「担当を{前}から担当なしに変更」）・complete「完了（担当：{名前}）」・uncomplete「完了を取り消し」・
//       auto_unassign「担当者が外れたため担当なし（以前の担当：{名前}）」・delete「削除」・restore「復元」
//     名前（操作した人・担当）：有効な人は名前のボタン（ProfileCardTrigger）、無効な人は「{名前}（退職者）」の文字だけでボタンなし（AC-6）。
//     読み込み中：role=status「履歴を読み込み中です」。失敗：「履歴を読み込めませんでした」と button「再試行」。
//     続き：button「さらに表示」（region の中）。続きの失敗：role=alert「履歴の続きを読み込めませんでした」で、読み込み済みの行は残す。
//   削除済みの一覧：TODO の区画の中に button「削除済みのTODO」（aria-expanded）。開いたときだけ取得し、region「削除済みのTODO」を出す。
//     0件「削除済みのTODOはありません」、読み込み中 role=status「削除済みのTODOを読み込み中です」、失敗「削除済みのTODOを読み込めませんでした」と「再試行」。
//     各行（listitem）：題名・「担当：」＋一覧の行と同じ出し分け・完了の印「完了」・「削除した人：{名前}」・<time dateTime={deletedAt}>・
//     button「{題名}の履歴」・（進行中だけ）button「{題名}を復元」。編集・削除・完了・未完了に戻すの操作は出さない（読み取り専用）。続きは「さらに表示」。
//   復元：POST …/todos/:todoId/restore（本文なし）。送信中は区画のすべての書き込み（追加する・完了にする・未完了に戻す・編集・削除・復元）を押せない。
//     成功で区画に role=status「TODOを復元しました」。失敗はサーバーの文言を区画の role=alert に出す（409 closed・404・503）。
//   削除の確認の本文に「削除したTODOは、削除済みの一覧から復元できます。」を足す。
//   取り直し：履歴・削除済みの一覧は、開いている間だけ2秒ごと（取得済みの全ページを先頭から）。閉じたら取らない。
//   資格を失ったとき（#308）：履歴・削除済みの一覧の 403 も、概要の取り直しの契機にする。非公開に切り替わったら、その案件の
//     ["cases","todoEvents",利用者,案件,…]（前方一致）と ["cases","deletedTodos",利用者,案件] を取り除く。ほかの案件の履歴のキャッシュは残す。
import { act, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_USER } from "../test/auth-handlers";
import {
  CASE_TEXTS,
  caseDetail,
  caseId,
  caseSummary,
  outsiderSummary,
  respondCases,
} from "../test/case-handlers";
import { renderCaseRequestScreen } from "../test/case-request-handlers";
import {
  CASE_TODO_HISTORY_TEXTS as H,
  CASE_TODO_TEXTS,
  deletedTodo,
  respondTodoHistory,
  respondTodos,
  todoError,
  todoEvent,
  todoEventAt,
  todoEventId,
  todoItem,
  todoTitle,
  type DeletedTodoItem,
  type TodoEvent,
  type TodoPerson,
} from "../test/case-todo-handlers";
import { server } from "../test/server";
import { CaseDetailPage } from "./CaseDetailPage";

const POLL_MS = 2_000;

const ALICE: TodoPerson = {
  userId: "01JTESTUSER149C0000000000A",
  displayName: "testuser_149c_alice",
  isActive: true,
};
const BOB: TodoPerson = {
  userId: "01JTESTUSER149C0000000000B",
  displayName: "testuser_149c_bob",
  isActive: true,
};
const RETIRED: TodoPerson = {
  userId: "01JTESTUSER149C0000000000R",
  displayName: "testuser_149c_retired",
  isActive: false,
};

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

function renderPage(n: number, options: { status?: "active" | "closed" } = {}) {
  const summary = caseSummary(n, {
    status: options.status ?? "active",
    ...(options.status === "closed" ? { canEditDueDate: false } : {}),
  });
  const summaries = [summary];
  const denied: string[] = [];
  const cases = respondCases({
    summaries,
    details: [caseDetail(n, summary)],
    denied,
  });
  server.use(
    http.get("/api/users/:userId/profile-card", ({ params }) =>
      HttpResponse.json({
        id: String(params.userId),
        displayName: "testuser_149c_card",
        legalName: "テスト本名149C",
        department: null,
        status: { kind: "available", returnAt: null, message: null },
      }),
    ),
  );
  const rendered = renderCaseRequestScreen(<CaseDetailPage />, {
    at: `/cases/${caseId(n)}`,
    path: "/cases/:caseId",
  });
  /** 外された状態にする：概要は非参加、詳細は 403 */
  const revoke = () => {
    summaries[0] = outsiderSummary(n, { status: summary.status });
    denied.push(caseId(n));
  };
  return { ...rendered, ...cases, revoke };
}

type User = ReturnType<typeof renderPage>["user"];

const section = () => screen.findByRole("region", { name: "TODO" });
/** 空白を除いた文字（文言の照合で、JSX の空白に依らないため） */
const squash = (text: string | null | undefined) =>
  (text ?? "").replace(/\s+/g, "");

function rowOf(container: HTMLElement, title: string): HTMLElement {
  const row = within(container)
    .getAllByRole("listitem")
    .find((item) => item.textContent?.includes(title));
  if (row === undefined) throw new Error(`${title} の行がありません`);
  return row;
}

const historyButton = (container: HTMLElement, title: string) =>
  within(container).findByRole("button", { name: `${title}の履歴` });

async function openHistory(user: User, container: HTMLElement, title: string) {
  await user.click(await historyButton(container, title));
  return within(container).findByRole("region", {
    name: `${title}の変更履歴`,
  });
}

/** 記録の日時（<time dateTime>）で、その記録の行を探す */
function entryAt(history: HTMLElement, iso: string): HTMLElement {
  const time = history.querySelector(`time[datetime="${iso}"]`);
  const entry = time?.closest("li");
  if (entry === null || entry === undefined)
    throw new Error(`${iso} の記録の行がありません`);
  return entry as HTMLElement;
}

async function openDeleted(user: User, region: HTMLElement) {
  await user.click(
    await within(region).findByRole("button", { name: H.deletedToggle }),
  );
  return within(region).findByRole("region", { name: H.deletedRegion });
}

const deletedTitle = (n: number) => `[UNIT_TEST]149C消したもの${n}`;
const deletedOf = (n: number, overrides: Partial<DeletedTodoItem> = {}) =>
  deletedTodo(n, ALICE, { title: deletedTitle(n), ...overrides });

/** region の中の行のうち、削除済みの題名の一覧（重複・欠落の確認用） */
const deletedTitlesIn = (container: HTMLElement) =>
  within(container)
    .getAllByRole("listitem")
    .map(
      (li) => /\[UNIT_TEST\]149C消したもの\d+/.exec(li.textContent ?? "")?.[0],
    )
    .filter((t): t is string => t !== undefined);

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("#149 149-C 5-4 AC-14 履歴の展開（計画 9.8 F1〜F4）", () => {
  it("#149 149-C 5-4 AC-14 F1: 「{題名}の履歴」で行の中に履歴が開き（aria-expanded が true）、もう一度押すと閉じる。詳細画面には移らない", async () => {
    const todos = respondTodos([todoItem(1), todoItem(2)]);
    respondTodoHistory(todos, {
      events: {
        [todoItem(1).id]: [
          todoEvent(1, ALICE, { kind: "create", title: todoTitle(1) }),
        ],
      },
    });
    const { user } = renderPage(1);
    const region = await section();
    const button = await historyButton(region, todoTitle(1));
    expect(button.getAttribute("aria-expanded")).toBe("false");
    const history = await openHistory(user, region, todoTitle(1));
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(rowOf(region, todoTitle(1)).contains(history)).toBe(true);
    expect(rowOf(region, todoTitle(2)).contains(history)).toBe(false);
    await waitFor(() =>
      expect(within(history).getAllByRole("listitem")).toHaveLength(1),
    );
    // 案件の画面のまま（見出し・TODO の区画が残る）
    expect(await screen.findByRole("heading", { level: 1 })).toBeTruthy();
    await user.click(button);
    await waitFor(() =>
      expect(
        within(region).queryByRole("region", {
          name: `${todoTitle(1)}の変更履歴`,
        }),
      ).toBeNull(),
    );
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(within(region).getByText(todoTitle(1))).toBeTruthy();
  });

  it("#149 149-C 5-4 AC-10・AC-11 F2: 9通りの記録の文言と、日時・操作した人が出る（再完了は別の行）", async () => {
    const t = todoItem(1);
    const events: TodoEvent[] = [
      todoEvent(1, BOB, {
        kind: "create",
        title: "[UNIT_TEST]149C旧",
        assignee: ALICE,
      }),
      todoEvent(2, BOB, {
        kind: "title_change",
        title: "[UNIT_TEST]149C新",
        previousTitle: "[UNIT_TEST]149C旧",
      }),
      todoEvent(3, BOB, {
        kind: "assignee_change",
        assignee: BOB,
        previousAssignee: ALICE,
      }),
      todoEvent(4, BOB, {
        kind: "assignee_change",
        assignee: null,
        previousAssignee: BOB,
      }),
      todoEvent(5, BOB, { kind: "complete", assignee: ALICE }),
      todoEvent(6, BOB, { kind: "uncomplete" }),
      todoEvent(7, BOB, { kind: "complete", assignee: ALICE }),
      todoEvent(8, BOB, { kind: "auto_unassign", assignee: ALICE }),
      todoEvent(9, BOB, { kind: "delete", title: t.title }),
      todoEvent(10, BOB, { kind: "restore", title: t.title }),
    ];
    const todos = respondTodos([t]);
    respondTodoHistory(todos, { events: { [t.id]: events } });
    const { user } = renderPage(2);
    const history = await openHistory(user, await section(), t.title);
    await waitFor(() =>
      expect(within(history).getAllByRole("listitem")).toHaveLength(10),
    );
    const expected: [number, string][] = [
      [1, `追加（担当：${ALICE.displayName}）`],
      [2, "題名を「[UNIT_TEST]149C旧」から「[UNIT_TEST]149C新」に変更"],
      [3, `担当を${ALICE.displayName}から${BOB.displayName}に変更`],
      [4, `担当を${BOB.displayName}から担当なしに変更`],
      [5, `完了（担当：${ALICE.displayName}）`],
      [6, "完了を取り消し"],
      [7, `完了（担当：${ALICE.displayName}）`],
      [8, `担当者が外れたため担当なし（以前の担当：${ALICE.displayName}）`],
      [9, "削除"],
      [10, "復元"],
    ];
    for (const [n, text] of expected) {
      const entry = entryAt(history, todoEventAt(n));
      expect(squash(entry.textContent), `記録${n}`).toContain(squash(text));
      expect(entry.textContent, `記録${n} の操作した人`).toContain(
        BOB.displayName,
      );
    }
    // 古い順に並ぶ
    const times = [...history.querySelectorAll("time")].map((e) =>
      e.getAttribute("datetime"),
    );
    expect(times).toEqual(expected.map(([n]) => todoEventAt(n)));
  });

  it("#149 149-C 5-4 AC-6 F3: 無効な人（操作した人・担当）は「（退職者）」つきの文字だけで、名前のボタンがない。有効な人は名前のボタンがある", async () => {
    const t = todoItem(1);
    const todos = respondTodos([t]);
    respondTodoHistory(todos, {
      events: {
        [t.id]: [
          todoEvent(1, RETIRED, {
            kind: "create",
            title: t.title,
            assignee: ALICE,
          }),
          todoEvent(2, ALICE, { kind: "complete", assignee: RETIRED }),
        ],
      },
    });
    const { user } = renderPage(3);
    const history = await openHistory(user, await section(), t.title);
    await waitFor(() =>
      expect(within(history).getAllByRole("listitem")).toHaveLength(2),
    );
    const first = entryAt(history, todoEventAt(1));
    expect(first.textContent).toContain(`${RETIRED.displayName}（退職者）`);
    expect(
      within(first).queryByRole("button", { name: RETIRED.displayName }),
    ).toBeNull();
    expect(
      within(first).getByRole("button", { name: ALICE.displayName }),
    ).toBeTruthy();
    const second = entryAt(history, todoEventAt(2));
    expect(second.textContent).toContain(`${RETIRED.displayName}（退職者）`);
    expect(
      within(second).queryByRole("button", { name: RETIRED.displayName }),
    ).toBeNull();
    expect(
      within(second).getByRole("button", { name: ALICE.displayName }),
    ).toBeTruthy();
  });

  it("#149 149-C 5-4 AC-14 F4: 読み込み中は「履歴を読み込み中です」、失敗は「履歴を読み込めませんでした」と「再試行」で、再試行で取り直す", async () => {
    const t = todoItem(1);
    const todos = respondTodos([t]);
    const gate = deferred();
    const state = respondTodoHistory(todos, {
      events: {
        [t.id]: [todoEvent(1, ALICE, { kind: "create", title: t.title })],
      },
      holdEvents: gate.promise,
    });
    const { user } = renderPage(4);
    const history = await openHistory(user, await section(), t.title);
    expect((await within(history).findByRole("status")).textContent).toContain(
      H.historyLoading,
    );
    state.failEvents = {
      status: 500,
      code: "INTERNAL_ERROR",
      message: "サーバーでエラーが起きました",
    };
    gate.release();
    state.holdEvents = null;
    expect(await within(history).findByText(H.historyLoadError)).toBeTruthy();
    state.failEvents = null;
    await user.click(within(history).getByRole("button", { name: H.retry }));
    await waitFor(() =>
      expect(within(history).getAllByRole("listitem")).toHaveLength(1),
    );
    expect(within(history).queryByText(H.historyLoadError)).toBeNull();
  });

  it("#149 149-C 5-4 AC-14 決定 Q5 F4: 101件なら「さらに表示」で続きが出る。続きの取得に失敗しても、読み込み済みの100件は残り、「履歴の続きを読み込めませんでした」が出る", async () => {
    const t = todoItem(1);
    const todos = respondTodos([t]);
    const events = Array.from({ length: 101 }, (_, i) =>
      todoEvent(i + 1, ALICE),
    );
    const state = respondTodoHistory(todos, { events: { [t.id]: events } });
    const { user } = renderPage(5);
    const history = await openHistory(user, await section(), t.title);
    await waitFor(() =>
      expect(within(history).getAllByRole("listitem")).toHaveLength(100),
    );
    state.failEvents = {
      status: 500,
      code: "INTERNAL_ERROR",
      message: "サーバーでエラーが起きました",
      more: true,
    };
    await user.click(
      within(history).getByRole("button", { name: CASE_TODO_TEXTS.more }),
    );
    expect((await within(history).findByRole("alert")).textContent).toContain(
      H.historyMoreError,
    );
    expect(within(history).getAllByRole("listitem")).toHaveLength(100);
    state.failEvents = null;
    await user.click(
      within(history).getByRole("button", { name: CASE_TODO_TEXTS.more }),
    );
    await waitFor(() =>
      expect(within(history).getAllByRole("listitem")).toHaveLength(101),
    );
    expect(entryAt(history, todoEventAt(101))).toBeTruthy();
  });
});

describe("#149 149-C 5-4 AC-12 削除済みの一覧（計画 9.8 F5・F6）", () => {
  it("#149 149-C 5-4 AC-12 F5: 「削除済みのTODO」を開くまで API を呼ばない。開くと行に題名・削除した人・日時・「履歴」が出る", async () => {
    const todos = respondTodos([todoItem(1)]);
    const state = respondTodoHistory(todos, {
      deleted: [deletedOf(5, { assignee: BOB })],
    });
    const { user } = renderPage(6);
    const region = await section();
    await within(region).findByText(todoTitle(1));
    await advance(POLL_MS);
    expect(state.deletedRequests).toEqual([]);
    const toggle = within(region).getByRole("button", {
      name: H.deletedToggle,
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const deleted = await openDeleted(user, region);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await within(deleted).findByText(deletedTitle(5));
    expect(state.deletedRequests.length).toBeGreaterThan(0);
    const row = rowOf(deleted, deletedTitle(5));
    expect(squash(row.textContent)).toContain(
      squash(`${H.deletedBy}${ALICE.displayName}`),
    );
    expect(squash(row.textContent)).toContain(
      squash(`担当：${BOB.displayName}`),
    );
    expect(
      row.querySelector(`time[datetime="${todoEventAt(1005)}"]`),
    ).not.toBeNull();
    expect(
      within(row).getByRole("button", { name: `${deletedTitle(5)}の履歴` }),
    ).toBeTruthy();
    // 通常の一覧には出ない（削除済みの題名は、削除済みの区画の中だけ）
    const normal = within(region)
      .getAllByRole("listitem")
      .filter((li) => !deleted.contains(li));
    expect(normal.some((li) => li.textContent?.includes(deletedTitle(5)))).toBe(
      false,
    );
  });

  it("#149 149-C 5-4 AC-12 F5: 0件なら「削除済みのTODOはありません」", async () => {
    const todos = respondTodos([todoItem(1)]);
    respondTodoHistory(todos);
    const { user } = renderPage(7);
    const deleted = await openDeleted(user, await section());
    expect(await within(deleted).findByText(H.deletedEmpty)).toBeTruthy();
  });

  it("#149 149-C 5-4 AC-12 F5: 読み込み中は「削除済みのTODOを読み込み中です」、失敗は「削除済みのTODOを読み込めませんでした」と「再試行」", async () => {
    const todos = respondTodos([todoItem(1)]);
    const gate = deferred();
    const state = respondTodoHistory(todos, {
      deleted: [deletedOf(5)],
      holdDeleted: gate.promise,
    });
    const { user } = renderPage(8);
    const deleted = await openDeleted(user, await section());
    expect((await within(deleted).findByRole("status")).textContent).toContain(
      H.deletedLoading,
    );
    state.failDeleted = {
      status: 500,
      code: "INTERNAL_ERROR",
      message: "サーバーでエラーが起きました",
    };
    gate.release();
    state.holdDeleted = null;
    expect(await within(deleted).findByText(H.deletedLoadError)).toBeTruthy();
    state.failDeleted = null;
    await user.click(within(deleted).getByRole("button", { name: H.retry }));
    expect(await within(deleted).findByText(deletedTitle(5))).toBeTruthy();
  });

  it("#149 149-C 5-4 AC-6・AC-12 F5: 担当の出し分けは一覧の行と同じ（以前の担当・完了時の担当・退職者）", async () => {
    const todos = respondTodos([todoItem(1)]);
    respondTodoHistory(todos, {
      deleted: [
        deletedOf(5, { assignee: null, previousAssignee: RETIRED }),
        deletedOf(6, {
          completed: true,
          assignee: BOB,
          completedAssignee: ALICE,
        }),
      ],
    });
    const { user } = renderPage(9);
    const deleted = await openDeleted(user, await section());
    await within(deleted).findByText(deletedTitle(6));
    expect(squash(rowOf(deleted, deletedTitle(5)).textContent)).toContain(
      squash(`担当：担当なし（以前の担当：${RETIRED.displayName}（退職者））`),
    );
    const done = rowOf(deleted, deletedTitle(6));
    expect(squash(done.textContent)).toContain(
      squash(`担当：${ALICE.displayName}`),
    );
    expect(within(done).getByText(CASE_TODO_TEXTS.completed)).toBeTruthy();
  });

  it("#149 149-C 5-4 AC-12 F6: 削除済みの行に、編集・削除・完了にする・未完了に戻すの操作がない（読み取り専用）", async () => {
    const todos = respondTodos([todoItem(1)]);
    respondTodoHistory(todos, {
      deleted: [deletedOf(5), deletedOf(6, { completed: true })],
    });
    const { user } = renderPage(10);
    const deleted = await openDeleted(user, await section());
    await within(deleted).findByText(deletedTitle(6));
    for (const n of [5, 6]) {
      const row = rowOf(deleted, deletedTitle(n));
      const names = within(row)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label") ?? b.textContent ?? "");
      expect(names.length, `${n} の行のボタン`).toBeGreaterThan(0);
      for (const name of names)
        expect(name, `${n} の行`).not.toMatch(
          /を編集|を削除|完了にする|未完了に戻す/,
        );
    }
  });
});

describe("#149 149-C 5-4 AC-13 復元（計画 9.8 F7〜F10）", () => {
  it("#149 149-C 5-4 AC-4・AC-13 F7: 「{題名}を復元」で POST（本文なし）を1回送り、「TODOを復元しました」。通常の一覧に戻り、進捗が変わり、削除済みの一覧から消える", async () => {
    const todos = respondTodos([todoItem(1, { completed: true })]);
    const state = respondTodoHistory(todos, { deleted: [deletedOf(5)] });
    const { user } = renderPage(11);
    const region = await section();
    await within(region).findByText("1/1");
    const deleted = await openDeleted(user, region);
    await user.click(
      await within(deleted).findByRole("button", {
        name: `${deletedTitle(5)}を復元`,
      }),
    );
    expect(await within(region).findByText(H.restored)).toBeTruthy();
    expect(state.restores).toEqual([todoItem(5).id]);
    expect(await within(region).findByText("1/2")).toBeTruthy();
    await waitFor(() =>
      expect(within(deleted).queryByText(deletedTitle(5))).toBeNull(),
    );
    const normal = within(region)
      .getAllByRole("listitem")
      .filter((li) => !deleted.contains(li));
    expect(normal.some((li) => li.textContent?.includes(deletedTitle(5)))).toBe(
      true,
    );
    expect(await within(deleted).findByText(H.deletedEmpty)).toBeTruthy();
  });

  it("#149 149-C 5-4 AC-13 F8: 送信中は「復元」と、ほかの書き込み（追加する・完了にする・編集・削除）が押せない。履歴の開閉は押せる", async () => {
    const todos = respondTodos([todoItem(1)]);
    const gate = deferred();
    const state = respondTodoHistory(todos, {
      deleted: [deletedOf(5), deletedOf(6)],
      events: {
        [todoItem(1).id]: [
          todoEvent(1, ALICE, { kind: "create", title: todoTitle(1) }),
        ],
      },
      respondRestore: async () => {
        await gate.promise;
        return HttpResponse.json({
          ...todoItem(5, { title: deletedTitle(5), version: 2 }),
          progress: { done: 0, total: 2 },
        });
      },
    });
    const { user } = renderPage(12);
    const region = await section();
    const deleted = await openDeleted(user, region);
    await user.click(
      await within(deleted).findByRole("button", {
        name: `${deletedTitle(5)}を復元`,
      }),
    );
    await waitFor(() => expect(state.restores).toHaveLength(1));
    const disabled = (name: string) =>
      (within(region).getByRole("button", { name }) as HTMLButtonElement)
        .disabled;
    await waitFor(() =>
      expect(disabled(`${deletedTitle(6)}を復元`)).toBe(true),
    );
    expect(disabled("追加する")).toBe(true);
    expect(disabled(`${todoTitle(1)}を完了にする`)).toBe(true);
    expect(disabled(`${todoTitle(1)}を編集`)).toBe(true);
    expect(disabled(`${todoTitle(1)}を削除`)).toBe(true);
    // 読み取りの操作は止めない
    expect(disabled(`${todoTitle(1)}の履歴`)).toBe(false);
    const history = await openHistory(user, region, todoTitle(1));
    await waitFor(() =>
      expect(within(history).getAllByRole("listitem")).toHaveLength(1),
    );
    gate.release();
    expect(await within(region).findByText(H.restored)).toBeTruthy();
  });

  it("#149 149-C 5-4 AC-9 F9: 終了中の案件では「復元」が出ない。削除済みの一覧と履歴は見られる", async () => {
    const todos = respondTodos([todoItem(1)]);
    respondTodoHistory(todos, {
      deleted: [deletedOf(5)],
      events: {
        [todoItem(5).id]: [
          todoEvent(1, ALICE, { kind: "delete", title: deletedTitle(5) }),
        ],
      },
    });
    const { user } = renderPage(13, { status: "closed" });
    const region = await section();
    const deleted = await openDeleted(user, region);
    await within(deleted).findByText(deletedTitle(5));
    expect(
      within(region).queryByRole("button", {
        name: `${deletedTitle(5)}を復元`,
      }),
    ).toBeNull();
    expect(
      within(region).queryAllByRole("button", { name: /を復元$/ }),
    ).toEqual([]);
    const history = await openHistory(user, deleted, deletedTitle(5));
    await waitFor(() =>
      expect(within(history).getAllByRole("listitem")).toHaveLength(1),
    );
    // 通常の一覧の行の履歴も、終了中に開ける
    expect(await historyButton(region, todoTitle(1))).toBeTruthy();
  });

  it.each([
    [
      "409 closed",
      () =>
        todoError(409, "CONFLICT", "終了した案件は変更できません", {
          reason: "closed",
        }),
      "終了した案件は変更できません",
    ],
    [
      "404",
      () => todoError(404, "NOT_FOUND", "TODOが見つかりません"),
      "TODOが見つかりません",
    ],
    [
      "503",
      () =>
        todoError(
          503,
          "SERVICE_UNAVAILABLE",
          "混み合っています。しばらくしてからもう一度お試しください",
        ),
      "混み合っています。しばらくしてからもう一度お試しください",
    ],
  ])(
    "#149 149-C 5-4 AC-9・AC-13 F10: 復元が %s なら、サーバーの文言を区画の role=alert に出し、成功の表示は出さない",
    async (_l, respond, text) => {
      const todos = respondTodos([todoItem(1)]);
      respondTodoHistory(todos, {
        deleted: [deletedOf(5)],
        respondRestore: async () => respond(),
      });
      const { user } = renderPage(14);
      const region = await section();
      const deleted = await openDeleted(user, region);
      await user.click(
        await within(deleted).findByRole("button", {
          name: `${deletedTitle(5)}を復元`,
        }),
      );
      const alerts = await within(region).findAllByRole("alert");
      expect(alerts.some((a) => a.textContent?.includes(text))).toBe(true);
      expect(within(region).queryByText(H.restored)).toBeNull();
    },
  );
});

describe("#149 149-C #308 資格を失ったとき（計画 9.8 F11・F12）", () => {
  const otherHistoryKey = [
    "cases",
    "todoEvents",
    TEST_USER.id,
    caseId(999),
    todoItem(1).id,
  ];

  it("#149 149-C #308 F11: 開いている履歴の取得が 403 になると、概要を取り直し、非参加なら非公開の表示に切り替わる。その案件の履歴・削除済みのキャッシュを取り除き、ほかの案件の履歴のキャッシュは残す", async () => {
    const t = todoItem(1);
    const todos = respondTodos([t]);
    const state = respondTodoHistory(todos, {
      events: {
        [t.id]: [todoEvent(1, ALICE, { kind: "create", title: t.title })],
      },
      deleted: [deletedOf(5)],
    });
    const { user, client, revoke, summaryCalls } = renderPage(15);
    client.setQueryData(otherHistoryKey, { pages: [], pageParams: [] });
    const region = await section();
    const deleted = await openDeleted(user, region);
    await within(deleted).findByText(deletedTitle(5));
    const history = await openHistory(user, region, t.title);
    await waitFor(() =>
      expect(within(history).getAllByRole("listitem")).toHaveLength(1),
    );
    const summariesBefore = summaryCalls.length;
    revoke();
    // TODO の一覧・削除済みの一覧は通ったまま、履歴だけが 403（履歴の側の契機を確かめる）
    state.failEvents = {
      status: 403,
      code: "FORBIDDEN",
      message: CASE_TEXTS.participantsOnly,
    };
    await advance(POLL_MS);
    await waitFor(() =>
      expect(summaryCalls.length).toBeGreaterThan(summariesBefore),
    );
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "TODO" })).toBeNull(),
    );
    expect(
      screen.getAllByText(CASE_TEXTS.participantsOnly).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(deletedTitle(5))).toBeNull();
    const cache = client.getQueryCache();
    expect(
      cache.findAll({
        queryKey: ["cases", "todoEvents", TEST_USER.id, caseId(15)],
      }),
    ).toEqual([]);
    expect(
      cache.findAll({
        queryKey: ["cases", "deletedTodos", TEST_USER.id, caseId(15)],
      }),
    ).toEqual([]);
    expect(
      cache.findAll({ queryKey: otherHistoryKey, exact: true }),
    ).toHaveLength(1);
  });

  it("#149 149-C #308 F12: 開いている削除済みの一覧の取得が 403 になっても、F11 と同じく非公開の表示に切り替わり、キャッシュを取り除く", async () => {
    const todos = respondTodos([todoItem(1)]);
    const state = respondTodoHistory(todos, { deleted: [deletedOf(5)] });
    const { user, client, revoke, summaryCalls } = renderPage(16);
    client.setQueryData(otherHistoryKey, { pages: [], pageParams: [] });
    const region = await section();
    const deleted = await openDeleted(user, region);
    await within(deleted).findByText(deletedTitle(5));
    const summariesBefore = summaryCalls.length;
    revoke();
    state.failDeleted = {
      status: 403,
      code: "FORBIDDEN",
      message: CASE_TEXTS.participantsOnly,
    };
    await advance(POLL_MS);
    await waitFor(() =>
      expect(summaryCalls.length).toBeGreaterThan(summariesBefore),
    );
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "TODO" })).toBeNull(),
    );
    expect(screen.queryByText(deletedTitle(5))).toBeNull();
    const cache = client.getQueryCache();
    expect(
      cache.findAll({
        queryKey: ["cases", "deletedTodos", TEST_USER.id, caseId(16)],
      }),
    ).toEqual([]);
    expect(
      cache.findAll({ queryKey: otherHistoryKey, exact: true }),
    ).toHaveLength(1);
  });
});

describe("#149 149-C 5-4 AC-7 開いている間だけの取り直し（計画 9.8 F13・軽微3）", () => {
  it("#149 149-C 5-4 AC-7 F13: 開いている削除済みの一覧は、2秒の取り直しでほかの人の削除を出す。閉じている間は取らない", async () => {
    const todos = respondTodos([todoItem(1)]);
    const state = respondTodoHistory(todos, { deleted: [deletedOf(5)] });
    const { user } = renderPage(17);
    const region = await section();
    const deleted = await openDeleted(user, region);
    await within(deleted).findByText(deletedTitle(5));
    state.deleted = [...state.deleted, deletedOf(6)];
    await advance(POLL_MS);
    expect(await within(deleted).findByText(deletedTitle(6))).toBeTruthy();
    await user.click(
      within(region).getByRole("button", { name: H.deletedToggle }),
    );
    await waitFor(() =>
      expect(
        within(region).queryByRole("region", { name: H.deletedRegion }),
      ).toBeNull(),
    );
    const stopped = state.deletedRequests.length;
    await advance(POLL_MS * 3);
    expect(state.deletedRequests.length).toBe(stopped);
  });

  it("#149 149-C 5-4 AC-7 軽微3: 開いている履歴は、2秒の取り直しでほかの人の操作の記録を出す。閉じた後は取らない", async () => {
    const t = todoItem(1);
    const todos = respondTodos([t]);
    const state = respondTodoHistory(todos, {
      events: {
        [t.id]: [todoEvent(1, ALICE, { kind: "create", title: t.title })],
      },
    });
    const { user } = renderPage(18);
    const region = await section();
    const history = await openHistory(user, region, t.title);
    await waitFor(() =>
      expect(within(history).getAllByRole("listitem")).toHaveLength(1),
    );
    state.events[t.id] = [
      ...(state.events[t.id] ?? []),
      todoEvent(2, BOB, { kind: "complete", assignee: ALICE }),
    ];
    await advance(POLL_MS);
    await waitFor(() =>
      expect(within(history).getAllByRole("listitem")).toHaveLength(2),
    );
    await user.click(await historyButton(region, t.title));
    await waitFor(() =>
      expect(
        within(region).queryByRole("region", { name: `${t.title}の変更履歴` }),
      ).toBeNull(),
    );
    const stopped = state.eventRequests.length;
    await advance(POLL_MS * 3);
    expect(state.eventRequests.length).toBe(stopped);
  });

  it("#149 149-C 決定 Q5 軽微3: 履歴が100件ちょうどなら「さらに表示」を出さず、101件目が足されると、次の取り直しで「さらに表示」が出る", async () => {
    const t = todoItem(1);
    const todos = respondTodos([t]);
    const state = respondTodoHistory(todos, {
      events: {
        [t.id]: Array.from({ length: 100 }, (_, i) => todoEvent(i + 1, ALICE)),
      },
    });
    const { user } = renderPage(19);
    const history = await openHistory(user, await section(), t.title);
    await waitFor(() =>
      expect(within(history).getAllByRole("listitem")).toHaveLength(100),
    );
    expect(
      within(history).queryByRole("button", { name: CASE_TODO_TEXTS.more }),
    ).toBeNull();
    state.events[t.id] = [...(state.events[t.id] ?? []), todoEvent(101, ALICE)];
    await advance(POLL_MS);
    expect(
      await within(history).findByRole("button", {
        name: CASE_TODO_TEXTS.more,
      }),
    ).toBeTruthy();
  });

  it("#149 149-C 軽微3: 履歴の「さらに表示」の後の取り直しは、取得済みのページを先頭から全部取り直す（2ページ目は1ページ目の最後の ID から）", async () => {
    const t = todoItem(1);
    const todos = respondTodos([t]);
    const state = respondTodoHistory(todos, {
      events: {
        [t.id]: Array.from({ length: 150 }, (_, i) => todoEvent(i + 1, ALICE)),
      },
    });
    const { user } = renderPage(20);
    const history = await openHistory(user, await section(), t.title);
    await waitFor(() =>
      expect(within(history).getAllByRole("listitem")).toHaveLength(100),
    );
    await user.click(
      within(history).getByRole("button", { name: CASE_TODO_TEXTS.more }),
    );
    await waitFor(() =>
      expect(within(history).getAllByRole("listitem")).toHaveLength(150),
    );
    state.eventRequests.length = 0;
    await advance(POLL_MS);
    await waitFor(() =>
      expect(state.eventRequests).toEqual([
        { todoId: t.id, cursor: null },
        { todoId: t.id, cursor: todoEventId(100) },
      ]),
    );
  });

  it.each([
    [
      "カーソルより古い TODO（1ページ目の範囲）が、ほかの人に削除された",
      (state: { deleted: DeletedTodoItem[] }) => {
        state.deleted = [...state.deleted, deletedOf(51)];
      },
      [...Array.from({ length: 101 }, (_, i) => (i + 1) * 2), 51],
    ],
    [
      "1ページ目の TODO が、ほかの人に復元された",
      (state: { deleted: DeletedTodoItem[] }) => {
        state.deleted = state.deleted.filter((d) => d.id !== deletedOf(4).id);
      },
      Array.from({ length: 101 }, (_, i) => (i + 1) * 2).filter((n) => n !== 4),
    ],
  ])(
    "#149 149-C 5-4 AC-7・AC-12 軽微3: 削除済みの一覧（101件・2ページ）を開いている間に、%s場合、取り直しの後に重複・欠落が残らない",
    async (_l, change, expectedNumbers) => {
      const todos = respondTodos([todoItem(1)]);
      const state = respondTodoHistory(todos, {
        deleted: Array.from({ length: 101 }, (_, i) => deletedOf((i + 1) * 2)),
      });
      const { user } = renderPage(21);
      const region = await section();
      const deleted = await openDeleted(user, region);
      await within(deleted).findByText(deletedTitle(200));
      await user.click(
        within(deleted).getByRole("button", { name: CASE_TODO_TEXTS.more }),
      );
      await within(deleted).findByText(deletedTitle(202));
      change(state);
      await advance(POLL_MS);
      const expected = [...expectedNumbers]
        .sort((a, b) => a - b)
        .map(deletedTitle);
      await waitFor(() => expect(deletedTitlesIn(deleted)).toEqual(expected));
      expect(new Set(deletedTitlesIn(deleted)).size).toBe(expected.length);
    },
  );
});

describe("#149 149-C 5-4 AC-13 削除の確認（計画 9.8 F14）", () => {
  it("#149 149-C 5-4 AC-13 F14: 削除の確認の本文に「削除したTODOは、削除済みの一覧から復元できます。」が出る（題名の本文も残る）", async () => {
    respondTodos([todoItem(1)]);
    const { user } = renderPage(22);
    const region = await section();
    await user.click(
      await within(region).findByRole("button", {
        name: `${todoTitle(1)}を削除`,
      }),
    );
    const confirm = await screen.findByRole("dialog", {
      name: CASE_TODO_TEXTS.deleteDialog,
    });
    expect(confirm.textContent).toContain(`「${todoTitle(1)}」を削除します。`);
    expect(confirm.textContent).toContain(H.deleteHint);
  });
});
