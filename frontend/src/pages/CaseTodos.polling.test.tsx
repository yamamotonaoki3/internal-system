// #149（149-A）1-9 AC-2・5-4 AC-7（C-145：2秒間隔のポーリング）、計画 6.6・6.9(4)・6.9(6)：S-17 の TODO の区画の取り直し。
// 偽の時計で時間を進めて確かめる（固定の待ちを使わない）。API は MSW。データはすべて架空（testuser_149a_・[UNIT_TEST]）。
// この層で確かめるもの：
//   2秒進めると、ほかの参加者が足した・完了にした TODO と進捗が、再読み込みなしで出る。ヘッダーと区画の進捗が同じ値になる（6.9(4)）。
//   403 で取得を止め、非公開の表示に切り替える（前の TODO を残さない）。401・404 で止まる。
//   複数のページ（1ページ100件。6.9(6)）：100件 → 101件目の追加で「さらに表示」が出る。201件で3ページ。「さらに表示」の後のポーリングで全ページを取り直す。
// 画面の契約は CaseTodos.test.tsx の冒頭と同じ。
import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  caseDetail,
  caseId,
  caseSummary,
  respondCases,
} from "../test/case-handlers";
import {
  CASE_TODO_TEXTS,
  respondTodos,
  todoItem,
  todoTitle,
} from "../test/case-todo-handlers";
import { renderCaseRequestScreen } from "../test/case-request-handlers";
import { CaseDetailPage } from "./CaseDetailPage";

const POLL_MS = 2_000;

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

function renderPage(n: number) {
  const cases = respondCases({
    summaries: [caseSummary(n)],
    details: [caseDetail(n)],
  });
  const rendered = renderCaseRequestScreen(<CaseDetailPage />, {
    at: `/cases/${caseId(n)}`,
    path: "/cases/:caseId",
  });
  return { ...rendered, ...cases };
}

const section = () => screen.findByRole("region", { name: "TODO" });
const header = async () => {
  const found = (await screen.findByRole("heading", { level: 1 })).closest(
    "header",
  );
  if (found === null) throw new Error("ヘッダーがありません");
  return found;
};
const items = (n: number, from = 1) =>
  Array.from({ length: n }, (_, i) => todoItem(from + i));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("#149 AC-2 1-9 AC-2・5-4 AC-7 2秒のポーリング", () => {
  it("#149 AC-2 1-9 AC-2: ほかの参加者が TODO を足すと、2秒後に再読み込みなしで一覧と進捗に出る", async () => {
    const state = respondTodos([todoItem(1)]);
    renderPage(1);
    const region = await section();
    await within(region).findByText(todoTitle(1));
    expect(within(region).getByText("0/1")).toBeTruthy();
    state.items = [...state.items, todoItem(2, { completed: true })];
    await advance(POLL_MS);
    expect(await within(region).findByText(todoTitle(2))).toBeTruthy();
    expect(await within(region).findByText("1/2")).toBeTruthy();
  });

  it("#149 AC-2 5-4 AC-7 計画 6.9(4): 別の参加者が完了にした後、2秒進めると、ヘッダーと区画の進捗が両方とも同じ「n/m」になる", async () => {
    const state = respondTodos([todoItem(1), todoItem(2), todoItem(3)]);
    renderPage(2);
    const region = await section();
    await within(region).findByText("0/3");
    expect(await within(await header()).findByText("0/3")).toBeTruthy();
    state.items = state.items.map((item, i) =>
      i === 0 ? { ...item, completed: true, version: 2 } : item,
    );
    await advance(POLL_MS);
    await waitFor(() => {
      expect(within(region).getByText("1/3")).toBeTruthy();
    });
    expect(within(region).queryByText("0/3")).toBeNull();
    const top = await header();
    expect(within(top).getByText("1/3")).toBeTruthy();
    expect(
      within(top).getByRole("progressbar", { name: "3項目中1項目が完了" }),
    ).toBeTruthy();
  });

  it("#149 AC-2: 0件から1件になると「項目なし」が消え、進捗が出る", async () => {
    const state = respondTodos([]);
    renderPage(3);
    const region = await section();
    await within(region).findByText(CASE_TODO_TEXTS.empty);
    state.items = [todoItem(1)];
    await advance(POLL_MS);
    expect(await within(region).findByText("0/1")).toBeTruthy();
    expect(within(region).queryByText(CASE_TODO_TEXTS.empty)).toBeNull();
  });

  it("#149 AC-2 R-76: 取得が 403 になったら、取得を止め、非公開の表示に切り替え、前の TODO を残さない。概要・詳細を取り直す", async () => {
    const state = respondTodos([todoItem(1)]);
    const { summaryCalls } = renderPage(4);
    const region = await section();
    await within(region).findByText(todoTitle(1));
    const summariesBefore = summaryCalls.length;
    state.failWith = {
      status: 403,
      code: "FORBIDDEN",
      message: "参加者だけが見られます（非公開）",
    };
    await advance(POLL_MS);
    await waitFor(() => expect(screen.queryByText(todoTitle(1))).toBeNull());
    await waitFor(() =>
      expect(summaryCalls.length).toBeGreaterThan(summariesBefore),
    );
    const stopped = state.requests.length;
    await advance(POLL_MS * 3);
    expect(state.requests.length).toBe(stopped);
  });

  it.each([
    [401, "UNAUTHENTICATED", "ログインしてください"],
    [404, "NOT_FOUND", "案件が見つかりません"],
  ])(
    "#149 AC-2: 取得が %s になったら、取得を止める",
    async (status, code, message) => {
      const state = respondTodos([todoItem(1)]);
      renderPage(5);
      const region = await section();
      await within(region).findByText(todoTitle(1));
      state.failWith = { status, code, message };
      await advance(POLL_MS);
      await waitFor(() => expect(state.requests.length).toBeGreaterThan(1));
      const stopped = state.requests.length;
      await advance(POLL_MS * 3);
      expect(state.requests.length).toBe(stopped);
    },
  );
});

