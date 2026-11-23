// #149（149-B）5-4 AC-6（編集で選べる担当・有効な社員の名前からプロフィールと DM）・AC-7・AC-8・AC-9、決定 Q1・Q3、計画 6.2.5・10節 #35〜#49：
// S-17 の TODO の区画の「編集」「削除」。API は MSW（test/case-todo-handlers.ts）。データはすべて架空（testuser_・[UNIT_TEST]）。
// 認可・判定の順はサーバー（backend の routes/case-todos.edit.test.ts）で確かめ、ここでは重ねない。
// 画面の契約（実装の担当へ。テストが決めたもの）：
//   行のボタン：進行中だけ「{題名}を編集」「{題名}を削除」（aria-label）。終了中は出さない。送信中は押せない。
//   編集のダイアログ：dialog「TODOの編集」。textbox「題名」・combobox「担当者」（選択肢は「担当なし」と、詳細の participants のうち isActive の人。
//     値は利用者の ID）・button「保存する」「キャンセル」。完了済みの TODO では combobox「担当者」を出さない（決定 Q1）。
//     送るのは変わった項目だけ（PATCH の本文 { version, title?, assigneeUserId? }）。何も変わらなければ送らずに閉じる。
//     422 の fields は各欄（aria-describedby）、409・403 はダイアログの中の role=alert。入力は残す。成功で閉じ、区画に「TODOを更新しました」。
//     409 todo_changed：サーバーの文言を出し、入力を残し、一覧を取り直す。取り直しが終わるまで「保存する」を押せない。取得済みのページに項目があれば
//       「最新の内容：{題名}／担当：{担当の表示名か「担当なし」}」を出し、次の保存は最新の版で送る。項目がなければ
//       「最新の内容を読み込めませんでした。閉じてから、一覧で確かめてください」を出して保存を押せなくする（削除とは言わない）。
//       取り直しが失敗したら「最新の内容を読み込めませんでした」と button「再試行」（ダイアログの中）。保存は押せない。
//     409 todo_deleted：「このTODOは削除されています」を出し、保存を押せなくする（入力は残す）。
//   削除の確認：dialog「TODOの削除」、本文「「{題名}」を削除します。」、button「削除する」。確定で DELETE（本文なし）、成功で区画に「TODOを削除しました」。
//   担当の名前（5-4 AC-6）：有効な人の名前は、プロフィールカード（ProfileCardTrigger。名前のボタン）で出し、カードの中に「{名前} さんに DMを送る」
//     （自分には出さない）。無効な人は「{名前}（退職者）」の文字だけで、ボタンも DM もない。未完了の現在の担当・完了時の担当・以前の担当で同じ。
// jsdom には popover がないため、カードの開閉は toggle イベント（fireToggle）で再現する。
import { act, screen, waitFor, within } from "@testing-library/react";
import { onlineManager } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_USER } from "../test/auth-handlers";
import { fireToggle } from "../test/app-shell-harness";
import {
  PARTICIPANT_CREATOR,
  PARTICIPANT_RETIRED,
  caseDetail,
  caseId,
  caseSummary,
  respondCases,
  type CaseParticipant,
} from "../test/case-handlers";
import { renderCaseRequestScreen } from "../test/case-request-handlers";
import {
  CASE_TODO_TEXTS,
  respondTodos,
  todoError,
  todoId,
  todoItem,
  todoTitle,
  type TodoItem,
  type TodoPerson,
} from "../test/case-todo-handlers";
import { server } from "../test/server";
import { CaseDetailPage } from "./CaseDetailPage";

const POLL_MS = 2_000;

const MEMBER: CaseParticipant = {
  userId: "01JTESTCASE149BPM000000001",
  displayName: "testuser_149b_member",
  departmentName: "[UNIT_TEST]営業149B",
  isActive: true,
  isCreator: false,
  autoRole: null,
  removable: true,
};
/** セッションの利用者（自分）も参加者にする（自分には DM のボタンを出さない） */
const SELF: CaseParticipant = {
  userId: TEST_USER.id,
  displayName: "testuser_149b_self",
  departmentName: "[UNIT_TEST]営業149B",
  isActive: true,
  isCreator: false,
  autoRole: null,
  removable: true,
};
const PARTICIPANTS = [PARTICIPANT_CREATOR, MEMBER, SELF, PARTICIPANT_RETIRED];
const person = (p: CaseParticipant): TodoPerson => ({
  userId: p.userId,
  displayName: p.displayName,
  isActive: p.isActive,
});
const PEOPLE = PARTICIPANTS.map(person);

const FAIL_500 = {
  status: 500,
  code: "INTERNAL_ERROR",
  message: "サーバーでエラーが起きました",
};
const changedConflict = () =>
  todoError(409, "CONFLICT", CASE_TODO_TEXTS.todoChanged, {
    reason: "todo_changed",
  });

