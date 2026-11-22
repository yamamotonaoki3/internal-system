// Service の部品：削除済みの添付の後始末（#270。計画 4.4）。印（deleted_at）の付いた行の R2 の実体を消してから、行を消す。
// 要求の中の削除（attachment.service の remove）・メッセージの削除（message.service の remove の後）・定期の処理（attachmentPurgeJob）が、同じ部品を使う。
// message.service.ts からも使うため、attachment.service.ts と分けて置く（attachment.service.ts は message.service.ts を読み込むので、循環を作らない）。
// R2 の失敗は数えて error ログに残し、失敗の時刻（purge_failed_at）を書いて次の行へ進む（キー・名前を出さない。行は印つきで残り、次の定期の処理が試す）。
// 行の削除（D1）の失敗は投げる。失敗の時刻の書き込みの失敗だけは、付随する後始末の失敗として error ログに残す。
import { withAttachments } from "../db/attachment.repository";
import type { PurgeTarget } from "../db/attachment-delete.sql";
import type { Logger } from "../lib/logger/logger";

/**
 * 実体の削除に失敗した時刻を書く（定期の処理が、失敗したことのない行を先に読むため）。
 * この書き込みの失敗は後始末に付随する失敗なので、主の結果を変えずに error ログに残す
 */
async function recordPurgeFailure(
  env: Env,
  attachmentId: string,
  logger: Logger,
): Promise<void> {
  try {
    await withAttachments(env, (repository) =>
      repository.markPurgeFailed(attachmentId, new Date().toISOString()),
    );
  } catch (error) {
    logger.error("attachment-purge：失敗の時刻の記録に失敗した", { error });
  }
}

export type PurgeResult = { purgedRows: number; failedObjects: number };

export async function purgeDeletedAttachments(
  env: Env,
  rows: readonly Pick<PurgeTarget, "id" | "storageKey">[],
  logger: Logger,
): Promise<PurgeResult> {
  const result: PurgeResult = { purgedRows: 0, failedObjects: 0 };
  for (const row of rows) {
    try {
      await env.ATTACHMENTS.delete(row.storageKey);
    } catch (error) {
      result.failedObjects += 1;
      logger.error("attachment-purge：保存物の削除に失敗した", { error });
      await recordPurgeFailure(env, row.id, logger);
      continue;
    }
    result.purgedRows += await withAttachments(env, (repository) =>
      repository.deletePurgedRow(row.id),
    );
  }
  return result;
}

/** そのメッセージの削除済みの添付を後始末する（メッセージの削除が成功した後に、要求の中で1回呼ぶ） */
export async function purgeAttachmentsOfMessage(
  env: Env,
  messageId: string,
  logger: Logger,
): Promise<void> {
  const rows = await withAttachments(env, (repository) =>
    repository.listDeletedOfMessage(messageId),
  );
  await purgeDeletedAttachments(env, rows, logger);
}
