// Service：案件の TODO（#149 の 149-A）の業務ルール。HTTP を知らない。
// 判定の順（計画 149-A 6.3。変えない）：
//   一覧：案件がない（404）→ 有効な参加者でない（403）→ perm.case.view → 読み取り（資格を SQL に入れる。資格がなければ 403）
//   追加：404 → 403 → perm.case.todo.edit → 本文の形・題名（422）→ 担当者が有効な参加者でない（422。いない・無効・非参加で同じ文）
//     → 終了中（409 closed）→ batch
//   完了・取り消し：404 → 403 → perm.case.todo.edit → TODO がない・ほかの案件の TODO（404）→ 削除済み（409 todo_deleted）
//     → 終了中（409 closed）→ すでにその状態なら何も書かずに 200（決定 Q3）→ batch
// 非参加者（全体管理者・担当部署のオーナーを含む。R-76）には、TODO の有無・本文の誤り・案件の状態を区別させない（403 が先）。
// batch が取り消されたら（CaseStateChangedError）、最初と同じ判定で読み直す。理由に当たればそれを返し、すでにその状態なら 200。
// どれにも当たらなければ ID の順の逆転とみなし、確定済みの最大より大きい ID で作り直して batch 全体をやり直す（計画 6.9(3)・6.10）。
// TODO の操作は監査ログに残さない（決定 Q2。TODO の記録の表に残す）。404・403 の拒否は logger.audit に残す。再認証は求めない。
import { z } from "zod";
import { caseTodoTitleSchema } from "../../../shared/case-todo-rules";
import { CaseStateChangedError } from "../db/case.repository";
import {
  withCaseTodos,
  type CaseTodoRepository,
  type TodoProgress,
  type TodoWriteFacts,
} from "../db/case-todo.repository";
import type { RoleAssignmentRepository } from "../db/role-assignment.repository";
import { AppError } from "../lib/app-error";
import { createLogger } from "../lib/logger/logger";
import type { Permission } from "../lib/permissions";
import { isUlid, newUlid, ulidAfter } from "../lib/ulid";
import { createAppAuthorizer } from "./authorizer";

export type CaseTodoActor = { userId: string; traceId: string };

/** ID の作り直しの上限（最初の1回に加えて）。メッセージの作り直しと同じ回数 */
const MAX_ID_RETRIES = 3;

/** 画面はこの文言をそのまま出す */
const NOT_FOUND_MESSAGE = "案件が見つかりません";
const PARTICIPANTS_ONLY_MESSAGE = "参加者だけが見られます（非公開）";
const PARTICIPANTS_ONLY_TO_EDIT_MESSAGE = "参加者だけが操作できます";
const TODO_NOT_FOUND_MESSAGE = "TODOが見つかりません";
const VALIDATION_MESSAGE = "入力内容を確かめてください";
/** 担当者がいない・無効・非参加のどれでも同じ本文にする（社員の有無・状態を本文の違いで明かさない） */
const ASSIGNEE_INVALID_MESSAGE = "担当者は、この案件の参加者から選んでください";
const BUSY_MESSAGE = "混み合っています。しばらくしてからもう一度お試しください";

export type CaseTodoConflictReason = "closed" | "todo_deleted";

const CONFLICT_MESSAGES: Record<CaseTodoConflictReason, string> = {
  closed: "終了した案件は変更できません",
  todo_deleted: "このTODOは削除されています",
};

type TodoAction =
  | "case.todo.view"
  | "case.todo.add"
  | "case.todo.complete"
  | "case.todo.uncomplete";

const addBodySchema = z
  .object({
    title: caseTodoTitleSchema,
    assigneeUserId: z.string().refine(isUlid).nullable().optional(),
  })
  .strict();

/** 判定の結果。deny は logger.audit に残す（404・403）。null は通ること */
type Decision =
  | { kind: "deny"; reason: string; error: AppError }
  | { kind: "error"; error: AppError }
  | null;

const conflict = (reason: CaseTodoConflictReason): Decision => ({
  kind: "error",
  error: new AppError("CONFLICT", CONFLICT_MESSAGES[reason], { reason }),
});

/** 403 までの判定（閲覧と書き込みで、403 の文言だけが違う） */
function decideGate(
  facts: TodoWriteFacts | null,
  forbiddenMessage: string,
): Decision {
  if (facts === null)
    return {
      kind: "deny",
      reason: "not_found",
      error: new AppError("NOT_FOUND", NOT_FOUND_MESSAGE),
    };
  if (!facts.actorIsParticipant)
    return {
      kind: "deny",
      reason: "not_participant",
      error: new AppError("FORBIDDEN", forbiddenMessage),
    };
  return null;
}

