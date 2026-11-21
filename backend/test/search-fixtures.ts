// #155（155-A）のテストで使う、検索の索引（search_documents・search_fts）の準備・直接の検査・後始末。
// 索引の作り方（計画 4.1・4.2）：search_documents（対応の表。id は整数の主キー、kind・ref_id・room_id・message_id・created_at・source_body）と、
// search_fts（FTS5 trigram。列 text。rowid = search_documents.id）。直接の検査は、本番の検索の部品（Repository）を通さずに SQL で行う（索引そのものの確認）。
// 既存のメッセージの索引は、計画 4.2 D-9 の reindexMessages で作る（SQL のシードを入れた後に buildSearchIndex を呼ぶ）。
// 後始末は識別子で行う：本文に [UNIT_TEST] を含むメッセージの写しと、元のメッセージがない写し（孤立）だけを消す。メッセージを消す後始末より先に呼ぶ。
// 契約（実装前の仮置き。実装の担当へ）：
//   backend/src/db/search-reindex.ts：reindexMessages(db: Database, options: { afterId: string | null; batchSize?: number }): Promise<string | null>
//     … messages.id の昇順に、afterId より後の未削除の行を batchSize（既定100）件読み、行ごとに索引の組を実行し、最後に読んだ ID を返す（読んだ行がなければ null）。
//   backend/src/db/search-index.sql.ts：syncMessageIndexStatements(db, { messageId, sourceBody }): BatchItem[]（空でない配列。db.batch にそのまま渡せる）
// 155-B（添付ファイル名の索引。kind = 'attachment'）の契約（実装前の仮置き。実装の担当へ）：
//   backend/src/db/search-index.sql.ts：
//     syncAttachmentIndexStatements(db: Database, messageId: string): BatchItem[]（空でない配列）
//       … そのメッセージの kind=attachment の写しのうち、いまの行と合わないものを消し、結び付いた添付のうち写しの無いものを入れる（計画 3章の組 1〜4）。
//     removeStaleAttachmentIndexStatements(db: Database, messageId: string): BatchItem[]（組の 1・2 だけ）
//   写しの形（計画 2章）：search_documents の kind='attachment'・ref_id=添付の ID・room_id=添付の部屋・message_id=結ぶメッセージ・
//     created_at=メッセージの作成日時・source_body=original_name。search_fts.text=original_name（記号を除かない。B-3）。
// データは架空（[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { withDatabase, type BatchItem } from "../src/db/database";
import {
  syncAttachmentIndexStatements,
  syncMessageIndexStatements,
} from "../src/db/search-index.sql";
import { reindexMessages } from "../src/db/search-reindex";

/** FTS5 の句として引用する（計画 4.4。本番の toFtsPhrase から作らず、T-0 で確かめた規則で独立に作る） */
export const phraseOf = (term: string) => `"${term.replaceAll('"', '""')}"`;

/** 既存のメッセージの索引を、最初から最後まで作る（batchSize ずつ。戻り値の ID から続ける） */
export async function buildSearchIndex(batchSize = 100): Promise<void> {
  await withDatabase(env, async (db) => {
    let after: string | null = null;
    for (let round = 0; round < 10_000; round += 1) {
      const last: string | null = await reindexMessages(db, {
        afterId: after,
        batchSize,
      });
      if (last === null) return;
      after = last;
    }
    throw new Error("索引の作成が終わりません（戻り値の ID が進んでいない）");
  });
}

/** 索引の組（計画 4.2 の1〜4）を、渡した元の本文で実行する（既存データの登録の処理が読んだ本文を、後から実行する場面を作る） */
export async function runIndexStatements(
  messageId: string,
  sourceBody: string,
): Promise<void> {
  await withDatabase(env, async (db) => {
    const statements = syncMessageIndexStatements(db, {
      messageId,
      sourceBody,
    });
    const [first, ...rest] = statements;
    if (first === undefined) throw new Error("索引の組が空です");
    await db.batch([first, ...rest] as [BatchItem, ...BatchItem[]]);
  });
}

/** 索引を直接引く（3文字以上の語。MATCH）。メッセージの ID の昇順 */
export async function ftsMatchIds(term: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT d.ref_id AS id FROM search_fts f JOIN search_documents d ON d.id = f.rowid
     WHERE search_fts MATCH ? AND d.kind = 'message' ORDER BY d.ref_id`,
  )
    .bind(phraseOf(term))
    .all<{ id: string }>();
  return results.map((r) => r.id);
}

/** 索引を直接引く（1〜2文字の語。instr）。メッセージの ID の昇順 */
export async function ftsInstrIds(term: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT d.ref_id AS id FROM search_fts f JOIN search_documents d ON d.id = f.rowid
     WHERE instr(lower(f.text), lower(?)) > 0 AND d.kind = 'message' ORDER BY d.ref_id`,
  )
    .bind(term)
    .all<{ id: string }>();
  return results.map((r) => r.id);
}

