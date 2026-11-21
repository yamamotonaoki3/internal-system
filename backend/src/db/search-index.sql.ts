// DAO：検索の索引（search_documents と search_fts）の更新の文の組（#155・計画 4.2）。メッセージの本文を書くときは、必ず同じ batch の末尾にこの組を足す。
// 各文は「いまのメッセージの行の状態」と「渡した元の本文（sourceBody）」だけで結果が決まる。同じ組を何度実行しても同じで、
// どの順に実行されても、最後に索引はいまの行と一致する（拒否された編集・既存データの登録との割り込みでも、正しい写しを消さない）。
// 件数の判定には使わない（D1 の meta.changes は検索用の表の内部の書き込みも数えるため、既存の戻り値は主の文の結果から取る）。
import { sql, type SQL } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { searchDocuments } from "../../db/schema";
import { toSearchText } from "../../../shared/search-text";
import { searchMethodOf, toFtsPhrase } from "../lib/search-query";
import type { BatchItem, Database } from "./database";

// 検索用の表（FTS5。手で書いた migration 0033）。Drizzle の生成に乗せないため schema.ts には置かず、batch に入れる文を組むためだけにここで形を示す
const searchFts = sqliteTable("search_fts", {
  rowid: integer("rowid").notNull(),
  text: text("text").notNull(),
});

/** 索引の対象：未削除で、部屋のあるメッセージ */
const indexedMessage = (messageId: SQL) =>
  sql`m.id = ${messageId} AND m.deleted_at IS NULL AND m.room_id IS NOT NULL`;

/** いまの行と一致しない写し（元が無い・削除済み・本文が違う）の、対応の表の行 */
const staleDocuments = (messageId: string) => sql`
  SELECT d.id FROM search_documents d
  WHERE d.kind = 'message' AND d.ref_id = ${messageId}
    AND NOT EXISTS (
      SELECT 1 FROM messages m
      WHERE ${indexedMessage(sql`d.ref_id`)} AND m.body = d.source_body)`;

/** いまの行と一致しない写しだけを消す（削除の確定・本文の変更の後に、古い写しを消す） */
export function removeStaleMessageIndexStatements(
  db: Database,
  messageId: string,
): [BatchItem, BatchItem] {
  return [
    db
      .delete(searchFts)
      .where(sql`${searchFts.rowid} IN (${staleDocuments(messageId)})`),
    db
      .delete(searchDocuments)
      .where(sql`${searchDocuments.id} IN (${staleDocuments(messageId)})`),
  ];
}

/** 古い写しを消し、いまの本文が sourceBody と一致するときだけ、記号を除いた本文の写しを入れる */
export function syncMessageIndexStatements(
  db: Database,
  input: { messageId: string; sourceBody: string },
): [BatchItem, ...BatchItem[]] {
  const { messageId, sourceBody } = input;
  return [
    ...removeStaleMessageIndexStatements(db, messageId),
    // 列の並びは schema.ts の searchDocuments と同じ（id は採番に任せる）
    db.insert(searchDocuments).select(sql`
      SELECT NULL, 'message', m.id, m.room_id, m.id, m.created_at, ${sourceBody}
      FROM messages m
      WHERE ${indexedMessage(sql`${messageId}`)} AND m.body = ${sourceBody}
        AND NOT EXISTS (SELECT 1 FROM search_documents d WHERE d.kind = 'message' AND d.ref_id = m.id)`),
    db.insert(searchFts).select(sql`
      SELECT d.id, ${toSearchText(sourceBody)}
      FROM search_documents d
      WHERE d.kind = 'message' AND d.ref_id = ${messageId} AND d.source_body = ${sourceBody}
        AND NOT EXISTS (SELECT 1 FROM search_fts f WHERE f.rowid = d.id)`),
  ];
}

// ---- 添付のファイル名（kind = 'attachment'）。名前は記号を除かずにそのまま写す（ファイル名の記号は名前の一部のため）。
// 引数はメッセージの ID だけで、値はすべて DB のいまの行から写す。結び付け・削除・既存データの登録のどの順に実行されても、最後に索引はいまの行と一致する

/** いまの行と一致しない添付の写し（元の添付が無い・結び付き・部屋・名前・日時が違う・メッセージが索引の対象でない）の、対応の表の行 */
const staleAttachmentDocuments = (messageId: string) => sql`
  SELECT d.id FROM search_documents d
  WHERE d.kind = 'attachment' AND d.message_id = ${messageId}
    AND NOT EXISTS (
      SELECT 1 FROM message_attachments a JOIN messages m ON m.id = a.message_id
      WHERE a.id = d.ref_id AND a.message_id = d.message_id AND a.room_id = d.room_id
        AND a.original_name = d.source_body AND m.created_at = d.created_at
        AND ${indexedMessage(sql`d.message_id`)} AND m.room_id = a.room_id)`;

