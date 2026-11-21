# メッセージの検索（S-15・ヘッダーの検索欄。Issue #155 の155-A・155-B）

## 目的

キーワードで、自分が見られるメッセージだけを、本文と添付のファイル名から検索し、結果から元のやり取りへ移れるようにする（4-1 AC-1〜AC-3、Issue #155 の AC-1〜AC-4）。検索の方式は、D1 の FTS5 の`trigram`（C-152・[ADR-0010](../adr/0010-japanese-search-fts5-trigram.md)）。検索用の表の migration は手で書く（[ADR-0031](../adr/0031-search-fts-handwritten-migration.md)）。コードは書き写さず、ファイル名・関数名で指す。

## 範囲

| 区分 | 内容 |
| --- | --- |
| 155-A で作ったもの | 検索用の表（`search_documents`・`search_fts`。migration 0032・0033）／索引の更新の部品と、メッセージの本文を書く7か所への組み込み／既存のメッセージの登録の処理と、手元での実行（`search-reindex`）／`GET /api/search/messages`（EP-4-01。部屋・期間の絞り込み、カーソル）／S-15（メッセージの結果）とヘッダーの検索欄／案件の資格を失ったときの、検索のキャッシュの取り除き |
| 155-B で作ったもの | 添付のファイル名の索引（種類`attachment`）／種類の CHECK を変える migration（0034 で写しを空にし、0035 で表を作り直す。ADR-0031 の追記）／投稿・返信の結び付けと論理削除の batch への、添付の組の組み込み／既存の添付の登録（`reindexMessages`を広げた）／EP-4-01 の応答の`matchedIn`・`matchedAttachments`／S-15 の「ファイル名で一致」の印と、一致したファイル名の一覧（利用者の決定 B-1〜B-5。C-201） |
| 155-B で作らなかったもの | 「ファイル名だけ」の絞り込み（B-5）／結果のファイル名からファイルを直接開くこと（B-4）／添付の中身の検索 |
| 後の子 | 155-C：案件の件名・案件番号・取引先名（種類`case_title`。CHECK はすでに通す。EP-4-02。S-15 の案件の結果） |
| 親 #155 の残り（延期） | 全社員公開アーカイブの、参加していない人向けの検索（D-4。公開承認の仕組みがまだない）。TODO の検索（D-5。C-152 の「後から追加できる」） |
| 作らなかったもの | 検索の回数の制限（429。D-7。上限が X-8 で未決定のため、#160 の実測の後に判断）／総件数の表示／部屋の絞り込みを選ぶ部品（URL の`roomId`だけを引き継ぐ）／4-1 AC-4【案】の「参加していません」の表示（C-144 の案で、決定ではない）／添付の中身の検索 |
| #160 に回すもの | 本物の D1 での trigram の確認、30万件の実測（語1・2・3・10・50・100文字。p95 2秒）、Time Travel の確認、本番での migration 0032〜0035 の適用と既存のメッセージ・添付の登録 |

## ファイルと役割

### 共通（`shared/`）

| ファイル | 役割 |
| --- | --- |
| `shared/search-rules.ts` | 検索語の検査`searchKeywordSchema`（前後の空白を除いて1〜100文字。上限は UTF-16 の単位で数える）と、方式の境目`SEARCH_TRIGRAM_MIN_CODE_POINTS`（3。コードポイントで数える）の**定義元**。`searchKeywordSchema`は、検索・メッセージの一覧の`q`・社員の検索（`GET /api/users`）の`q`・画面の検索欄が使う。#155 で、上限の判定を UTF-16 で数える形に変えた（zod の`max`はサロゲートペアを1文字と数えるため） |
| `shared/search-text.ts` | 索引に入れる本文を作る`toSearchText`（マークダウンの記号を除く）と、一致の位置`findSearchMatches`の**定義元**。索引・抜粋・画面の強調が同じ規則で同じ文を見るよう、ここの1か所に置く。テストは`backend/src/lib/search-text.test.ts`（vitest の対象が backend と frontend だけのため） |

### バックエンド