export type IndexCounts = { documents: number; fts: number };

/** そのメッセージの写しの数（対応の表の行・検索用の表の行） */
export async function indexCountsOf(messageId: string): Promise<IndexCounts> {
  const row = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM search_documents WHERE kind = 'message' AND ref_id = ?1) AS documents,
       (SELECT COUNT(*) FROM search_fts WHERE rowid IN (SELECT id FROM search_documents WHERE kind = 'message' AND ref_id = ?1)) AS fts`,
  )
    .bind(messageId)
    .first<IndexCounts>();
  return row ?? { documents: -1, fts: -1 };
}

/** 検索用の表の全体の行数（孤立した行の確認に使う） */
export async function totalFtsRows(): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM search_fts",
  ).first<{ n: number }>();
  return row?.n ?? -1;
}

export type IndexMismatches = {
  /** 未削除で部屋のあるメッセージなのに、写しがない */
  missing: number;
  /** 写しがあるのに、元が無い・削除済み・部屋が無い・本文や部屋・作成日時が写しと違う */
  stale: number;
  /** 対応の表の行に、検索用の表の行がない */
  withoutFts: number;
  /** 検索用の表の行に、対応の表の行がない */
  orphanFts: number;
  /** 同じメッセージの写しが2行以上 */
  duplicated: number;
};

/** 索引と元の表の不一致（計画 4.2 の「漏れの防止」(2)）。ids を渡すと、そのメッセージだけを数える（孤立した検索用の行は常に全体） */
export async function indexMismatches(
  ids?: readonly string[],
  db: D1Database = env.DB,
): Promise<IndexMismatches> {
  const scope =
    ids === undefined ? "1 = 1" : "ref IN (SELECT value FROM json_each(?1))";
  const messageScope = scope.replace("ref", "m.id");
  const docScope = scope.replace("ref", "d.ref_id");
  const statement = db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM messages m
         WHERE ${messageScope} AND m.deleted_at IS NULL AND m.room_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM search_documents d WHERE d.kind = 'message' AND d.ref_id = m.id)) AS missing,
       (SELECT COUNT(*) FROM search_documents d
         WHERE d.kind = 'message' AND ${docScope}
           AND NOT EXISTS (SELECT 1 FROM messages m
             WHERE m.id = d.ref_id AND m.deleted_at IS NULL AND m.room_id IS NOT NULL
               AND m.body = d.source_body AND m.room_id = d.room_id AND m.id = d.message_id AND m.created_at = d.created_at)) AS stale,
       (SELECT COUNT(*) FROM search_documents d
         WHERE d.kind = 'message' AND ${docScope}
           AND NOT EXISTS (SELECT 1 FROM search_fts f WHERE f.rowid = d.id)) AS withoutFts,
       (SELECT COUNT(*) FROM search_fts f
         WHERE NOT EXISTS (SELECT 1 FROM search_documents d WHERE d.id = f.rowid)) AS orphanFts,
       (SELECT COUNT(*) FROM (SELECT d.ref_id FROM search_documents d WHERE d.kind = 'message' AND ${docScope}
         GROUP BY d.ref_id HAVING COUNT(*) > 1)) AS duplicated`,
  );
  const bound =
    ids === undefined ? statement : statement.bind(JSON.stringify(ids));
  const row = await bound.first<IndexMismatches>();
  if (row === null) throw new Error("不一致を数えられませんでした");
  return row;
}

export const NO_MISMATCH: IndexMismatches = {
  missing: 0,
  stale: 0,
  withoutFts: 0,
  orphanFts: 0,
  duplicated: 0,
};

/**
 * 検索の索引の後始末（識別子で消す）：本文に [UNIT_TEST] を含むメッセージの写しと、元のメッセージがない写し・対応の行がない検索用の行。
 * 表がまだない（実装前）ときは何もしない。メッセージを消す後始末より先に呼ぶ。
 */