function renderPage(
  n: number,
  options: { status?: "active" | "closed"; denied?: string[] } = {},
) {
  const summary = caseSummary(n, { status: options.status ?? "active" });
  const cases = respondCases({
    summaries: [summary],
    details: [caseDetail(n, { ...summary, participants: PARTICIPANTS })],
    denied: options.denied,
  });
  // プロフィールカード（S-27）の中身。どの人でも架空のカードを返す
  server.use(
    http.get("/api/users/:userId/profile-card", ({ params }) =>
      HttpResponse.json({
        id: String(params.userId),
        displayName: "testuser_149b_card",
        legalName: "テスト本名149B",
        department: null,
        status: { kind: "available", returnAt: null, message: null },
      }),
    ),
  );
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
const disabled = (element: HTMLElement) =>
  (element as HTMLButtonElement).disabled;

type User = ReturnType<typeof renderPage>["user"];

async function openEdit(user: User, region: HTMLElement, title: string) {
  await user.click(
    await within(region).findByRole("button", { name: `${title}を編集` }),
  );
  return screen.findByRole("dialog", { name: CASE_TODO_TEXTS.editDialog });
}
const titleOf = (dialog: HTMLElement) =>
  within(dialog).getByRole("textbox", { name: "題名" }) as HTMLInputElement;
const assigneeOf = (dialog: HTMLElement) =>
  within(dialog).getByRole("combobox", { name: "担当者" });
/** 選択欄の値（選んだ利用者の ID。「担当なし」は空文字） */
const selectedOf = (dialog: HTMLElement) =>
  (assigneeOf(dialog) as HTMLInputElement).value;
const saveOf = (dialog: HTMLElement) =>
  within(dialog).getByRole("button", { name: CASE_TODO_TEXTS.save });

async function retitle(user: User, dialog: HTMLElement, value: string) {
  const input = titleOf(dialog);
  await user.clear(input);
  await user.type(input, value);
}

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe("#149 AC-1 149-B 5-4 AC-6・AC-8 編集のダイアログ", () => {
  it("#149 AC-1 5-4 AC-6 計画 10節 #35: 「{題名}を編集」で、題名と担当（B）が入ったダイアログが開く。担当の候補は「担当なし」と有効な参加者だけ（退職者は出ない）", async () => {
    respondTodos([todoItem(1, { assignee: person(MEMBER) })], {
      people: PEOPLE,
    });
    const { user } = renderPage(1);
    const region = await section();
    const dialog = await openEdit(user, region, todoTitle(1));
    expect(titleOf(dialog).value).toBe(todoTitle(1));
    expect(selectedOf(dialog)).toBe(MEMBER.userId);
    const options = within(assigneeOf(dialog))
      .getAllByRole("option")
      .map((o) => o.textContent ?? "");
    expect(options[0]).toBe(CASE_TODO_TEXTS.noAssignee);
    expect(options.some((o) => o.includes(MEMBER.displayName))).toBe(true);
    expect(
      options.some((o) => o.includes(PARTICIPANT_CREATOR.displayName)),
    ).toBe(true);
    expect(
      options.some((o) => o.includes(PARTICIPANT_RETIRED.displayName)),
    ).toBe(false);
  });

  it("#149 AC-1 5-4 AC-8 計画 10節 #36・#48: 題名だけ変えて保存すると、PATCH の本文は { version: 1, title } だけ（担当を含まない。「[」もそのまま）。成功で「TODOを更新しました」、ダイアログが閉じ、一覧が取り直される", async () => {
    const state = respondTodos([todoItem(1, { assignee: person(MEMBER) })], {
      people: PEOPLE,
    });
    const { user } = renderPage(2);
    const region = await section();
    const dialog = await openEdit(user, region, todoTitle(1));
    await retitle(user, dialog, "[[UNIT_TEST]149B改題");
    const fetched = state.requests.length;
    await user.click(saveOf(dialog));
    expect(
      await within(region).findByText(CASE_TODO_TEXTS.updated),
    ).toBeTruthy();
    expect(state.writes).toEqual([
      {
        method: "PATCH",
        path: `/api/cases/${caseId(2)}/todos/${todoId(1)}`,
        body: { version: 1, title: "[UNIT_TEST]149B改題" },
      },
    ]);
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: CASE_TODO_TEXTS.editDialog }),
      ).toBeNull(),
    );
    await waitFor(() => expect(state.requests.length).toBeGreaterThan(fetched));
    expect(await within(region).findByText("[UNIT_TEST]149B改題")).toBeTruthy();
  });

  it("#149 AC-1 5-4 AC-6 決定 Q3: 担当だけを「担当なし」にすると、本文は { version, assigneeUserId: null } だけ", async () => {
    const state = respondTodos([todoItem(1, { assignee: person(MEMBER) })], {
      people: PEOPLE,
    });
    const { user } = renderPage(3);
    const region = await section();
    const dialog = await openEdit(user, region, todoTitle(1));
    await user.selectOptions(
      assigneeOf(dialog),
      within(assigneeOf(dialog)).getByRole("option", {
        name: CASE_TODO_TEXTS.noAssignee,
      }),
    );
    await user.click(saveOf(dialog));
    await waitFor(() => expect(state.writes).toHaveLength(1));
    expect(state.writes[0]?.body).toEqual({ version: 1, assigneeUserId: null });
  });

  it("#149 AC-1 計画 10節 #37: 何も変えずに保存すると、要求を送らずに閉じる", async () => {
    const state = respondTodos([todoItem(1, { assignee: person(MEMBER) })], {
      people: PEOPLE,
    });
    const { user } = renderPage(4);
    const region = await section();
    const dialog = await openEdit(user, region, todoTitle(1));
    await user.click(saveOf(dialog));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: CASE_TODO_TEXTS.editDialog }),
      ).toBeNull(),
    );
    expect(state.writes).toEqual([]);
  });

  it.each([
    ["空", ""],
    ["空白だけ", "　 "],
    ["101文字", "あ".repeat(101)],
  ])(
    "#149 AC-1 5-4 AC-2（C-90）: 編集の題名が%sなら、送らずに題名の欄にエラーを出す",
    async (_l, value) => {
      const state = respondTodos([todoItem(1)], { people: PEOPLE });
      const { user } = renderPage(5);
      const region = await section();
      const dialog = await openEdit(user, region, todoTitle(1));
      await user.clear(titleOf(dialog));
      if (value !== "") await user.type(titleOf(dialog), value);
      await user.click(saveOf(dialog));
      await waitFor(() => expect(describedText(titleOf(dialog))).not.toBe(""));
      expect(titleOf(dialog).getAttribute("aria-invalid")).toBe("true");
      expect(state.writes).toEqual([]);
    },
  );

  it("#149 AC-1 決定 Q1 計画 10節 #38: 完了済みの TODO の編集では、担当の欄を出さない（題名だけ）", async () => {
    respondTodos(
      [
        todoItem(2, {
          completed: true,
          version: 2,
          completedAssignee: person(MEMBER),
        }),
      ],
      { people: PEOPLE },
    );
    const { user } = renderPage(6);
    const region = await section();
    const dialog = await openEdit(user, region, todoTitle(2));
    expect(titleOf(dialog).value).toBe(todoTitle(2));
    expect(
      within(dialog).queryByRole("combobox", { name: "担当者" }),
    ).toBeNull();
  });
});