| ファイル | 役割 |
| --- | --- |
| `backend/db/schema.ts`（`searchDocuments`・`SEARCH_DOCUMENT_KINDS`）、`backend/db/migrations/0032_add_search_documents.sql` | 対応の表`search_documents`。生成物のまま。種類の値の**定義元**は読み取り専用の定数`SEARCH_DOCUMENT_KINDS`（`message`・`attachment`・`case_title`）で、CHECK はここから作る（155-B） |
| `backend/db/migrations/0033_add_search_fts.sql` | 検索用の表`search_fts`（FTS5・`trigram`）。**手で書いた**（ADR-0031）。`schema.ts`には書かない |
| `backend/db/migrations/0034_clear_search_index.sql` | `search_fts`と`search_documents`の行を全部消す。**手で書いた**（ADR-0031 の追記。次の作り直しで採番の記録を失っても、古い文が新しい行に結び付かないようにするため）。155-B |
| `backend/db/migrations/0035_change_search_document_kinds.sql` | `search_documents`の作り直し（CHECK を3つの種類に変える）。生成物のまま。155-B |
| `backend/src/db/search-index.sql.ts` | 索引の更新の文の組`syncMessageIndexStatements`・`removeStaleMessageIndexStatements`と、添付のファイル名の組`syncAttachmentIndexStatements`・`removeStaleAttachmentIndexStatements`（155-B）。検索用の表の形（batch に入れる文を組むためのもの）は、このファイルの中だけに置く |
| `backend/src/db/message.repository.ts`・`reply-insert.sql.ts`・`message-modify.sql.ts` | メッセージの本文を書く batch の末尾に、索引の組を足した。投稿・返信・論理削除には、添付の組も足した（下の「書き込みへの組み込み」） |
| `backend/src/db/search-reindex.ts` | 既存のメッセージと、その添付のファイル名の登録`reindexMessages` |
| `backend/src/db/search.repository.ts` | 検索の SQL（`createSearchRepository`の`searchMessages`）。一致の条件・見える範囲・メッセージ単位のまとめ・絞り込み・並び・カーソル・抜粋・`matchedIn`と`matchedAttachments`（`matchesOf`） |
| `backend/src/db/room-visibility.sql.ts` | `directRoomListable`を足した（`perm.dm.message.view`がない人の一覧・検索から DM の部屋を除く。案件の部屋の`caseRoomListable`と同じ作り） |
| `backend/src/lib/search-query.ts` | `toFtsPhrase`（語を1つの句にする）・`searchMethodOf`（`match`か`instr`か）・`buildExcerpt`（抜粋の切り出し） |
| `backend/src/services/search.service.ts` | 権限の判定と、JST の日付を UTC の境目に直すこと（`createSearchService`・`withSearchService`） |
| `backend/src/routes/search.ts` | `GET /api/search/messages`の入力の検査（422）と応答。`backend/src/index.ts`が`/api/search`に登録する |
| `backend/src/routes/audit-logs.ts`（`jstDateSchema`）、`backend/src/db/audit-log.repository.ts`（`jstDayStart`・`jstNextDayStart`） | JST の日付の検査と境目の部品に`export`を付けた（同じ規則を2か所に書かないため。計画の外の変更） |
| `backend/db/seeds/cleanup.sql` | メッセージを消した後に、元のメッセージがなくなった索引の行と、対応の行のない検索用の行を消す。155-B で、元の添付か結ぶメッセージのなくなった添付の写しも消す |
| `docs/api/openapi.json` | EP-4-01 の API 仕様（155-B で`MessageSearchItem`に`matchedIn`・`matchedAttachments`） |

### スクリプト

| ファイル | 役割 |
| --- | --- |
| `scripts/db-generate-args.ts` | `db:generate`の引数の検査`generateArgs`。引数なし・`--name <名前>`・`--custom --name <名前>`だけを通す（`scripts/db-local.ts`から切り出した。テストは`scripts/db-generate-args.test.mjs`。`npm test`の`node --test`に足した） |
| `scripts/db-local.ts`（`search-reindex`） | 手元の D1 だけで、既存のメッセージの索引を作る。追加の引数（`--remote`など）と、D1 でない環境（`DATABASE_URL`がある環境）は拒否する |
| `scripts/search-reindex-local.ts` | `reindexLocalSearch`。wrangler の`getPlatformProxy`（`remoteBindings: false`）で、`db-local.ts`の他の操作と同じ保存先の D1 を開き、`reindexMessages`を最後まで繰り返す。本文は画面に出さず、件数だけを出す |

### フロントエンド

| ファイル | 役割 |
| --- | --- |
| `frontend/src/features/search/api/search-api.ts`・`query-keys.ts` | `searchMessages`（応答は zod で検証。155-B で`matchedIn`〔1つ以上〕・`matchedAttachments`を足し、「`matchedIn`が`attachment`を含む ⇔ `matchedAttachments`が1件以上」を確かめる。食い違う応答は、取得の失敗として扱う）。キー`searchKeys.messages(利用者の ID, 条件, ページ数)`＝`['search', 利用者の ID, 'messages', 条件, ページ数]`、`searchKeys.user(利用者の ID)`＝その利用者の検索の全部 |
| `frontend/src/features/search/hooks/useMessageSearch.ts` | 結果の取得（`useQuery`。見せるページ数を状態に持ち、取得のたびに1ページ目からその数だけ順に取る。`showMore`でページ数を増やす）。キャッシュに持たない設定（下の「画面」） |
| `frontend/src/features/search/components/` | `HeaderSearch`（ヘッダーの検索欄）、`SearchKeywordForm`（語の入力欄。ヘッダーと S-15 で共用）、`SearchConditionsForm`（語と、折りたたんだ期間の絞り込み）、`MessageSearchResults`（読み込み中・0件・失敗と再試行・さらに表示。155-B で、ファイル名で一致した行の印と名前の一覧〔中の部品`MatchedAttachmentNames`〕）、`HighlightedExcerpt`（抜粋の中の一致を`<mark>`で強調） |
| `frontend/src/pages/SearchPage.tsx`、`frontend/src/App.tsx`（`/search`） | S-15。URL の`q`・`roomId`・`from`・`to`で検索する。`q`がなければ API を呼ばない |
| `frontend/src/features/app-shell/Header.tsx` | `HeaderSearch`を置いた |
| `frontend/src/features/cases/hooks/useCaseWrites.ts`（`forgetCaseContent`・`forgetSearchResults`） | 案件の資格を失ったときに、その利用者の検索の結果（`searchKeys.user`）も片付ける（取り消し → 表示していない分の取り除き → 表示中の分の`resetQueries`。下の「画面」） |

## 表の構成（migration 0032〜0035）