export async function cleanupSearchIndex(): Promise<void> {
  const exists = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('search_documents', 'search_fts')",
  ).first<{ n: number }>();
  if ((exists?.n ?? 0) < 2) return;
  const target = `SELECT d.id FROM search_documents d WHERE d.kind = 'message'
    AND (d.ref_id NOT IN (SELECT id FROM messages) OR d.ref_id IN (SELECT id FROM messages WHERE body LIKE '%[UNIT!_TEST]%' ESCAPE '!'))`;
  // 添付の写し（155-B）：元の添付が無い・結ぶメッセージが無い・テストのメッセージに結ぶ写し
  const attachmentTarget = `SELECT d.id FROM search_documents d WHERE d.kind = 'attachment'
    AND (d.ref_id NOT IN (SELECT id FROM message_attachments)
      OR d.message_id IS NULL OR d.message_id NOT IN (SELECT id FROM messages)
      OR d.message_id IN (SELECT id FROM messages WHERE body LIKE '%[UNIT!_TEST]%' ESCAPE '!'))`;
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM search_fts WHERE rowid IN (${target})`),
    env.DB.prepare(`DELETE FROM search_documents WHERE id IN (${target})`),
    env.DB.prepare(
      `DELETE FROM search_fts WHERE rowid IN (${attachmentTarget})`,
    ),
    env.DB.prepare(
      `DELETE FROM search_documents WHERE id IN (${attachmentTarget})`,
    ),
    env.DB.prepare(
      "DELETE FROM search_fts WHERE rowid NOT IN (SELECT id FROM search_documents)",
    ),
  ]);
}

// ---- 155-B：添付ファイル名の索引（kind = 'attachment'） ----

/** 添付の索引の組（計画 3章の 1〜4）を、そのメッセージについて実行する */
export async function runAttachmentIndexStatements(
  messageId: string,
): Promise<void> {
  await withDatabase(env, async (db) => {
    const [first, ...rest] = syncAttachmentIndexStatements(db, messageId);
    if (first === undefined) throw new Error("添付の索引の組が空です");
    await db.batch([first, ...rest] as [BatchItem, ...BatchItem[]]);
  });
}

/** 添付の索引を直接引く（3文字以上の語。MATCH）。添付の ID の昇順 */
export async function ftsMatchAttachmentIds(
  term: string,
  db: D1Database = env.DB,
): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT d.ref_id AS id FROM search_fts f JOIN search_documents d ON d.id = f.rowid
       WHERE search_fts MATCH ? AND d.kind = 'attachment' ORDER BY d.ref_id`,
    )
    .bind(phraseOf(term))
    .all<{ id: string }>();
  return results.map((r) => r.id);
}

/** 添付の索引を直接引く（1〜2文字の語。instr）。添付の ID の昇順 */
export async function ftsInstrAttachmentIds(
  term: string,
  db: D1Database = env.DB,
): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT d.ref_id AS id FROM search_fts f JOIN search_documents d ON d.id = f.rowid
       WHERE instr(lower(f.text), lower(?)) > 0 AND d.kind = 'attachment' ORDER BY d.ref_id`,
    )
    .bind(term)
    .all<{ id: string }>();
  return results.map((r) => r.id);
}

/** その添付の写しの数（対応の表の行・検索用の表の行） */
export async function attachmentIndexCountsOf(
  attachmentId: string,
): Promise<IndexCounts> {
  const row = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM search_documents WHERE kind = 'attachment' AND ref_id = ?1) AS documents,
       (SELECT COUNT(*) FROM search_fts WHERE rowid IN (SELECT id FROM search_documents WHERE kind = 'attachment' AND ref_id = ?1)) AS fts`,
  )
    .bind(attachmentId)
    .first<IndexCounts>();
  return row ?? { documents: -1, fts: -1 };
}

/** 種類 attachment の対応の表の全体の行数 */
export async function totalAttachmentDocuments(
  db: D1Database = env.DB,
): Promise<number> {
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM search_documents WHERE kind = 'attachment'",
    )
    .first<{ n: number }>();
  return row?.n ?? -1;
}

