// #139 AC-2：編集の書き込み（updateBodyIfModifiable）の batch が失敗したときの扱い。
// 条件が偽になった合図（messages.body の NOT NULL 違反）だけを「0行の更新」にし、未知のDBエラーはもみ消さず元のまま投げ直す
// （AGENTS.md「エラーの扱い」、project-rules の batch の決まり）。DBは隔離D1。batch の失敗は spy で再現し、実データは作らない。
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../db/schema";
import { testId } from "../../test/role-fixtures";
import { updateBodyIfModifiable } from "./message-modify.sql";

const input = () => ({
  messageId: testId("MSG"),
  userId: testId("USER"),
  roomId: testId("ROOM"),
  body: "[UNIT_TEST]本文",
  editedAt: "2026-11-16T00:00:00.000Z",
  mentions: [],
});

/** 外側のエラーから cause を depth 回たどった先に、元のエラーを置く */
function nested(message: string, depth: number): Error {
  let error = new Error(message);
  for (let level = 0; level < depth; level += 1)
    error = new Error(`D1_ERROR: wrapped ${level}`, { cause: error });
  return error;
}

const run = (failure: unknown) => {
  const db = drizzle(env.DB, { schema });
  vi.spyOn(db, "batch").mockRejectedValue(failure);
  return updateBodyIfModifiable(db, input()).then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("#139 AC-2 編集の batch の失敗の扱い", () => {
  it.each([0, 1, 4])(
    "#139 AC-2: 条件が偽の合図（messages.body の NOT NULL 違反）は、cause を %s 段たどった先でも0行として返す",
    async (depth) => {
      const result = await run(
        nested("NOT NULL constraint failed: messages.body", depth),
      );
      expect(result).toEqual({ value: 0 });
    },
  );

  it("#139 AC-2: 合図が cause を5段たどった先にあるときは、見つけず元のエラーを投げ直す", async () => {
    const failure = nested("NOT NULL constraint failed: messages.body", 5);
    expect(await run(failure)).toEqual({ error: failure });
  });

  it.each([
    "NOT NULL constraint failed: messages.sender_id",
    "NOT NULL constraint failed: message_mentions.user_id",
    "UNIQUE constraint failed: message_mentions.message_id, message_mentions.start",
    "FOREIGN KEY constraint failed",
    "D1_ERROR: 別のエラー",
  ])(
    "#139 AC-2: 未知のDBエラー（%s）は0行にせず、同じエラーをそのまま投げ直す",
    async (message) => {
      const failure = new Error(message);
      const result = await run(failure);
      expect("error" in result && result.error).toBe(failure);
    },
  );

  it("#139 AC-2: 入れ子の奥が未知のエラーなら、外側のエラーをそのまま投げ直す", async () => {
    const failure = nested(
      "UNIQUE constraint failed: message_mentions.start",
      2,
    );
    const result = await run(failure);
    expect("error" in result && result.error).toBe(failure);
  });

  it("#139 AC-2: Error でない値が投げられても、握りつぶさず同じ値を投げ直す", async () => {
    const failure = "D1 が文字列を投げた";
    const result = await run(failure);
    expect("error" in result && result.error).toBe(failure);
  });
});