- `search_documents`（普通の表）：`id`（整数の主キー。`AUTOINCREMENT`）・`kind`（CHECK は`'message'`・`'attachment'`・`'case_title'`。0035 で、`'message'`だけから変えた。`case_title`は 155-C で使う）・`ref_id`（元の行の ID。添付の写しは添付の ID）・`room_id`（部屋の絞り込み）・`message_id`（結ぶメッセージ。メッセージ自身は同じ ID）・`created_at`（期間の絞り込み。元のメッセージの作成日時の写し）・`source_body`（写しの元の本文）。`(kind, ref_id)`の一意索引、`(room_id, created_at, id)`・`(kind, created_at, id)`の索引。元の行を消す後始末に縛られないよう、外部キーは張らない
- `search_fts`（FTS5。`text`の1列。`tokenize='trigram'`）：中身（記号を除いた本文）を自分で持つ。外部の内容の表・トリガーは使わない
- **rowid ＝`search_documents.id`**。整数の番号は検索用の表との対応にだけ使い、並び・カーソルには使わない（更新のたびに採番し直すため）
- 添付の写し（`kind = 'attachment'`）の各列：`ref_id`＝添付の ID、`room_id`＝添付の部屋、`message_id`＝結ぶメッセージ、`created_at`＝**メッセージの**作成日時（アップロードの時刻ではない。期間・並びをメッセージの結果とそろえるため）、`source_body`と検索用の表の`text`＝`original_name`を**記号を除かずにそのまま**（B-3。ファイル名の`_`・`*`などは名前の一部のため。`toSearchText`を当てない）
- **表を作り直すとき**：作り直しは採番の記録を失い、番号が使い回されうる。対応の行のない古い検索用の行が残っていると、新しい行に古い文が結び付くため、作り直しの前に写しを全部消し（0034）、生成のままの作り直し（0035）の後に登録し直す。今後の作り直しもこの手順にする（[ADR-0031](../adr/0031-search-fts-handwritten-migration.md)の追記）

## 索引の更新（`search-index.sql.ts`）

「索引の対象」は、未削除で部屋のあるメッセージ（`deleted_at IS NULL`かつ`room_id IS NOT NULL`）。

`syncMessageIndexStatements(db, { messageId, sourceBody })`は、次の4つの文の組を返す。記号を除いた本文は、部品の中で`toSearchText(sourceBody)`から作る（呼び出し側は元の本文だけを渡す）。

1. いまの行と一致しない写し（元がない・削除済み・本文が`source_body`と違う）を、検索用の表から消す
2. 同じ条件で、対応の表の行を消す
3. いまの本文が`sourceBody`と一致し、まだ写しがないときだけ、対応の表に行を入れる
4. 対応の表の行があり、`source_body`が`sourceBody`と一致し、検索用の表にまだ行がないときだけ、記号を除いた本文を入れる

`removeStaleMessageIndexStatements`は、1・2 だけの組（削除で使う）。

性質（テストで固定した）：

- **べき等**：各文の結果は「いまの行の状態」と「渡した`sourceBody`」だけで決まる。同じ組を何度実行しても同じ
- **順序に依らない**：正しい写しは、どの呼び出しでも消えない。合わない写しは、どの呼び出しでも消える。新しい写しが入るのは、渡した元の本文がいまの本文と一致するときだけ。このため、編集と既存のメッセージの登録が、どの順で実行されても、最後に索引はいまの行と一致する
- **拒否された編集では変わらない**：条件つきの UPDATE が0件で成功しても（他人・削除済みなど）、いまの本文の写しは消えず、渡した新しい本文の写しも入らない
- **削除済みは残らない**：削除が確定すれば、写しは対象でなくなり消える。拒否されれば残る
- batch が取り消されれば（添付の結び付けの失敗など）、索引の文も取り消される

件数の判定に、索引の文の結果を使わない。D1 の`meta.changes`は、FTS5 の内部の表への書き込みも数えるため（T-0 で確かめた）。既存の戻り値は、主の文の`meta.changes`から取る。

### 添付のファイル名の組（155-B）

`syncAttachmentIndexStatements(db, messageId)`は、次の4つの文の組を返す。引数はメッセージの ID だけで、値はすべて DB のいまの行から写す。

1. そのメッセージの添付の写しのうち、いまの行と合わないものを、検索用の表から消す
2. 同じ条件で、対応の表の行を消す
3. そのメッセージに結び付いた添付のうち、まだ写しのないものを、対応の表に入れる（メッセージが索引の対象で、メッセージと添付の部屋が同じときだけ）
4. 対応の表の行があり、検索用の表にまだ行がないものに、名前を入れる

「いまの行と合う」写しの条件（どれか1つでも崩れたら、古い写しとして消す）：

| 条件 | 崩れる場面の例 |
| --- | --- |
| 添付の行が実在する（`a.id = d.ref_id`） | 添付の行が消えた |
| 添付の`message_id`が写しの`message_id`と同じ | 結び付きが別のメッセージに変わった |
| 添付の`room_id`が写しの`room_id`と同じで、メッセージの部屋とも同じ | 部屋が食い違う |
| `original_name = source_body` | 名前が変わった |
| メッセージの`created_at`が写しの`created_at`と同じ | 日時の食い違い |
| メッセージが索引の対象（未削除・部屋あり） | 論理削除された |

`removeStaleAttachmentIndexStatements`は、1・2 だけの組（論理削除で使う）。性質はメッセージの組と同じ（べき等・順序に依らない・拒否された削除では変わらない・削除済みは残らない・batch の取り消しで索引も取り消される。テストで固定した）。

## 書き込みへの組み込み（7か所）