describe("#149 AC-1 149-B 編集の失敗（計画 10節 #39〜#42）", () => {
  it("#149 AC-1 計画 6.2.5 10節 #39: 409 todo_changed なら、文言を出し、入力を残し、取り直しが終わるまで保存を押せない。最新の内容を出し、次の保存は最新の版で送る", async () => {
    const hold = deferred();
    let attempts = 0;
    const state = respondTodos([todoItem(1, { assignee: person(MEMBER) })], {
      people: PEOPLE,
      respond: (write) => {
        attempts += 1;
        if (attempts === 1) {
          // ほかの人の変更：題名と担当が変わり、版が 2 に進んでいる
          state.items = [
            todoItem(1, {
              title: "[UNIT_TEST]149B最新の題名",
              assignee: person(PARTICIPANT_CREATOR),
              version: 2,
            }),
          ];
          state.hold = hold.promise;
          return changedConflict();
        }
        return HttpResponse.json({
          ...todoItem(1, {
            title: (write.body as { title: string }).title,
            version: 3,
          }),
          progress: { done: 0, total: 1 },
        });
      },
    });
    const { user } = renderPage(7);
    const region = await section();
    const dialog = await openEdit(user, region, todoTitle(1));
    await retitle(user, dialog, "[[UNIT_TEST]149B入力した題名");
    await user.selectOptions(
      assigneeOf(dialog),
      within(assigneeOf(dialog)).getByRole("option", {
        name: CASE_TODO_TEXTS.noAssignee,
      }),
    );
    await user.click(saveOf(dialog));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(CASE_TODO_TEXTS.todoChanged);
    // 入力が残る
    expect(titleOf(dialog).value).toBe("[UNIT_TEST]149B入力した題名");
    expect(selectedOf(dialog)).toBe("");
    // 取り直しの間は保存を押せない
    await waitFor(() => expect(disabled(saveOf(dialog))).toBe(true));
    state.hold = null;
    hold.release();
    expect(
      await within(dialog).findByText(
        `${CASE_TODO_TEXTS.latestPrefix}[UNIT_TEST]149B最新の題名／担当：${PARTICIPANT_CREATOR.displayName}`,
        { exact: false },
      ),
    ).toBeTruthy();
    expect(dialog.textContent).not.toContain(CASE_TODO_TEXTS.todoDeleted);
    await waitFor(() => expect(disabled(saveOf(dialog))).toBe(false));
    await user.click(saveOf(dialog));
    await waitFor(() => expect(state.writes).toHaveLength(2));
    expect(state.writes[1]?.body).toEqual({
      version: 2,
      title: "[UNIT_TEST]149B入力した題名",
      assigneeUserId: null,
    });
  });

  it("#149 AC-1 計画 10節 #40: 409 todo_deleted なら「このTODOは削除されています」を出し、保存を押せない。入力は残る", async () => {
    respondTodos([todoItem(1)], {
      people: PEOPLE,
      respond: () =>
        todoError(409, "CONFLICT", CASE_TODO_TEXTS.todoDeleted, {
          reason: "todo_deleted",
        }),
    });
    const { user } = renderPage(8);
    const region = await section();
    const dialog = await openEdit(user, region, todoTitle(1));
    await retitle(user, dialog, "[[UNIT_TEST]149B残す");
    await user.click(saveOf(dialog));
    expect((await within(dialog).findByRole("alert")).textContent).toContain(
      CASE_TODO_TEXTS.todoDeleted,
    );
    expect(titleOf(dialog).value).toBe("[UNIT_TEST]149B残す");
    await waitFor(() => expect(disabled(saveOf(dialog))).toBe(true));
  });

  it("#298 AC-5: 409 でも、コードが SESSION_USER_MISMATCH なら、todo_changed と同じ文言でも「ほかの人の変更」の扱いにしない（最新の内容を出さず、保存は押せるまま、次の保存も元の版で送る）", async () => {
    let attempts = 0;
    const state = respondTodos([todoItem(1, { assignee: person(MEMBER) })], {
      people: PEOPLE,
      respond: (write) => {
        attempts += 1;
        if (attempts === 1) {
          // 競合なら取り直しで届くはずの最新の内容（版 2）を用意しておく
          state.items = [
            todoItem(1, {
              title: "[UNIT_TEST]298最新の題名",
              assignee: person(PARTICIPANT_CREATOR),
              version: 2,
            }),
          ];
          return todoError(
            409,
            "SESSION_USER_MISMATCH",
            CASE_TODO_TEXTS.todoChanged,
          );
        }
        return HttpResponse.json({
          ...todoItem(1, {
            title: (write.body as { title: string }).title,
            version: 3,
          }),
          progress: { done: 0, total: 1 },
        });
      },
    });
    const { user } = renderPage(61);
    const region = await section();
    const dialog = await openEdit(user, region, todoTitle(1));
    await retitle(user, dialog, "[[UNIT_TEST]298入力した題名");
    await user.click(saveOf(dialog));
    // ふつうの失敗と同じく、サーバーの文言を欄の外に出し、入力は残す
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(CASE_TODO_TEXTS.todoChanged);
    expect(titleOf(dialog).value).toBe("[UNIT_TEST]298入力した題名");
    // 競合として扱えば、onSettled が一覧の取り直しを待つ間、保存は押せない。有効に戻るまで待ってから確かめる
    await waitFor(() => expect(disabled(saveOf(dialog))).toBe(false));
    expect(dialog.textContent).not.toContain(CASE_TODO_TEXTS.latestPrefix);
    await user.click(saveOf(dialog));
    await waitFor(() => expect(state.writes).toHaveLength(2));
    expect(state.writes[1]?.body).toMatchObject({ version: 1 });
  });

  it("#298 AC-5: 409 でも、コードが SESSION_USER_MISMATCH なら、todo_deleted と同じ文言でも「削除されている」の扱いにしない（保存は押せるまま）", async () => {
    respondTodos([todoItem(1)], {
      people: PEOPLE,
      respond: () =>
        todoError(409, "SESSION_USER_MISMATCH", CASE_TODO_TEXTS.todoDeleted),
    });
    const { user } = renderPage(62);
    const region = await section();
    const dialog = await openEdit(user, region, todoTitle(1));
    await retitle(user, dialog, "[[UNIT_TEST]298残す");
    await user.click(saveOf(dialog));
    expect((await within(dialog).findByRole("alert")).textContent).toContain(
      CASE_TODO_TEXTS.todoDeleted,
    );
    expect(titleOf(dialog).value).toBe("[UNIT_TEST]298残す");
    await waitFor(() => expect(disabled(saveOf(dialog))).toBe(false));
    // 有効に戻った後も、削除済みの扱い（保存を押せなくする）になっていない
    expect(titleOf(dialog).value).toBe("[UNIT_TEST]298残す");
  });

  it("#149 AC-1 計画 6.2.5（重大4）10節 #40-2: 101件の案件で、T100 が 2ページ目に押し出された後に 409 todo_changed なら、削除とは言わず「閉じてから、一覧で確かめてください」を出し、保存を押せない。入力は残る", async () => {
    const items = Array.from({ length: 101 }, (_, i) => todoItem(i + 1));
    const state = respondTodos(items, {
      people: PEOPLE,
      respond: () => {
        // ほかの人が T100 より古い TODO（ID が小さい）を復元した：T100 は 101 番目（2ページ目）になる
        state.items = [todoItem(0), ...state.items];
        return changedConflict();
      },
    });
    const { user } = renderPage(9);
    const region = await section();
    const dialog = await openEdit(user, region, todoTitle(100));
    await retitle(user, dialog, "[[UNIT_TEST]149B押し出し");
    await user.click(saveOf(dialog));
    expect(
      await within(dialog).findByText(CASE_TODO_TEXTS.latestOutOfPage, {
        exact: false,
      }),
    ).toBeTruthy();
    expect(dialog.textContent).not.toContain(CASE_TODO_TEXTS.todoDeleted);
    expect(titleOf(dialog).value).toBe("[UNIT_TEST]149B押し出し");
    expect(disabled(saveOf(dialog))).toBe(true);
  });

  it("#149 AC-1 計画 6.2.5 10節 #40-3: 409 todo_changed の後の取り直しが失敗したら、「最新の内容を読み込めませんでした」と「再試行」を出し、保存を押せない。再試行が成功すれば最新の内容が出て保存できる", async () => {
    const state = respondTodos([todoItem(1, { assignee: person(MEMBER) })], {
      people: PEOPLE,
      respond: () => {
        state.items = [
          todoItem(1, {
            title: "[UNIT_TEST]149B再試行の後の題名",
            assignee: null,
            version: 2,
          }),
        ];
        state.failWith = FAIL_500;
        return changedConflict();
      },
    });
    const { user } = renderPage(10);
    const region = await section();
    const dialog = await openEdit(user, region, todoTitle(1));
    await retitle(user, dialog, "[[UNIT_TEST]149B取り直しの失敗");
    await user.click(saveOf(dialog));
    expect(
      await within(dialog).findByText(CASE_TODO_TEXTS.latestLoadFailed, {
        exact: false,
      }),
    ).toBeTruthy();
    expect(dialog.textContent).not.toContain("閉じてから");
    expect(dialog.textContent).not.toContain(CASE_TODO_TEXTS.todoDeleted);
    expect(disabled(saveOf(dialog))).toBe(true);
    state.failWith = null;
    await user.click(within(dialog).getByRole("button", { name: "再試行" }));
    expect(
      await within(dialog).findByText(
        `${CASE_TODO_TEXTS.latestPrefix}[UNIT_TEST]149B再試行の後の題名／担当：${CASE_TODO_TEXTS.noAssignee}`,
        { exact: false },
      ),
    ).toBeTruthy();
    await waitFor(() => expect(disabled(saveOf(dialog))).toBe(false));
    expect(titleOf(dialog).value).toBe("[UNIT_TEST]149B取り直しの失敗");
  });

  it("#149 AC-1 5-4 AC-6 計画 10節 #41: 422（fields assigneeUserId）は担当の欄に出し、欄の外には出さない。入力は残る", async () => {
    respondTodos([todoItem(1, { assignee: person(MEMBER) })], {
      people: PEOPLE,
      respond: () =>
        todoError(422, "VALIDATION_ERROR", CASE_TODO_TEXTS.assigneeInvalid, {
          fields: ["assigneeUserId"],
        }),
    });
    const { user } = renderPage(11);
    const region = await section();
    const dialog = await openEdit(user, region, todoTitle(1));
    await user.selectOptions(
      assigneeOf(dialog),
      within(assigneeOf(dialog)).getByRole("option", {
        name: new RegExp(PARTICIPANT_CREATOR.displayName),
      }),
    );
    await user.click(saveOf(dialog));
    await waitFor(() =>
      expect(describedText(assigneeOf(dialog))).toContain(
        CASE_TODO_TEXTS.assigneeInvalid,
      ),
    );
    expect(within(dialog).queryByRole("alert")).toBeNull();
    expect(selectedOf(dialog)).toBe(PARTICIPANT_CREATOR.userId);
  });

  it.each([
    [
      "409 todo_completed（画面が古く、完了を知らずに担当を変えた）",
      () =>
        todoError(
          409,
          "CONFLICT",
          "[UNIT_TEST]完了したTODOの担当は変えられません",
          {
            reason: "todo_completed",
          },
        ),
      "[UNIT_TEST]完了したTODOの担当は変えられません",
    ],
    [
      "409 closed（ほかの人が終了した）",
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
    "#149 AC-1 決定 Q1 計画 10節 #42: %s は、ダイアログの中の欄の外（role=alert）にサーバーの文言を出し、入力は残す",
    async (_l, respond, text) => {
      respondTodos([todoItem(1, { assignee: person(MEMBER) })], {
        people: PEOPLE,
        respond,
      });
      const { user } = renderPage(12);
      const region = await section();
      const dialog = await openEdit(user, region, todoTitle(1));
      await user.selectOptions(
        assigneeOf(dialog),
        within(assigneeOf(dialog)).getByRole("option", {
          name: new RegExp(PARTICIPANT_CREATOR.displayName),
        }),
      );
      await user.click(saveOf(dialog));
      expect((await within(dialog).findByRole("alert")).textContent).toContain(
        text,
      );
      expect(describedText(assigneeOf(dialog))).not.toContain(text);
      expect(selectedOf(dialog)).toBe(PARTICIPANT_CREATOR.userId);
    },
  );
});

describe("#149 AC-1 149-B 送信中と失敗の表示（計画 10節 #43・#44）", () => {
  it("#149 AC-1 計画 10節 #43: 編集の送信中は、保存と、区画のすべての行の完了・取り消し・編集・削除・追加が押せず、送るのは1回だけ", async () => {
    const gate = deferred();
    const state = respondTodos(
      [todoItem(1), todoItem(2), todoItem(3, { completed: true })],
      {
        people: PEOPLE,
        respond: async () => {
          await gate.promise;
          return HttpResponse.json({
            ...todoItem(1, { title: "[UNIT_TEST]149B送信中", version: 2 }),
            progress: { done: 1, total: 3 },
          });
        },
      },
    );
    const { user } = renderPage(13);
    const region = await section();
    const dialog = await openEdit(user, region, todoTitle(1));
    await retitle(user, dialog, "[[UNIT_TEST]149B送信中");
    await user.click(saveOf(dialog));
    await waitFor(() => expect(disabled(saveOf(dialog))).toBe(true));
    await waitFor(() => {
      const buttons = within(region).getAllByRole("button", {
        name: /を完了にする$|を未完了に戻す$|を編集$|を削除$/,
      });
      expect(buttons.length).toBeGreaterThanOrEqual(9);
      for (const button of buttons)
        expect(disabled(button), button.getAttribute("aria-label") ?? "").toBe(
          true,
        );
      expect(
        disabled(within(region).getByRole("button", { name: "追加する" })),
      ).toBe(true);
    });
    await user.click(saveOf(dialog));
    expect(state.writes).toHaveLength(1);
    gate.release();
    expect(
      await within(region).findByText(CASE_TODO_TEXTS.updated),
    ).toBeTruthy();
  });

  it("#149 AC-1 計画 10節 #44: 削除の失敗（403）の表示は、次の別の操作（完了）の成功で消える", async () => {
    respondTodos([todoItem(1), todoItem(2)], {
      people: PEOPLE,
      respond: (write) =>
        write.method === "DELETE"
          ? todoError(403, "FORBIDDEN", CASE_TODO_TEXTS.participantsOnlyEdit)
          : HttpResponse.json({
              id: todoId(2),
              completed: true,
              version: 2,
              progress: { done: 1, total: 2 },
            }),
    });
    const { user } = renderPage(14);
    const region = await section();
    await user.click(
      await within(region).findByRole("button", {
        name: `${todoTitle(1)}を削除`,
      }),
    );
    const confirm = await screen.findByRole("dialog", {
      name: CASE_TODO_TEXTS.deleteDialog,
    });
    await user.click(
      within(confirm).getByRole("button", {
        name: CASE_TODO_TEXTS.deleteConfirm,
      }),
    );
    await waitFor(() =>
      expect(
        screen
          .queryAllByRole("alert")
          .some((a) =>
            a.textContent?.includes(CASE_TODO_TEXTS.participantsOnlyEdit),
          ),
      ).toBe(true),
    );
    // 確認のダイアログが開いたままなら閉じる
    const stillOpen = screen.queryByRole("dialog", {
      name: CASE_TODO_TEXTS.deleteDialog,
    });
    if (stillOpen !== null)
      await user.click(
        within(stillOpen).getByRole("button", { name: CASE_TODO_TEXTS.cancel }),
      );
    await waitFor(() =>
      expect(
        disabled(
          within(region).getByRole("button", {
            name: `${todoTitle(2)}を完了にする`,
          }),
        ),
      ).toBe(false),
    );
    await user.click(
      within(region).getByRole("button", {
        name: `${todoTitle(2)}を完了にする`,
      }),
    );
    await waitFor(() =>
      expect(
        screen
          .queryAllByRole("alert")
          .some((a) =>
            a.textContent?.includes(CASE_TODO_TEXTS.participantsOnlyEdit),
          ),
      ).toBe(false),
    );
  });
});

describe("#149 AC-1 149-B 5-4 AC-8・AC-12 削除（計画 10節 #45）", () => {
  it("#149 AC-1 5-4 AC-8・AC-12 計画 10節 #45: 「{題名}を削除」で確認（見出し「TODOの削除」・本文に題名・「削除する」）。確定で DELETE を本文なしで1回送り、「TODOを削除しました」。一覧と進捗（ヘッダー・区画の両方）が変わる", async () => {
    const state = respondTodos(
      [todoItem(1), todoItem(2, { completed: true })],
      { people: PEOPLE },
    );
    const { user } = renderPage(15);
    const region = await section();
    await within(region).findByText("1/2");
    await user.click(
      await within(region).findByRole("button", {
        name: `${todoTitle(1)}を削除`,
      }),
    );
    const confirm = await screen.findByRole("dialog", {
      name: CASE_TODO_TEXTS.deleteDialog,
    });
    expect(confirm.textContent).toContain(`「${todoTitle(1)}」を削除します。`);
    expect(state.writes).toEqual([]);
    await user.click(
      within(confirm).getByRole("button", {
        name: CASE_TODO_TEXTS.deleteConfirm,
      }),
    );
    expect(
      await within(region).findByText(CASE_TODO_TEXTS.deleted),
    ).toBeTruthy();
    expect(state.writes).toEqual([
      {
        method: "DELETE",
        path: `/api/cases/${caseId(15)}/todos/${todoId(1)}`,
        body: undefined,
      },
    ]);
    await waitFor(() =>
      expect(within(region).queryByText(todoTitle(1))).toBeNull(),
    );
    expect(await within(region).findByText("1/1")).toBeTruthy();
    expect(await within(await header()).findByText("1/1")).toBeTruthy();
  });

  it("#149 AC-1: 削除の確認で「キャンセル」なら送らない", async () => {
    const state = respondTodos([todoItem(1)], { people: PEOPLE });
    const { user } = renderPage(16);
    const region = await section();
    await user.click(
      await within(region).findByRole("button", {
        name: `${todoTitle(1)}を削除`,
      }),
    );
    const confirm = await screen.findByRole("dialog", {
      name: CASE_TODO_TEXTS.deleteDialog,
    });
    await user.click(
      within(confirm).getByRole("button", { name: CASE_TODO_TEXTS.cancel }),
    );
    expect(state.writes).toEqual([]);
    expect(within(region).getByText(todoTitle(1))).toBeTruthy();
  });
});

describe("#149 AC-1 149-B 5-4 AC-6 担当の名前からプロフィールと DM（計画 10節 #40-4）", () => {
  const items = (): TodoItem[] => [
    todoItem(1, { assignee: person(MEMBER) }),
    todoItem(2, { assignee: person(SELF) }),
    todoItem(3, { completed: true, completedAssignee: person(MEMBER) }),
    todoItem(4, { previousAssignee: person(MEMBER) }),
    todoItem(5, {
      assignee: {
        ...person(PARTICIPANT_RETIRED),
        displayName: "テスト退職者149B",
      },
    }),
    todoItem(6, {
      completed: true,
      completedAssignee: {
        ...person(PARTICIPANT_RETIRED),
        displayName: "テスト完了時退職者149B",
      },
    }),
  ];

  function panelOf(trigger: HTMLElement) {
    const id = trigger.getAttribute("popovertarget");
    const panel = id === null ? null : document.getElementById(id);
    if (panel === null) throw new Error("カードの popover がありません");
    return panel;
  }

  it.each([
    ["未完了の現在の担当", 1],
    ["完了時の担当", 3],
    ["以前の担当（担当なし）", 4],
  ])(
    "#149 AC-1 5-4 AC-6: 有効な %s の名前を押すとプロフィールカードが開き、「{名前} さんに DMを送る」がある",
    async (_l, n) => {
      respondTodos(items(), { people: PEOPLE });
      renderPage(20 + n);
      const region = await section();
      await within(region).findByText(todoTitle(n), { exact: false });
      const trigger = within(rowOf(region, todoTitle(n))).getByRole("button", {
        name: MEMBER.displayName,
      });
      const panel = panelOf(trigger);
      fireToggle(panel, "open");
      expect(
        await within(panel).findByRole("button", {
          name: `${MEMBER.displayName} さんに DMを送る`,
        }),
      ).toBeTruthy();
    },
  );

  it("#149 AC-1 5-4 AC-6: 自分が担当なら、名前のカードは開けるが、DM のボタンはない", async () => {
    respondTodos(items(), { people: PEOPLE });
    renderPage(25);
    const region = await section();
    await within(region).findByText(todoTitle(2), { exact: false });
    const trigger = within(rowOf(region, todoTitle(2))).getByRole("button", {
      name: SELF.displayName,
    });
    const panel = panelOf(trigger);
    fireToggle(panel, "open");
    await within(panel).findByRole("button", { name: "閉じる" });
    expect(
      within(panel).queryByRole("button", { name: /DMを送る/ }),
    ).toBeNull();
  });

  it("#149 AC-1 5-4 AC-6・C-75: 無効な社員の名前は「（退職者）」つきの文字だけで、名前のボタンも DM もない（現在の担当・完了時の担当）", async () => {
    respondTodos(items(), { people: PEOPLE });
    renderPage(26);
    const region = await section();
    await within(region).findByText(todoTitle(5), { exact: false });
    for (const [n, name] of [
      [5, "テスト退職者149B"],
      [6, "テスト完了時退職者149B"],
    ] as const) {
      const row = rowOf(region, todoTitle(n));
      expect(row.textContent).toContain(`${name}（退職者）`);
      expect(
        within(row).queryByRole("button", { name: new RegExp(name) }),
      ).toBeNull();
      expect(
        within(row).queryByRole("button", { name: /DMを送る/ }),
      ).toBeNull();
      expect(row.querySelector("[popovertarget]")).toBeNull();
    }
  });

  it("#149 AC-1 計画レビュー2回目（軽微2）: 同じ人の名前が複数の行に出ても、カードの ID は重ならない（どの名前のボタンも自分の行のカードを開く）", async () => {
    respondTodos(items(), { people: PEOPLE });
    renderPage(27);
    const region = await section();
    await within(region).findByText(todoTitle(4), { exact: false });
    const triggers = [1, 3, 4].map((n) =>
      within(rowOf(region, todoTitle(n))).getByRole("button", {
        name: MEMBER.displayName,
      }),
    );
    const targets = triggers.map((t) => t.getAttribute("popovertarget"));
    expect(new Set(targets).size).toBe(3);
    for (const id of targets)
      expect(document.querySelectorAll(`[id="${id}"]`)).toHaveLength(1);
  });
});

describe("#149 AC-1 149-B 5-4 AC-9 終了した案件（計画 10節 #47）", () => {
  it("#149 AC-1 5-4 AC-9 計画 10節 #47: 終了中は、編集・削除のボタンを出さない", async () => {
    respondTodos([todoItem(1), todoItem(2, { completed: true })], {
      people: PEOPLE,
    });
    renderPage(30, { status: "closed" });
    const region = await section();
    expect(await within(region).findByText(todoTitle(1))).toBeTruthy();
    expect(
      within(region).queryByRole("button", { name: /を編集$|を削除$/ }),
    ).toBeNull();
  });
});

describe("#149 AC-1 149-B 5-4 AC-7 ポーリングと資格の喪失（計画 10節 #46・#49）", () => {
  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("#149 AC-1 5-4 AC-7 計画 10節 #46: 別の参加者が編集・削除した後、2秒進めると、題名・担当・進捗が変わる（ヘッダーと区画が同じ値）", async () => {
    const state = respondTodos(
      [
        todoItem(1, { assignee: person(MEMBER) }),
        todoItem(2, { completed: true }),
        todoItem(3),
      ],
      { people: PEOPLE },
    );
    renderPage(31);
    const region = await section();
    await within(region).findByText("1/3");
    state.items = [
      todoItem(1, {
        title: "[UNIT_TEST]149B相手の改題",
        assignee: person(PARTICIPANT_CREATOR),
        version: 2,
      }),
      todoItem(2, { completed: true }),
    ];
    await advance(POLL_MS);
    expect(
      await within(region).findByText("[UNIT_TEST]149B相手の改題"),
    ).toBeTruthy();
    expect(rowOf(region, "[UNIT_TEST]149B相手の改題").textContent).toContain(
      PARTICIPANT_CREATOR.displayName,
    );
    await waitFor(() =>
      expect(within(region).queryByText(todoTitle(3))).toBeNull(),
    );
    expect(await within(region).findByText("1/2")).toBeTruthy();
    expect(await within(await header()).findByText("1/2")).toBeTruthy();
  });

  it("#149 AC-1 #308 計画 10節 #49: 編集のダイアログを開いたまま 403（外された）になると、非公開の表示に切り替わり、ダイアログが閉じ、TODO と入力が出ない", async () => {
    const denied: string[] = [];
    const state = respondTodos([todoItem(1)], { people: PEOPLE });
    const { user } = renderPage(32, { denied });
    const region = await section();
    const dialog = await openEdit(user, region, todoTitle(1));
    await retitle(user, dialog, "[[UNIT_TEST]149B外された後の入力");
    denied.push(caseId(32));
    state.failWith = {
      status: 403,
      code: "FORBIDDEN",
      message: "参加者だけが見られます（非公開）",
    };
    await advance(POLL_MS);
    expect(
      await screen.findByText("参加者だけが見られます（非公開）"),
    ).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: CASE_TODO_TEXTS.editDialog }),
      ).toBeNull(),
    );
    expect(screen.queryByText(todoTitle(1))).toBeNull();
    expect(document.body.textContent).not.toContain(
      "[UNIT_TEST]149B外された後の入力",
    );
  });
});

