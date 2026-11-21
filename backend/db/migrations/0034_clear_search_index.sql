-- 手で書く migration（#155・ADR-0031）。次の migration で search_documents を作り直すと、採番の履歴を失い、最大の番号が使い回される。
-- 対応の行のない古い検索用の行が残っていると、新しい対応の行が古い文と結び付き、別のメッセージの文で一致してしまう。
-- 索引は元のメッセージ・添付からいつでも作り直せる写しなので、作り直しの前に両方の表を空にし、適用の後に search-reindex で登録し直す。
-- 2つの文は、片方だけが当たる状態を作らないよう、同じ migration に置く
DELETE FROM search_fts;
--> statement-breakpoint
DELETE FROM search_documents;