| 書き込み | 場所 | 入れ方 |
| --- | --- | --- |
| 投稿 | `message.repository.ts`の`insertIfOrdered`の batch | 既存のガード（`guardInsertedMessage`）の**後ろ、batch の末尾**に`syncMessageIndexStatements`。ガードとの間に挟まない（ガードは直前の文の`changes()`を見るため） |
| 返信 | `reply-insert.sql.ts`の`insertReplyIfOrdered`の batch | 同上 |
| 本文の編集（互換の経路） | `message-modify.sql.ts`の`updateBodyIfModifiable`（`roomId`がないとき） | 単文の UPDATE を batch に変え、末尾に組を足した。戻り値は UPDATE の`meta.changes`のまま |
| 本文の編集（batch の経路） | 同（`roomId`があるとき） | 条件つきの UPDATE の後ろ、末尾に組を足した |
| 論理削除 | `message-modify.sql.ts`の`deleteIfModifiable` | 末尾に`removeStaleMessageIndexStatements` |
| 添付の結び付けの`room_id`の UPDATE | 投稿・返信の batch の中 | 投稿・返信の組（末尾）で足りる。失敗すれば batch ごと取り消される |
| 既存のメッセージの登録 | `search-reindex.ts`の`reindexMessages` | 行ごとに1つの batch で組を実行する |

索引を変えない操作：チャンネルのアーカイブ・復元・公開範囲・参加、退職、部署の無効化、案件の終了・再開。見える範囲は、検索の SQL がその時点の資格で決める。メッセージの本文を書く処理を新しく足すときは、同じ batch の末尾に組を足す（[messages.md](messages.md)）。

### 添付の書き込みの経路（155-B）

| 経路 | 場所 | 添付の組 | 理由 |
| --- | --- | --- | --- |
| 投稿への結び付け | `message.repository.ts`の`insertIfOrdered`の batch | 末尾（メッセージの組の後ろ）に`syncAttachmentIndexStatements` | 結び付いた添付が、投稿と同時に検索に出る |
| 返信への結び付け | `reply-insert.sql.ts`の`insertReplyIfOrdered`の batch | 同上 | 同上 |
| 結び付けの失敗（件数・容量・他人の添付） | 同上 | 組を含めて batch ごと取り消される | 索引も残らない |
| 論理削除 | `message-modify.sql.ts`の`deleteIfModifiable` | 末尾に`removeStaleAttachmentIndexStatements` | 削除が確定したときだけ、名前の写しが対象外になって消える |
| 既存の分の登録 | `search-reindex.ts`の`reindexMessages` | 行ごとの batch に、メッセージの組と添付の組 | シード・migration の後の登録 |
| 本文の編集（2経路） | `updateBodyIfModifiable` | 何もしない | 添付は変わらない。メッセージの組は`kind = 'message'`だけを見るので、添付の写しは残る |
| アップロード（未投稿） | `attachment.repository.ts`の`insertPending` | 何もしない | 未投稿の添付は索引に入れない（本人にも検索で出さない） |
| 未投稿の掃除 | `deletePendingBefore` | 何もしない | 未投稿だけを消すので、写しはない |
| 案件の添付の公開範囲の変更 | `case-attachment.repository.ts`の`changeVisibility` | 何もしない | 公開範囲は検索の読み取りの資格に使わない（下の「見える範囲」） |

チャンネル・案件・添付を物理削除するアプリのコードは、いまはない。**#270（添付の削除）など、`message_attachments`を変える処理を新しく足すときは、同じ batch の末尾に添付の組を足し**、`backend/src/db/search-index.attachments.db.test.ts`の書き込みの経路の一覧のテストにも足す（漏れると、消えた添付の名前は検索の SQL の条件で出ないが、新しい名前が検索に出ない）。

## 既存のメッセージの登録（D-9）

- `reindexMessages(db, { afterId, batchSize })`：`messages.id`の順に、未削除で部屋のある行を`batchSize`件（既定100）読み、行ごとに組（`sourceBody`＝読んだ本文）と、その行の添付の組（155-B）を1つの batch で実行し、最後に読んだ ID を返す（読む行がなければ`null`）。組がべき等なので、途中で失敗しても、最初から、または返った ID から再開してよい。実行の間の投稿・編集とも食い違わない
- 手元：`node scripts/db-local.ts <development|test> search-reindex`。シードの SQL はメッセージを直接入れるため、シードの後に必ず実行する（実行しないと、既存のメッセージは検索に出ない）。**既存の手元の DB に migration 0034・0035 を当てた後も実行する**（0034 が写しを空にするため。実行しないと、既存のメッセージ・添付が検索に出ない）。npm のスクリプトは足していない
- テスト：vitest は`env.DB`に対して関数を直接呼ぶ（`backend/test/search-fixtures.ts`）。E2E は spec の`beforeAll`で、シードの後に`search-reindex`を呼ぶ
- 本番：#160。実行の経路、書き込みとの競合の確認（本物の D1）、検索を公開する条件（登録の完了と、索引と元の表の不一致が0件であることの確認の後）を、#160 で示して承認を得る

## 検索の処理（`GET /api/search/messages`）

### 入力（`routes/search.ts`）

- `q`：`searchKeywordSchema`（前後の空白を除いて1〜100文字。UTF-16 の単位）。この API だけ、NUL（`\u0000`）を含む語を 422 にする（FTS5 は句の途中の NUL を文字列の終わりとして扱うため。共通の`searchKeywordSchema`は変えない）
- `roomId`（任意。ULID）：見えない部屋を指定しても、0件の 200（存在を示さない）
- `from`・`to`（任意。`YYYY-MM-DD`の JST の日付。両端を含む）：形・暦の検査は`jstDateSchema`。`from`が`to`より後なら 422
- `limit`（1〜50。既定は`PAGE_LIMIT.default`の20）、`cursor`（不正は 422）。ほかのクエリの項目は拒否する（`strict`）
- 応答に`noStore`を付ける。検索語はログに出さない

### 権限（`search.service.ts`）

