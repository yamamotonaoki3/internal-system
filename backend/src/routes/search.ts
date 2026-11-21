// Controller（ルート）：メッセージの検索（GET /api/search/messages。EP-4-01）と案件の検索（GET /api/search/cases。EP-4-02）。#155。
// 入力の形の確認（422）と応答だけを行う。権限と見える範囲は Service・Repository が判定する。検索語はログに出さない。
// 認証と送信元の確認（originCheck）は app.ts が /api/* に一括で適用する。GET は状態を変えない。回数の制限は作らない（D-7）。
import { Hono } from "hono";
import { z } from "zod";
import { searchKeywordSchema } from "../../../shared/search-rules";
import { actorOf } from "../lib/actor";
import { cursorQuerySchema, PAGE_LIMIT } from "../lib/cursor";
import { noStore } from "../lib/security";
import { isUlid } from "../lib/ulid";
import { validate } from "../lib/validation";
import { withSearchService } from "../services/search.service";
import { jstDateSchema } from "./audit-logs";

/** 1ページの件数の上限（EP-4-01） */
const SEARCH_PAGE_MAX = 50;

// FTS5 は句の途中の NUL を文字列の終わりとして扱うため、検索の API だけ NUL を拒否する（共通の規則は変えない）
const searchTermSchema = searchKeywordSchema.refine(
  (value) => !value.includes("\u0000"),
);

const searchQuerySchema = cursorQuerySchema({
  defaultLimit: PAGE_LIMIT.default,
})
  .extend({
    q: searchTermSchema,
    roomId: z.string().refine(isUlid).optional(),
    from: jstDateSchema.optional(),
    to: jstDateSchema.optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(SEARCH_PAGE_MAX)
      .default(PAGE_LIMIT.default),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.from !== undefined &&
      value.to !== undefined &&
      value.from > value.to
    )
      ctx.addIssue({
        code: "custom",
        path: ["to"],
        message: "終了日は開始日以降にしてください",
      });
  });

/** EP-4-02 のクエリ。limit は一覧の決まり（1〜100・既定 20） */
const caseSearchQuerySchema = cursorQuerySchema({
  defaultLimit: PAGE_LIMIT.default,
})
  .extend({ q: searchTermSchema })
  .strict();

export function searchRoutes() {
  return new Hono<{ Bindings: Env }>()
    .get(
      "/messages",
      noStore,
      validate("query", searchQuerySchema),
      async (c) => {
        const actor = actorOf(c);
        const { q, limit, cursor, roomId, from, to } = c.req.valid("query");
        const page = await withSearchService(c.env, actor, (service) =>
          service.searchMessages(actor, {
            q,
            limit,
            ...(cursor === undefined ? {} : { cursor }),
            ...(roomId === undefined ? {} : { roomId }),
            ...(from === undefined ? {} : { from }),
            ...(to === undefined ? {} : { to }),
          }),
        );
        return c.json(page);
      },
    )
    .get(
      "/cases",
      noStore,
      validate("query", caseSearchQuerySchema),
      async (c) => {
        const actor = actorOf(c);
        const { q, limit, cursor } = c.req.valid("query");
        const page = await withSearchService(c.env, actor, (service) =>
          service.searchCases(actor, {
            q,
            limit,
            ...(cursor === undefined ? {} : { cursor }),
          }),
        );
        return c.json(page);
      },
    );
}