// #320：409（todo_changed）の後の取り直しの完了を、時刻の比較だけに頼らずに見分ける（#149-B の後追い）。
// 組み合わせ：取り直しの {成功・失敗・最中} × {時刻が進む・409 の受信と前の取得が同じミリ秒}。
// 同じミリ秒は、Date.now を固定して再現する（react-query の取得の時刻も、409 を受けた時刻も同じ値になる）。
const LOADING_TEXT = "最新の内容を読み込み中です";
const SAME_MS = 1_800_000_000_000;

describe.each([
  { label: "時刻が進む", sameMs: false },
  { label: "409 の受信と前の取得が同じミリ秒", sameMs: true },
])("#320 AC-1・AC-2 409 の後の取り直し（$label）", ({ sameMs }) => {
  beforeEach(() => {
    if (sameMs) vi.spyOn(Date, "now").mockReturnValue(SAME_MS);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** 409 を返し、その後の一覧は「最新の内容」を、失敗または保留で返す */
  function setup(n: number, mode: { fail?: boolean; hold?: Promise<void> }) {
    const state = respondTodos([todoItem(1, { assignee: person(MEMBER) })], {
      people: PEOPLE,
      respond: () => {
        state.items = [
          todoItem(1, {
            title: "[UNIT_TEST]320最新の題名",
            assignee: person(PARTICIPANT_CREATOR),
            version: 2,
          }),
        ];
        if (mode.fail) state.failWith = FAIL_500;
        if (mode.hold !== undefined) state.hold = mode.hold;
        return changedConflict();
      },
    });
    const { user } = renderPage(n);
    return { state, user };
  }
  async function saveWithInput(
    user: User,
    region: HTMLElement,
    text: string,
  ): Promise<HTMLElement> {
    const dialog = await openEdit(user, region, todoTitle(1));
    await retitle(user, dialog, text);
    await user.selectOptions(
      assigneeOf(dialog),
      within(assigneeOf(dialog)).getByRole("option", {
        name: CASE_TODO_TEXTS.noAssignee,
      }),
    );
    await user.click(saveOf(dialog));
    return dialog;
  }

  it("#320 AC-1・AC-2: 取り直しが失敗したら、古い内容を「最新」と出さず、失敗の表示と「再試行」を出し、保存は押せない。入力は残る", async () => {
    const { state, user } = setup(41, { fail: true });
    const region = await section();
    const dialog = await saveWithInput(
      user,
      region,
      "[[UNIT_TEST]320失敗の入力",
    );
    expect(
      await within(dialog).findByText(CASE_TODO_TEXTS.latestLoadFailed, {
        exact: false,
      }),
    ).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "再試行" })).toBeTruthy();
    expect(dialog.textContent).not.toContain(CASE_TODO_TEXTS.latestPrefix);
    expect(disabled(saveOf(dialog))).toBe(true);
    // 入力は残る
    expect(titleOf(dialog).value).toBe("[UNIT_TEST]320失敗の入力");
    expect(selectedOf(dialog)).toBe("");
    // 古い版のまま、もう一度送らせない
    await user.click(saveOf(dialog));
    expect(state.writes).toHaveLength(1);
  });

  it("#320 AC-1・AC-2: 取り直しの最中は、読み込みの表示になり、保存は押せない。「最新」とは出さない。入力は残る", async () => {
    const hold = deferred();
    const { state, user } = setup(42, { hold: hold.promise });
    const region = await section();
    const dialog = await saveWithInput(
      user,
      region,
      "[[UNIT_TEST]320最中の入力",
    );
    expect(
      await within(dialog).findByText(LOADING_TEXT, { exact: false }),
    ).toBeTruthy();
    expect(dialog.textContent).not.toContain(CASE_TODO_TEXTS.latestPrefix);
    expect(disabled(saveOf(dialog))).toBe(true);
    expect(titleOf(dialog).value).toBe("[UNIT_TEST]320最中の入力");
    expect(selectedOf(dialog)).toBe("");
    await user.click(saveOf(dialog));
    expect(state.writes).toHaveLength(1);
    state.hold = null;
    hold.release();
    expect(
      await within(dialog).findByText(
        `${CASE_TODO_TEXTS.latestPrefix}[UNIT_TEST]320最新の題名`,
        { exact: false },
      ),
    ).toBeTruthy();
  });

  it("#320 AC-1・AC-2: 失敗の後の「再試行」が成功したら、最新の内容が出て、保存を押せる。入力は残る", async () => {
    const { state, user } = setup(43, { fail: true });
    const region = await section();
    const dialog = await saveWithInput(
      user,
      region,
      "[[UNIT_TEST]320再試行の入力",
    );
    await within(dialog).findByText(CASE_TODO_TEXTS.latestLoadFailed, {
      exact: false,
    });
    state.failWith = null;
    await user.click(within(dialog).getByRole("button", { name: "再試行" }));
    expect(
      await within(dialog).findByText(
        `${CASE_TODO_TEXTS.latestPrefix}[UNIT_TEST]320最新の題名／担当：${PARTICIPANT_CREATOR.displayName}`,
        { exact: false },
      ),
    ).toBeTruthy();
    await waitFor(() => expect(disabled(saveOf(dialog))).toBe(false));
    expect(within(dialog).queryByRole("button", { name: "再試行" })).toBeNull();
    expect(titleOf(dialog).value).toBe("[UNIT_TEST]320再試行の入力");
    expect(selectedOf(dialog)).toBe("");
  });
});