| 判定 | 権限 | 権限がないとき |
| --- | --- | --- |
| 入口 | `perm.search.message`（R-58） | 403（`authorize`。拒否は監査に記録する） |
| DM の部屋を含めるか | `perm.dm.message.view` | DM の部屋を除いて、検索は成功させる（`can`。監査に残さない） |
| 案件の部屋を含めるか | `perm.case.view` | 案件の部屋を除いて、検索は成功させる（同上） |

スレッドの一覧と同じ作り。権限のない部屋は、取得の後に除くとページの件数とカーソルがずれるため、SQL の条件で除く。

### 方式の切り替え（`searchMethodOf`）

- 語の**コードポイント数**が3以上：`search_fts MATCH`（trigram）
- 3未満：`instr(lower(f.text), lower(語)) > 0`（D-3。社員一覧の検索〔C-168〕と同じ）。全件の走査になるため、部屋・期間の絞り込みと併用して件数を抑える（ADR-0010）
- 上限（UTF-16）と境目（コードポイント）は、数え方が違うので別の定数にしている
- 正規化するのは前後の空白の除去だけ。全角・半角、合成済み・結合文字は、別の文字として扱う（索引も同じ）。英字の大小文字は、3文字以上は trigram の規則（区別しない）、1〜2文字は`lower()`（ASCII の英字だけ区別しない）

### 入力の無害化

