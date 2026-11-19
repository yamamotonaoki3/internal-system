// Repository：案件の TODO（#149 の 149-A）。一覧・進捗と、追加・完了・完了の取り消し。DB へのアクセスはこの層に閉じ込める。
// 読み取り：中身（項目・進捗・担当の名前）を読む文に、その時点の閲覧の資格（閲覧者が有効な参加者）を入れる。確かめてから別の文で読まない。
// 書き込み：1操作＝1回の db.batch。先頭の前提（#196 の方式。案件が進行中・操作者が有効な参加者・対象の TODO の状態・担当者が有効な参加者）を
// cases.version を「そのままか NULL」にする UPDATE で確かめ、業務の文・記録の文にも同じ条件を付ける。
// 必須の行を書く文の直後には changes() の確認を置き、0行なら同じく NOT NULL 違反で batch 全体を取り消す（計画 6.10。先例：message-mentions.sql.ts）。
// どちらも CaseStateChangedError になり、Service が最初と同じ判定で読み直す（理由・すでにその状態・ID の順の逆転を読み分ける）。
// ID は外から渡す。同じ案件の TODO・同じ TODO の記録に、渡した ID 以上がすでにあれば書かない（ID の順＝確定の順にするため。計画 6.9(3)）。
import { and, asc, eq, gt, isNull, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { cases, caseTodoEvents, caseTodos, users } from "../../db/schema";
import { decodeCursor, toPage } from "../lib/cursor";
import {
  activeCaseWith,
  assertStatement,
  CaseStateChangedError,
  guardChanges,
  K_ROOM,
  runWriteBatch,
  type CaseStatus,
} from "./case.repository";
import { activeChannelMember } from "./channel-member.sql";
import { withDatabase, type Database } from "./database";
import {
  createRoleAssignmentRepository,
  type RoleAssignmentRepository,
} from "./role-assignment.repository";

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
  /** 現在の担当。有効な人はいまの表示名、無効な人は担当した時点の名前（5-4 AC-6・C-74） */
  assignee: TodoPerson | null;
  /** 現在の担当がなく、担当した時点の人が残っているときだけ */
  previousAssignee: TodoPerson | null;
  /** 完了しているときだけ。完了した時の担当と、その時点の表示名（5-4 AC-11） */
  completedAssignee: TodoPerson | null;
};

export type TodoProgress = { done: number; total: number } | null;

export type TodoPage = {
  items: TodoItem[];
  nextCursor: string | null;
  progress: TodoProgress;
};

/** 書き込みの判定の材料（Service が判定の関数に渡す）。案件がなければ null */
export type TodoWriteFacts = {
  status: CaseStatus;
  actorIsParticipant: boolean;
  /** 対象の TODO（指定したとき・操作者が有効な参加者のときだけ。その案件のものがなければ null） */
  todo: {
    deleted: boolean;
    completed: boolean;
    version: number;
  } | null;
  /** 担当者がその案件の有効な参加者か（指定したときだけ。指定しなければ null） */
  assigneeIsParticipant: boolean | null;
  /** 操作者が有効な参加者でなければ数えない（null） */
  progress: TodoProgress;
};

export type TodoAddInput = {
  caseId: string;
  actorId: string;
  todoId: string;
  eventId: string;
  title: string;
  assigneeId: string | null;
};

export type TodoStateInput = {
  caseId: string;
  actorId: string;
  todoId: string;
  eventId: string;
};

export type TodoUncompleteInput = TodoStateInput & {
  /** 担当者が外れていたときだけ使う記録 auto_unassign の ID。eventId より小さくする */
  autoUnassignEventId: string;
};

/** 操作者が、案件（別名 vc）の有効な参加者であること（中身の読み取りの資格） */
function visibleTo(caseId: string, viewerId: string): SQL {
  return sql`EXISTS (SELECT 1 FROM cases vc WHERE vc.id = ${caseId}
    AND ${activeChannelMember(sql`vc.channel_id`, viewerId)})`;
}

/** 案件（別名 k）の、削除されていない TODO（別名 t）で、extra を満たすものがあること */
function liveTodoWith(todoId: string, extra: SQL): SQL {
  return sql`EXISTS (SELECT 1 FROM case_todos t WHERE t.id = ${todoId} AND t.case_id = k.id
    AND t.deleted_at IS NULL AND ${extra})`;
}

