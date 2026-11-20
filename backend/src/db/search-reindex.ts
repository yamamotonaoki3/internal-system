// 既存のメッセージの索引の登録（#155・D-9）。migration では記号を除けない（アプリの関数のため）ので、この処理で作る。
// messages.id の順に、未削除の行を batchSize 件ずつ読み、行ごとに索引の組（search-index.sql.ts）を実行する。
// 組はべき等で、いまの行と読んだ本文が一致するときだけ写しを入れるため、途中で失敗しても最初から・返った ID から再開してよく、
// 実行の間の投稿・編集とも食い違わない。
import { and, asc, gt, isNotNull, isNull } from "drizzle-orm";
import { messages } from "../../db/schema";
import type { Database } from "./database";
import { syncMessageIndexStatements } from "./search-index.sql";

const DEFAULT_BATCH_SIZE = 100;

/** afterId より後の未削除のメッセージを batchSize 件登録し、最後に読んだ ID を返す（読む行がなければ null） */
export async function reindexMessages(
  db: Database,
  options: { afterId: string | null; batchSize?: number },
): Promise<string | null> {
  const rows = await db
    .select({ id: messages.id, body: messages.body })
    .from(messages)
    .where(
      and(
        options.afterId === null ? undefined : gt(messages.id, options.afterId),
        isNull(messages.deletedAt),
        isNotNull(messages.roomId),
      ),
    )
    .orderBy(asc(messages.id))
    .limit(options.batchSize ?? DEFAULT_BATCH_SIZE);
  for (const row of rows)
    await db.batch(
      syncMessageIndexStatements(db, {
        messageId: row.id,
        sourceBody: row.body,
      }),
    );
  return rows.at(-1)?.id ?? null;
}
