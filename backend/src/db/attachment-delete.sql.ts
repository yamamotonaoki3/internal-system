// DAO：添付の削除（#270。EP-1-11）と、削除済みの添付の後始末の SQL。「削除してよい」条件をここに1か所で置く。
// 条件を UPDATE の WHERE と監査の onlyWhen に置くのは、Service の確認から書き込みまでの間に状態が変わっても、条件を破る行を書かないため。
// 削除してよい（deletable）：添付が存在し・削除されていない・投稿に結び付いている・アップロードしたのが本人で、
//   結び付いたメッセージが同じ部屋にあり、message-modify.sql.ts の modifiable（本人の投稿・未削除・部屋に書き込める）を満たし、
//   本文のない投稿の、最後の見える添付でない（⑤。#270 の2つ目。leavesMessageNonEmpty）。
// 後始末の順は「印（deleted_at）→ R2 の実体 → 行の物理削除」。行の削除は印のある行だけを条件にする（要求の中と定期の処理が重なっても、片方が0行になるだけ）。
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { messageAttachments } from "../../db/schema";
import { auditLogInsert } from "./audit-log.repository";
import type { Database } from "./database";
import { storedBodyIsEmpty } from "./message-body";
import { modifiable } from "./message-modify.sql";
import { removeStaleAttachmentIndexStatements } from "./search-index.sql";

/** ⑤を除いた削除の条件（判定の①〜④に当たる SQL） */
function deletableExceptLast(attachmentId: string, userId: string): SQL {
  return sql`EXISTS (
    SELECT 1 FROM message_attachments da
    JOIN messages dm ON dm.id = da.message_id
    WHERE da.id = ${attachmentId} AND da.deleted_at IS NULL AND da.message_id IS NOT NULL
      AND da.uploader_id = ${userId} AND dm.room_id = da.room_id
      AND ${modifiable(sql`da.message_id`, userId)})`;
}

/**
 * ⑤（#270。利用者の決定2）：消しても、本文も見える添付もない投稿にならない。
 * 結び付いたメッセージの本文が目印でない、または、同じメッセージにこの添付のほかに見える添付がある。
 */
function leavesMessageNonEmpty(attachmentId: string): SQL {
  return sql`NOT EXISTS (
    SELECT 1 FROM message_attachments la
    JOIN messages lm ON lm.id = la.message_id
    WHERE la.id = ${attachmentId} AND ${storedBodyIsEmpty(sql`lm.body`)}
      AND NOT EXISTS (
        SELECT 1 FROM message_attachments lo
        WHERE lo.message_id = la.message_id AND lo.id <> la.id AND lo.deleted_at IS NULL))`;
}

export function deletable(attachmentId: string, userId: string): SQL {
  return sql`(${deletableExceptLast(attachmentId, userId)} AND ${leavesMessageNonEmpty(attachmentId)})`;
}

/**
 * ⑤の判定の材料（#270）：⑤を除いた削除の条件が成り立つときだけ、「本文のない投稿の、最後の見える添付か」を返す。成り立たなければ null。
 * 条件の確かめと⑤を同じ batch で読み、①〜④の後に状態が変わっても、⑤の応答で拒否の理由を取り違えない
 */
export async function lastOfBodylessIfDeletable(
  db: Database,
  attachmentId: string,
  userId: string,
): Promise<boolean | null> {
  const [last, check] = await db.batch([
    db
      .select({
        last: sql<number>`NOT ${leavesMessageNonEmpty(attachmentId)}`.mapWith(
          Number,
        ),
      })
      .from(sql`(SELECT 1) c`),
    db
      .select({ ok: sql<number>`1` })
      .from(sql`(SELECT 1) c`)
      .where(deletableExceptLast(attachmentId, userId)),
  ]);
  if (check.length === 0) return null;
  const value = last[0]?.last;
  if (value !== 0 && value !== 1)
    throw new Error("最後の添付かどうかを読めませんでした");
  return value === 1;
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

/** 後始末の対象の行（保存先のキーは Service だけが使い、応答・ログに出さない）。purgeFailedAt は実体の削除に最後に失敗した時刻 */
export type PurgeTarget = {
  id: string;
  storageKey: string;
  deletedAt: string;
  purgeFailedAt: string | null;
};

const purgeTargetSchema = z.array(
  z.object({
    id: z.string(),
    storageKey: z.string(),
    deletedAt: z.string(),
    purgeFailedAt: z.string().nullable(),
  }),
);

/**
 * 定期の処理の読む位置。失敗したことのない行（fresh）は (deleted_at, id)、失敗したことのある行（failed）は (purge_failed_at, id) で区切る。
 * failedBefore は実行の開始の時刻。失敗したことのある行は、これより前に失敗した行だけを読む
 * （同じ実行の中で失敗を書いた行の時刻はこれ以後になるため、同じ実行で2回読まない）。
 */
export type PurgeCursor = {
  failedBefore: string;
  after:
    | { phase: "fresh"; deletedAt: string; id: string }
    | { phase: "failed"; purgeFailedAt: string; id: string }
    | null;
};

/**
 * 削除済みの行を、失敗したことのない行を (deleted_at, id) の昇順に先に、その後に失敗したことのある行を (purge_failed_at, id) の昇順に、
 * cursor.after より後から limit 行読む。失敗した行は少ない前提で、並べ替えは索引に頼らない
 */
export async function listPurgeTargets(
  db: Database,
  cursor: PurgeCursor,
  limit: number,
): Promise<PurgeTarget[]> {
  const failed = sql`(purge_failed_at IS NOT NULL AND purge_failed_at < ${cursor.failedBefore})`;
  const after = cursor.after;
  const from =
    after === null
      ? sql`(purge_failed_at IS NULL OR ${failed})`
      : after.phase === "fresh"
        ? sql`((purge_failed_at IS NULL AND (deleted_at > ${after.deletedAt} OR (deleted_at = ${after.deletedAt} AND id > ${after.id}))) OR ${failed})`
        : sql`(${failed} AND (purge_failed_at > ${after.purgeFailedAt} OR (purge_failed_at = ${after.purgeFailedAt} AND id > ${after.id})))`;
  const rows = await db.all(sql`
    SELECT id, storage_key AS storageKey, deleted_at AS deletedAt, purge_failed_at AS purgeFailedAt
    FROM message_attachments
    WHERE deleted_at IS NOT NULL AND ${from}
    ORDER BY purge_failed_at IS NOT NULL, COALESCE(purge_failed_at, deleted_at), id
    LIMIT ${limit}`);
  return purgeTargetSchema.parse(rows);
}

/** そのメッセージの削除済みの添付（メッセージの削除の後に、要求の中で後始末する） */
export async function listDeletedOfMessage(
  db: Database,
  messageId: string,
): Promise<PurgeTarget[]> {
  const rows = await db.all(sql`
    SELECT id, storage_key AS storageKey, deleted_at AS deletedAt, purge_failed_at AS purgeFailedAt
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

/** 実体の削除に失敗した時刻を、印のある行に書き、書いた行数（1 か 0）を返す（deleted_at・deleted_by は変えない） */
export async function markPurgeFailed(
  db: Database,
  attachmentId: string,
  failedAt: string,
): Promise<number> {
  const result = await db
    .update(messageAttachments)
    .set({ purgeFailedAt: failedAt })
    .where(
      sql`${messageAttachments.id} = ${attachmentId} AND ${messageAttachments.deletedAt} IS NOT NULL`,
    )
    .run();
  return result.meta.changes;
}