describe("#320 AC-1 一覧の自動の取り直し（2秒ごと）と編集のダイアログ", () => {
  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("#320 AC-1: 送信中に、一覧の自動の取り直しが走っても、保存・キャンセルは押せないままで、送信は1回だけ", async () => {
    const gate = deferred();
    const state = respondTodos([todoItem(1)], {
      people: PEOPLE,
      respond: async () => {
        await gate.promise;
        return HttpResponse.json({
          ...todoItem(1, { title: "[UNIT_TEST]320送信中", version: 2 }),
          progress: { done: 0, total: 1 },
        });
      },
    });
    const { user } = renderPage(44);
    const region = await section();
    const dialog = await openEdit(user, region, todoTitle(1));
    await retitle(user, dialog, "[[UNIT_TEST]320送信中");
    await user.click(saveOf(dialog));
    await waitFor(() => expect(disabled(saveOf(dialog))).toBe(true));
    const before = state.requests.length;
    await advance(POLL_MS);
    await waitFor(() => expect(state.requests.length).toBeGreaterThan(before));
    const cancel = within(dialog).getByRole("button", {
      name: CASE_TODO_TEXTS.cancel,
    });
    expect(disabled(saveOf(dialog))).toBe(true);
    expect(disabled(cancel)).toBe(true);
    await user.click(saveOf(dialog));
    expect(state.writes).toHaveLength(1);
    gate.release();
    expect(
      await within(region).findByText(CASE_TODO_TEXTS.updated),
    ).toBeTruthy();
  });

  it("#320 AC-1: 409 の後ではない、ふだんの自動の取り直しの最中・失敗では、読み込みや失敗の表示に切り替わらず、保存を押せる。入力は残る", async () => {
    const hold = deferred();
    const state = respondTodos([todoItem(1, { assignee: person(MEMBER) })], {
      people: PEOPLE,
    });
    const { user } = renderPage(45);
    const region = await section();
    const dialog = await openEdit(user, region, todoTitle(1));
    await retitle(user, dialog, "[[UNIT_TEST]320ふだんの入力");
    expect(disabled(saveOf(dialog))).toBe(false);
    // 取り直しの最中（保留）
    state.hold = hold.promise;
    const before = state.requests.length;
    await advance(POLL_MS);
    await waitFor(() => expect(state.requests.length).toBeGreaterThan(before));
    expect(dialog.textContent).not.toContain(LOADING_TEXT);
    expect(dialog.textContent).not.toContain(CASE_TODO_TEXTS.latestLoadFailed);
    expect(disabled(saveOf(dialog))).toBe(false);
    // 取り直しの失敗
    state.failWith = FAIL_500;
    state.hold = null;
    hold.release();
    await advance(POLL_MS);
    await waitFor(() =>
      expect(state.requests.length).toBeGreaterThan(before + 1),
    );
    expect(dialog.textContent).not.toContain(LOADING_TEXT);
    expect(dialog.textContent).not.toContain(CASE_TODO_TEXTS.latestLoadFailed);
    expect(within(dialog).queryByRole("button", { name: "再試行" })).toBeNull();
    expect(disabled(saveOf(dialog))).toBe(false);
    expect(titleOf(dialog).value).toBe("[UNIT_TEST]320ふだんの入力");
  });
});

