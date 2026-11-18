// #149（149-A）5-4 AC-1・AC-2・AC-3・AC-4・AC-6・AC-8（取り消し）・AC-9、画面 S-17：案件の詳細の TODO の区画。API は MSW。データはすべて架空
// （testuser_149a_・[UNIT_TEST]）。認可・判定の順はサーバー（backend の routes/case-todos.test.ts）で確かめ、ここでは重ねない。
// この層で確かめるもの（計画 149-A のテストケースの「画面」の行・6.6・6.9(1)・6.9(4)）：
//   見出し「TODO」の区画が「参加者 → TODO → やり取り」の順。4つの状態（読み込み中・エラーと再試行・0件「項目なし」・あり）。
//   一覧（完了は「完了」の文字）・進捗「2/5」とバー（読み上げ「5項目中2項目が完了」。パーセントは出さない）。
//   担当の出し分け（有効は名前、無効は「（退職者）」、なしは「担当なし」、外れた後は「担当なし（以前の担当：名前）」）。
//   追加（題名の欄のエラー・担当者の候補は有効な参加者だけ・422 を欄に・409・403 を欄の外に・送信中は押せない・成功で欄を空に）。
//   完了・取り消し（ボタンの名前に題名）。終了中は操作を出さず「閲覧のみ」。非参加者・詳細が 403 では TODO を取得しない。
//   参加者のヘッダーの進捗は、TODO の一覧の取得の progress から出す（概要の progress ではない。6.9(4)）。
// 画面の契約（実装の担当へ。テストが決めたもの）：
//   区画は名前「TODO」の region（section に aria-labelledby で見出し h2「TODO」）。
//   進捗：文字「{done}/{total}」と、progressbar（名前「{total}項目中{done}項目が完了」）。0件は「項目なし」で、progressbar も「0/0」も出さない。
//   項目：区画の中の listitem。完了の行に文字「完了」。ボタン「{題名}を完了にする」「{題名}を未完了に戻す」。
//   担当：有効な人は表示名、無効な人は「{名前}（退職者）」（リンクなし）、なしは「担当なし」、previousAssignee があれば「担当なし（以前の担当：{名前}）」。
//   追加：textbox「題名」、combobox「担当者」（選択肢「担当なし」と、詳細の participants のうち isActive の人の表示名）、button「追加する」。
//     成功で「TODOを追加しました」を出し、題名を空にする。422 の fields は各欄（aria-describedby）、409・403 は区画の中の role=alert。
//   読み込みの失敗は「TODOを読み込めませんでした」と button「再試行」。終了中は文字「閲覧のみ」。
import { screen, waitFor, within } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import {
  PARTICIPANT_CREATOR,
  PARTICIPANT_RETIRED,
  caseDetail,
  caseId,
  caseSummary,
  outsiderSummary,
  respondCases,
  type CaseParticipant,
} from "../test/case-handlers";
import {
  CASE_TODO_TEXTS,
  respondTodos,
  todoError,
  todoId,
  todoItem,
  todoTitle,
} from "../test/case-todo-handlers";
import { renderCaseRequestScreen } from "../test/case-request-handlers";
import { server } from "../test/server";
import { CaseDetailPage } from "./CaseDetailPage";

const MEMBER: CaseParticipant = {
  userId: "01JTESTCASE149APM000000001",
  displayName: "testuser_149a_member",
  departmentName: "[UNIT_TEST]営業147A",
  isActive: true,
  isCreator: false,
  autoRole: null,
  removable: true,
};
const PARTICIPANTS = [PARTICIPANT_CREATOR, MEMBER, PARTICIPANT_RETIRED];
const person = (p: CaseParticipant) => ({
  userId: p.userId,
  displayName: p.displayName,
  isActive: p.isActive,
});

