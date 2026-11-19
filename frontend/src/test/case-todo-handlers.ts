// #149（149-A）S-17 の TODO の区画のテストで使う、架空の応答（MSW）。
// 応答の形は、バックエンドのテスト（backend/src/routes/case-todos.test.ts）が決めた契約と同じ。データはすべて架空（testuser_・[UNIT_TEST]）。
// state を書き換えると、次の取得（ポーリング）からその内容を返す（ほかの参加者の操作の代わり）。
import { http, HttpResponse } from "msw";
import { server } from "./server";

export type TodoPerson = {
  userId: string;
  displayName: string;
  isActive: boolean;
};

export type TodoItem = {
  id: string;
  title: string;
  completed: boolean;
  version: number;
  assignee: TodoPerson | null;
  previousAssignee: TodoPerson | null;
  completedAssignee: TodoPerson | null;
};

export type TodoProgress = { done: number; total: number } | null;

/** 画面の文言（計画 149-A 6.3・6.6。サーバーの文言と同じもの） */
export const CASE_TODO_TEXTS = {
  heading: "TODO",
  empty: "項目なし",
  completed: "完了",
  loadError: "TODOを読み込めませんでした",
  added: "TODOを追加しました",
  readOnly: "閲覧のみ",
  noAssignee: "担当なし",
  retired: "退職者",
  more: "さらに表示",
  participantsOnlyEdit: "参加者だけが操作できます",
  closed: "終了した案件は変更できません",
  assigneeInvalid: "担当者は、この案件の参加者から選んでください",
  // ---- 149-B（編集・削除。計画 6.2.5。画面の契約は CaseTodos.edit.test.tsx の冒頭） ----
  editDialog: "TODOの編集",
  save: "保存する",
  cancel: "キャンセル",
  updated: "TODOを更新しました",
  deleteDialog: "TODOの削除",
  deleteConfirm: "削除する",
  deleted: "TODOを削除しました",
  todoDeleted: "このTODOは削除されています",
  todoChanged:
    "ほかの人が変更しました。最新の内容を確かめてから、もう一度操作してください",
  latestLoadFailed: "最新の内容を読み込めませんでした",
  latestOutOfPage:
    "最新の内容を読み込めませんでした。閉じてから、一覧で確かめてください",
  latestPrefix: "最新の内容：",
} as const;

/** TODO の ID（ULID の形。n は 1〜99999） */
export const todoId = (n: number) =>
  `01JTESTTODO149A${String(n).padStart(11, "0")}`;
export const todoTitle = (n: number) => `[UNIT_TEST]149A項目${n}`;

export function todoItem(
  n: number,
  overrides: Partial<TodoItem> = {},
): TodoItem {
  return {
    id: todoId(n),
    title: todoTitle(n),
    completed: false,
    version: 1,
    assignee: null,
    previousAssignee: null,
    completedAssignee: null,
    ...overrides,
  };
}

/** 削除済みを除いた全体から数えた進捗（0件は null）。テストの期待は、別に数字で書く */
export function progressOf(items: TodoItem[]): TodoProgress {
  if (items.length === 0) return null;
  return {
    done: items.filter((item) => item.completed).length,
    total: items.length,
  };
}

export type TodoWrite = { method: string; path: string; body: unknown };

export type TodoServerState = {
  /** 案件ごとの全項目（ID 昇順＝追加した順） */
  items: TodoItem[];
  /** 1ページの件数（既定 100） */
  pageSize: number;
  /** 取得の応答を差し替える（403・404・401・500 など）。null なら通常 */
  failWith: { status: number; code: string; message: string } | null;
  /** GET の記録（cursor） */
  requests: (string | null)[];
  writes: TodoWrite[];
  /** 書き込みの応答を差し替える。undefined なら既定（追加は 201、完了・取り消し・編集は 200、削除は 204） */
  respond?: (write: TodoWrite) => Response | Promise<Response>;
  /** 149-B：編集で assigneeUserId から担当（Person）を引くための人（既定は空。いなければ担当なし） */
  people: TodoPerson[];
  /** 149-B：一覧の取得を保留する（取り直しの間の画面を確かめる）。null なら保留しない */
  hold: Promise<void> | null;
};

/**
 * TODO の一覧（GET /api/cases/:caseId/todos?cursor）・追加（POST …/todos）・完了（POST …/todos/:todoId/complete）・
 * 取り消し（POST …/todos/:todoId/uncomplete）の架空の応答。cursor は「次のページの先頭の位置」（"p2"・"p3" …）。
 * 既定の書き込みは state.items を更新する（取り直しに反映される）。
 */
