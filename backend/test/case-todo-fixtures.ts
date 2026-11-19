// #149（149-A）のテストで使う、案件の TODO（case_todos）と、その変更の記録（case_todo_events）の架空のテストデータの作成・読み取り。
// 世界は case-request-fixtures.ts の setupCaseWorld、案件は case-fixtures.ts の seedCase を使う。
// 後始末は cleanupCaseTestData（case-approval-fixtures.ts）に任せる（案件より先に case_todo_events → case_todos を消す）。
// 表の形（計画 149-A 6.1・6.9(1)・6.9(5)。実装の担当が schema.ts と migration で作る）：
//   case_todos：id・case_id・title・assignee_id・recorded_assignee_id・recorded_assignee_name・completed_assignee_id・
//     completed_assignee_name・is_done・version・created_by・created_at・updated_at・deleted_at・deleted_by
//   case_todo_events：id・todo_id・case_id・kind・actor_id・title・previous_title・assignee_id・assignee_name・
//     previous_assignee_id・previous_assignee_name・created_at
// ID は ULID の形で、決定的に作る（同じ n には同じ ID。n が大きいほど大きい）。データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { createUlidFactory } from "../src/lib/ulid";
import { CASEREQ_NOW } from "./case-request-fixtures";

/** 計画 149-A 6.3 の文言（画面はこの文言をそのまま出す） */
export const CASE_TODO_MESSAGES = {
  caseNotFound: "案件が見つかりません",
  participantsOnlyView: "参加者だけが見られます（非公開）",
  participantsOnlyEdit: "参加者だけが操作できます",
  todoNotFound: "TODOが見つかりません",
  todoDeleted: "このTODOは削除されています",
  closed: "終了した案件は変更できません",
  assigneeInvalid: "担当者は、この案件の参加者から選んでください",
  /** 149-B（統括の決定）：版が違うときの 409 todo_changed */
  todoChanged:
    "ほかの人が変更しました。最新の内容を確かめてから、もう一度操作してください",
} as const;

/** 計画 149-A・149-B の 409 の reason（todo_completed の文言は計画で決まっていないため、テストは reason だけを確かめる） */
export const CASE_TODO_REASONS = {
  closed: "closed",
  todoDeleted: "todo_deleted",
  todoChanged: "todo_changed",
  todoCompleted: "todo_completed",
} as const;

export const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const fixedUlid = (ms: number) =>
  createUlidFactory({
    now: () => ms,
    random: (length) => new Uint8Array(length),
  })();

/** TODO の ID（2025年ごろの時刻。いまの時刻の ID より小さい） */
export const todoIdAt = (n: number) => fixedUlid(1_760_000_000_000 + n * 1_000);
/** 記録の ID（TODO の ID と重ならない範囲。いまの時刻の ID より小さい） */
export const eventIdAt = (n: number) =>
  fixedUlid(1_765_000_000_000 + n * 1_000);
/** 未来の時刻の ID（ID の順の逆転を作る。いまの時刻・ulidAfter の ID より大きい） */
export const futureIdAt = (n: number) =>
  fixedUlid(2_000_000_000_000 + n * 1_000);
/** いない TODO の ID（ULID の形） */
export const MISSING_TODO_ID = fixedUlid(1_759_000_000_000);

export type TodoSeed = {
  id: string;
  caseId: string;
  title: string;
  createdBy: string;
  assigneeId?: string | null;
  /** 既定は assigneeId と同じ */
  recordedAssigneeId?: string | null;
  recordedAssigneeName?: string | null;
  isDone?: boolean;
  completedAssigneeId?: string | null;
  completedAssigneeName?: string | null;
  version?: number;
  deletedBy?: string | null;
  createdAt?: string;
};

