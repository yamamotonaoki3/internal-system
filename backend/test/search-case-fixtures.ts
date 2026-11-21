// #155（155-C）のテストで使う、案件の件名の索引（search_documents の kind = 'case_title' と search_fts）の準備・直接の検査・後始末。
// 写しの形（計画 2章）：kind='case_title'・ref_id=案件の ID・room_id=NULL・message_id=NULL・created_at=案件の作成日時・source_body=いまの件名。
//   search_fts.text=件名（記号を除かない）。
// 直接の検査は、本番の検索の部品（Repository）を通さずに SQL で行う（索引そのものの確認）。
// 既存の search-fixtures.ts（155-A・B）は変えず、案件の分だけをここに置く（まだない本体の関数を import しても、既存のテストの読み込みに響かないように）。
// 契約（実装前の仮置き。実装の担当へ）：
//   backend/src/db/search-index.sql.ts：
//     syncCaseTitleIndexStatements(db: Database, caseId: string): [BatchItem, ...BatchItem[]]
//       … その案件の kind=case_title の写しのうち、いまの案件の行と合わないもの（案件が無い・件名・作成日時が違う）を消し、
//         写しが無ければ、いまの件名で入れる（計画 3章の組 1・2）。値はすべて DB のいまの行から写し、何度・どの順に実行しても同じ結果になる。
//   backend/src/db/search-reindex.ts：
//     reindexCases(db: Database, options: { afterId: string | null; batchSize?: number }): Promise<string | null>
//       … cases.id の昇順に、afterId より後（afterId は含めない）の案件を batchSize（既定 100）件読み、案件ごとに上の組を実行し、
//         最後に読んだ ID を返す（読んだ行がなければ null）。進行中・終了のどちらも対象。
// データは架空（[UNIT_TEST]・testuser_）。
import { env } from "cloudflare:workers";
import { withDatabase, type BatchItem } from "../src/db/database";
import { syncCaseTitleIndexStatements } from "../src/db/search-index.sql";
import { reindexCases } from "../src/db/search-reindex";
import { phraseOf } from "./search-fixtures";

/** 件名の索引の組を、その案件について実行する（本番の書き込みの batch の外で、組だけを当てる場面を作る） */
export async function runCaseTitleIndexStatements(
  caseId: string,
): Promise<void> {
  await withDatabase(env, async (db) => {
    const [first, ...rest] = syncCaseTitleIndexStatements(db, caseId);
    if (first === undefined) throw new Error("件名の索引の組が空です");
    await db.batch([first, ...rest] as [BatchItem, ...BatchItem[]]);
  });
}

/** 既存の案件の件名の索引を、最初から最後まで作る（batchSize ずつ。省くと既定の件数。戻り値の ID から続ける）。登録した回数を返す */
export async function buildCaseTitleIndex(batchSize?: number): Promise<number> {
  return withDatabase(env, async (db) => {
    let after: string | null = null;
    for (let round = 0; round < 10_000; round += 1) {
      const last: string | null = await reindexCases(db, {
        afterId: after,
        ...(batchSize === undefined ? {} : { batchSize }),
      });
      if (last === null) return round;
      after = last;
    }
    throw new Error(
      "件名の索引の登録が終わりません（戻り値の ID が進んでいない）",
    );
  });
}

/** 件名の索引を直接引く（3文字以上の語。MATCH）。案件の ID の昇順 */
export async function ftsMatchCaseIds(term: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT d.ref_id AS id FROM search_fts f JOIN search_documents d ON d.id = f.rowid
     WHERE search_fts MATCH ? AND d.kind = 'case_title' ORDER BY d.ref_id`,
  )
    .bind(phraseOf(term))
    .all<{ id: string }>();
  return results.map((r) => r.id);
}

/** 件名の索引を直接引く（1〜2文字の語。instr）。案件の ID の昇順 */
export async function ftsInstrCaseIds(term: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT d.ref_id AS id FROM search_fts f JOIN search_documents d ON d.id = f.rowid
     WHERE instr(lower(f.text), lower(?)) > 0 AND d.kind = 'case_title' ORDER BY d.ref_id`,
  )
    .bind(term)
    .all<{ id: string }>();
  return results.map((r) => r.id);
}