function renderPage(
  n: number,
  options: { status?: "active" | "closed"; outsider?: boolean } = {},
) {
  const summary = options.outsider
    ? outsiderSummary(n, { progress: { done: 1, total: 3 } })
    : caseSummary(n, { status: options.status ?? "active" });
  respondCases({
    summaries: [summary],
    details: [caseDetail(n, { ...summary, participants: PARTICIPANTS })],
  });
  return renderCaseRequestScreen(<CaseDetailPage />, {
    at: `/cases/${caseId(n)}`,
    path: "/cases/:caseId",
  });
}

const section = () => screen.findByRole("region", { name: "TODO" });
const rowOf = (region: HTMLElement, title: string) => {
  const row = within(region)
    .getAllByRole("listitem")
    .find((item) => item.textContent?.includes(title));
  if (row === undefined) throw new Error(`${title} の行がありません`);
  return row;
};
function describedText(input: HTMLElement): string {
  return (input.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter((id) => id !== "")
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
}

describe("#149 S-17 TODO の区画：配置と4つの状態", () => {
  it("#149 AC-1 5-4 AC-1・C-184(3): 参加者の S-17 に見出し「TODO」の区画を、参加者とやり取りの間に置く（タブは作らない）", async () => {
    respondTodos([todoItem(1)]);
    renderPage(1);
    const region = await section();
    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);
    const at = (name: string) => headings.findIndex((h) => h === name);
    expect(at("TODO")).toBeGreaterThan(at("説明"));
    expect(at("やり取り")).toBeGreaterThan(at("TODO"));
    expect(await within(region).findByText(todoTitle(1))).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("#149 AC-1 5-4 AC-4: 0件なら「項目なし」で、進捗のバーも「0/0」も出さない", async () => {
    respondTodos([]);
    renderPage(2);
    const region = await section();
    expect(await within(region).findByText(CASE_TODO_TEXTS.empty)).toBeTruthy();
    expect(within(region).queryByRole("progressbar")).toBeNull();
    expect(within(region).queryByText("0/0")).toBeNull();
  });

  it("#149 AC-1: 取得の間は「読み込み中です」", async () => {
    server.use(
      http.get("/api/cases/:caseId/todos", async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
    );
    renderPage(3);
    const region = await section();
    expect(await within(region).findByText("読み込み中です")).toBeTruthy();
  });

  it("#149 AC-1: 取得に失敗したら「TODOを読み込めませんでした」と「再試行」。再試行で取り直して出す", async () => {
    const state = respondTodos([todoItem(1)], {
      failWith: { status: 500, code: "INTERNAL_ERROR", message: "x" },
    });
    const { user } = renderPage(4);
    const region = await section();
    expect(
      await within(region).findByText(CASE_TODO_TEXTS.loadError),
    ).toBeTruthy();
    state.failWith = null;
    await user.click(within(region).getByRole("button", { name: "再試行" }));
    expect(await within(region).findByText(todoTitle(1))).toBeTruthy();
  });
});

describe("#149 AC-1 5-4 AC-1・AC-4・AC-6 一覧・進捗・担当", () => {
  it("#149 AC-1 5-4 AC-1・AC-4: 完了の行に「完了」を出し、進捗は「2/5」とバー（読み上げ「5項目中2項目が完了」）。パーセントは出さない", async () => {
    respondTodos([
      todoItem(1, { completed: true }),
      todoItem(2),
      todoItem(3, { completed: true }),
      todoItem(4),
      todoItem(5),
    ]);
    renderPage(5);
    const region = await section();
    await within(region).findByText(todoTitle(1));
    expect(within(rowOf(region, todoTitle(1))).getByText("完了")).toBeTruthy();
    expect(within(rowOf(region, todoTitle(2))).queryByText("完了")).toBeNull();
    expect(within(region).getByText("2/5")).toBeTruthy();
    expect(
      within(region).getByRole("progressbar", { name: "5項目中2項目が完了" }),
    ).toBeTruthy();
    expect(region.textContent ?? "").not.toMatch(/%|％/);
  });

  it("#149 AC-1 5-4 AC-6・C-75: 担当の出し分け（有効は名前、無効は「（退職者）」でリンクなし、なしは「担当なし」、外れた後は以前の担当）", async () => {
    respondTodos([
      todoItem(1, { assignee: person(MEMBER) }),
      todoItem(2, {
        assignee: {
          ...person(PARTICIPANT_RETIRED),
          displayName: "テスト保存名149",
        },
      }),
      todoItem(3),
      todoItem(4, {
        previousAssignee: {
          userId: MEMBER.userId,
          displayName: "テスト以前の担当149",
          isActive: false,
        },
      }),
      todoItem(5, {
        completed: true,
        assignee: null,
        completedAssignee: {
          userId: PARTICIPANT_RETIRED.userId,
          displayName: "テスト完了時149",
          isActive: false,
        },
      }),
      todoItem(6, {
        previousAssignee: {
          userId: MEMBER.userId,
          displayName: "テスト外れた担当149",
          isActive: true,
        },
      }),
      todoItem(7, {
        completed: true,
        completedAssignee: {
          userId: MEMBER.userId,
          displayName: "テスト完了時有効149",
          isActive: true,
        },
      }),
    ]);
    renderPage(6);
    const region = await section();
    await within(region).findByText(todoTitle(1));
    expect(
      within(rowOf(region, todoTitle(1))).getByText(MEMBER.displayName, {
        exact: false,
      }),
    ).toBeTruthy();
    const retired = rowOf(region, todoTitle(2));
    expect(retired.textContent).toContain("テスト保存名149（退職者）");
    expect(within(retired).queryByRole("link")).toBeNull();
    expect(rowOf(region, todoTitle(3)).textContent).toContain(
      CASE_TODO_TEXTS.noAssignee,
    );
    expect(rowOf(region, todoTitle(1)).textContent).not.toContain("退職者");
    // 5-4 AC-6・計画 6.9(1)：以前の担当が今無効なら「（退職者）」を併記する
    expect(rowOf(region, todoTitle(4)).textContent).toContain(
      "担当なし（以前の担当：テスト以前の担当149（退職者））",
    );
    // 参加から外れただけ（有効）なら併記しない
    const detached = rowOf(region, todoTitle(6));
    expect(detached.textContent).toContain(
      "担当なし（以前の担当：テスト外れた担当149）",
    );
    expect(detached.textContent).not.toContain("退職者");
    const done = rowOf(region, todoTitle(5));
    expect(done.textContent).toContain("テスト完了時149（退職者）");
    expect(within(done).queryByRole("link")).toBeNull();
    const doneActive = rowOf(region, todoTitle(7));
    expect(doneActive.textContent).toContain("テスト完了時有効149");
    expect(doneActive.textContent).not.toContain("退職者");
  });

  it("#149 AC-1 計画 6.9(4): 参加者のヘッダーの進捗は、概要ではなく TODO の一覧の取得の progress（区画と同じ値）", async () => {
    respondTodos([todoItem(1, { completed: true }), todoItem(2), todoItem(3)]);
    // 概要の progress はわざと違う値にする（ヘッダーが概要から出していれば 9/9 になる）
    respondCases({
      summaries: [caseSummary(7, { progress: { done: 9, total: 9 } })],
      details: [caseDetail(7, { participants: PARTICIPANTS })],
    });
    renderCaseRequestScreen(<CaseDetailPage />, {
      at: `/cases/${caseId(7)}`,
      path: "/cases/:caseId",
    });
    const region = await section();
    await within(region).findByText("1/3");
    const header = (await screen.findByRole("heading", { level: 1 })).closest(
      "header",
    );
    if (header === null) throw new Error("ヘッダーがありません");
    expect(within(header).getByText("1/3")).toBeTruthy();
    expect(within(header).queryByText("9/9")).toBeNull();
  });

  it("#149 AC-1 5-1 AC-2・R-78: 非参加者の S-17 は、ヘッダーに概要の進捗だけを出し、TODO を取得しない", async () => {
    const state = respondTodos([todoItem(1)]);
    renderPage(8, { outsider: true });
    const header = (await screen.findByRole("heading", { level: 1 })).closest(
      "header",
    );
    if (header === null) throw new Error("ヘッダーがありません");
    expect(await within(header).findByText("1/3")).toBeTruthy();
    expect(
      within(header).getByRole("progressbar", { name: "3項目中1項目が完了" }),
    ).toBeTruthy();
    expect(screen.queryByRole("region", { name: "TODO" })).toBeNull();
    expect(state.requests).toEqual([]);
  });

  it("#149 AC-1 R-76: 詳細が 403（外された）なら、TODO を取得せず、前の TODO を出さない", async () => {
    const state = respondTodos([todoItem(1)]);
    respondCases({
      summaries: [caseSummary(9)],
      denied: [caseId(9)],
    });
    renderCaseRequestScreen(<CaseDetailPage />, {
      at: `/cases/${caseId(9)}`,
      path: "/cases/:caseId",
    });
    expect(
      await screen.findByText("参加者だけが見られます（非公開）"),
    ).toBeTruthy();
    expect(screen.queryByText(todoTitle(1))).toBeNull();
    expect(state.requests).toEqual([]);
  });
});

describe("#149 AC-1 5-4 AC-2・AC-6 追加", () => {
  it("#149 AC-1 5-4 AC-6: 担当者の候補は「担当なし」と有効な参加者だけ（退職者は出さない）", async () => {
    respondTodos([]);
    renderPage(10);
    const region = await section();
    const select = await within(region).findByRole("combobox", {
      name: "担当者",
    });
    const options = within(select)
      .getAllByRole("option")
      .map((o) => o.textContent ?? "");
    expect(options[0]).toBe(CASE_TODO_TEXTS.noAssignee);
    expect(
      options.some((o) => o.includes(PARTICIPANT_CREATOR.displayName)),
    ).toBe(true);
    expect(options.some((o) => o.includes(MEMBER.displayName))).toBe(true);
    expect(
      options.some((o) => o.includes(PARTICIPANT_RETIRED.displayName)),
    ).toBe(false);
  });

  it("#149 AC-1 5-4 AC-2: 題名と担当者で追加すると、POST { title, assigneeUserId } を1回送り、「TODOを追加しました」を出し、題名を空にし、一覧に出る", async () => {
    const state = respondTodos([]);
    const { user } = renderPage(11);
    const region = await section();
    const title = await within(region).findByRole("textbox", { name: "題名" });
    await user.type(title, "[[UNIT_TEST]149A見積り");
    await user.selectOptions(
      within(region).getByRole("combobox", { name: "担当者" }),
      within(region).getByRole("option", {
        name: new RegExp(MEMBER.displayName),
      }),
    );
    await user.click(within(region).getByRole("button", { name: "追加する" }));
    expect(await within(region).findByText(CASE_TODO_TEXTS.added)).toBeTruthy();
    expect(state.writes).toEqual([
      {
        method: "POST",
        path: `/api/cases/${caseId(11)}/todos`,
        body: { title: "[UNIT_TEST]149A見積り", assigneeUserId: MEMBER.userId },
      },
    ]);
    expect((title as HTMLInputElement).value).toBe("");
    expect(
      await within(region).findByText("[UNIT_TEST]149A見積り"),
    ).toBeTruthy();
  });

  it("#149 AC-1 5-4 AC-6: 担当者が「担当なし」なら assigneeUserId は null で送る", async () => {
    const state = respondTodos([]);
    const { user } = renderPage(12);
    const region = await section();
    await user.type(
      await within(region).findByRole("textbox", { name: "題名" }),
      "[[UNIT_TEST]149A担当なし",
    );
    await user.click(within(region).getByRole("button", { name: "追加する" }));
    await waitFor(() => expect(state.writes).toHaveLength(1));
    expect(state.writes[0]?.body).toEqual({
      title: "[UNIT_TEST]149A担当なし",
      assigneeUserId: null,
    });
  });

  it.each([
    ["空", ""],
    ["空白だけ", "　 "],
    ["101文字", "あ".repeat(101)],
  ])(
    "#149 AC-1 5-4 AC-2（C-90）: 題名が%sなら、送らずに題名の欄にエラーを出す",
    async (_l, value) => {
      const state = respondTodos([]);
      const { user } = renderPage(13);
      const region = await section();
      const title = await within(region).findByRole("textbox", {
        name: "題名",
      });
      if (value !== "") await user.type(title, value);
      await user.click(
        within(region).getByRole("button", { name: "追加する" }),
      );
      await waitFor(() => expect(describedText(title)).not.toBe(""));
      expect(title.getAttribute("aria-invalid")).toBe("true");
      expect(state.writes).toEqual([]);
    },
  );

  it("#149 AC-1 5-4 AC-6: 追加の 422（fields assigneeUserId）は担当者の欄に出し、欄の外には出さない", async () => {
    respondTodos([], {
      respond: () =>
        todoError(422, "VALIDATION_ERROR", CASE_TODO_TEXTS.assigneeInvalid, {
          fields: ["assigneeUserId"],
        }),
    });
    const { user } = renderPage(14);
    const region = await section();
    await user.type(
      await within(region).findByRole("textbox", { name: "題名" }),
      "[[UNIT_TEST]149A",
    );
    await user.click(within(region).getByRole("button", { name: "追加する" }));
    const select = within(region).getByRole("combobox", { name: "担当者" });
    await waitFor(() =>
      expect(describedText(select)).toContain(CASE_TODO_TEXTS.assigneeInvalid),
    );
    expect(within(region).queryByRole("alert")).toBeNull();
  });

  it.each([
    [
      "409（終了した案件）",
      () =>
        todoError(409, "CONFLICT", CASE_TODO_TEXTS.closed, {
          reason: "closed",
        }),
      CASE_TODO_TEXTS.closed,
    ],
    [
      "403（外された後の操作）",
      () => todoError(403, "FORBIDDEN", CASE_TODO_TEXTS.participantsOnlyEdit),
      CASE_TODO_TEXTS.participantsOnlyEdit,
    ],
  ])(
    "#149 AC-1 5-4 AC-9: 追加の %s は欄の外（role=alert）に文言を出し、入力は残す",
    async (_l, respond, text) => {
      respondTodos([], { respond });
      const { user } = renderPage(15);
      const region = await section();
      const title = await within(region).findByRole("textbox", {
        name: "題名",
      });
      await user.type(title, "[[UNIT_TEST]149A残す");
      await user.click(
        within(region).getByRole("button", { name: "追加する" }),
      );
      const alert = await within(region).findByRole("alert");
      expect(alert.textContent).toContain(text);
      expect(describedText(title)).not.toContain(text);
      expect((title as HTMLInputElement).value).toBe("[UNIT_TEST]149A残す");
    },
  );

  it("#149 二重送信の防止: 追加の応答を待つ間は「追加する」を押せず、送るのは1回だけ", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const state = respondTodos([], {
      respond: async () => {
        await gate;
        return HttpResponse.json(
          { ...todoItem(1), progress: { done: 0, total: 1 } },
          { status: 201 },
        );
      },
    });
    const { user } = renderPage(16);
    const region = await section();
    await user.type(
      await within(region).findByRole("textbox", { name: "題名" }),
      "[[UNIT_TEST]149A二重",
    );
    const button = within(region).getByRole("button", { name: "追加する" });
    await user.click(button);
    await waitFor(() =>
      expect((button as HTMLButtonElement).disabled).toBe(true),
    );
    await user.click(button);
    expect(state.writes).toHaveLength(1);
    release();
    expect(await within(region).findByText(CASE_TODO_TEXTS.added)).toBeTruthy();
  });
});

describe("#149 AC-1 5-4 AC-3・AC-8 完了と取り消し", () => {
  it("#149 AC-1 5-4 AC-3: 「{題名}を完了にする」で完了の POST を送り、行に「完了」と、進捗の変化を出す", async () => {
    const state = respondTodos([todoItem(1), todoItem(2)]);
    const { user } = renderPage(20);
    const region = await section();
    await user.click(
      await within(region).findByRole("button", {
        name: `${todoTitle(1)}を完了にする`,
      }),
    );
    await waitFor(() =>
      expect(
        within(rowOf(region, todoTitle(1))).getByText("完了"),
      ).toBeTruthy(),
    );
    expect(state.writes).toEqual([
      {
        method: "POST",
        path: `/api/cases/${caseId(20)}/todos/${todoId(1)}/complete`,
        body: undefined,
      },
    ]);
    expect(await within(region).findByText("1/2")).toBeTruthy();
  });

  it("#149 AC-1 5-4 AC-8: 完了の行には「{題名}を未完了に戻す」を出し、押すと取り消しの POST を送る", async () => {
    const state = respondTodos([todoItem(1, { completed: true })]);
    const { user } = renderPage(21);
    const region = await section();
    expect(
      within(region).queryByRole("button", {
        name: `${todoTitle(1)}を完了にする`,
      }),
    ).toBeNull();
    await user.click(
      await within(region).findByRole("button", {
        name: `${todoTitle(1)}を未完了に戻す`,
      }),
    );
    await waitFor(() => expect(state.writes).toHaveLength(1));
    expect(state.writes[0]?.path).toBe(
      `/api/cases/${caseId(21)}/todos/${todoId(1)}/uncomplete`,
    );
    expect(
      await within(region).findByRole("button", {
        name: `${todoTitle(1)}を完了にする`,
      }),
    ).toBeTruthy();
  });

  it("#149 AC-1 5-4 AC-9: 完了の 409（ほかの人が終了した）は欄の外に文言を出し、取り直す", async () => {
    const state = respondTodos([todoItem(1)], {
      respond: () =>
        todoError(409, "CONFLICT", CASE_TODO_TEXTS.closed, {
          reason: "closed",
        }),
    });
    const { user } = renderPage(22);
    const region = await section();
    const before = state.requests.length;
    await user.click(
      await within(region).findByRole("button", {
        name: `${todoTitle(1)}を完了にする`,
      }),
    );
    expect(await within(region).findByRole("alert")).toBeTruthy();
    expect(within(region).getByRole("alert").textContent).toContain(
      CASE_TODO_TEXTS.closed,
    );
    await waitFor(() => expect(state.requests.length).toBeGreaterThan(before));
  });

  it("#149 二重送信の防止: 完了の応答を待つ間は、その行の「完了にする」を押せない", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const state = respondTodos([todoItem(1)], {
      respond: async () => {
        await gate;
        return HttpResponse.json({
          id: todoId(1),
          completed: true,
          version: 2,
          progress: { done: 1, total: 1 },
        });
      },
    });
    const { user } = renderPage(23);
    const region = await section();
    const button = await within(region).findByRole("button", {
      name: `${todoTitle(1)}を完了にする`,
    });
    await user.click(button);
    await waitFor(() =>
      expect((button as HTMLButtonElement).disabled).toBe(true),
    );
    await user.click(button);
    expect(state.writes).toHaveLength(1);
    release();
  });

  it("#149 コードレビュー1回目（軽微）: A の行の完了の応答を待つ間は、すべての行の完了・取り消しのボタンを押せず、B を押しても送らない", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const state = respondTodos(
      [todoItem(1), todoItem(2), todoItem(3, { completed: true })],
      {
        respond: async () => {
          await gate;
          return HttpResponse.json({
            id: todoId(1),
            completed: true,
            version: 2,
            progress: { done: 2, total: 3 },
          });
        },
      },
    );
    const { user } = renderPage(24);
    const region = await section();
    await user.click(
      await within(region).findByRole("button", {
        name: `${todoTitle(1)}を完了にする`,
      }),
    );
    const others = [
      within(region).getByRole("button", {
        name: `${todoTitle(2)}を完了にする`,
      }),
      within(region).getByRole("button", {
        name: `${todoTitle(3)}を未完了に戻す`,
      }),
    ];
    await waitFor(() => {
      for (const button of within(region).getAllByRole("button", {
        name: /を完了にする$|を未完了に戻す$/,
      }))
        expect((button as HTMLButtonElement).disabled, button.textContent).toBe(
          true,
        );
    });
    for (const button of others) await user.click(button);
    expect(state.writes).toHaveLength(1);
    release();
  });

  it("#149 コードレビュー1回目・再レビュー（軽微）: A の完了が 409 で失敗したらエラーを出し、ポーリングの取得の成功では消えず、同じ操作のやり直しが成功したら消える", async () => {
    let releaseA: () => void = () => undefined;
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    let attemptsA = 0;
    const state = respondTodos([todoItem(1), todoItem(2)], {
      respond: async (write) => {
        if (write.path.includes(todoId(1))) {
          attemptsA += 1;
          if (attemptsA === 1) {
            await gateA;
            return todoError(409, "CONFLICT", CASE_TODO_TEXTS.closed, {
              reason: "closed",
            });
          }
          return HttpResponse.json({
            id: todoId(1),
            completed: true,
            version: 2,
            progress: { done: 1, total: 2 },
          });
        }
        return HttpResponse.json({
          id: todoId(2),
          completed: true,
          version: 2,
          progress: { done: 1, total: 2 },
        });
      },
    });
    const { user } = renderPage(25);
    const region = await section();
    const buttonA = () =>
      within(region).getByRole("button", {
        name: `${todoTitle(1)}を完了にする`,
      });
    await user.click(
      await within(region).findByRole("button", {
        name: `${todoTitle(1)}を完了にする`,
      }),
    );
    releaseA();
    const alert = await within(region).findByRole("alert");
    expect(alert.textContent).toContain(CASE_TODO_TEXTS.closed);
    // ボタンがまた押せるようになるのを待つ
    await waitFor(() =>
      expect((buttonA() as HTMLButtonElement).disabled).toBe(false),
    );
    // ポーリング（一覧の取得）が成功しても、エラーは消えない
    const fetched = state.requests.length;
    await waitFor(
      () => expect(state.requests.length).toBeGreaterThan(fetched),
      { timeout: 5_000 },
    );
    expect(within(region).getByRole("alert").textContent).toContain(
      CASE_TODO_TEXTS.closed,
    );
    // 同じ操作のやり直しが成功したら、エラーが消える
    await user.click(buttonA());
    await waitFor(() => expect(attemptsA).toBe(2));
    await waitFor(() => expect(within(region).queryByRole("alert")).toBeNull());
  });
});

describe("#149 AC-1 5-4 AC-9 終了した案件", () => {
  it("#149 AC-1 5-4 AC-9: 終了中は「閲覧のみ」を出し、一覧と進捗は見せ、追加の欄・完了・取り消しのボタンを出さない", async () => {
    respondTodos([todoItem(1), todoItem(2, { completed: true })]);
    renderPage(30, { status: "closed" });
    const region = await section();
    expect(await within(region).findByText(todoTitle(1))).toBeTruthy();
    expect(
      within(region).getByText(CASE_TODO_TEXTS.readOnly, { exact: false }),
    ).toBeTruthy();
    expect(within(region).getByText("1/2")).toBeTruthy();
    expect(within(region).queryByRole("textbox", { name: "題名" })).toBeNull();
    expect(
      within(region).queryByRole("button", { name: "追加する" }),
    ).toBeNull();
    expect(
      within(region).queryByRole("button", { name: /完了にする|未完了に戻す/ }),
    ).toBeNull();
  });
});