/** TODO の行を直接入れる（削除済み・完了済みなど、状態を自由に作るため） */
export async function insertTodo(seed: TodoSeed): Promise<string> {
  const assigneeId = seed.assigneeId ?? null;
  const recordedId = seed.recordedAssigneeId ?? assigneeId;
  const recordedName =
    seed.recordedAssigneeName ?? (recordedId === null ? null : "テスト担当");
  const at = seed.createdAt ?? CASEREQ_NOW;
  const deletedBy = seed.deletedBy ?? null;
  await env.DB.prepare(
    `INSERT INTO case_todos (id, case_id, title, assignee_id, recorded_assignee_id, recorded_assignee_name,
       completed_assignee_id, completed_assignee_name, is_done, version, created_by, created_at, updated_at, deleted_at, deleted_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      seed.id,
      seed.caseId,
      seed.title,
      assigneeId,
      recordedId,
      recordedName,
      seed.completedAssigneeId ?? null,
      seed.completedAssigneeName ?? null,
      seed.isDone === true ? 1 : 0,
      seed.version ?? 1,
      seed.createdBy,
      at,
      at,
      deletedBy === null ? null : at,
      deletedBy,
    )
    .run();
  return seed.id;
}

export type TodoEventKind =
  | "create"
  | "title_change"
  | "assignee_change"
  | "complete"
  | "uncomplete"
  | "delete"
  | "restore"
  | "auto_unassign";

/** 記録の行を直接入れる（ID の順の逆転を作るため） */
export async function insertTodoEvent(seed: {
  id: string;
  todoId: string;
  caseId: string;
  kind: TodoEventKind | string;
  actorId: string;
}) {
  await env.DB.prepare(
    `INSERT INTO case_todo_events (id, todo_id, case_id, kind, actor_id, title, previous_title, assignee_id, assignee_name,
       previous_assignee_id, previous_assignee_name, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?)`,
  )
    .bind(
      seed.id,
      seed.todoId,
      seed.caseId,
      seed.kind,
      seed.actorId,
      CASEREQ_NOW,
    )
    .run();
}

export type TodoRow = {
  id: string;
  case_id: string;
  title: string;
  assignee_id: string | null;
  recorded_assignee_id: string | null;
  recorded_assignee_name: string | null;
  completed_assignee_id: string | null;
  completed_assignee_name: string | null;
  is_done: number;
  version: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  deleted_by: string | null;
};

export async function todoRow(id: string): Promise<TodoRow> {
  const row = await env.DB.prepare("SELECT * FROM case_todos WHERE id = ?")
    .bind(id)
    .first<TodoRow>();
  if (row === null) throw new Error(`TODO ${id} がありません`);
  return row;
}

/** 案件の TODO（ID の昇順） */
export async function todoRowsOf(caseId: string): Promise<TodoRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM case_todos WHERE case_id = ? ORDER BY id",
  )
    .bind(caseId)
    .all<TodoRow>();
  return results;
}

export type TodoEventRow = {
  id: string;
  todo_id: string;
  case_id: string;
  kind: string;
  actor_id: string;
  title: string | null;
  previous_title: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  previous_assignee_id: string | null;
  previous_assignee_name: string | null;
  created_at: string;
};

/** TODO の記録（ID の昇順） */
export async function todoEventsOf(todoId: string): Promise<TodoEventRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM case_todo_events WHERE todo_id = ? ORDER BY id",
  )
    .bind(todoId)
    .all<TodoEventRow>();
  return results;
}

export async function auditLogCount(): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM audit_logs",
  ).first<{ n: number }>();
  if (row === null) throw new Error("監査ログの件数を読めませんでした");
  return row.n;
}

/** 取り消しの確認用：TODO・記録（全案件）・案件の行（版を含む）・監査ログの件数。失敗の後に、前と完全に同じであることを確かめる */
export async function todoSnapshot() {
  const all = async (query: string) =>
    (await env.DB.prepare(query).all<Record<string, unknown>>()).results;
  return {
    todos: await all("SELECT * FROM case_todos ORDER BY id"),
    events: await all("SELECT * FROM case_todo_events ORDER BY id"),
    cases: await all(
      "SELECT id, status, due_date, version, updated_at FROM cases ORDER BY id",
    ),
    members: await all(
      "SELECT channel_id, user_id FROM channel_members WHERE channel_id IN (SELECT channel_id FROM cases) ORDER BY channel_id, user_id",
    ),
    audits: await auditLogCount(),
  };
}