/** 写しを直接入れる（索引の遅れ・不整合の状態を作る）。ftsText を省くと sourceBody。対応の表の id を返す */
export async function insertAttachmentIndexRow(seed: {
  attachmentId: string;
  roomId: string | null;
  messageId: string | null;
  createdAt: string;
  sourceBody: string;
  ftsText?: string;
  kind?: string;
}): Promise<number> {
  const inserted = await env.DB.prepare(
    `INSERT INTO search_documents (kind, ref_id, room_id, message_id, created_at, source_body)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(
      seed.kind ?? "attachment",
      seed.attachmentId,
      seed.roomId,
      seed.messageId,
      seed.createdAt,
      seed.sourceBody,
    )
    .first<{ id: number }>();
  if (inserted === null) throw new Error("写しを入れられませんでした");
  await env.DB.prepare("INSERT INTO search_fts (rowid, text) VALUES (?, ?)")
    .bind(inserted.id, seed.ftsText ?? seed.sourceBody)
    .run();
  return inserted.id;
}

export type AttachmentIndexMismatches = {
  /** 索引の対象のメッセージ（未削除・部屋あり・部屋が添付と同じ）に結び付いた添付なのに、写しがない */
  missing: number;
  /** 写しがあるのに、元の添付が無い */
  missingAttachment: number;
  /** 写しの message_id と、添付の結び付き（message_id）が違う（未投稿に戻った場合を含む） */
  wrongMessage: number;
  /** 写しの部屋と、添付の部屋が違う */
  wrongRoom: number;
  /** 写しの元の名前（source_body）と、添付のいまの名前が違う */
  wrongName: number;
  /** 写しの作成日時と、結ぶメッセージの作成日時が違う */
  wrongCreatedAt: number;
  /** 結ぶメッセージが無い・削除済み・部屋が無い */
  deletedMessage: number;
  /** 対応の行に、検索用の行がない */
  withoutFts: number;
  /** 検索用の行の文が、対応の行の元の名前と違う（記号を除かない。B-3） */
  wrongFtsText: number;
  /** 検索用の行に、対応の行がない（種類を問わず全体） */
  orphanFts: number;
};

export const NO_ATTACHMENT_MISMATCH: AttachmentIndexMismatches = {
  missing: 0,
  missingAttachment: 0,
  wrongMessage: 0,
  wrongRoom: 0,
  wrongName: 0,
  wrongCreatedAt: 0,
  deletedMessage: 0,
  withoutFts: 0,
  wrongFtsText: 0,
  orphanFts: 0,
};

/** 添付の索引と元の表の不一致（計画 R1-3 の分類）。分類ごとに独立に数える */
export async function attachmentIndexMismatches(
  db: D1Database = env.DB,
): Promise<AttachmentIndexMismatches> {
  const docs = "FROM search_documents d WHERE d.kind = 'attachment'";
  const row = await db
    .prepare(
      `SELECT
       (SELECT COUNT(*) FROM message_attachments a JOIN messages m ON m.id = a.message_id
         WHERE m.deleted_at IS NULL AND m.room_id IS NOT NULL AND m.room_id = a.room_id
           AND NOT EXISTS (SELECT 1 FROM search_documents d WHERE d.kind = 'attachment' AND d.ref_id = a.id)) AS missing,
       (SELECT COUNT(*) ${docs}
         AND NOT EXISTS (SELECT 1 FROM message_attachments a WHERE a.id = d.ref_id)) AS missingAttachment,
       (SELECT COUNT(*) ${docs}
         AND EXISTS (SELECT 1 FROM message_attachments a WHERE a.id = d.ref_id
           AND (a.message_id IS NULL OR d.message_id IS NULL OR a.message_id <> d.message_id))) AS wrongMessage,
       (SELECT COUNT(*) ${docs}
         AND EXISTS (SELECT 1 FROM message_attachments a WHERE a.id = d.ref_id
           AND (d.room_id IS NULL OR a.room_id <> d.room_id))) AS wrongRoom,
       (SELECT COUNT(*) ${docs}
         AND EXISTS (SELECT 1 FROM message_attachments a WHERE a.id = d.ref_id AND a.original_name <> d.source_body)) AS wrongName,
       (SELECT COUNT(*) ${docs}
         AND EXISTS (SELECT 1 FROM messages m WHERE m.id = d.message_id AND m.created_at <> d.created_at)) AS wrongCreatedAt,
       (SELECT COUNT(*) ${docs}
         AND NOT EXISTS (SELECT 1 FROM messages m
           WHERE m.id = d.message_id AND m.deleted_at IS NULL AND m.room_id IS NOT NULL)) AS deletedMessage,
       (SELECT COUNT(*) ${docs}
         AND NOT EXISTS (SELECT 1 FROM search_fts f WHERE f.rowid = d.id)) AS withoutFts,
       (SELECT COUNT(*) ${docs}
         AND EXISTS (SELECT 1 FROM search_fts f WHERE f.rowid = d.id AND f.text <> d.source_body)) AS wrongFtsText,
       (SELECT COUNT(*) FROM search_fts f
         WHERE NOT EXISTS (SELECT 1 FROM search_documents d WHERE d.id = f.rowid)) AS orphanFts`,
    )
    .first<AttachmentIndexMismatches>();
  if (row === null) throw new Error("添付の不一致を数えられませんでした");
  return row;
}
