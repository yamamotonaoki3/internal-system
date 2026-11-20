-- 手で書く migration（#155・D-1）。FTS5 の仮想の表は Drizzle の生成に乗らないため、schema.ts に書かずにここで作る。
-- 中身を自分で持つ表（外部の内容の表・トリガーは使わない）。rowid は search_documents.id。更新は backend/src/db/search-index.sql.ts の組だけで行う
CREATE VIRTUAL TABLE `search_fts` USING fts5(text, tokenize='trigram');
