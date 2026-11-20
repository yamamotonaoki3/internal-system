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

// ---- #149（149-C）TODO の履歴（EP-5-24）・削除済みの一覧（EP-5-25）・復元（EP-5-26）の架空の応答 ----
// 応答の形は backend/src/routes/case-todos.history.test.ts の契約と同じ。カーソルは本物と同じく「前のページの最後の ID」で、
// その ID より大きいものを ID 昇順で返す（件数の増減で境界が動いても、取り直しで重複・欠落が出ないことを確かめるため）。

export type TodoEventKind =
  | "create"
  | "title_change"
  | "assignee_change"
  | "complete"
  | "uncomplete"
  | "delete"
  | "restore"
  | "auto_unassign";

export type TodoEvent = {
  id: string;
  kind: TodoEventKind;
  createdAt: string;
  actor: TodoPerson;
  title: string | null;
  previousTitle: string | null;
  assignee: TodoPerson | null;
  previousAssignee: TodoPerson | null;
};

export type DeletedTodoItem = TodoItem & {
  deletedAt: string;
  deletedBy: TodoPerson;
};

/** 画面の文言（計画 plan-149c 5.5。画面の契約は CaseTodos.history.test.tsx の冒頭） */
export const CASE_TODO_HISTORY_TEXTS = {
  history: "履歴",
  historyLoading: "履歴を読み込み中です",
  historyLoadError: "履歴を読み込めませんでした",
  historyMoreError: "履歴の続きを読み込めませんでした",
  deletedToggle: "削除済みのTODO",
  deletedRegion: "削除済みのTODO",
  deletedEmpty: "削除済みのTODOはありません",
  deletedLoading: "削除済みのTODOを読み込み中です",
  deletedLoadError: "削除済みのTODOを読み込めませんでした",
  deletedBy: "削除した人：",
  restored: "TODOを復元しました",
  deleteHint: "削除したTODOは、削除済みの一覧から復元できます。",
  retry: "再試行",
} as const;

/** 記録の ID（ULID の形。n は 1〜99999） */
export const todoEventId = (n: number) =>
  `01JTESTEVNT149C${String(n).padStart(11, "0")}`;
/** 記録の日時（n 分後。記録ごとに違う値） */
export const todoEventAt = (n: number) =>
  new Date(Date.UTC(2026, 10, 20, 0, 0, 0) + n * 60_000).toISOString();

export function todoEvent(
  n: number,
  actor: TodoPerson,
  overrides: Partial<TodoEvent> = {},
): TodoEvent {
  return {
    id: todoEventId(n),
    kind: "uncomplete",
    createdAt: todoEventAt(n),
    actor,
    title: null,
    previousTitle: null,
    assignee: null,
    previousAssignee: null,
    ...overrides,
  };
}

export function deletedTodo(
  n: number,
  deletedBy: TodoPerson,
  overrides: Partial<DeletedTodoItem> = {},
): DeletedTodoItem {
  return {
    ...todoItem(n),
    deletedAt: todoEventAt(1000 + n),
    deletedBy,
    ...overrides,
  };
}

type Failure = { status: number; code: string; message: string };

export type TodoHistoryState = {
  /** TODO の ID ごとの記録（ID 昇順＝古い順） */
  events: Record<string, TodoEvent[]>;
  /** 削除済みの TODO（ID 昇順＝追加した順） */
  deleted: DeletedTodoItem[];
  pageSize: number;
  eventRequests: { todoId: string; cursor: string | null }[];
  deletedRequests: (string | null)[];
  /** 履歴の取得の応答を差し替える。more: true なら続き（cursor あり）だけ */
  failEvents: (Failure & { more?: boolean }) | null;
  failDeleted: Failure | null;
  /** 履歴・削除済みの一覧の取得を保留する。null なら保留しない */
  holdEvents: Promise<void> | null;
  holdDeleted: Promise<void> | null;
  /** 復元の記録（TODO の ID） */
  restores: string[];
  /** 復元の応答を差し替える。undefined なら既定（削除済みから通常の一覧へ移して 200） */
  respondRestore?: (todoId: string) => Response | Promise<Response>;
};

function pageAfter<T extends { id: string }>(
  all: readonly T[],
  cursor: string | null,
  pageSize: number,
) {
  const rest = [...all]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .filter((item) => cursor === null || item.id > cursor);
  const items = rest.slice(0, pageSize);
  const hasMore = rest.length > pageSize;
  return { items, nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null };
}

const failure = (f: Failure) =>
  HttpResponse.json({ code: f.code, message: f.message }, { status: f.status });

/**
 * 履歴（GET /api/cases/:caseId/todos/:todoId/events）・削除済みの一覧（GET /api/cases/:caseId/deleted-todos）・
 * 復元（POST /api/cases/:caseId/todos/:todoId/restore）の架空の応答。既定の復元は、todos.items に ID 順で戻し、版を1進める。
 */
export function respondTodoHistory(
  todos: TodoServerState,
  options: Partial<
    Omit<TodoHistoryState, "eventRequests" | "deletedRequests" | "restores">
  > = {},
): TodoHistoryState {
  const state: TodoHistoryState = {
    events: options.events ?? {},
    deleted: [...(options.deleted ?? [])],
    pageSize: options.pageSize ?? 100,
    eventRequests: [],
    deletedRequests: [],
    failEvents: options.failEvents ?? null,
    failDeleted: options.failDeleted ?? null,
    holdEvents: options.holdEvents ?? null,
    holdDeleted: options.holdDeleted ?? null,
    restores: [],
    respondRestore: options.respondRestore,
  };
  server.use(
    http.get(
      "/api/cases/:caseId/todos/:todoId/events",
      async ({ request, params }) => {
        const todoId = String(params.todoId);
        const cursor = new URL(request.url).searchParams.get("cursor");
        state.eventRequests.push({ todoId, cursor });
        if (state.holdEvents !== null) await state.holdEvents;
        const fail = state.failEvents;
        if (fail !== null && (fail.more !== true || cursor !== null))
          return failure(fail);
        return HttpResponse.json(
          pageAfter(state.events[todoId] ?? [], cursor, state.pageSize),
        );
      },
    ),
    http.get("/api/cases/:caseId/deleted-todos", async ({ request }) => {
      const cursor = new URL(request.url).searchParams.get("cursor");
      state.deletedRequests.push(cursor);
      if (state.holdDeleted !== null) await state.holdDeleted;
      if (state.failDeleted !== null) return failure(state.failDeleted);
      return HttpResponse.json(
        pageAfter(state.deleted, cursor, state.pageSize),
      );
    }),
    http.post(
      "/api/cases/:caseId/todos/:todoId/restore",
      async ({ params }) => {
        const todoId = String(params.todoId);
        state.restores.push(todoId);
        if (state.respondRestore !== undefined)
          return state.respondRestore(todoId);
        const found = state.deleted.find((item) => item.id === todoId);
        if (found === undefined)
          return todoError(404, "NOT_FOUND", "TODOが見つかりません");
        state.deleted = state.deleted.filter((item) => item.id !== todoId);
        const restored: TodoItem = {
          id: found.id,
          title: found.title,
          completed: found.completed,
          version: found.version + 1,
          assignee: found.assignee,
          previousAssignee: found.previousAssignee,
          completedAssignee: found.completedAssignee,
        };
        todos.items = [...todos.items, restored].sort((a, b) =>
          a.id < b.id ? -1 : 1,
        );
        return HttpResponse.json({
          ...restored,
          progress: progressOf(todos.items),
        });
      },
    ),
  );
  return state;
}