const ONE = sql`1`;

function toProgress(row: { total: number; done: number } | undefined) {
  if (row === undefined || row.total === 0) return null;
  return { done: row.done, total: row.total };
}

export function createCaseTodoRepository(db: Database) {
  const currentUser = alias(users, "au");
  const recordedUser = alias(users, "ru");
  const completedUser = alias(users, "cu");

  /** 項目の行と、担当の有効性（同じ文で読む） */
  const itemRows = (where: SQL | undefined) =>
    db
      .select({
        id: caseTodos.id,
        title: caseTodos.title,
        isDone: caseTodos.isDone,
        version: caseTodos.version,
        assigneeId: caseTodos.assigneeId,
        // 同じ表を3回結合するので、同じ名前の列が重ならないよう、選択項目に別名を付ける
        assigneeName: sql<string | null>`${currentUser.displayName}`.as(
          "assignee_name",
        ),
        assigneeActive: sql<number | null>`${currentUser.isActive}`.as(
          "assignee_active",
        ),
        recordedAssigneeId: caseTodos.recordedAssigneeId,
        recordedAssigneeName: caseTodos.recordedAssigneeName,
        recordedActive: sql<number | null>`${recordedUser.isActive}`.as(
          "recorded_active",
        ),
        completedAssigneeId: caseTodos.completedAssigneeId,
        completedAssigneeName: caseTodos.completedAssigneeName,
        completedActive: sql<number | null>`${completedUser.isActive}`.as(
          "completed_active",
        ),
      })
      .from(caseTodos)
      .leftJoin(currentUser, eq(currentUser.id, caseTodos.assigneeId))
      .leftJoin(recordedUser, eq(recordedUser.id, caseTodos.recordedAssigneeId))
      .leftJoin(
        completedUser,
        eq(completedUser.id, caseTodos.completedAssigneeId),
      )
      .where(where);

  type ItemRow = Awaited<ReturnType<typeof itemRows>>[number];

  function toItem(row: ItemRow): TodoItem {
    const assignee =
      row.assigneeId === null
        ? null
        : row.assigneeActive === 1 && row.assigneeName !== null
          ? {
              userId: row.assigneeId,
              displayName: row.assigneeName,
              isActive: true,
            }
          : {
              userId: row.assigneeId,
              displayName: requiredName(row.recordedAssigneeName),
              isActive: false,
            };
    const previousAssignee =
      row.assigneeId === null && row.recordedAssigneeId !== null
        ? {
            userId: row.recordedAssigneeId,
            displayName: requiredName(row.recordedAssigneeName),
            isActive: row.recordedActive === 1,
          }
        : null;
    const completedAssignee =
      row.isDone === 1 && row.completedAssigneeId !== null
        ? {
            userId: row.completedAssigneeId,
            displayName: requiredName(row.completedAssigneeName),
            isActive: row.completedActive === 1,
          }
        : null;
    return {
      id: row.id,
      title: row.title,
      completed: row.isDone === 1,
      version: row.version,
      assignee,
      previousAssignee,
      completedAssignee,
    };
  }

  /** 削除済みを除いた進捗（資格の条件つき） */
  const progressQuery = (caseId: string, viewerId: string) =>
    db
      .select({
        total: sql<number>`COUNT(*)`,
        done: sql<number>`COALESCE(SUM(${caseTodos.isDone}), 0)`,
      })
      .from(caseTodos)
      .where(
        and(
          eq(caseTodos.caseId, caseId),
          isNull(caseTodos.deletedAt),
          visibleTo(caseId, viewerId),
        ),
      );

  /** 最大の ID（ID の作り直しの基準） */
  async function maxIdOf(query: Promise<{ id: string | null }[]>) {
    const [row] = await query;
    return row?.id ?? null;
  }

  return {
    /** 一覧：追加した順（ID 昇順）。1つの batch で、案件と資格・項目・進捗を読む。資格がなければ中身を捨てる */
    async listTodos(input: {
      caseId: string;
      viewerId: string;
      limit: number;
      cursor: string | null;
    }): Promise<TodoPage | "not_found" | "not_visible"> {
      const visible = visibleTo(input.caseId, input.viewerId);
      const after =
        input.cursor === null
          ? undefined
          : gt(caseTodos.id, decodeCursor(input.cursor).id);
      const [caseRows, rows, progressRows] = await db.batch([
        db
          .select({
            visible: sql<number>`CASE WHEN ${visible} THEN 1 ELSE 0 END`,
          })
          .from(cases)
          .where(eq(cases.id, input.caseId))
          .limit(1),
        itemRows(
          and(
            eq(caseTodos.caseId, input.caseId),
            isNull(caseTodos.deletedAt),
            visible,
            after,
          ),
        )
          .orderBy(asc(caseTodos.id))
          .limit(input.limit + 1),
        progressQuery(input.caseId, input.viewerId),
      ]);
      const [found] = caseRows;
      if (found === undefined) return "not_found";
      if (found.visible !== 1) return "not_visible";
      const page = toPage(rows, input.limit, (row) => ({
        v: row.id,
        id: row.id,
      }));
      return {
        items: page.items.map(toItem),
        nextCursor: page.nextCursor,
        progress: toProgress(progressRows[0]),
      };
    },

    /** 書き込みの判定の材料を、同じ時点（1つの batch）で読む。TODO・進捗は、操作者が有効な参加者のときだけ読む */
    async findTodoWriteFacts(input: {
      caseId: string;
      actorId: string;
      todoId?: string;
      assigneeId?: string;
    }): Promise<TodoWriteFacts | null> {
      const assigneeId = input.assigneeId;
      // 操作者と担当者の判定は同じ形の式になるため、選択項目に別名を付けて、列の名前を重ねない
      const assigneeIsParticipant = (
        assigneeId === undefined
          ? sql<number | null>`NULL`
          : sql<
              number | null
            >`CASE WHEN ${activeChannelMember(sql`"cases"."channel_id"`, assigneeId)} THEN 1 ELSE 0 END`
      ).as("assignee_is_participant");
      const visible = visibleTo(input.caseId, input.actorId);
      const [caseRows, todoRows, progressRows] = await db.batch([
        db
          .select({
            status: cases.status,
            actorIsParticipant:
              sql<number>`CASE WHEN ${activeChannelMember(sql`"cases"."channel_id"`, input.actorId)} THEN 1 ELSE 0 END`.as(
                "actor_is_participant",
              ),
            assigneeIsParticipant,
          })
          .from(cases)
          .where(eq(cases.id, input.caseId))
          .limit(1),
        db
          .select({
            deletedAt: caseTodos.deletedAt,
            isDone: caseTodos.isDone,
            version: caseTodos.version,
          })
          .from(caseTodos)
          .where(
            and(
              input.todoId === undefined
                ? sql`0 = 1`
                : eq(caseTodos.id, input.todoId),
              eq(caseTodos.caseId, input.caseId),
              visible,
            ),
          )
          .limit(1),
        progressQuery(input.caseId, input.actorId),
      ]);
      const [found] = caseRows;
      if (found === undefined) return null;
      const [todo] = todoRows;
      return {
        status: found.status,
        actorIsParticipant: found.actorIsParticipant === 1,
        todo:
          todo === undefined
            ? null
            : {
                deleted: todo.deletedAt !== null,
                completed: todo.isDone === 1,
                version: todo.version,
              },
        assigneeIsParticipant:
          found.assigneeIsParticipant === null
            ? null
            : found.assigneeIsParticipant === 1,
        progress: toProgress(progressRows[0]),
      };
    },

    /** 案件の TODO の最大の ID（削除済みを含む） */
    maxTodoId(caseId: string): Promise<string | null> {
      return maxIdOf(
        db
          .select({ id: sql<string | null>`MAX(${caseTodos.id})` })
          .from(caseTodos)
          .where(eq(caseTodos.caseId, caseId)),
      );
    },

    /** TODO の記録の最大の ID */
    maxEventId(todoId: string): Promise<string | null> {
      return maxIdOf(
        db
          .select({ id: sql<string | null>`MAX(${caseTodoEvents.id})` })
          .from(caseTodoEvents)
          .where(eq(caseTodoEvents.todoId, todoId)),
      );
    },

    /**
     * 追加：前提 → TODO の挿入 → 確認 → 記録 create → 確認 → 項目と進捗の読み取り。
     * 前提：進行中・操作者が有効な参加者・担当者（指定したとき）が有効な参加者。崩れたら CaseStateChangedError で、何も残さない
     */
    async addTodo(
      input: TodoAddInput,
    ): Promise<{ item: TodoItem; progress: TodoProgress }> {
      const assigneeOk =
        input.assigneeId === null
          ? sql`1 = 1`
          : activeChannelMember(K_ROOM, input.assigneeId);
      const condition = activeCaseWith(
        input.caseId,
        sql`${activeChannelMember(K_ROOM, input.actorId)} AND ${assigneeOk}`,
      );
      const assigneeName =
        input.assigneeId === null
          ? sql`NULL`
          : sql`(SELECT an.display_name FROM users an WHERE an.id = ${input.assigneeId})`;
      const now = new Date().toISOString();
      const [, , , , , rows, progressRows] = await runWriteBatch(() =>
        db.batch([
          assertStatement(db, input.caseId, condition),
          db.insert(caseTodos).select(
            sql`SELECT ${input.todoId}, ${input.caseId}, ${input.title}, ${input.assigneeId}, ${input.assigneeId}, ${assigneeName},
                NULL, NULL, 0, 1, ${input.actorId}, ${now}, ${now}, NULL, NULL
                WHERE ${condition}
                  AND NOT EXISTS (SELECT 1 FROM case_todos ot WHERE ot.case_id = ${input.caseId} AND ot.id >= ${input.todoId})`,
          ),
          guardChanges(db, input.caseId, ONE),
          db.insert(caseTodoEvents).select(
            sql`SELECT ${input.eventId}, ct.id, ct.case_id, 'create', ${input.actorId}, ct.title, NULL,
                ct.assignee_id, ct.recorded_assignee_name, NULL, NULL, ${now}
                FROM case_todos ct WHERE ct.id = ${input.todoId} AND ct.case_id = ${input.caseId} AND ${condition}`,
          ),
          guardChanges(db, input.caseId, ONE),
          itemRows(
            and(
              eq(caseTodos.id, input.todoId),
              visibleTo(input.caseId, input.actorId),
            ),
          ).limit(1),
          progressQuery(input.caseId, input.actorId),
        ]),
      );
      const [row] = rows;
      // 案件の行がないと、前提・確認の UPDATE は0行で失敗しないため、結果の行で確かめる
      if (row === undefined) throw new CaseStateChangedError();
      return { item: toItem(row), progress: toProgress(progressRows[0]) };
    },

    /**
     * 完了：前提 → 記録 complete（完了の時点の担当と表示名）→ 確認 → TODO の更新 → 確認 → 進捗。
     * 記録を先に置くのは、状態の条件（未完了）が更新の後には偽になるため。前提：進行中・操作者が有効な参加者・TODO がその案件の未削除・未完了
     */
    async completeTodo(
      input: TodoStateInput,
    ): Promise<{ version: number; progress: TodoProgress }> {
      const condition = activeCaseWith(
        input.caseId,
        sql`${activeChannelMember(K_ROOM, input.actorId)}
          AND ${liveTodoWith(input.todoId, sql`t.is_done = 0`)}`,
      );
      const now = new Date().toISOString();
      const [, , , updated, , progressRows] = await runWriteBatch(() =>
        db.batch([
          assertStatement(db, input.caseId, condition),
          db.insert(caseTodoEvents).select(
            sql`SELECT ${input.eventId}, ct.id, ct.case_id, 'complete', ${input.actorId}, NULL, NULL,
                ct.assignee_id, (SELECT cn.display_name FROM users cn WHERE cn.id = ct.assignee_id), NULL, NULL, ${now}
                FROM case_todos ct WHERE ct.id = ${input.todoId} AND ${condition}
                  AND NOT EXISTS (SELECT 1 FROM case_todo_events oe WHERE oe.todo_id = ${input.todoId} AND oe.id >= ${input.eventId})`,
          ),
          guardChanges(db, input.caseId, ONE),
          db
            .update(caseTodos)
            .set({
              isDone: 1,
              completedAssigneeId: sql`"case_todos"."assignee_id"`,
              completedAssigneeName: sql`(SELECT cn.display_name FROM users cn WHERE cn.id = "case_todos"."assignee_id")`,
              version: sql`${caseTodos.version} + 1`,
              updatedAt: now,
            })
            .where(and(eq(caseTodos.id, input.todoId), condition))
            .returning({ version: caseTodos.version }),
          guardChanges(db, input.caseId, ONE),
          progressQuery(input.caseId, input.actorId),
        ]),
      );
      const [row] = updated;
      if (row === undefined) throw new CaseStateChangedError();
      return { version: row.version, progress: toProgress(progressRows[0]) };
    },

    /**
     * 完了の取り消し：前提 → 記録 auto_unassign（担当者がいま有効な参加者でないときだけ）→ 確認 → 記録 uncomplete → 確認 → TODO の更新 → 確認 → 進捗。
     * 担当者が外れていれば、現在の担当を NULL にする（担当した時点の人と名前は残す。計画 6.9(2)）。外れた担当は記録の assignee_* に入れる
     */
    async uncompleteTodo(
      input: TodoUncompleteInput,
    ): Promise<{ version: number; progress: TodoProgress }> {
      const condition = activeCaseWith(
        input.caseId,
        sql`${activeChannelMember(K_ROOM, input.actorId)}
          AND ${liveTodoWith(input.todoId, sql`t.is_done = 1`)}`,
      );
      const room = sql`(SELECT kr.channel_id FROM cases kr WHERE kr.id = ${input.caseId})`;
      const assigneeGone = (assignee: SQL) =>
        sql`(${assignee} IS NOT NULL AND NOT ${activeChannelMember(room, assignee)})`;
      const noLaterEvent = (eventId: string) =>
        sql`NOT EXISTS (SELECT 1 FROM case_todo_events oe WHERE oe.todo_id = ${input.todoId} AND oe.id >= ${eventId})`;
      const now = new Date().toISOString();
      const [, , , , , updated, , progressRows] = await runWriteBatch(() =>
        db.batch([
          assertStatement(db, input.caseId, condition),
          db.insert(caseTodoEvents).select(
            sql`SELECT ${input.autoUnassignEventId}, ct.id, ct.case_id, 'auto_unassign', ${input.actorId}, NULL, NULL,
                ct.assignee_id, ct.recorded_assignee_name, NULL, NULL, ${now}
                FROM case_todos ct WHERE ct.id = ${input.todoId} AND ${condition}
                  AND ${assigneeGone(sql`ct.assignee_id`)} AND ${noLaterEvent(input.autoUnassignEventId)}`,
          ),
          guardChanges(
            db,
            input.caseId,
            sql`(SELECT CASE WHEN ${assigneeGone(sql`gt.assignee_id`)} THEN 1 ELSE 0 END FROM case_todos gt WHERE gt.id = ${input.todoId})`,
          ),
          db.insert(caseTodoEvents).select(
            sql`SELECT ${input.eventId}, ct.id, ct.case_id, 'uncomplete', ${input.actorId}, NULL, NULL,
                NULL, NULL, NULL, NULL, ${now}
                FROM case_todos ct WHERE ct.id = ${input.todoId} AND ${condition} AND ${noLaterEvent(input.eventId)}`,
          ),
          guardChanges(db, input.caseId, ONE),
          db
            .update(caseTodos)
            .set({
              isDone: 0,
              assigneeId: sql`CASE WHEN ${assigneeGone(sql`"case_todos"."assignee_id"`)} THEN NULL ELSE "case_todos"."assignee_id" END`,
              completedAssigneeId: null,
              completedAssigneeName: null,
              version: sql`${caseTodos.version} + 1`,
              updatedAt: now,
            })
            .where(and(eq(caseTodos.id, input.todoId), condition))
            .returning({ version: caseTodos.version }),
          guardChanges(db, input.caseId, ONE),
          progressQuery(input.caseId, input.actorId),
        ]),
      );
      const [row] = updated;
      if (row === undefined) throw new CaseStateChangedError();
      return { version: row.version, progress: toProgress(progressRows[0]) };
    },
  };
}

/** 担当の名前の列は、CHECK で ID と対になっている。ないのは表の不変条件が崩れたとき */
function requiredName(name: string | null): string {
  if (name === null) throw new Error("TODO の担当の名前がありません");
  return name;
}

export type CaseTodoRepository = ReturnType<typeof createCaseTodoRepository>;

export function withCaseTodos<T>(
  env: Env,
  run: (
    repository: CaseTodoRepository,
    roles: RoleAssignmentRepository,
  ) => Promise<T>,
): Promise<T> {
  return withDatabase(env, (db) =>
    run(createCaseTodoRepository(db), createRoleAssignmentRepository(db)),
  );
}