- `MATCH`の語は`toFtsPhrase`で全体を`"`で囲み、中の`"`を`""`にして1つの句にし、バインドで渡す。FTS5 の構文の文字（`*`・`^`・`:`・かっこ・`AND`・`OR`・`NOT`・`NEAR`など）を構文として解釈させない。空白を含む語も、空白を含めた1つの句（D-6）。NUL を含む語を渡されたら、`toFtsPhrase`は例外を投げる（API が先に 422 で拒否するので、来るのは呼び出し側の誤りだけ）
- `instr`は`LIKE`を使わないので、`%`・`_`・`\`も文字として扱う

### 見える範囲（`search.repository.ts`）

次の条件を、すべて**`LIMIT`より前の`WHERE`**に入れる。見えない一致が、件数・次の有無・抜粋に影響しない。

- `roomViewableBy`（`room-visibility.sql.ts`）：閲覧者が有効／チャンネルは未アーカイブで、公開か参加中の非公開／DM は当事者。案件の部屋は非公開のチャンネル＝有効な参加者だけ（全体管理者・オーナーも、参加していなければ出ない）。終了しただけの案件の部屋は、参加者には出る
- `directRoomListable`（DM を含めるか）・`caseRoomListable`（`case-room.sql.ts`。案件の部屋を含めるか）
- 元の行と結び、`m.deleted_at IS NULL`と`m.room_id = d.room_id`（索引が遅れても削除済み・移った行を返さない）

既存の一致の対象の一覧と同じく出すもの（テストで固定）：削除済みの親への未削除の返信、退職した相手との DM、退職した投稿者のメッセージ、無効の部署のチャンネル。155-B では、削除済みの親への未削除の返信の添付、案件の部屋の参加者限定（`participants_only`）の添付（参加者に）も出す。

#### SQL の組み立ての順（155-B）

1. 一致：検索用の表で語に一致した写しの行（本文の行・添付の行）を出す。メッセージとは`d.message_id`で結ぶ
2. 適格の確定：写しの行ごとに、下の表の条件を`WHERE`で確かめ、適格な行だけを残す
3. まとめ：適格な行だけを`GROUP BY m.id`でメッセージ単位にまとめる。本文の行があれば`body`、添付の行の名前を集めて`attachment`（`matchedIn`・`matchedAttachments`）。本文と名前の両方が一致しても1件
4. 並び・カーソル・`LIMIT`

まとめは`LIMIT`より前で、不適格な行は 2 で落ちるため、見えない一致・合わない写しが、件数・次の有無・カーソル・名前の一覧・`matchedIn`に混ざらない。

| 適格の条件 | 防ぐもの |
| --- | --- |
| 本文の行：`d.ref_id = m.id` | 種類の取り違え（本文の行に添付の ID が入っている） |
| 添付の行：添付が実在する（`a.id = d.ref_id`） | 消えた添付の名前（索引の遅れ・後始末の漏れ） |
| 添付の行：`a.message_id = m.id` | 別のメッセージ・未投稿の添付の名前 |
| 添付の行：`a.room_id = m.room_id` | 部屋の食い違う添付の名前 |
| 添付の行：`a.original_name = d.source_body` | **写しの名前と、いまの名前が食い違う添付は出さない**（統括の決定。古い名前でも新しい名前でも、同期までは出ない） |
| 共通：`m.deleted_at IS NULL`・`m.room_id = d.room_id`・`roomViewableBy`・`directRoomListable`・`caseRoomListable` | 削除済みのメッセージ、見えない部屋、権限で除く部屋 |

`matchesOf`は、まとめた行から`matchedIn`（`body` → `attachment`の順）と`matchedAttachments`（添付の ID の昇順。名前はいまの`original_name`）を作る。どちらも無い行は SQL の誤りとして例外にする（成功として扱わない）。

#### 添付の配信の認可との対応（155-B）

SQL の見える範囲：

| 条件 | 配信（`attachment-visibility.sql.ts`の`attachmentVisible`） | 検索 |
| --- | --- | --- |
| 閲覧者が有効・部屋を見てよい | `roomViewableBy`（添付の部屋） | `roomViewableBy`（メッセージの部屋）と、添付の部屋＝メッセージの部屋 |
| 投稿に結び付いている | 結び付いた添付 | `a.message_id = m.id` |
| メッセージが未削除 | 条件にある | 同じ |
| 未投稿の添付 | アップロードした本人だけ | 出さない（本人にも。検索のほうが狭い） |

Service の権限：

| 判定 | 配信（`attachment.service.ts`の`download`） | メッセージの表示（添付の名前を出す） | 検索 |
| --- | --- | --- | --- |
| 入口 | `perm.attachment.download`（403） | 一覧の権限 | `perm.search.message`（403） |
| DM | `perm.dm.message.view`も確かめる | 同じ | なければ DM の部屋を除く |
| 案件の部屋 | `perm.case.view`も確かめる | 同じ | なければ案件の部屋を除く |

- 部屋・結び付き・削除の条件は、配信と同じ。未投稿は検索のほうが狭い。入口の権限は別のもの（配信はファイルの本体、検索は名前の読み取り）
- **ファイル名の読み取りは、メッセージの表示と同じ扱い**にする。メッセージの表示は、ダウンロードの権限を確かめずに添付の名前を出しているため、検索も`perm.attachment.download`を確かめない。いまの役割の設定では、3つの役割すべてが`perm.attachment.download`を持つ（`backend/src/lib/permissions.ts`）。**役割の権限の設定を変えて、ダウンロードの権限を外す場合は、メッセージの表示と検索を一緒に見直す**
- **案件の添付の公開範囲（`publication_visibility`）は、検索の読み取りの資格に使わない**。案件の部屋は有効な参加者だけが見え、参加者はどの公開範囲の添付も一覧・配信で見られるため（148-B-2 と同じ）。参加していない人向けの検索（全社員公開アーカイブ）は範囲外（D-4）

**総件数は返さない**。件数を返すと、見えないメッセージの存在が件数の差から推し量れるため（4-2 AC-2「件数からも漏らさない」）。`limit + 1`件を読み、次の有無だけを決める。FTS5 の`snippet()`・`bm25`は使わない。

### 期間・並び・カーソル

- 期間：Service が、`from`を JST のその日の 00:00、`to`を JST の翌日の 00:00（含めない側）に直し（`jstDayStart`・`jstNextDayStart`）、`search_documents.created_at`と比べる
- 並び：`messages.created_at`の降順、同じなら`messages.id`の降順
- カーソル：メッセージの`(created_at, id)`（`backend/src/lib/cursor.ts`の`toPage`。ID は ULID を確かめる）

### 抜粋と強調

- 資格を確かめた後の、いまの本文に`toSearchText`を当て、その文の中で一致を探して切り出す（`buildExcerpt`）。索引と同じ文の上で探すので、記号をまたぐ一致（`申**請**手続`を「申請手続」で）も抜粋に出る。抜粋は記号を除いた文で、画面ではマークダウンとして描かない
- **名前だけの一致**（155-B）：本文に一致がないため、`buildExcerpt`の一致なしの動きで、本文の先頭（120 コードポイントまで。強調なし）を抜粋にする
- 長さ：120 コードポイント。本文がそれ以下なら全体。長いときは、最初の一致の前に最大40 コードポイントを残して切り出す。語が長く、一致の長さと40の和が120を超えるときは、前に残す長さを縮め、一致の全体が抜粋に入るようにする。コードポイントの単位で切るので、サロゲートペアを切らない
- 一致の位置（`findSearchMatches`）：英字（ASCII）だけ大小文字を区別しない。左から重ならずに数える。画面の強調（`HighlightedExcerpt`）も同じ部品を使う。ASCII 以外の大小文字は、trigram の一致と強調が合わない場合がある

### 記号を除く規則（`toSearchText`）

ADR-0026 の許可リストの書式の記号を除き、文字は残す。画面の描画を完全には再現しないので、範囲はテスト（`backend/src/lib/search-text.test.ts`）の期待で固定している。

| 除くもの | 残すもの |
| --- | --- |
| 行頭の引用`>`・見出し`#`・箇条書きの記号（`-`・`*`・`+`）・番号（`1.`・`1)`）。重なっても繰り返し除く | `_`（識別子`file_name`を壊さないため。D-2） |
| 組になった強調・斜体の`*`（1〜3個）、取り消しの`~~` | 組にならない1つだけの`*`（`5*3`など） |
| インラインのコードの`` ` ``、コードブロックの囲みの行の記号 | コードブロックの中身（そのまま） |
| リンクの`[`・`](`・`)` | リンクの表示の文字と URL の両方（D-2） |
| エスケープの`\`（後ろの記号は文字として残す） | エスケープをまたぐ強調・リンクの記号（エスケープで区切って処理するため、除かない。計画と違えた点） |

## 画面（S-15・ヘッダー）

- ヘッダーの検索欄（`HeaderSearch`）から、前後の空白を除いた語で`/search?q=…`へ移る。語の検査は`searchKeywordSchema`を共有する（空・101文字以上は送らずにエラーを出す。サーバーでも検証する）
- S-15（`SearchPage`）：語の欄と、折りたたんだ「絞り込み」（開始日・終了日）。送ると URL を書き換えて取り直す。部屋の絞り込みは URL の`roomId`を引き継ぐだけで、選ぶ部品はない
- 結果：部屋の名前（DM は相手の表示名）・投稿者・日時・抜粋（一致を強調）。押すと元の場所のスレッドへ（チャンネル・案件の部屋は`/channels/<部屋>?thread=`、DM は`/dms/<部屋>?thread=`。返信は親のスレッド。案件の部屋は、チャンネルの画面が案件の画面へ移す）
- **ファイル名で一致した行**（155-B。B-4）：抜粋の下に、印「ファイル名で一致」と、一致したファイル名の一覧（`aria-label="一致したファイル名"`。複数なら全部。1件のメッセージの添付は最大10件）を出す。名前の中の一致は`HighlightedExcerpt`（`findSearchMatches`）で`<mark>`に強調し、名前は文字として描く。名前は**リンクにしない**（結果からファイルを直接開かせず、配信の経路を増やさないため）。行を押したときの移り先は、本文の一致と同じ（そのメッセージのスレッド）。長い名前は行の中で折り返し（`break-all`）、横にはみ出さない。本文だけの一致の行には、印も一覧も出さない
- 応答の`matchedIn`と`matchedAttachments`が食い違う（片方だけ）ときは、zod の検証で取得の失敗として扱い、取得済みの行も出さない（統括の決定。印と名前の片方だけを出さないため）
- 状態：読み込み中・0件（「一致するメッセージはありません」）・失敗と再試行・さらに表示
- **取得のたびに1ページ目から取り直す**：`useMessageSearch`は、見せるページ数を状態とキーに持ち、1ページ目からその数だけ順に取る（カーソルは、同じ取り直しの中の直前のページから作る）。「さらに表示」はページ数を1つ増やし、先頭から取り直す。次のページだけを足す形では、途中で資格を失った部屋の行が前のページに残るため（コードレビューの重大な指摘への対応）。取得が完了した時点で出る行は、その時点のサーバーの応答の行だけになる
- 「さらに表示」の取得の最中は、前の行を出さず、読み込み中だけを出す。取得中はボタンを押せない。失敗したら、取得済みの行も出さず、失敗の文言と再試行だけを出す（再試行は1ページ目から）。条件を変えると（`SearchPage`が結果の部品に`key`を付ける）、ページ数は1に戻る
- **キャッシュに持たない**（抜粋は資格に左右されるため）：`staleTime: 0`・`gcTime: 0`・`retry: false`、画面を離れたら`searchKeys.user`を取り消して取り除く。`placeholderData`を使わず、前の結果を仮に出さない
- **利用者の切り替え**：キーに利用者の ID を入れ、ADR-0030 の枠（`user-switch-guard.ts`）でも捨てられる
- **資格の喪失**：`forgetCaseContent`が`forgetSearchResults`（`useCaseWrites.ts`）を呼び、その利用者の検索の結果（`['search', 利用者の ID]`）を全部片付ける（どの案件の抜粋が入っているかをキーから決められないため）。順は、取り消し → 表示していない分の取り除き（`removeQueries`の`type: 'inactive'`）→ `resetQueries`（表示中の分のデータを消して購読している画面に知らせ、いまの資格で取り直す）。`removeQueries`だけでは表示中の画面に知らせず、出ている抜粋が残るため（2回目のコードレビューの重大な指摘への対応）。取り直しの完了は待たず、取り消しの完了だけを待つ。案件のほかのキーの片付けの方式は変えていない
- **取り消し**：取得は`signal`で取り消せる（`searchMessages`に渡す）。取り消された取得は、残りのページを取りにいかない。別の作業 #323 が、資格を失ったときの後片付けを「ページごと読み込み直す」方式に変える予定で、その後はこの取り除きの扱いも合わせて見直す

## 設計の判断

- 索引の作り方は「自分で中身を持つ表＋アプリの側で更新」（3つの案の比較は ADR-0031）
- 索引の文は「いまの行の状態」と「写しの元の本文」で条件づける。編集の拒否・既存のメッセージの登録との割り込みでも、正しい写しを消さないため（計画レビューの重大な指摘への対応）
- 権限のない部屋・見えない部屋は、SQL の`LIMIT`より前で除く。総件数は返さない
- 155-B：ファイル名の一致は、別の API・別の一覧にせず、EP-4-01 のメッセージの結果に印を付けて混ぜる（D-5・B-4）。「ファイル名だけ」の絞り込みは作らない（B-5）。索引の表の作り直しは、写しを空にしてから行う（B-1。ADR-0031 の追記）。決定は C-201
- 429 は作らない（D-7）。api-draft の EP-4-01 にある 429 は、上限（X-8）が未決定のため、#160 の実測の後に判断する

## テストの場所

- DB：`backend/src/db/search-fts5-capability.db.test.ts`（T-0。手元の D1 で trigram が使えること）、`search-index.db.test.ts`（状態の遷移・順序に依らない一致・7か所の書き込みの後の不一致0件・既存の戻り値）、`search-reindex.db.test.ts`（べき等・再開・分割の境目・migration の更新の試験）、`search.repository.db.test.ts`（一致・見える範囲と権限・期間・ページ・抜粋）、`search.explain.db.test.ts`（実行計画）、`cleanup-sql.search.db.test.ts`（後始末）。準備の部品は`backend/test/search-fixtures.ts`
- 単体：`backend/src/lib/search-query.test.ts`、`backend/src/lib/search-text.test.ts`、`scripts/db-generate-args.test.mjs`
- API：`backend/src/routes/search.test.ts`、`backend/src/services/search.service.test.ts`、`backend/src/openapi.search.test.ts`
- 画面：`frontend/src/pages/SearchPage.test.tsx`、`SearchPage.userSwitch.test.tsx`、`SearchPage.accessLoss.test.tsx`（資格を失った後の「さらに表示」・取り直しの失敗・途中のページの失敗で、前の抜粋を残さない。表示中の画面の後片付け、取り消された取得が残りのページを取りにいかないこと）、`SearchPage.pages.test.tsx`（取得の最中の表示、条件を変えたらページ数が1に戻る、3ページ目までのカーソル）、`frontend/src/features/cases/hooks/useCaseWrites.search-forget.test.ts`。モックは`frontend/src/test/search-handlers.ts`
- 155-B（添付のファイル名）：
  - DB：`backend/src/db/search-documents-kind.upgrade.db.test.ts`（0034・0035 の更新の試験。0034 を飛ばした対照で、孤立した番号の使い回しによる誤った一致を検出できること）、`search-index.attachments.db.test.ts`（状態の遷移・順序に依らない一致・不一致の分類ごとの検出・書き込みの経路の一覧・既存の戻り値）、`search.repository.attachments.db.test.ts`（一致・まとめ・名前の書き換え・見える範囲の条件ごと・ページ・期間・途中で資格を失う）。既存の`search.explain.db.test.ts`・`search-reindex.db.test.ts`・`cleanup-sql.search.db.test.ts`に事例を足した
  - API：`backend/src/routes/search.attachments.test.ts`、`openapi.search.test.ts`・`services/search.service.test.ts`に事例を足した
  - 画面：`frontend/src/pages/SearchPage.attachments.test.tsx`、`SearchPage.accessLoss.test.tsx`に事例を足した
- E2E：`e2e/search.spec.ts`（シードは`e2e/seeds/search.sql`、後始末は`search-cleanup.sql`。155-B の事例も同じ spec。[e2e.md](../testing/e2e.md)）
- ヘッダーに「検索」のボタンが増えたため、名前で「検索」のボタンを探していた既存のテスト（`e2e/clients.spec.ts`・`e2e/channel-management.spec.ts`・`frontend/src/features/members/members.dm.test.tsx`・`frontend/src/channel-admin.session-switch.test.tsx`）は、本文（`main`）の中に絞った

## 既知の差・未実施

| 項目 | 状態 |
| --- | --- |
| 本番の D1 での trigram、30万件の実測、Time Travel | #160 |
| ウィンドウに戻ったときの取り直し（同じキー） | 応答が届くまでの間は、前の行が見えたまま。完了した時点で、置き換わるか消える |
| 「さらに表示」の要求の数 | 押すたびに、読み込んだページ数の分の要求が出る。ページ数の上限は設けていない |
| ヘッダーの検索欄（`SearchKeywordForm`）が素の`<input>`のままであること | 共通の`TextField`は、見えるラベルと余白を必ず出すため使っていない（ADR-0015 の「素の`input`にクラスを書かない」との関係）。**扱いは利用者に確認中** |
| 本番での migration 0032〜0035 の適用と、既存のメッセージ・添付の登録 | **本番に未適用**。#160 で、ほかの未適用の migration（0029〜0031）とまとめて、手順を示して承認を得てから。登録が終わるまで、既存のメッセージ・添付は検索に出ない。0034・0035 の本物の D1 での確認は #160・#350 |
| `scripts/search-reindex-local.ts`が、Node の標準の`module.registerHooks`で、拡張子のない相対の import に`.ts`を補っていること | backend のコード（拡張子を省くバンドラの前提）を Node で直接読むための書き方。**ルールが決まっていない書き方で、利用者に確認中** |
| 案件の資格の喪失の後片付け | #323 が「ページごと読み込み直す」方式に変える予定（上の「画面」） |
| E2E の各`*-cleanup.sql`（`e2e/seeds/`） | 検索の索引の行を消す文は足していない。`backend/db/seeds/cleanup.sql`と`e2e/seeds/search-cleanup.sql`だけが消す（索引の行は外部キーを持たないため、ほかの後始末の失敗にはならない） |
| `search_documents.kind`の CHECK | 155-B（0035）で`'message'`・`'attachment'`・`'case_title'`にした。155-C は CHECK を変えずに足せる。さらに種類を足して作り直すときは、ADR-0031 の追記の手順（写しを空にする → 生成のままの作り直し → 登録し直し） |
| 全角・半角、合成済み・結合文字、ASCII 以外の大小文字 | 本文と同じく、添付の名前でも、trigram の一致と画面の強調（`findSearchMatches`）がずれる場合がある（全角と半角は別の文字。テストで固定した） |
| 孤立した検索用の行と、番号の使い回し | 対応の行のない検索用の行は、後始末の順・途中の失敗で残りうる（`cleanup.sql`が消す）。いまは`AUTOINCREMENT`で番号を使い回さないため誤った一致にならないが、採番の記録を失う操作（表の作り直しなど）をすると誤った一致になる。作り直しは ADR-0031 の追記の手順で行う |
| 155-C に向けた注意 | CHECK はすでに`case_title`を通す。件名の写しは`message_id`を持たない見込みで、いまの検索の SQL は`d.message_id`でメッセージと結び、メッセージ単位の結果を前提にしている。155-C では、案件の結果を別の文（EP-4-02）で作るか、結合を分けるかを決める（**未決定**） |
| S-15 の総件数の表示・件数の読み上げ（screens.md の S-15） | 総件数を返さないため、出していない |
| キーワードが空のときの説明（screens.md の S-15） | `q`がないときは結果の区画を出さないだけで、説明の文は出していない |

## 関係するIssue・ADR

- Issue #155（155-A・155-B。親 #155 の残り：155-C・延期の2件）、#160（本番での確認と適用・実測）、#350（本物の D1 での確認）、#323（資格を失ったときの後片付け）、#270（添付の削除。索引の組を足す）
- ADR-0010（FTS5 trigram）、ADR-0031（手で書く migration）、ADR-0026（マークダウンの許可リスト）、ADR-0030（利用者の切り替え）、ADR-0006（カーソル）、ADR-0012（毎回サーバー側で認可）
- 決定記録 C-152・C-200・C-201（155-B）、C-168（`instr`）、C-90（1〜100文字）、C-94・C-117（未参加の公開チャンネル）
- 要件：4-1 AC-1〜AC-3、EP-4-01、S-15、R-58
