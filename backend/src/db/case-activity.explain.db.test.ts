// #148（148-C）計画 148-C「SQL」：案件の一覧・概要の lastActivityAt（案件ごとの副問い合わせ）が、索引 messages_room_id_id_idx を使い、
// メッセージの表を索引なしで全件走査（SCAN）しないことを、隔離 D1 の EXPLAIN QUERY PLAN で確かめる（先例：case-todo.explain.db.test.ts）。
// あわせて、副問い合わせの部屋の条件が、外側の案件の行（"cases"."channel_id"）を指すことを、実行した SQL の文で確かめる（#294）。
// 方法：実行した SQL と値を記録する D1 を Repository に渡して呼び、記録した文のうちメッセージの表を読むものを EXPLAIN QUERY PLAN にかける。
//   表の別名は、記録した SQL の文から読み取る（実装の別名に依存しない）。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../db/schema";
import {
  cleanupCaseRoomWorld,
  seedRoomMessage,
  seedRoomReply,
  setupCaseRoomWorld,
  type CaseRoomWorld,
} from "../../test/case-room-fixtures";
import { createCaseRepository } from "./case.repository";

type Recorded = { sql: string; params: unknown[] };

/** 実行した SQL（prepare）と値（bind）を記録する D1 */
function recordingDb(statements: Recorded[]): D1Database {
  return new Proxy(env.DB, {
    get(target, prop) {
      if (prop === "prepare")
        return (query: string) => {
          const entry: Recorded = { sql: query, params: [] };
          statements.push(entry);
          const prepared = target.prepare(query);
          return new Proxy(prepared, {
            get(stmt, key) {
              if (key === "bind")
                return (...values: unknown[]) => {
                  entry.params = values;
                  return stmt.bind(...values);
                };
              const value: unknown = Reflect.get(stmt, key, stmt);
              return typeof value === "function" ? value.bind(stmt) : value;
            },
          });
        };
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

const dbOf = (statements: Recorded[]) =>
  drizzle(recordingDb(statements), { schema });

const KEYWORDS = new Set([
  "where",
  "on",
  "inner",
  "left",
  "join",
  "order",
  "group",
  "limit",
  "set",
  "select",
  "values",
  "and",
  "or",
]);

/** messages の表の名前と、SQL の中で付けた別名 */
function messageNamesOf(sqlText: string): string[] {
  const names = new Set(["messages"]);
  for (const match of sqlText.matchAll(
    /"?messages"?\s+(?:as\s+)?"?([a-z_][a-z0-9_]*)"?/gi,
  )) {
    const alias = match[1]?.toLowerCase();
    if (alias !== undefined && !KEYWORDS.has(alias)) names.add(alias);
  }
  return [...names];
}

async function planOf(statement: Recorded): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `EXPLAIN QUERY PLAN ${statement.sql}`,
  )
    .bind(...statement.params)
    .all<{ detail: string }>();
  return results.map((r) => r.detail);
}

const readsMessages = (s: Recorded) => /\bmessages\b/i.test(s.sql);

let cw: CaseRoomWorld;

beforeEach(async () => {
  cw = await setupCaseRoomWorld(1560);
  const top = await seedRoomMessage(cw.open.roomId, cw.w.memberS1.id, 10);
  await seedRoomReply(cw.open.roomId, top, cw.w.memberD1.id, 11);
  await seedRoomMessage(cw.other.roomId, cw.w.memberS2.id, 12);
  await seedRoomMessage(cw.normal, cw.w.memberS1.id, 13);
});

afterEach(async () => {
  await cleanupCaseRoomWorld();
});

async function recordListAndSummary(): Promise<Recorded[]> {
  const statements: Recorded[] = [];
  const repository = createCaseRepository(dbOf(statements));
  await repository.list({
    actorId: cw.w.memberS1.id,
    scope: "all",
    status: "active",
    limit: 20,
  });
  await repository.findSummary({
    actorId: cw.w.memberS1.id,
    caseId: cw.open.id,
  });
  return statements;
}

describe("#148 148-C 計画「SQL」実行計画（EXPLAIN QUERY PLAN）", () => {
  it("#148 148-C: 一覧・概要の最終更新は、messages_room_id_id_idx を使い、messages を全件走査しない", async () => {
    const statements = (await recordListAndSummary()).filter(readsMessages);
    // 一覧と概要の2文（どちらも案件の行と同じ文の中で最終更新を読む）
    expect(statements.length, "messages を読む文").toBeGreaterThanOrEqual(2);
    let usedIndex = 0;
    for (const statement of statements) {
      const plan = await planOf(statement);
      const names = messageNamesOf(statement.sql);
      for (const detail of plan) {
        const scanned = /^SCAN (\S+)/.exec(detail)?.[1]?.replace(/"/g, "");
        if (scanned !== undefined && names.includes(scanned.toLowerCase()))
          expect(
            /USING (COVERING )?INDEX/.test(detail),
            `messages を全件走査している：${detail}\n${statement.sql}\n${plan.join("\n")}`,
          ).toBe(true);
      }
      if (plan.some((d) => d.includes("messages_room_id_id_idx")))
        usedIndex += 1;
    }
    expect(
      usedIndex,
      "messages_room_id_id_idx を使う文",
    ).toBeGreaterThanOrEqual(2);
  });

  it('#148 148-C #294: 最終更新の副問い合わせの部屋の条件は、外側の案件の行（"cases"."channel_id"）を指し、内側のメッセージの表には別名を付ける', async () => {
    const statements = (await recordListAndSummary()).filter(readsMessages);
    expect(statements.length).toBeGreaterThanOrEqual(2);
    for (const statement of statements) {
      // 例：FROM messages m WHERE m.room_id = "cases"."channel_id"（別名は何でもよい）
      const match =
        /from\s+"?messages"?\s+(?:as\s+)?"?([a-z_][a-z0-9_]*)"?\s+where\s+[\s\S]*?"?\1"?\."?room_id"?\s*=\s*"cases"\."channel_id"/i.exec(
          statement.sql,
        );
      expect(match, statement.sql).not.toBeNull();
      expect(KEYWORDS.has(match?.[1]?.toLowerCase() ?? "where")).toBe(false);
    }
  });
});