describe("#320 AC-1 コードレビュー1回目の指摘", () => {
  it("#320 AC-1: 409 の前にキャッシュがすでに最新で、409 の後の取り直しが同じ中身を返しても、ほかの描画のきっかけがなくても、読み込み中が終わり、最新の内容が出て、保存を押せる", async () => {
    const hold = deferred();
    // 開いた時点の一覧がすでに最新の版（version 2）。一覧の中身は 409 の前後で変わらない
    const state = respondTodos(
      [
        todoItem(1, {
          title: "[UNIT_TEST]320同じ中身の題名",
          assignee: person(MEMBER),
          version: 2,
        }),
      ],
      {
        people: PEOPLE,
        respond: () => {
          state.hold = hold.promise;
          return changedConflict();
        },
      },
    );
    const { user } = renderPage(46);
    const region = await section();
    const dialog = await openEdit(user, region, "[UNIT_TEST]320同じ中身の題名");
    await retitle(user, dialog, "[[UNIT_TEST]320同じ中身の入力");
    await user.click(saveOf(dialog));
    expect(
      await within(dialog).findByText(LOADING_TEXT, { exact: false }),
    ).toBeTruthy();
    expect(disabled(saveOf(dialog))).toBe(true);
    // 取り直しの応答（キャッシュと同じ中身）が届く。これ以外の描画のきっかけはない
    state.hold = null;
    hold.release();
    expect(
      await within(dialog).findByText(
        `${CASE_TODO_TEXTS.latestPrefix}[UNIT_TEST]320同じ中身の題名／担当：${MEMBER.displayName}`,
        { exact: false },
      ),
    ).toBeTruthy();
    expect(dialog.textContent).not.toContain(LOADING_TEXT);
    await waitFor(() => expect(disabled(saveOf(dialog))).toBe(false));
    expect(titleOf(dialog).value).toBe("[UNIT_TEST]320同じ中身の入力");
  });

  it("#320 AC-1: 409 の後の取得が通信断で一時停止し、復帰後にキャッシュと同じ中身を取得しても、読み込み中が終わり、最新の内容が出て、保存を押せる", async () => {
    const state = respondTodos(
      [
        todoItem(1, {
          title: "[UNIT_TEST]320断の題名",
          assignee: person(MEMBER),
          version: 2,
        }),
      ],
      {
        people: PEOPLE,
        respond: () => {
          onlineManager.setOnline(false);
          return changedConflict();
        },
      },
    );
    const { user } = renderPage(48);
    const region = await section();
    const dialog = await openEdit(user, region, "[UNIT_TEST]320断の題名");
    try {
      await retitle(user, dialog, "[[UNIT_TEST]320断の入力");
      await user.click(saveOf(dialog));
      expect(
        await within(dialog).findByText(LOADING_TEXT, { exact: false }),
      ).toBeTruthy();
      const before = state.requests.length;
      act(() => onlineManager.setOnline(true));
      await waitFor(() =>
        expect(state.requests.length).toBeGreaterThan(before),
      );
      expect(
        await within(dialog).findByText(
          `${CASE_TODO_TEXTS.latestPrefix}[UNIT_TEST]320断の題名／担当：${MEMBER.displayName}`,
          { exact: false },
        ),
      ).toBeTruthy();
      await waitFor(() => expect(disabled(saveOf(dialog))).toBe(false));
      expect(titleOf(dialog).value).toBe("[UNIT_TEST]320断の入力");
    } finally {
      onlineManager.setOnline(true);
    }
  });

  describe("再送信中の「再試行」", () => {
    const advance = (ms: number) =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("#320 AC-1: 409 → 取得成功 → もう一度送っている間に、自動の取り直しが失敗して失敗の表示になっても、「再試行」は無効で、押しても取り直しは走らない。保存の応答を返すと、送信は2回で止まる", async () => {
      const gate = deferred();
      let attempts = 0;
      const state = respondTodos([todoItem(1, { assignee: person(MEMBER) })], {
        people: PEOPLE,
        respond: async () => {
          attempts += 1;
          if (attempts === 1) {
            state.items = [
              todoItem(1, {
                title: "[UNIT_TEST]320再送信の最新",
                assignee: person(MEMBER),
                version: 2,
              }),
            ];
            return changedConflict();
          }
          await gate.promise;
          return HttpResponse.json({
            ...todoItem(1, { title: "[UNIT_TEST]320再送信の入力", version: 3 }),
            progress: { done: 0, total: 1 },
          });
        },
      });
      const { user } = renderPage(47);
      const region = await section();
      const dialog = await openEdit(user, region, todoTitle(1));
      await retitle(user, dialog, "[[UNIT_TEST]320再送信の入力");
      await user.click(saveOf(dialog));
      await within(dialog).findByText(
        `${CASE_TODO_TEXTS.latestPrefix}[UNIT_TEST]320再送信の最新`,
        { exact: false },
      );
      await waitFor(() => expect(disabled(saveOf(dialog))).toBe(false));
      // もう一度送る（応答を止める）
      await user.click(saveOf(dialog));
      await waitFor(() => expect(state.writes).toHaveLength(2));
      await waitFor(() => expect(disabled(saveOf(dialog))).toBe(true));
      // 送信中に、自動の取り直しが失敗する
      state.failWith = FAIL_500;
      await advance(POLL_MS);
      const retry = await within(dialog).findByRole("button", {
        name: "再試行",
      });
      expect(
        within(dialog).getByText(CASE_TODO_TEXTS.latestLoadFailed, {
          exact: false,
        }),
      ).toBeTruthy();
      expect(disabled(retry)).toBe(true);
      const before = state.requests.length;
      await user.click(retry);
      await advance(100);
      expect(state.requests).toHaveLength(before);
      gate.release();
      expect(
        await within(region).findByText(CASE_TODO_TEXTS.updated),
      ).toBeTruthy();
      expect(state.writes).toHaveLength(2);
    });
  });
});
