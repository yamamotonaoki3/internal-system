// DAO：添付の削除（#270。EP-1-11）と、削除済みの添付の後始末の SQL。「削除してよい」条件をここに1か所で置く。
// 条件を UPDATE の WHERE と監査の onlyWhen に置くのは、Service の確認から書き込みまでの間に状態が変わっても、条件を破る行を書かないため。
// 削除してよい（deletable）：添付が存在し・削除されていない・投稿に結び付いている・アップロードしたのが本人で、
//   結び付いたメッセージが同じ部屋にあり、message-modify.sql.ts の modifiable（本人の投稿・未削除・部屋に書き込める）を満たす。
// 後始末の順は「印（deleted_at）→ R2 の実体 → 行の物理削除」。行の削除は印のある行だけを条件にする（要求の中と定期の処理が重なっても、片方が0行になるだけ）。
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { messageAttachments } from "../../db/schema";
import { auditLogInsert } from "./audit-log.repository";
import type { Database } from "./database";
import { modifiable } from "./message-modify.sql";
import { removeStaleAttachmentIndexStatements } from "./search-index.sql";

export function deletable(attachmentId: string, userId: string): SQL {
  return sql`EXISTS (
    SELECT 1 FROM message_attachments da
    JOIN messages dm ON dm.id = da.message_id
    WHERE da.id = ${attachmentId} AND da.deleted_at IS NULL AND da.message_id IS NOT NULL
      AND da.uploader_id = ${userId} AND dm.room_id = da.room_id
      AND ${modifiable(sql`da.message_id`, userId)})`;
}

export type AttachmentDeletion = {
  attachmentId: string;
  messageId: string;
  roomId: string;
  userId: string;
  deletedAt: string;
  traceId: string;
};

/** 監査・削除の印・索引を1回の batch で書き、印を付けた行数（1 か 0）を返す */
export async function markAttachmentDeleted(
  db: Database,
  input: AttachmentDeletion,
): Promise<number> {
  const allowed = deletable(input.attachmentId, input.userId);
  const statements = [
    // UPDATE の後は条件が偽になるため、前に置く。detail にファイル名・本文を入れない
    auditLogInsert(
      db,
      {
        actorId: input.userId,
        action: "attachment.delete",
        targetType: "attachment",
        targetId: input.attachmentId,
        result: "success",
        traceId: input.traceId,
        detail: { roomId: input.roomId, messageId: input.messageId },
      },
      { onlyWhen: allowed },
    ),
  ] as const;
  // 末尾に索引の文があるので、主の UPDATE を積んだ時点の位置を保持して読む
  const updateAt = statements.length;
  const results = await db.batch([
    ...statements,
    db
      .update(messageAttachments)
      .set({ deletedAt: input.deletedAt, deletedBy: input.userId })
      .where(
        sql`${messageAttachments.id} = ${input.attachmentId} AND ${allowed}`,
      ),
    // 検索の索引（#155）。削除が確定したときだけ、写しが対象外になって消える
    ...removeStaleAttachmentIndexStatements(db, input.messageId),
  ]);
  const update = results[updateAt];
  if (update === undefined)
    throw new Error("添付の削除の結果を読めませんでした");
  return update.meta.changes;
}

/** 後始末の対象の行（保存先のキーは Service だけが使い、応答・ログに出さない） */
export type PurgeTarget = { id: string; storageKey: string; deletedAt: string };

const purgeTargetSchema = z.array(
  z.object({ id: z.string(), storageKey: z.string(), deletedAt: z.string() }),
);

/** 削除済みの行を (deleted_at, id) の昇順に、after より後から limit 行読む（部分索引 message_attachments_deleted_at_idx） */
export async function listPurgeTargets(
  db: Database,
  after: { deletedAt: string; id: string } | null,
  limit: number,
): Promise<PurgeTarget[]> {
  const from =
    after === null
      ? sql``
      : sql`AND (deleted_at > ${after.deletedAt} OR (deleted_at = ${after.deletedAt} AND id > ${after.id}))`;
  const rows = await db.all(sql`
    SELECT id, storage_key AS storageKey, deleted_at AS deletedAt
    FROM message_attachments
    WHERE deleted_at IS NOT NULL ${from}
    ORDER BY deleted_at, id
    LIMIT ${limit}`);
  return purgeTargetSchema.parse(rows);
}

/** そのメッセージの削除済みの添付（メッセージの削除の後に、要求の中で後始末する） */
export async function listDeletedOfMessage(
  db: Database,
  messageId: string,
): Promise<PurgeTarget[]> {
  const rows = await db.all(sql`
    SELECT id, storage_key AS storageKey, deleted_at AS deletedAt
    FROM message_attachments
    WHERE message_id = ${messageId} AND deleted_at IS NOT NULL
    ORDER BY id`);
  return purgeTargetSchema.parse(rows);
}

/** 実体を消した後に、印のある行だけを消し、消した行数（1 か 0）を返す */
export async function deletePurgedRow(
  db: Database,
  attachmentId: string,
): Promise<number> {
  const result = await db
    .delete(messageAttachments)
    .where(
      sql`${messageAttachments.id} = ${attachmentId} AND ${messageAttachments.deletedAt} IS NOT NULL`,
    )
    .run();
  return result.meta.changes;
}
