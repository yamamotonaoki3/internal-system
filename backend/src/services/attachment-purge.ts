// Service の部品：削除済みの添付の後始末（#270。計画 4.4）。印（deleted_at）の付いた行の R2 の実体を消してから、行を消す。
// 要求の中の削除（attachment.service の remove）・メッセージの削除（message.service の remove の後）・定期の処理（attachmentPurgeJob）が、同じ部品を使う。
// message.service.ts からも使うため、attachment.service.ts と分けて置く（attachment.service.ts は message.service.ts を読み込むので、循環を作らない）。
// R2 の失敗は数えて error ログに残し、次の行へ進む（キー・名前を出さない。行は印つきで残り、次の定期の処理が試す）。D1 の失敗は投げる。
import { withAttachments } from "../db/attachment.repository";
import type { PurgeTarget } from "../db/attachment-delete.sql";
import type { Logger } from "../lib/logger/logger";

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
