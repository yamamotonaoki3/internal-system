// DB への接続（Cloudflare D1）。接続の仕方はこのファイルに閉じ込める。
import type { BatchItem as DrizzleBatchItem } from "drizzle-orm/batch";
import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "../../db/schema";

export type Database = DrizzleD1Database<typeof schema>;

/**
 * db.batch([...]) に渡せる1文。業務の更新と監査ログの書き込みは、配列に入れてそのまま db.batch() に渡す（まとめて確定・失敗する）。
 * 配列の専用型は作らない：各文の型（returning() の結果を含む）を、推論のまま残すため。
 */
export type BatchItem = DrizzleBatchItem<"sqlite">;

export function withDatabase<T>(
  env: Env,
  run: (db: Database) => Promise<T>,
): Promise<T> {
  return run(drizzle(env.DB, { schema }));
}