const decideWriteGate = (facts: TodoWriteFacts | null) =>
  decideGate(facts, PARTICIPANTS_ONLY_TO_EDIT_MESSAGE);

/** 403 までの判定を通った材料（案件がある）。判定で null を除いた後にだけ呼ぶ */
function present(facts: TodoWriteFacts | null): TodoWriteFacts {
  if (facts === null)
    throw new Error("案件の材料がありません（404 の判定の前に呼ばれました）");
  return facts;
}

/** 追加の、本文の検証の後の判定 */
function decideAdd(facts: TodoWriteFacts): Decision {
  if (facts.assigneeIsParticipant === false)
    return {
      kind: "error",
      error: new AppError("VALIDATION_ERROR", ASSIGNEE_INVALID_MESSAGE, {
        fields: ["assigneeUserId"],
      }),
    };
  return facts.status === "active" ? null : conflict("closed");
}

type StateResult = { version: number; progress: TodoProgress };

/** 完了・取り消しの、認可の後の判定。すでに求める状態なら、何も書かずにその時点の版と進捗を結果にする（決定 Q3） */
function decideState(
  facts: TodoWriteFacts,
  completed: boolean,
): Decision | { result: StateResult } {
  const todo = facts.todo;
  if (todo === null)
    return {
      kind: "deny",
      reason: "todo_not_found",
      error: new AppError("NOT_FOUND", TODO_NOT_FOUND_MESSAGE),
    };
  if (todo.deleted) return conflict("todo_deleted");
  if (facts.status !== "active") return conflict("closed");
  if (todo.completed === completed)
    return { result: { version: todo.version, progress: facts.progress } };
  return null;
}

function parseAddBody(body: unknown) {
  const parsed = addBodySchema.safeParse(body);
  if (!parsed.success)
    throw new AppError("VALIDATION_ERROR", VALIDATION_MESSAGE, {
      fields: [
        ...new Set(parsed.error.issues.map((issue) => issue.path.join("."))),
      ],
    });
  return {
    title: parsed.data.title,
    assigneeId: parsed.data.assigneeUserId ?? null,
  };
}

/** 次に使う ID：確定済みの最大より大きいもの（なければ新しい ID） */
const idAfter = (max: string | null) =>
  max === null ? newUlid() : ulidAfter(max);

export function withCaseTodoService<T>(
  env: Env,
  run: (service: ReturnType<typeof createCaseTodoService>) => Promise<T>,
): Promise<T> {
  return withCaseTodos(env, (repository, roles) =>
    run(createCaseTodoService(repository, roles)),
  );
}