export type CaseTitleIndexRow = {
  id: number;
  kind: string;
  ref_id: string;
  room_id: string | null;
  message_id: string | null;
  created_at: string;
  source_body: string;
  fts_text: string | null;
};

/** その案件の件名の写し（対応の表の行と、検索用の表の文）。行の id の昇順 */
export async function caseTitleIndexRowsOf(
  caseId: string,
): Promise<CaseTitleIndexRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT d.id AS id, d.kind AS kind, d.ref_id AS ref_id, d.room_id AS room_id, d.message_id AS message_id,
       d.created_at AS created_at, d.source_body AS source_body,
       (SELECT f.text FROM search_fts f WHERE f.rowid = d.id) AS fts_text
     FROM search_documents d WHERE d.kind = 'case_title' AND d.ref_id = ? ORDER BY d.id`,
  )
    .bind(caseId)
    .all<CaseTitleIndexRow>();
  return results;
}

/** 件名の索引の全体（対応の表の行と、検索用の表の行）。失敗した操作の前後で完全に同じであることを確かめる */
export async function caseTitleIndexSnapshot() {
  const documents = (
    await env.DB.prepare(
      `SELECT id, kind, ref_id, room_id, message_id, created_at, source_body
       FROM search_documents WHERE kind = 'case_title' ORDER BY id`,
    ).all<Record<string, unknown>>()
  ).results;
  const fts = (
    await env.DB.prepare(
      `SELECT f.rowid AS rowid, f.text AS text FROM search_fts f
       WHERE f.rowid IN (SELECT id FROM search_documents WHERE kind = 'case_title') ORDER BY f.rowid`,
    ).all<Record<string, unknown>>()
  ).results;
  return { documents, fts };
}

/** 写しを直接入れる（索引の遅れ・不整合の状態を作る）。ftsText を省くと sourceBody。kind を省くと case_title。対応の表の id を返す */
export async function insertCaseTitleIndexRow(seed: {
  caseId: string;
  createdAt: string;
  sourceBody: string;
  ftsText?: string;
  kind?: string;
  roomId?: string | null;
  messageId?: string | null;
  /** 偽なら検索用の表の行を入れない（対応の行だけの欠け） */
  withFts?: boolean;
}): Promise<number> {
  const inserted = await env.DB.prepare(
    `INSERT INTO search_documents (kind, ref_id, room_id, message_id, created_at, source_body)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(
      seed.kind ?? "case_title",
      seed.caseId,
      seed.roomId ?? null,
      seed.messageId ?? null,
      seed.createdAt,
      seed.sourceBody,
    )
    .first<{ id: number }>();
  if (inserted === null) throw new Error("写しを入れられませんでした");
  if (seed.withFts !== false)
    await env.DB.prepare("INSERT INTO search_fts (rowid, text) VALUES (?, ?)")
      .bind(inserted.id, seed.ftsText ?? seed.sourceBody)
      .run();
  return inserted.id;
}

/** 検索用の表に、対応の行の無い行を直接入れる（検索用の行だけの欠け） */
export async function insertOrphanFtsRow(
  rowid: number,
  text: string,
): Promise<void> {
  await env.DB.prepare("INSERT INTO search_fts (rowid, text) VALUES (?, ?)")
    .bind(rowid, text)
    .run();
}

