// Controller：案件の TODO（/api/cases/:caseId/todos。#149 の 149-A・149-B。EP-5-13・14・15・16・17・18）。
// 入力の形の確認（422）と応答だけを行い、参加の判定・認可・判定の順は Service が行う。
// 追加の本文は、ここでは JSON として読めることだけを確かめ、オブジェクトであることを含めた形は Service が 403 までの判定の後に確かめる
// （非参加者に、本文の誤りと他の理由を区別させない。存在の非開示）。
// 認証と送信元の確認（originCheck）は app.ts が /api/* に一括で適用する。
import { Hono, type Context } from "hono";
import { z } from "zod";
import { AppError } from "../lib/app-error";
import { cursorQuerySchema, PAGE_LIMIT } from "../lib/cursor";
import { noStore } from "../lib/security";
import { traceIdOf } from "../lib/trace-id";
import { isUlid } from "../lib/ulid";
import { validate } from "../lib/validation";
import {
  withCaseTodoService,
  type CaseTodoActor,
} from "../services/case-todo.service";

// 1回 100 件（決定 Q4）。cursor の形はここで確かめる（壊れていれば 422）
const listQuerySchema = cursorQuerySchema({
  defaultLimit: PAGE_LIMIT.max,
}).strict();
const caseParamSchema = z.object({ caseId: z.string().refine(isUlid) });
const todoParamSchema = caseParamSchema.extend({
  todoId: z.string().refine(isUlid),
});
const bodyEnvelopeSchema = z.unknown();

function actorOf(c: Context<{ Bindings: Env }>): CaseTodoActor {
  const principal = c.get("principal");
  if (principal === null) {
    throw new AppError("UNAUTHENTICATED", "ログインしてください");
  }
  return { userId: principal.userId, traceId: traceIdOf(c) };
}

export function caseTodoRoutes() {
  return (
    new Hono<{ Bindings: Env }>()
      .get(
        "/:caseId/todos",
        noStore,
        validate("param", caseParamSchema),
        validate("query", listQuerySchema),
        async (c) => {
          const actor = actorOf(c);
          const { limit } = c.req.valid("query");
          // Service は検証済みのカーソルを、文字列のまま Repository に渡す（Repository が復元する）
          const cursor = c.req.query("cursor") ?? null;
          const page = await withCaseTodoService(c.env, (service) =>
            service.listTodos(actor, c.req.valid("param").caseId, {
              limit,
              cursor,
            }),
          );
          return c.json(page);
        },
      )
      .post(
        "/:caseId/todos",
        noStore,
        validate("param", caseParamSchema),
        validate("json", bodyEnvelopeSchema),
        async (c) => {
          const actor = actorOf(c);
          const added = await withCaseTodoService(c.env, (service) =>
            service.addTodo(
              actor,
              c.req.valid("param").caseId,
              c.req.valid("json"),
            ),
          );
          return c.json(added, 201);
        },
      )
      .patch(
        "/:caseId/todos/:todoId",
        noStore,
        validate("param", todoParamSchema),
        validate("json", bodyEnvelopeSchema),
        async (c) => {
          const actor = actorOf(c);
          const { caseId, todoId } = c.req.valid("param");
          const edited = await withCaseTodoService(c.env, (service) =>
            service.editTodo(actor, caseId, todoId, c.req.valid("json")),
          );
          return c.json(edited);
        },
      )
      // 削除は本文を受け取らない（版は送らない。決定 Q2）
      .delete(
        "/:caseId/todos/:todoId",
        noStore,
        validate("param", todoParamSchema),
        async (c) => {
          const actor = actorOf(c);
          const { caseId, todoId } = c.req.valid("param");
          await withCaseTodoService(c.env, (service) =>
            service.deleteTodo(actor, caseId, todoId),
          );
          return c.body(null, 204);
        },
      )
      .post(
        "/:caseId/todos/:todoId/complete",
        noStore,
        validate("param", todoParamSchema),
        async (c) => {
          const actor = actorOf(c);
          const { caseId, todoId } = c.req.valid("param");
          const changed = await withCaseTodoService(c.env, (service) =>
            service.completeTodo(actor, caseId, todoId),
          );
          return c.json(changed);
        },
      )
      .post(
        "/:caseId/todos/:todoId/uncomplete",
        noStore,
        validate("param", todoParamSchema),
        async (c) => {
          const actor = actorOf(c);
          const { caseId, todoId } = c.req.valid("param");
          const changed = await withCaseTodoService(c.env, (service) =>
            service.uncompleteTodo(actor, caseId, todoId),
          );
          return c.json(changed);
        },
      )
  );
}