export function createCaseTodoService(
  repository: CaseTodoRepository,
  roles: RoleAssignmentRepository,
) {
  const loggerOf = (actor: CaseTodoActor) =>
    createLogger({ traceId: actor.traceId, userId: actor.userId });

  async function authorize(
    actor: CaseTodoActor,
    permission: Permission,
  ): Promise<void> {
    await createAppAuthorizer(roles, { logger: loggerOf(actor) }).authorize(
      { userId: actor.userId },
      permission,
      { type: "company" },
    );
  }

  function deny(
    actor: CaseTodoActor,
    action: TodoAction,
    caseId: string,
    reason: string,
    error: AppError,
  ): never {
    loggerOf(actor).audit(action, caseId, "failure", { reason });
    throw error;
  }

  /** 判定が理由を返したら投げる（404・403 は logger.audit に残す） */
  function raiseIf(
    actor: CaseTodoActor,
    action: TodoAction,
    caseId: string,
    decision: Decision,
  ): void {
    if (decision === null) return;
    if (decision.kind === "deny")
      deny(actor, action, caseId, decision.reason, decision.error);
    throw decision.error;
  }

  /**
   * batch を、取り消されたら読み直して、ID の順の逆転なら作り直してやり直す。
   * redecide が値を返したら（すでに求める状態）、それを結果にする。理由に当たれば raiseIf が投げる
   */
  async function writeWithRetry<T>(
    actor: CaseTodoActor,
    action: TodoAction,
    caseId: string,
    write: () => Promise<T>,
    redecide: () => Promise<Decision | { result: T }>,
    renewIds: () => Promise<void>,
  ): Promise<T> {
    for (let retry = 0; ; retry += 1) {
      try {
        return await write();
      } catch (error) {
        if (!(error instanceof CaseStateChangedError)) throw error;
        const decision = await redecide();
        if (decision !== null && "result" in decision) return decision.result;
        raiseIf(actor, action, caseId, decision);
        if (retry >= MAX_ID_RETRIES) break;
        await renewIds();
      }
    }
    loggerOf(actor).warn("TODO・記録の ID の作り直しが上限を超えた", {
      caseId,
    });
    throw new AppError("SERVICE_UNAVAILABLE", BUSY_MESSAGE);
  }

  /** 完了・取り消しの共通の流れ */
  async function changeState(
    actor: CaseTodoActor,
    caseId: string,
    todoId: string,
    completed: boolean,
  ): Promise<{ id: string; completed: boolean } & StateResult> {
    const action = completed ? "case.todo.complete" : "case.todo.uncomplete";
    const decide = async () => {
      const facts = await repository.findTodoWriteFacts({
        caseId,
        actorId: actor.userId,
        todoId,
      });
      return decideWriteGate(facts) ?? decideState(present(facts), completed);
    };
    const first = await repository.findTodoWriteFacts({
      caseId,
      actorId: actor.userId,
      todoId,
    });
    raiseIf(actor, action, caseId, decideWriteGate(first));
    await authorize(actor, "perm.case.todo.edit");
    const decision = decideState(present(first), completed);
    if (decision !== null && "result" in decision)
      return { id: todoId, completed, ...decision.result };
    raiseIf(actor, action, caseId, decision);

    // 取り消しの記録は2件（auto_unassign → uncomplete）になりうるので、ID を2つ昇順に用意する
    let autoUnassignEventId = newUlid();
    let eventId = newUlid();
    const result = await writeWithRetry(
      actor,
      action,
      caseId,
      () =>
        completed
          ? repository.completeTodo({
              caseId,
              actorId: actor.userId,
              todoId,
              eventId,
            })
          : repository.uncompleteTodo({
              caseId,
              actorId: actor.userId,
              todoId,
              eventId,
              autoUnassignEventId,
            }),
      decide,
      async () => {
        autoUnassignEventId = idAfter(await repository.maxEventId(todoId));
        eventId = ulidAfter(autoUnassignEventId);
      },
    );
    return { id: todoId, completed, ...result };
  }

  return {
    /** 一覧（EP-5-13）。cursor は検証済みの文字列（route が形を確かめる） */
    async listTodos(
      actor: CaseTodoActor,
      caseId: string,
      options: { limit: number; cursor: string | null },
    ) {
      const action = "case.todo.view";
      const facts = await repository.findTodoWriteFacts({
        caseId,
        actorId: actor.userId,
      });
      raiseIf(
        actor,
        action,
        caseId,
        decideGate(facts, PARTICIPANTS_ONLY_MESSAGE),
      );
      await authorize(actor, "perm.case.view");
      // 認可の後に無効化・参加の解除が確定した場合に備え、読み取りそのものに資格を入れている
      const page = await repository.listTodos({
        caseId,
        viewerId: actor.userId,
        ...options,
      });
      if (page === "not_found")
        deny(
          actor,
          action,
          caseId,
          "not_found",
          new AppError("NOT_FOUND", NOT_FOUND_MESSAGE),
        );
      if (page === "not_visible")
        deny(
          actor,
          action,
          caseId,
          "not_participant",
          new AppError("FORBIDDEN", PARTICIPANTS_ONLY_MESSAGE),
        );
      return page;
    },

    /** 追加（EP-5-14）。body は検証前の本文（403 までの判定の後に形を確かめる。存在の非開示） */
    async addTodo(actor: CaseTodoActor, caseId: string, body: unknown) {
      const action = "case.todo.add";
      const gate = await repository.findTodoWriteFacts({
        caseId,
        actorId: actor.userId,
      });
      raiseIf(actor, action, caseId, decideWriteGate(gate));
      await authorize(actor, "perm.case.todo.edit");
      const { title, assigneeId } = parseAddBody(body);
      const decide = async (): Promise<Decision> => {
        const facts = await repository.findTodoWriteFacts({
          caseId,
          actorId: actor.userId,
          ...(assigneeId === null ? {} : { assigneeId }),
        });
        return decideWriteGate(facts) ?? decideAdd(present(facts));
      };
      raiseIf(actor, action, caseId, await decide());
      let todoId = newUlid();
      let eventId = newUlid();
      const added = await writeWithRetry(
        actor,
        action,
        caseId,
        () =>
          repository.addTodo({
            caseId,
            actorId: actor.userId,
            todoId,
            eventId,
            title,
            assigneeId,
          }),
        decide,
        async () => {
          todoId = idAfter(await repository.maxTodoId(caseId));
          eventId = newUlid();
        },
      );
      return { ...added.item, progress: added.progress };
    },

    /** 完了（EP-5-17） */
    completeTodo(actor: CaseTodoActor, caseId: string, todoId: string) {
      return changeState(actor, caseId, todoId, true);
    },

    /** 完了の取り消し（EP-5-18） */
    uncompleteTodo(actor: CaseTodoActor, caseId: string, todoId: string) {
      return changeState(actor, caseId, todoId, false);
    },
  };
}