/** そのメッセージの、いまの行と一致しない添付の写しだけを消す（論理削除の後に、名前の写しを消す） */
export function removeStaleAttachmentIndexStatements(
  db: Database,
  messageId: string,
): [BatchItem, BatchItem] {
  return [
    db
      .delete(searchFts)
      .where(
        sql`${searchFts.rowid} IN (${staleAttachmentDocuments(messageId)})`,
      ),
    db
      .delete(searchDocuments)
      .where(
        sql`${searchDocuments.id} IN (${staleAttachmentDocuments(messageId)})`,
      ),
  ];
}

/** 古い添付の写しを消し、そのメッセージに結び付いた添付のうち、写しの無いものの名前を入れる */
export function syncAttachmentIndexStatements(
  db: Database,
  messageId: string,
): [BatchItem, ...BatchItem[]] {
  return [
    ...removeStaleAttachmentIndexStatements(db, messageId),
    // 列の並びは schema.ts の searchDocuments と同じ（id は採番に任せる）。日時はメッセージのもの（期間・並びをメッセージの結果とそろえる）
    db.insert(searchDocuments).select(sql`
      SELECT NULL, 'attachment', a.id, a.room_id, m.id, m.created_at, a.original_name
      FROM message_attachments a JOIN messages m ON m.id = a.message_id
      WHERE ${indexedMessage(sql`${messageId}`)} AND m.room_id = a.room_id
        AND NOT EXISTS (SELECT 1 FROM search_documents d WHERE d.kind = 'attachment' AND d.ref_id = a.id)`),
    db.insert(searchFts).select(sql`
      SELECT d.id, d.source_body
      FROM search_documents d
      WHERE d.kind = 'attachment' AND d.message_id = ${messageId}
        AND NOT EXISTS (SELECT 1 FROM search_fts f WHERE f.rowid = d.id)`),
  ];
}

// ---- 案件の件名（kind = 'case_title'）。件名は記号を除かずにそのまま写す。部屋・メッセージの列は NULL（メッセージの検索の部屋・期間の絞り込みに混ざらないため）。
// 引数は案件の ID だけで、値はすべて DB のいまの行から写す。件名を変える batch（承認・再編集）の末尾に足す

/** いまの案件の行と一致しない件名の写し（元の案件が無い・件名・作成日時が違う・部屋の列がある・検索用の文が違うか無い）の、対応の表の行 */
const staleCaseTitleDocuments = (caseId: string) => sql`
  SELECT d.id FROM search_documents d
  WHERE d.kind = 'case_title' AND d.ref_id = ${caseId}
    AND NOT (d.room_id IS NULL AND d.message_id IS NULL
      AND EXISTS (SELECT 1 FROM cases k WHERE k.id = d.ref_id AND k.title = d.source_body AND k.created_at = d.created_at)
      AND EXISTS (SELECT 1 FROM search_fts f WHERE f.rowid = d.id AND f.text = d.source_body))`;

/** 古い件名の写しを消し、写しが無ければ、いまの件名で入れる */
export function syncCaseTitleIndexStatements(
  db: Database,
  caseId: string,
): [BatchItem, ...BatchItem[]] {
  return [
    db
      .delete(searchFts)
      .where(sql`${searchFts.rowid} IN (${staleCaseTitleDocuments(caseId)})`),
    db
      .delete(searchDocuments)
      .where(
        sql`${searchDocuments.id} IN (${staleCaseTitleDocuments(caseId)})`,
      ),
    // 列の並びは schema.ts の searchDocuments と同じ（id は採番に任せる）
    db.insert(searchDocuments).select(sql`
      SELECT NULL, 'case_title', k.id, NULL, NULL, k.created_at, k.title
      FROM cases k
      WHERE k.id = ${caseId}
        AND NOT EXISTS (SELECT 1 FROM search_documents d WHERE d.kind = 'case_title' AND d.ref_id = k.id)`),
    db.insert(searchFts).select(sql`
      SELECT d.id, d.source_body
      FROM search_documents d
      WHERE d.kind = 'case_title' AND d.ref_id = ${caseId}
        AND NOT EXISTS (SELECT 1 FROM search_fts f WHERE f.rowid = d.id)`),
  ];
}

/**
 * 件名が語に一致する案件の ID（列 case_id）を返す副問い合わせ。外側の案件に依らない集合として先に作る（案件ごとに検索用の表を引き直さない）。
 * いまの件名と写しの元の件名が同じ行だけにする（索引が遅れても、古い件名で一致させない）
 */
export function caseTitleHitsQuery(db: Database, term: string) {
  const condition =
    searchMethodOf(term) === "match"
      ? sql`search_fts MATCH ${toFtsPhrase(term)}`
      : sql`instr(lower(f.text), lower(${term})) > 0`;
  return db
    .select({ caseId: sql<string>`d.ref_id`.as("case_id") })
    .from(
      sql`search_fts f JOIN search_documents d ON d.id = f.rowid JOIN cases tk ON tk.id = d.ref_id`,
    )
    .where(
      sql`${condition} AND d.kind = 'case_title' AND d.source_body = tk.title`,
    );
}