export type CaseTitleIndexMismatches = {
  /** 案件があるのに、件名の写しが無い */
  missing: number;
  /** 写しがあるのに、元の案件が無い */
  missingCase: number;
  /** 写しの元の件名（source_body）と、案件のいまの件名が違う */
  wrongTitle: number;
  /** 写しの作成日時と、案件の作成日時が違う */
  wrongCreatedAt: number;
  /** 写しの部屋・メッセージの列が NULL でない（件名の行は部屋に属さない） */
  wrongColumns: number;
  /** 対応の行に、検索用の行が無い */
  withoutFts: number;
  /** 検索用の行の文が、対応の行の元の件名と違う */
  wrongFtsText: number;
  /** 検索用の行に、対応の行が無い（種類を問わず全体） */
  orphanFts: number;
};
// 同じ案件の写しが2行以上になる状態は、(kind, ref_id) の一意索引で作れないため数えない（常に0になる数えを置かない）

export const NO_CASE_TITLE_MISMATCH: CaseTitleIndexMismatches = {
  missing: 0,
  missingCase: 0,
  wrongTitle: 0,
  wrongCreatedAt: 0,
  wrongColumns: 0,
  withoutFts: 0,
  wrongFtsText: 0,
  orphanFts: 0,
};

/** 件名の索引と cases の不一致（計画 I-2 の分類）。分類ごとに独立に数える */
export async function caseTitleIndexMismatches(): Promise<CaseTitleIndexMismatches> {
  const docs = "FROM search_documents d WHERE d.kind = 'case_title'";
  const row = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM cases k
         WHERE NOT EXISTS (SELECT 1 FROM search_documents d WHERE d.kind = 'case_title' AND d.ref_id = k.id)) AS missing,
       (SELECT COUNT(*) ${docs}
         AND NOT EXISTS (SELECT 1 FROM cases k WHERE k.id = d.ref_id)) AS missingCase,
       (SELECT COUNT(*) ${docs}
         AND EXISTS (SELECT 1 FROM cases k WHERE k.id = d.ref_id AND k.title <> d.source_body)) AS wrongTitle,
       (SELECT COUNT(*) ${docs}
         AND EXISTS (SELECT 1 FROM cases k WHERE k.id = d.ref_id AND k.created_at <> d.created_at)) AS wrongCreatedAt,
       (SELECT COUNT(*) ${docs}
         AND (d.room_id IS NOT NULL OR d.message_id IS NOT NULL)) AS wrongColumns,
       (SELECT COUNT(*) ${docs}
         AND NOT EXISTS (SELECT 1 FROM search_fts f WHERE f.rowid = d.id)) AS withoutFts,
       (SELECT COUNT(*) ${docs}
         AND EXISTS (SELECT 1 FROM search_fts f WHERE f.rowid = d.id AND f.text <> d.source_body)) AS wrongFtsText,
       (SELECT COUNT(*) FROM search_fts f
         WHERE NOT EXISTS (SELECT 1 FROM search_documents d WHERE d.id = f.rowid)) AS orphanFts`,
  ).first<CaseTitleIndexMismatches>();
  if (row === null) throw new Error("件名の索引の不一致を数えられませんでした");
  return row;
}

/** 件名の写しの全体の行数 */
export async function totalCaseTitleDocuments(): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM search_documents WHERE kind = 'case_title'",
  ).first<{ n: number }>();
  return row?.n ?? -1;
}

/**
 * 件名の索引の後始末：元の案件が無くなった写しと、対応の行の無い検索用の行を消す。
 * 案件を消す後始末（cleanupCaseTestData）の後に呼ぶ（テストの案件の写しは、案件が消えると孤立になるため、ここで全部消える）。
 * 表がまだない（実装前）ときは何もしない。
 */
export async function cleanupCaseTitleIndex(): Promise<void> {
  const exists = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('search_documents', 'search_fts')",
  ).first<{ n: number }>();
  if ((exists?.n ?? 0) < 2) return;
  const target = `SELECT d.id FROM search_documents d WHERE d.kind = 'case_title'
    AND d.ref_id NOT IN (SELECT id FROM cases)`;
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM search_fts WHERE rowid IN (${target})`),
    env.DB.prepare(`DELETE FROM search_documents WHERE id IN (${target})`),
    env.DB.prepare(
      "DELETE FROM search_fts WHERE rowid NOT IN (SELECT id FROM search_documents)",
    ),
  ]);
}
