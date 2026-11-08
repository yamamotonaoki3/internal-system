import { sql } from "drizzle-orm";
import { clientApiRateLimits } from "../../db/schema";
import { withDatabase, type Database } from "./database";

export type ClientRateBucket = "read" | "write";
export type ClientRateConsumption = {
  windowStartedAtMs: number;
  attemptCount: number;
};

export function createClientRateLimitRepository(db: Database) {
  return {
    async consume(input: {
      userId: string;
      bucket: ClientRateBucket;
      nowMs: number;
      limit: number;
    }): Promise<ClientRateConsumption> {
      const windowStartedAtMs = Math.floor(input.nowMs / 60_000) * 60_000;
      const rows = await db
        .insert(clientApiRateLimits)
        .values({
          userId: input.userId,
          bucketType: input.bucket,
          windowStartedAtMs,
          attemptCount: 1,
        })
        .onConflictDoUpdate({
          target: [clientApiRateLimits.userId, clientApiRateLimits.bucketType],
          set: {
            windowStartedAtMs: sql`CASE WHEN ${clientApiRateLimits.windowStartedAtMs} < ${windowStartedAtMs} THEN ${windowStartedAtMs} ELSE ${clientApiRateLimits.windowStartedAtMs} END`,
            attemptCount: sql`CASE WHEN ${clientApiRateLimits.windowStartedAtMs} < ${windowStartedAtMs} THEN 1 ELSE min(${input.limit + 1}, ${clientApiRateLimits.attemptCount} + 1) END`,
          },
        })
        .returning({
          windowStartedAtMs: clientApiRateLimits.windowStartedAtMs,
          attemptCount: clientApiRateLimits.attemptCount,
        });
      const consumed = rows[0];
      if (!consumed) throw new Error("取引先APIの受付数を記録できませんでした");
      return consumed;
    },
  };
}

export type ClientRateLimitRepository = ReturnType<
  typeof createClientRateLimitRepository
>;

export function withClientRateLimit<T>(
  env: Env,
  run: (repository: ClientRateLimitRepository) => Promise<T>,
): Promise<T> {
  return withDatabase(env, (db) => run(createClientRateLimitRepository(db)));
}