describe("#149 AC-1 決定 Q4 計画 6.9(6) 複数のページ", () => {
  const more = () =>
    screen.queryByRole("button", { name: CASE_TODO_TEXTS.more });

  it("#149 AC-1 決定 Q4: 100件ちょうどなら「さらに表示」を出さず、101件目が足されると、次の取り直しで「さらに表示」が出る", async () => {
    const state = respondTodos(items(100));
    renderPage(10);
    const region = await section();
    await within(region).findByText(todoTitle(100));
    expect(more()).toBeNull();
    state.items = [...state.items, todoItem(101)];
    await advance(POLL_MS);
    expect(
      await screen.findByRole("button", { name: CASE_TODO_TEXTS.more }),
    ).toBeTruthy();
    expect(within(region).getByText("0/101")).toBeTruthy();
  });

  it("#149 AC-1 決定 Q4: 201件なら「さらに表示」を2回押して3ページ（201件目まで）出る", async () => {
    respondTodos(items(201));
    const { user } = renderPage(11);
    const region = await section();
    await within(region).findByText(todoTitle(100));
    expect(within(region).queryByText(todoTitle(101))).toBeNull();
    await user.click(
      await screen.findByRole("button", { name: CASE_TODO_TEXTS.more }),
    );
    expect(await within(region).findByText(todoTitle(200))).toBeTruthy();
    await user.click(
      await screen.findByRole("button", { name: CASE_TODO_TEXTS.more }),
    );
    expect(await within(region).findByText(todoTitle(201))).toBeTruthy();
    await waitFor(() => expect(more()).toBeNull());
  });

  it("#149 AC-1 計画 6.9(6): 「さらに表示」の後のポーリングは、取得済みのページを先頭から全部取り直し、2ページ目の項目の完了も反映する", async () => {
    const state = respondTodos(items(150));
    const { user } = renderPage(12);
    const region = await section();
    await within(region).findByText(todoTitle(100));
    await user.click(
      await screen.findByRole("button", { name: CASE_TODO_TEXTS.more }),
    );
    await within(region).findByText(todoTitle(150));
    state.requests.length = 0;
    state.items = state.items.map((item) =>
      item.id === todoItem(140).id ? { ...item, completed: true } : item,
    );
    await advance(POLL_MS);
    await waitFor(() => expect(state.requests).toEqual([null, "p2"]));
    const row = within(region)
      .getAllByRole("listitem")
      .find((li) => li.textContent?.includes(todoTitle(140)));
    await waitFor(() =>
      expect(row && within(row).queryByText("完了")).toBeTruthy(),
    );
    expect(within(region).getByText("1/150")).toBeTruthy();
  });

  it("#149 AC-1 計画 6.9(6): 最後のページが100件未満なら、ほかの人が足した TODO は、取り直しでそのページの最後に出る", async () => {
    const state = respondTodos(items(120));
    const { user } = renderPage(13);
    const region = await section();
    await within(region).findByText(todoTitle(100));
    await user.click(
      await screen.findByRole("button", { name: CASE_TODO_TEXTS.more }),
    );
    await within(region).findByText(todoTitle(120));
    state.items = [...state.items, todoItem(121)];
    await advance(POLL_MS);
    expect(await within(region).findByText(todoTitle(121))).toBeTruthy();
    const titles = within(region)
      .getAllByRole("listitem")
      .map((li) => li.textContent ?? "");
    expect(titles[titles.length - 1]).toContain(todoTitle(121));
  });
});