export function respondTodos(
  initial: TodoItem[] = [],
  options: Partial<Omit<TodoServerState, "items" | "requests" | "writes">> = {},
): TodoServerState {
  const state: TodoServerState = {
    items: [...initial],
    pageSize: options.pageSize ?? 100,
    failWith: options.failWith ?? null,
    requests: [],
    writes: [],
    respond: options.respond,
    people: options.people ?? [],
    hold: options.hold ?? null,
  };
  async function record(request: {
    method: string;
    url: string;
    text(): Promise<string>;
  }): Promise<TodoWrite> {
    const text = await request.text();
    const write: TodoWrite = {
      method: request.method,
      path: new URL(request.url).pathname,
      body: text === "" ? undefined : (JSON.parse(text) as unknown),
    };
    state.writes.push(write);
    return write;
  }
  const setCompleted = (id: string, completed: boolean) => {
    state.items = state.items.map((item) =>
      item.id === id ? { ...item, completed, version: item.version + 1 } : item,
    );
    const found = state.items.find((item) => item.id === id);
    return HttpResponse.json({
      id,
      completed,
      version: found?.version ?? 1,
      progress: progressOf(state.items),
    });
  };
  server.use(
    http.get("/api/cases/:caseId/todos", async ({ request }) => {
      const cursor = new URL(request.url).searchParams.get("cursor");
      state.requests.push(cursor);
      if (state.hold !== null) await state.hold;
      if (state.failWith !== null)
        return HttpResponse.json(
          { code: state.failWith.code, message: state.failWith.message },
          { status: state.failWith.status },
        );
      const page = cursor === null ? 1 : Number(cursor.replace("p", ""));
      const start = (page - 1) * state.pageSize;
      const items = state.items.slice(start, start + state.pageSize);
      const hasMore = state.items.length > start + state.pageSize;
      return HttpResponse.json({
        items,
        nextCursor: hasMore ? `p${page + 1}` : null,
        progress: progressOf(state.items),
      });
    }),
    http.post("/api/cases/:caseId/todos", async ({ request }) => {
      const write = await record(request);
      if (state.respond !== undefined) return state.respond(write);
      const body = write.body as { title: string };
      const created = todoItem(90000 + state.items.length, {
        title: body.title,
      });
      state.items = [...state.items, created];
      return HttpResponse.json(
        { ...created, progress: progressOf(state.items) },
        { status: 201 },
      );
    }),
    http.post(
      "/api/cases/:caseId/todos/:todoId/complete",
      async ({ request, params }) => {
        const write = await record(request);
        if (state.respond !== undefined) return state.respond(write);
        return setCompleted(String(params.todoId), true);
      },
    ),
    http.post(
      "/api/cases/:caseId/todos/:todoId/uncomplete",
      async ({ request, params }) => {
        const write = await record(request);
        if (state.respond !== undefined) return state.respond(write);
        return setCompleted(String(params.todoId), false);
      },
    ),
    // 149-B：編集（PATCH）。既定は、本文の title・assigneeUserId を反映して版を1進め、項目と進捗を返す
    http.patch(
      "/api/cases/:caseId/todos/:todoId",
      async ({ request, params }) => {
        const write = await record(request);
        if (state.respond !== undefined) return state.respond(write);
        const id = String(params.todoId);
        const body = write.body as {
          title?: string;
          assigneeUserId?: string | null;
        };
        state.items = state.items.map((item) => {
          if (item.id !== id) return item;
          const assignee =
            body.assigneeUserId === undefined
              ? item.assignee
              : body.assigneeUserId === null
                ? null
                : (state.people.find(
                    (person) => person.userId === body.assigneeUserId,
                  ) ?? null);
          return {
            ...item,
            title: body.title ?? item.title,
            assignee,
            previousAssignee:
              body.assigneeUserId === undefined ? item.previousAssignee : null,
            version: item.version + 1,
          };
        });
        const found = state.items.find((item) => item.id === id);
        return HttpResponse.json({
          ...(found ?? todoItem(0)),
          progress: progressOf(state.items),
        });
      },
    ),
    // 149-B：削除（DELETE）。既定は、一覧から除いて 204
    http.delete(
      "/api/cases/:caseId/todos/:todoId",
      async ({ request, params }) => {
        const write = await record(request);
        if (state.respond !== undefined) return state.respond(write);
        state.items = state.items.filter(
          (item) => item.id !== String(params.todoId),
        );
        return new HttpResponse(null, { status: 204 });
      },
    ),
  );
  return state;
}

export const todoError = (
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
) => HttpResponse.json({ code, message, ...extra }, { status });
