# メッセージと案件の検索（S-15・ヘッダーの検索欄。Issue #155 の155-A・155-B・155-C）

## 目的

キーワードで、自分が見られるメッセージだけを、本文と添付のファイル名から検索し、結果から元のやり取りへ移れるようにする（4-1 AC-1〜AC-3、Issue #155 の AC-1〜AC-4）。155-C で、案件を件名・案件番号・取引先名で検索し、結果の概要から案件の画面（S-17）へ移れるようにした（4-2 AC-1〜AC-3。案件の検索は下の「案件の検索（155-C）」）。検索の方式は、D1 の FTS5 の`trigram`（C-152・[ADR-0010](../adr/0010-japanese-search-fts5-trigram.md)）。検索用の表の migration は手で書く（[ADR-0031](../adr/0031-search-fts-handwritten-migration.md)）。コードは書き写さず、ファイル名・関数名で指す。

## 範囲

| 区分 | 内容 |
| --- | --- |
| 155-A で作ったもの | 検索用の表（`search_documents`・`search_fts`。migration 0032・0033）／索引の更新の部品と、メッセージの本文を書く7か所への組み込み／既存のメッセージの登録の処理と、手元での実行（`search-reindex`）／`GET /api/search/messages`（EP-4-01。部屋・期間の絞り込み、カーソル）／S-15（メッセージの結果）とヘッダーの検索欄／案件の資格を失ったときの、検索のキャッシュの取り除き |
| 155-B で作ったもの | 添付のファイル名の索引（種類`attachment`）／種類の CHECK を変える migration（0034 で写しを空にし、0035 で表を作り直す。ADR-0031 の追記）／投稿・返信の結び付けと論理削除の batch への、添付の組の組み込み／既存の添付の登録（`reindexMessages`を広げた）／EP-4-01 の応答の`matchedIn`・`matchedAttachments`／S-15 の「ファイル名で一致」の印と、一致したファイル名の一覧（利用者の決定 B-1〜B-5。C-201） |
| 155-B で作らなかったもの | 「ファイル名だけ」の絞り込み（B-5）／結果のファイル名からファイルを直接開くこと（B-4）／添付の中身の検索 |
| 155-C で作ったもの | 案件の件名の索引（種類`case_title`。migration なし）／承認による作成・再編集の batch への、件名の組の組み込み／既存の案件の登録（`reindexCases`）と、手元の`search-reindex`での続けての登録／`GET /api/search/cases`（EP-4-02。件名・案件番号・取引先名）／S-15 の「案件」の区画（利用者の決定と統括の決定。C-202）。これで、検索の対象は、メッセージの本文・添付のファイル名・案件（件名・案件番号・取引先名）になった |
| 155-C で作らなかったもの | 説明での検索（4-2 AC-1 の対象にない）／状態の絞り込み／担当部署名・発行時の取引先名での一致（発行時の取引先名は C-129・C-130 で未決定）／案件のアーカイブ（機能がない） |
| #155 の外に移したもの（延期） | 全社員公開アーカイブの、参加していない人向けの検索（D-4。公開承認の仕組みがまだない）→ #356。TODO の検索（D-5。C-152 の「後から追加できる」）→ #357。#155 は155-C で閉じる（利用者の決定 2026-11-21） |
| 作らなかったもの | 検索の回数の制限（429。D-7。上限が X-8 で未決定のため、#160 の実測の後に判断）／総件数の表示／部屋の絞り込みを選ぶ部品（URL の`roomId`だけを引き継ぐ）／4-1 AC-4【案】の「参加していません」の表示（C-144 の案で、決定ではない）／添付の中身の検索 |
| #160 に回すもの | 本物の D1 での trigram の確認、30万件の実測（語1・2・3・10・50・100文字。p95 2秒。155-C の案件の検索を含む）、Time Travel の確認、本番での migration 0032〜0035 の適用と既存のメッセージ・添付・案件の登録（本番で登録する経路は #353） |

## ファイルと役割

### 共通（`shared/`）

| ファイル | 役割 |
| --- | --- |
| `shared/search-rules.ts` | 検索語の検査`searchKeywordSchema`（前後の空白を除いて1〜100文字。上限は UTF-16 の単位で数える）と、方式の境目`SEARCH_TRIGRAM_MIN_CODE_POINTS`（3。コードポイントで数える）の**定義元**。`searchKeywordSchema`は、検索・メッセージの一覧の`q`・社員の検索（`GET /api/users`）の`q`・画面の検索欄が使う。#155 で、上限の判定を UTF-16 で数える形に変えた（zod の`max`はサロゲートペアを1文字と数えるため） |
| `shared/case-rules.ts`（`caseNumberSearchKey`） | 案件番号の検索のキーの**定義元**（155-C）。前後の空白を除き、全角の英数字（Ａ〜Ｚ・ａ〜ｚ・０〜９）を半角に直し、ハイフンにあたる文字（`-`・U+FF0D・U+30FC・U+2212・U+2010・U+2013・U+2014。U+2015 は含めない）を位置に依らず除き、英字を大文字にする。内部の空白は全角・半角とも保つ（NFKC は使わない）。利用者の決定（C-202 (5)）で、全角で打った番号も半角と同じに引ける。件名・取引先名の照合は変えない。取引先名のキーは既存の`shared/client-rules.ts`の`clientNameKey`を使う |
| `shared/search-text.ts` | 索引に入れる本文を作る`toSearchText`（マークダウンの記号を除く）と、一致の位置`findSearchMatches`の**定義元**。索引・抜粋・画面の強調が同じ規則で同じ文を見るよう、ここの1か所に置く。テストは`backend/src/lib/search-text.test.ts`（vitest の対象が backend と frontend だけのため） |

### バックエンド

| ファイル | 役割 |
| --- | --- |
| `backend/db/schema.ts`（`searchDocuments`・`SEARCH_DOCUMENT_KINDS`）、`backend/db/migrations/0032_add_search_documents.sql` | 対応の表`search_documents`。生成物のまま。種類の値の**定義元**は読み取り専用の定数`SEARCH_DOCUMENT_KINDS`（`message`・`attachment`・`case_title`）で、CHECK はここから作る（155-B） |
| `backend/db/migrations/0033_add_search_fts.sql` | 検索用の表`search_fts`（FTS5・`trigram`）。**手で書いた**（ADR-0031）。`schema.ts`には書かない |
| `backend/db/migrations/0034_clear_search_index.sql` | `search_fts`と`search_documents`の行を全部消す。**手で書いた**（ADR-0031 の追記。次の作り直しで採番の記録を失っても、古い文が新しい行に結び付かないようにするため）。155-B |
| `backend/db/migrations/0035_change_search_document_kinds.sql` | `search_documents`の作り直し（CHECK を3つの種類に変える）。生成物のまま。155-B |
| `backend/src/db/search-index.sql.ts` | 索引の更新の文の組`syncMessageIndexStatements`・`removeStaleMessageIndexStatements`と、添付のファイル名の組`syncAttachmentIndexStatements`・`removeStaleAttachmentIndexStatements`（155-B）、案件の件名の組`syncCaseTitleIndexStatements`と、件名が語に一致する案件の ID の集合`caseTitleHitsQuery`（155-C）。検索用の表の形（batch に入れる文を組むためのもの）は、このファイルの中だけに置く |
| `backend/src/db/message.repository.ts`・`reply-insert.sql.ts`・`message-modify.sql.ts` | メッセージの本文を書く batch の末尾に、索引の組を足した。投稿・返信・論理削除には、添付の組も足した（下の「書き込みへの組み込み」） |
| `backend/src/db/search-reindex.ts` | 既存のメッセージと、その添付のファイル名の登録`reindexMessages`。既存の案件の件名の登録`reindexCases`（155-C） |
| `backend/src/db/case-request.repository.ts`（`approve`）、`backend/src/db/case.repository.ts`（`buildEditStatements`・`editCase`） | 承認による案件の作成と再編集の batch の末尾に、件名の組を足した（155-C。下の「件名の書き込みの経路」） |
| `backend/src/db/case.repository.ts`（`searchCases`） | 案件の検索の SQL（EP-4-02。155-C）。一覧の選択の項目（`rowFields`。一覧の`selectRows`から切り出した）と概要の組み立て（`toSummaries`）を使い回す。返す型は`CaseSearchItem` |
| `backend/src/db/search.repository.ts` | 検索の SQL（`createSearchRepository`の`searchMessages`）。一致の条件・見える範囲・メッセージ単位のまとめ・絞り込み・並び・カーソル・抜粋・`matchedIn`と`matchedAttachments`（`matchesOf`） |
| `backend/src/db/room-visibility.sql.ts` | `directRoomListable`を足した（`perm.dm.message.view`がない人の一覧・検索から DM の部屋を除く。案件の部屋の`caseRoomListable`と同じ作り） |
| `backend/src/lib/search-query.ts` | `toFtsPhrase`（語を1つの句にする）・`searchMethodOf`（`match`か`instr`か）・`buildExcerpt`（抜粋の切り出し） |
| `backend/src/services/search.service.ts` | 権限の判定と、JST の日付を UTC の境目に直すこと（`createSearchService`・`withSearchService`）。155-C で`searchCases`（`perm.case.summary.view`で`authorize`してから Repository を呼ぶ） |
| `backend/src/routes/search.ts` | `GET /api/search/messages`と`GET /api/search/cases`（155-C）の入力の検査（422）と応答。`q`の検査は2つのルートで同じ式（NUL の拒否を含む）。`backend/src/index.ts`が`/api/search`に登録する |
| `backend/src/routes/audit-logs.ts`（`jstDateSchema`）、`backend/src/db/audit-log.repository.ts`（`jstDayStart`・`jstNextDayStart`） | JST の日付の検査と境目の部品に`export`を付けた（同じ規則を2か所に書かないため。計画の外の変更） |
| `backend/db/seeds/cleanup.sql` | メッセージを消した後に、元のメッセージがなくなった索引の行と、対応の行のない検索用の行を消す。155-B で、元の添付か結ぶメッセージのなくなった添付の写しも消す。155-C で、元の案件のなくなった件名の写しも消す |
| `docs/api/openapi.json` | EP-4-01 の API 仕様（155-B で`MessageSearchItem`に`matchedIn`・`matchedAttachments`）。155-C で EP-4-02（`searchCases`） |

### スクリプト

| ファイル | 役割 |
| --- | --- |
| `scripts/db-generate-args.ts` | `db:generate`の引数の検査`generateArgs`。引数なし・`--name <名前>`・`--custom --name <名前>`だけを通す（`scripts/db-local.ts`から切り出した。テストは`scripts/db-generate-args.test.mjs`。`npm test`の`node --test`に足した） |
| `scripts/db-local.ts`（`search-reindex`） | 手元の D1 だけで、既存のメッセージの索引を作る。追加の引数（`--remote`など）と、D1 でない環境（`DATABASE_URL`がある環境）は拒否する |
| `scripts/search-reindex-local.ts` | `reindexLocalSearch`。wrangler の`getPlatformProxy`（`remoteBindings: false`）で、`db-local.ts`の他の操作と同じ保存先の D1 を開き、`reindexMessages`を最後まで繰り返し、続けて`reindexCases`を同じ形（最後に読んだ案件の ID から続け、`null`で終わる）で最後まで繰り返す（155-C）。本文・件名は画面に出さず、回数と件数だけを出す |

### フロントエンド

| ファイル | 役割 |
| --- | --- |
| `frontend/src/features/search/api/search-api.ts`・`query-keys.ts` | `searchMessages`（応答は zod で検証。155-B で`matchedIn`〔1つ以上〕・`matchedAttachments`を足し、「`matchedIn`が`attachment`を含む ⇔ `matchedAttachments`が1件以上」を確かめる。食い違う応答は、取得の失敗として扱う）。キー`searchKeys.messages(利用者の ID, 条件, ページ数)`＝`['search', 利用者の ID, 'messages', 条件, ページ数]`、`searchKeys.user(利用者の ID)`＝その利用者の検索の全部。155-C で、`searchCases`（応答は zod で検証。`matchedIn`は1つ以上）と、キー`searchKeys.cases(利用者の ID, 語, ページ数)`＝`['search', 利用者の ID, 'cases', { q }, ページ数]`、区画ごとの全体のキー`searchKeys.messagesAll`・`searchKeys.casesAll`を足した（どれも`searchKeys.user`の前方一致に入る） |
| `frontend/src/features/search/hooks/fetch-search-pages.ts` | `fetchSearchPages`：1ページ目から指定のページ数まで順に取る（取り消された取得は残りのページを取りにいかない）。メッセージ・案件の2つの区画で共通（155-C で`useMessageSearch.ts`から切り出した） |
| `frontend/src/features/search/hooks/useMessageSearch.ts` | 結果の取得（`useQuery`。見せるページ数を状態に持ち、取得のたびに1ページ目からその数だけ順に取る。`showMore`でページ数を増やす）。キャッシュに持たない設定（下の「画面」）。155-C で、区画を離れたときの後始末を、メッセージのキー（`searchKeys.messagesAll`）だけにした |
| `frontend/src/features/search/hooks/useCaseSearch.ts` | 案件の区画の取得（155-C）。取得の決まりは`useMessageSearch`と同じ。区画を離れたときの後始末は案件のキー（`searchKeys.casesAll`）だけ |
| `frontend/src/features/search/components/` | `HeaderSearch`（ヘッダーの検索欄）、`SearchKeywordForm`（語の入力欄。ヘッダーと S-15 で共用）、`SearchConditionsForm`（語と、折りたたんだ期間の絞り込み）、`MessageSearchResults`（読み込み中・0件・失敗と再試行・さらに表示。155-B で、ファイル名で一致した行の印と名前の一覧〔中の部品`MatchedAttachmentNames`〕）、`HighlightedExcerpt`（抜粋の中の一致を`<mark>`で強調）。155-C で`CaseSearchResults`（案件の区画。中の部品`CaseRow`・`CaseSearchBody`。行の終わりに、`features/cases`の公開の入口（`index.ts`）から使う`CaseTodoProgress`で TODO の進捗を出す〔案件の一覧の行と同じ部品〕） |
| `frontend/src/features/search/keys.ts` | 155-C で足した、検索のキー`searchKeys`だけの公開の入口。`index.ts`は`CaseSearchResults`を通じて`features/cases`を参照するため、`cases`側（`useCaseWrites.ts`）が`index.ts`を読むと循環になる。それを避けて、`cases`側はここを読む（前例：`features/case-requests/form-parts.ts`） |
| `frontend/src/pages/SearchPage.tsx`、`frontend/src/App.tsx`（`/search`） | S-15。URL の`q`・`roomId`・`from`・`to`で検索する。`q`がなければ API を呼ばない。155-C で、案件の区画をメッセージの結果の上に置いた（案件の区画は`q`だけで取る） |
| `frontend/src/features/app-shell/Header.tsx` | `HeaderSearch`を置いた |
| `frontend/src/features/cases/hooks/useCaseWrites.ts`（`forgetCaseContent`・`forgetSearchResults`） | 案件の資格を失ったときに、その利用者の検索の結果（`searchKeys.user`）も片付ける（取り消し → 表示していない分の取り除き → 表示中の分の`resetQueries`。下の「画面」）。155-C では片付けの動作は変えていない（前方一致で、案件の区画のキーも一緒に片付く）。`searchKeys`の読み込み先だけ、循環を避けるため`features/search/keys.ts`にした |

## 表の構成（migration 0032〜0035）

- `search_documents`（普通の表）：`id`（整数の主キー。`AUTOINCREMENT`）・`kind`（CHECK は`'message'`・`'attachment'`・`'case_title'`。0035 で、`'message'`だけから変えた。`case_title`は 155-C で使う）・`ref_id`（元の行の ID。添付の写しは添付の ID）・`room_id`（部屋の絞り込み）・`message_id`（結ぶメッセージ。メッセージ自身は同じ ID）・`created_at`（期間の絞り込み。元のメッセージの作成日時の写し）・`source_body`（写しの元の本文）。`(kind, ref_id)`の一意索引、`(room_id, created_at, id)`・`(kind, created_at, id)`の索引。元の行を消す後始末に縛られないよう、外部キーは張らない
- `search_fts`（FTS5。`text`の1列。`tokenize='trigram'`）：中身（記号を除いた本文）を自分で持つ。外部の内容の表・トリガーは使わない
- **rowid ＝`search_documents.id`**。整数の番号は検索用の表との対応にだけ使い、並び・カーソルには使わない（更新のたびに採番し直すため）
- 添付の写し（`kind = 'attachment'`）の各列：`ref_id`＝添付の ID、`room_id`＝添付の部屋、`message_id`＝結ぶメッセージ、`created_at`＝**メッセージの**作成日時（アップロードの時刻ではない。期間・並びをメッセージの結果とそろえるため）、`source_body`と検索用の表の`text`＝`original_name`を**記号を除かずにそのまま**（B-3。ファイル名の`_`・`*`などは名前の一部のため。`toSearchText`を当てない）
- 案件の件名の写し（`kind = 'case_title'`。155-C）の各列：`ref_id`＝案件の ID、`room_id`と`message_id`＝**NULL**（案件の部屋の ID を入れない。メッセージの検索の部屋・期間の絞り込みに混ざらないため。案件の資格は案件の決まりで決める）、`created_at`＝`cases.created_at`、`source_body`と検索用の表の`text`＝いまの件名を**記号を除かずにそのまま**（件名にマークダウンはない。B-3 と同じ考え）。メッセージの検索の SQL は、メッセージとの内部結合と種類ごとの適格の条件で件名の行を落とすので、変えていない
- **表を作り直すとき**：作り直しは採番の記録を失い、番号が使い回されうる。対応の行のない古い検索用の行が残っていると、新しい行に古い文が結び付くため、作り直しの前に写しを全部消し（0034）、生成のままの作り直し（0035）の後に登録し直す。今後の作り直しもこの手順にする（[ADR-0031](../adr/0031-search-fts-handwritten-migration.md)の追記）

## 索引の更新（`search-index.sql.ts`）

「索引の対象」は、未削除で部屋のあるメッセージ（`deleted_at IS NULL`かつ`room_id IS NOT NULL`）。

`syncMessageIndexStatements(db, { messageId, sourceBody })`は、次の4つの文の組を返す。記号を除いた本文は、部品の中で`toSearchText(sourceBody)`から作る（呼び出し側は元の本文だけを渡す）。

1. いまの行と一致しない写し（元がない・削除済み・本文が`source_body`と違う）を、検索用の表から消す【#270の2つ目（C-205）：**本文がない（目印）**も「一致しない」に含める。`hasBody`（`NOT storedBodyIsEmpty(m.body)`）を条件に足した】
2. 同じ条件で、対応の表の行を消す
3. いまの本文が`sourceBody`と一致し、まだ写しがないときだけ、対応の表に行を入れる【#270の2つ目：本文がない投稿（目印）には、本文の写しを作らない。`hasBody`を満たすときだけ入れる。`indexedMessage`には足さない（添付の名前の写しの条件でも使うため。足すと、本文のない投稿の添付がファイル名で検索に出なくなる）】
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

`removeStaleAttachmentIndexStatements`は、1・2 だけの組（論理削除で使う）。性質（テストで固定した）：べき等、拒否された削除では変わらない、削除済みは残らない、batch の取り消しで索引も取り消される。

**順序に依らない範囲**：同じメッセージの組を、何度・どの順で実行しても同じ結果になる（結び付け・削除・登録の割り込みを含む）。ただし、古い写しを消す 1・2 は`d.message_id`（引数のメッセージ）の写しだけを見て、入れる 3 は添付の ID で「写しがすでにあるか」を見る。このため、添付をメッセージ A から B に付け替えて B → A の順に同期すると、B の同期では A の古い写しが追加を妨げ、続く A の同期で古い写しだけが消えて、索引が欠ける。**いまは付け替えの操作はない**（添付は、未投稿から1つのメッセージに結び付く1回だけ）。付け替えを足すときは、添付の ID を基準にした古い写しの整理と、逆順の試験が要る。

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
| 添付の削除（#270） | `attachment-delete.sql.ts`の`markAttachmentDeleted`の batch | 末尾に`removeStaleAttachmentIndexStatements` | `staleAttachmentDocuments`が削除済み（`deleted_at`が入った行）を古い写しとみなすため、削除が確定したときだけ写しが消える。拒否（0行）なら残る。`syncAttachmentIndexStatements`も削除済みを入れない（`reindexMessages`の登録し直しでも出ない） |
| 後始末の物理削除（#270） | `attachment-purge.ts`の`deletePurgedRow` | 何もしない | 印を付けた時点で写しは消えている。行の削除は、すでにない写しに触れない |
| 既存の分の登録 | `search-reindex.ts`の`reindexMessages` | 行ごとの batch に、メッセージの組と添付の組 | シード・migration の後の登録 |
| 本文の編集（2経路） | `updateBodyIfModifiable` | 何もしない | 添付は変わらない。メッセージの組は`kind = 'message'`だけを見るので、添付の写しは残る |
| アップロード（未投稿） | `attachment.repository.ts`の`insertPending` | 何もしない | 未投稿の添付は索引に入れない（本人にも検索で出さない） |
| 未投稿の掃除 | `deletePendingBefore` | 何もしない | 未投稿だけを消すので、写しはない |
| 案件の添付の公開範囲の変更 | `case-attachment.repository.ts`の`changeVisibility` | 何もしない | 公開範囲は検索の読み取りの資格に使わない（下の「見える範囲」） |

チャンネル・案件を物理削除するアプリのコードは、いまはない。添付の行の物理削除は、#270 の後始末（削除済みの行だけ。上の表）にだけある。**今後、`message_attachments`を変える処理を新しく足すときは、同じ batch の末尾に添付の組を足し**、`backend/src/db/search-index.attachments.db.test.ts`の書き込みの経路の一覧のテストにも足す（漏れると、消えた添付の名前は検索の SQL の条件で出ないが、新しい名前が検索に出ない）。

添付の削除の索引の確かめ（#270）：削除した添付がファイル名で一致しないこと・`matchedAttachments`に出ないことは`backend/src/routes/attachments.deleted-visibility.test.ts`（検索の節）で確かめる。詳細は[attachments.md](attachments.md)の「添付の削除」。

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
- 正規化するのは前後の空白の除去だけ。全角・半角、合成済み・結合文字は、別の文字として扱う（索引も同じ）。英字の大小文字は、3文字以上は trigram の規則（区別しない）、1〜2文字は`lower()`（ASCII の英字だけ区別しない）。ただし案件番号の検索のキー（`caseNumberSearchKey`）だけは、全角の英数字を半角にするなど別の整形をする（上の表）

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
| 添付の行：削除されていない（`a.deleted_at IS NULL`。#270） | **削除した添付の名前**（索引の更新が遅れても出さない） |
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
| 添付が未削除（#270） | 条件にある（`a.deleted_at IS NULL`） | 同じ（上の「添付の行：削除されていない」） |
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
- **本文のない投稿**（#270の2つ目。C-205）：本文の写しを作らないので、本文の検索（3文字以上の MATCH・1〜2文字の`instr`のどちらも）では一致しない。添付のファイル名では一致し（添付の名前の写しは本文を見ない）、その行の抜粋は**空文字**（`search.repository.ts`が`fromStoredBody`を通してから`buildExcerpt`に渡す）。画面は、抜粋が空文字のとき、リンクの名前を「（添付ファイルのみ）」にする。`reindexMessages`の登録し直しの後も同じ（組の中で決まる）。本文を空にする編集では、前の本文の写しが消え、前の本文では一致しなくなる。空から本文を足す編集では、新しい本文で一致する
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

- 入口は2つ（Issue #337）。①768px以上：ヘッダーの検索欄（`HeaderSearch`）から、前後の空白を除いた語で`/search?q=…`へ移る。②768px未満：ヘッダーには検索欄もボタンも出さず（高さ48を保つため。`HeaderSearch`が form ごと隠す）、ドロワーの先頭のリンク「メッセージを検索」（`navigation.ts`の`searchNavItem`。[app-shell.md](app-shell.md)）から`/search`を開く。語の検査は`searchKeywordSchema`を共有する（空・101文字以上は送らずにエラーを出す。サーバーでも検証する）
- 語の欄（`SearchKeywordForm`）は、共通の`TextField`（`type="search"`、ラベル「検索する言葉」を`hideLabel`で画面から隠す）で作る。送信ボタンの名前は`submitLabel`で決め、既定は「検索」（S-15 の本文）。ヘッダーだけ「メッセージを検索」にする（同じ画面に「検索」のボタンが並び、名前で区別できなくなるため）。結果の画面の見出しは「検索結果」、ボタンは「検索」のまま
- S-15（`SearchPage`）：言葉なし（`q`なし、または`q`が空白（半角・全角）だけ）で開いたときは、見出しの下に案内の文「検索する言葉を入れて、『検索』を押してください。」を1つだけ出し、結果の部品と検索の要求は出さない（`q`ありの読み込み中・結果あり・0件・失敗では出さない。Issue #337）。空白だけを言葉なしと扱うのは、URL の条件を読む`conditionsOf`の`q`だけ（案内の文・結果の部品・検索の要求の有無が同じ条件で決まる）。ほかの条件（`roomId`・`from`・`to`）は、そのまま API に渡り、不正な値は、これまでどおりエラーになる。前後に空白のある語は、そのまま語として検索する。語の欄と、折りたたんだ「絞り込み」（開始日・終了日）。送ると URL を書き換えて取り直す。部屋の絞り込みは URL の`roomId`を引き継ぐだけで、選ぶ部品はない
- 結果：部屋の名前（DM は相手の表示名）・投稿者・日時・抜粋（一致を強調。【#270の2つ目：抜粋が空文字〔本文のない投稿〕のときは、リンクの名前を「（添付ファイルのみ）」にする。定数`ATTACHMENT_ONLY_LABEL`は`features/messages/index.ts`から読む】）。押すと元の場所のスレッドへ（チャンネル・案件の部屋は`/channels/<部屋>?thread=`、DM は`/dms/<部屋>?thread=`。返信は親のスレッド。案件の部屋は、チャンネルの画面が案件の画面へ移す）
- **ファイル名で一致した行**（155-B。B-4）：抜粋の下に、印「ファイル名で一致」と、一致したファイル名の一覧（`aria-label="一致したファイル名"`。複数なら全部。1件のメッセージの添付は最大10件）を出す。名前の中の一致は`HighlightedExcerpt`（`findSearchMatches`）で`<mark>`に強調し、名前は文字として描く。名前は**リンクにしない**（結果からファイルを直接開かせず、配信の経路を増やさないため）。行を押したときの移り先は、本文の一致と同じ（そのメッセージのスレッド）。長い名前は行の中で折り返し（`break-all`）、横にはみ出さない。本文だけの一致の行には、印も一覧も出さない
- 応答の`matchedIn`と`matchedAttachments`が食い違う（片方だけ）ときは、zod の検証で取得の失敗として扱い、取得済みの行も出さない（統括の決定。印と名前の片方だけを出さないため）
- 状態：読み込み中・0件（「一致するメッセージはありません」）・失敗と再試行・さらに表示
- **取得のたびに1ページ目から取り直す**：`useMessageSearch`は、見せるページ数を状態とキーに持ち、1ページ目からその数だけ順に取る（カーソルは、同じ取り直しの中の直前のページから作る）。「さらに表示」はページ数を1つ増やし、先頭から取り直す。次のページだけを足す形では、途中で資格を失った部屋の行が前のページに残るため（コードレビューの重大な指摘への対応）。取得が完了した時点で出る行は、その時点のサーバーの応答の行だけになる
- 「さらに表示」の取得の最中は、前の行を出さず、読み込み中だけを出す。取得中はボタンを押せない。失敗したら、取得済みの行も出さず、失敗の文言と再試行だけを出す（再試行は1ページ目から）。条件を変えると（`SearchPage`が結果の部品に`key`を付ける）、ページ数は1に戻る
- **キャッシュに持たない**（抜粋は資格に左右されるため）：`staleTime: 0`・`gcTime: 0`・`retry: false`、区画を離れたら、その区画のキー（155-C から`searchKeys.messagesAll`。前は`searchKeys.user`）を取り消して取り除く。`placeholderData`を使わず、前の結果を仮に出さない
- **利用者の切り替え**：キーに利用者の ID を入れ、ADR-0030 の枠（`user-switch-guard.ts`）でも捨てられる
- **資格の喪失**：`forgetCaseContent`が`forgetSearchResults`（`useCaseWrites.ts`）を呼び、その利用者の検索の結果（`['search', 利用者の ID]`）を全部片付ける（どの案件の抜粋が入っているかをキーから決められないため）。順は、取り消し → 表示していない分の取り除き（`removeQueries`の`type: 'inactive'`）→ `resetQueries`（表示中の分のデータを消して購読している画面に知らせ、いまの資格で取り直す）。`removeQueries`だけでは表示中の画面に知らせず、出ている抜粋が残るため（2回目のコードレビューの重大な指摘への対応）。取り直しの完了は待たず、取り消しの完了だけを待つ。案件のほかのキーの片付けの方式は変えていない
- **取り消し**：取得は`signal`で取り消せる（`searchMessages`に渡す）。取り消された取得は、残りのページを取りにいかない。別の作業 #323 が、資格を失ったときの後片付けを「ページごと読み込み直す」方式に変える予定で、その後はこの取り除きの扱いも合わせて見直す

## 案件の検索（155-C）

### 件名の組（`syncCaseTitleIndexStatements`）

`syncCaseTitleIndexStatements(db, caseId)`は、次の4つの文の組を返す。引数は案件の ID だけで、値はすべて DB のいまの案件の行から写す（呼び出し側は件名を渡さない）。

1. その案件の件名の写しのうち、いまの行と合わないものを、検索用の表から消す
2. 同じ条件で、対応の表の行を消す
3. その案件の件名の写しがなければ、いまの件名で対応の表に入れる
4. 対応の表の行があり、検索用の表にまだ行がなければ、件名を入れる

「いまの行と合う」写しの条件（どれか1つでも崩れたら、古い写しとして消す）：元の案件がある／`source_body`がいまの件名と同じ／`created_at`が案件の作成日時と同じ／`room_id`・`message_id`が NULL／検索用の表に行があり、その文が`source_body`と同じ。テストの不一致の数え（`backend/test/search-case-fixtures.ts`の`caseTitleIndexMismatches`）は、元の案件がない・件名が違う・作成日時が違う・案件に行がない・部屋・メッセージの列が NULL でない・検索用の表に行がない・検索用の文が違う・対応の行のない検索用の行、を数え、消す条件と同じ範囲を確かめる。

性質（テストで固定した）：

- **べき等・順序に依らない**：結果は案件のいまの行だけで決まり、`ref_id`（案件の ID）だけで写しを見分けるため、何度・どの順で実行しても、最後の状態に一致する（添付の付け替えのような問題は起きない）
- **保証の範囲は、同じ batch の中**：組は件名を変える batch の末尾に入り、batch が取り消されれば索引も元のまま。拒否された再編集（前提の崩れ・存在しない案件）では、件名の写しは変わらない。DB の上で件名を直接書き換えるなど、組を通らない変更は、次の再編集か登録まで直らない（下の「既知の差」）
- 束縛値は案件の ID だけ（D1 の1文 100 個に遠い）。件数の判定に、組の文の結果（`meta.changes`）を使わない

### 件名の書き込みの経路

アプリのコードで案件の件名を書くのは、承認による作成と再編集の2つだけ（案件の削除・アーカイブはない）。

| 経路 | 場所 | 件名の組 | 理由 |
| --- | --- | --- | --- |
| 承認による作成 | `case-request.repository.ts`の`approve`の batch | 末尾（通知の後ろ）に足した | 作られた案件が、承認と同時に件名で出る |
| 再編集 | `case.repository.ts`の`buildEditStatements`の batch | 末尾（不変条件の確認の後ろ）に足した。**件名を変えない再編集でも毎回**足す（いまの行と同じなら何も変えない。件名の変化の判定を分けないため） | 新しい件名で出て、古い件名で出ない |
| 既存の分の登録 | `search-reindex.ts`の`reindexCases` | 案件ごとに1つの batch で組を実行する | シード・既存の案件の登録 |
| 終了・再開・参加者の追加と削除・納期の変更 | `changeStatus`・`buildReopenStatements`・参加者の処理・`changeDueDate` | 何もしない | 件名・作成日時を変えない。状態・参加の有無は、検索の時に元の表で読む |
| 取引先の改名・無効化、部署の改名・無効化 | 取引先・部署の処理 | 何もしない | 取引先名・部署名は索引に入れず、検索の時にいまの値で読む |

組は、前提の確認・ガード（`changes()`を見る文）の間に挟まず、末尾に置く（[project-rules.md](../project-rules.md)の検索の索引の決まり）。再編集の更新の結果を読む位置は、`buildEditStatements`が更新の文を積んだ時点で決めて返す（`updateAt`。[cases.md](cases.md)の150-C の書き込み）。案件の書き込みで件名を変える処理を新しく足すときは、同じ batch の末尾に件名の組を足し、`backend/src/db/search-index.cases.db.test.ts`の経路の一覧のテストにも足す。案件のアーカイブ・削除を作るときは、件名の写しを消す（または検索の SQL で除く）ことを、同じ変更で決める。

### 既存の案件の登録（`reindexCases`）

- `reindexCases(db, { afterId, batchSize })`：`cases.id`の順に、進行中・終了とも`batchSize`件（既定100）読み、案件ごとに件名の組を1つの batch で実行し、最後に読んだ ID を返す（読む行がなければ`null`）。組がべき等なので、途中で失敗しても、最初から、または返った ID から再開してよい
- 方式は、メッセージの登録（D-9）を案件に広げたもの（利用者の決定。C-202(3)。migration ではなく、後から実行する登録の処理）
- 手元：`node scripts/db-local.ts <development|test> search-reindex`が、メッセージの後に続けて案件も登録する
- 本番：#160・#353。手順書 [production-first-rollout.md](../operations/production-first-rollout.md)の工程 7 で、メッセージ・添付と同じ処理の中で登録し、不一致0件を確かめる

### API（`GET /api/search/cases`。EP-4-02）

- 入力：`q`（EP-4-01 と同じ式。`searchKeywordSchema`に NUL の拒否を足したもの）、`limit`（1〜100。既定20。一覧の決まり）、`cursor`。ほかの項目は 422（`strict`）。部屋・期間・状態の絞り込みはない
- 権限：`perm.case.summary.view`（`type: company`。EP-5-07 の概要と同じ）で`authorize`。ない人は 403（拒否は監査に記録する）。いまの役割では3つとも持つ。表示の判定（`can`）は使わない
- 応答：`items`（`id`・`caseNumber`・`title`・`status`・`client`〔`id`・`name`・`isActive`〕・`departments`〔`id`・`name`・`isActive`の配列〕・`dueDate`・`progress`〔`done`・`total`。0件は`null`〕・`isParticipant`・`matchedIn`）と`nextCursor`。`matchedIn`は`title` → `caseNumber` → `client`の順で1つ以上。総件数は返さない。`noStore`を付け、検索語はログに出さない
- **返さない項目**：説明・参加者・参加者数（`participantCount`）・管理の資格（`canManage`・`canEditDueDate`）・部屋の ID（`channelId`）・最終更新（`lastActivityAt`）・版（`version`）・取引先のコード。参加者にも返さない（区画の行に要らず、出す面を減らすため）。応答の型`CaseSearchItem`は概要`CaseSummary`からこの10個だけを選ぶ

### SQL の形（`searchCases`）

1. WITH 句`title_hits`（`caseTitleHitsQuery`）：検索用の表で語に一致し、種類が`case_title`で、写しの元の件名（`source_body`）が**いまの件名と同じ**行の案件の ID の集合。外側の案件に依らない集合として先に作る（案件ごとに検索用の表を引き直さない）。方式は EP-4-01 と同じ（3文字〔コードポイント〕以上は`MATCH`と`toFtsPhrase`、1〜2文字は`instr(lower(...))`）
2. 外側：`cases`を基の表にし、`clients`と内部結合し、`title_hits`と LEFT JOIN（1回だけ参照する）
3. 条件：件名の一致（`title_hits`にある）OR 案件番号の先頭からの一致（ハイフンを除いて大文字にした番号の先頭に、`caseNumberSearchKey`の値がある。キーが空なら、この腕を入れない）OR 取引先名の部分一致（`clients.name_normalized`に`clientNameKey`の値がある）。`LIKE`を使わないので`%`・`_`も文字として扱う。説明は対象にしない
4. 並びは案件 ID の降順、カーソル（`afterCursor`）と`limit + 1`（`toPage`）。案件ごとに1行なので、複数の項目で一致しても1件で、ページの境目で2回出ない
5. 概要の組み立ては一覧と同じ（`toSummaries`）。`matchedIn`は3つの一致の真偽から作り、どれも無い行は SQL の誤りとして例外にする（成功として扱わない）

実行計画（`backend/src/db/search.explain.cases.db.test.ts`で記録）：3文字以上は`title_hits`の中で検索用の表を1回だけ（仮想の表の索引の`MATCH`）引き、相関の副問い合わせにならない。1〜2文字は、対応の表を種類の索引で引いて走査する。案件番号・取引先名は`cases`・`clients`の全件の走査（案件が少ない前提。実測は #160）。

### 見える範囲

見える範囲は、案件の一覧（`all`）・概要と同じ**全案件**（進行中・終了。審査中の申請は`cases`に行がないため出ない）。

| 主体 | 出る案件 | `isParticipant` |
| --- | --- | --- |
| 有効な参加者 | すべて | その案件だけ`true` |
| 担当部署のオーナー（参加していない） | すべて | `false` |
| 全体管理者（参加していない） | すべて | `false` |
| 一般の社員（参加していない） | すべて | `false` |
| `perm.case.summary.view`がない | 403 | — |

4者で結果の案件の集合は同じで、返す項目は概要の項目だけ（4-2 AC-2）。参加しているかは、検索の時のいまの参加で決める（途中で外れたら、取り直したページで`false`になる）。全員に全案件の概要が見えるため、件数・カーソルから存在が推し量れる問題はない。行を押した先（S-17）の閲覧の制御は、既存の案件の画面の決まりのまま（参加していない人には非公開の案内）。

### 言葉の合わせ方（利用者の決定。C-202(1)）

| 対象 | 一致の仕方 | 正規化 |
| --- | --- | --- |
| 件名 | 部分一致（索引） | 前後の空白の除去だけ（EP-4-01 と同じ）。英字の大小文字は、3文字以上は trigram の規則、1〜2文字は`lower()` |
| 案件番号 | 先頭からの一致（C-117） | 前後の空白を除き、全角の英数字を半角に、ハイフンにあたる文字（27行目の表の定義元を参照）を位置に依らず除き、英字を大文字に（`caseNumberSearchKey`。番号の側もハイフンを除いて大文字にして比べる）。内部の空白は全角・半角とも保つ（内部に空白のある語は番号に一致しない）。ハイフンだけの語は番号では探さない |
| 取引先名 | いまの名前の部分一致（取引先の管理の検索と同じ） | `clientNameKey`（前後の空白の除去と小文字化）と`name_normalized`。改名の前の名前では出ない |

### 画面（S-15 の「案件」の区画）

- `CaseSearchResults`を、`SearchPage`のメッセージの結果の上に置く。`q`だけで取り、`key`は語だけ（部屋・期間を変えても作り直さない）
- 行：件名（`HighlightedExcerpt`で一致を強調。文字として描く）・案件番号・状態（進行中／終了）・取引先名・担当部署の名前・納期。件名を押すと`/cases/<案件の ID>`（S-17）
- 状態：読み込み中（「案件を読み込み中です」）・0件（「一致する案件はありません」）・失敗と再試行（「案件を検索できませんでした」。失敗したら取得済みの行も出さない。再試行は1ページ目から）・さらに表示。応答が zod の検証に合わないときも失敗として扱う
- 取得の決まりはメッセージの区画と同じ（毎回1ページ目から取り直す・`signal`で取り消す・`staleTime: 0`・`gcTime: 0`・`retry: false`・`placeholderData`なし）。`isParticipant`がいまの参加で変わるため
- **2つの区画は独立**：片方の取得・失敗・再試行・作り直しで、もう片方の取得は止まらず、表示も残る
- **後始末の違い**：
  - 通常の後始末（区画を離れたとき・作り直したとき）：その区画のキーだけ（`searchKeys.messagesAll`・`searchKeys.casesAll`）を取り消して取り除く。前の`useMessageSearch`は利用者の検索の全体（`searchKeys.user`）を片付けていたため、同じ画面に区画が2つになると、片方の作り直しが、もう片方の表示中の取得を消してしまう。そのため155-C で区画ごとに分けた
  - 資格の喪失・利用者の切り替え：利用者の単位で消す（`forgetSearchResults`の`searchKeys.user`と ADR-0030 の枠）。前方一致で、案件の区画も一緒に消える。`useCaseWrites.ts`は、`searchKeys`の読み込み先を`features/search/keys.ts`に替えただけで、後片付けの動きは変えていない（循環を避けるため）

## 設計の判断

- 索引の作り方は「自分で中身を持つ表＋アプリの側で更新」（3つの案の比較は ADR-0031）
- 索引の文は「いまの行の状態」と「写しの元の本文」で条件づける。編集の拒否・既存のメッセージの登録との割り込みでも、正しい写しを消さないため（計画レビューの重大な指摘への対応）
- 権限のない部屋・見えない部屋は、SQL の`LIMIT`より前で除く。総件数は返さない
- 155-B：ファイル名の一致は、別の API・別の一覧にせず、EP-4-01 のメッセージの結果に印を付けて混ぜる（D-5・B-4）。「ファイル名だけ」の絞り込みは作らない（B-5）。索引の表の作り直しは、写しを空にしてから行う（B-1。ADR-0031 の追記）。決定は C-201
- 429 は作らない（D-7）。api-draft の EP-4-01 にある 429 は、上限（X-8）が未決定のため、#160 の実測の後に判断する（EP-4-02 も同じ）
- 155-C：案件の検索は、メッセージの検索の SQL に混ぜず、案件を基の表にした別の文（EP-4-02）にした。案件ごとに1行なので重複が起きず、並び・カーソル・見える範囲を一覧とそろえられるため。前の版の「155-C に向けた注意」（結果を別の文で作るか、結合を分けるか）は、これで決まった
- 155-C：`searchCases`はサブクエリを含むが、入力で条件が変わる検索なので Drizzle の通常の書き方を基本にし、件名の集合だけ`sql`で埋め込んだ（知見 db/sql-complexity の「両方に当てはまる場合」）。件名の集合の SQL は、検索用の表の形を1か所に置くため`search-index.sql.ts`に置いた
- 155-C（計画と違えた点）：件名の集合を、`IN`ではなく WITH 句＋ LEFT JOIN で1回だけ参照する形にした（`matchedIn`のための件名の一致の判定と、WHERE の条件とで、検索用の表を読む段を1回にするため）。件名の一致の条件（種類・いまの件名との一致）は、`search-index.sql.ts`の`caseTitleHitsQuery`に、組の条件とは別にもう一度書いた。取得のページの部品を`fetch-search-pages.ts`に切り出した。合わない写しとして消す条件は、テストの不一致の数え（`caseTitleIndexMismatches`）と同じ範囲
- 155-C：再編集の batch に件名の組を毎回足し、文の上限を 12 から 16 に改めた（C-202(2)。件名が変わったときだけ足す案は、分岐が増え、件名の変化の見落としの危険が増えるため採らなかった）
- 155-C：応答の項目の名前は、EP-4-02 の草案ではなく、実装済みの概要（EP-5-07）に合わせた（C-202(6)。[api-draft.md](../requirements/api-draft.md)の追記）

## テストの場所

- DB：`backend/src/db/search-fts5-capability.db.test.ts`（T-0。手元の D1 で trigram が使えること）、`search-index.db.test.ts`（状態の遷移・順序に依らない一致・7か所の書き込みの後の不一致0件・既存の戻り値）、`search-reindex.db.test.ts`（べき等・再開・分割の境目・migration の更新の試験）、`search.repository.db.test.ts`（一致・見える範囲と権限・期間・ページ・抜粋）、`search.explain.db.test.ts`（実行計画）、`cleanup-sql.search.db.test.ts`（後始末）。準備の部品は`backend/test/search-fixtures.ts`
- 単体：`backend/src/lib/search-query.test.ts`、`backend/src/lib/search-text.test.ts`、`scripts/db-generate-args.test.mjs`
- API：`backend/src/routes/search.test.ts`、`backend/src/services/search.service.test.ts`、`backend/src/openapi.search.test.ts`
- 画面：`frontend/src/pages/SearchPage.test.tsx`、`SearchPage.userSwitch.test.tsx`、`SearchPage.accessLoss.test.tsx`（資格を失った後の「さらに表示」・取り直しの失敗・途中のページの失敗で、前の抜粋を残さない。表示中の画面の後片付け、取り消された取得が残りのページを取りにいかないこと）、`SearchPage.pages.test.tsx`（取得の最中の表示、条件を変えたらページ数が1に戻る、3ページ目までのカーソル）、`frontend/src/features/cases/hooks/useCaseWrites.search-forget.test.ts`。モックは`frontend/src/test/search-handlers.ts`
- 155-B（添付のファイル名）：
  - DB：`backend/src/db/search-documents-kind.upgrade.db.test.ts`（0034・0035 の更新の試験。0034 を飛ばした対照で、孤立した番号の使い回しによる誤った一致を検出できること）、`search-index.attachments.db.test.ts`（状態の遷移・順序に依らない一致・不一致の分類ごとの検出・書き込みの経路の一覧・既存の戻り値）、`search.repository.attachments.db.test.ts`（一致・まとめ・名前の書き換え・見える範囲の条件ごと・ページ・期間・途中で資格を失う）。既存の`search.explain.db.test.ts`・`search-reindex.db.test.ts`・`cleanup-sql.search.db.test.ts`に事例を足した
  - API：`backend/src/routes/search.attachments.test.ts`、`openapi.search.test.ts`・`services/search.service.test.ts`に事例を足した
  - 画面：`frontend/src/pages/SearchPage.attachments.test.tsx`、`SearchPage.accessLoss.test.tsx`に事例を足した
- 155-C（案件の検索）：
  - DB：`backend/src/db/search-index.cases.db.test.ts`（件名の組の状態の遷移・不一致の分類ごとの検出・書き込みの経路の一覧・拒否された再編集で索引が変わらない・既存の戻り値）、`case.repository.search.db.test.ts`（一致の項目ごと・条件を外すと落ちる対照・見える範囲の4者・返さない項目・ページ・途中で参加を外れる）、`search.explain.cases.db.test.ts`（実行計画）、`search-reindex.cases.db.test.ts`（登録・べき等・再開）、`search.repository.case-title.db.test.ts`（件名の行がメッセージの検索に出ない）、`cleanup-sql.case-title.db.test.ts`（後始末）。`case-edit.repository.db.test.ts`は、`buildEditStatements`の戻り値の形と文の上限 16 に合わせて直した。準備の部品は`backend/test/search-case-fixtures.ts`
  - 単体：`backend/src/lib/case-number-search.test.ts`（`caseNumberSearchKey`）
  - API：`backend/src/routes/search.cases.test.ts`、`services/search.service.cases.test.ts`、`openapi.search.cases.test.ts`
  - 画面：`frontend/src/pages/SearchPage.cases.test.tsx`、`SearchPage.cases.accessLoss.test.tsx`、`frontend/src/features/cases/hooks/useCaseWrites.search-forget.cases.test.ts`。モックは`frontend/src/test/search-handlers.ts`
  - E2E：`e2e/search-cases.spec.ts`（[e2e.md](../testing/e2e.md)）
- 添付だけの投稿（#270の2つ目。C-205）：`backend/src/db/search-index.attachments.db.test.ts`（本文なしの写しを作らない・目印の写しを消す・添付の名前の写しは作る・`reindexMessages`・編集で空にする／足す）、`backend/src/routes/search.attachments.test.ts`、画面`frontend/src/pages/SearchPage.attachments.test.tsx`
- E2E：`e2e/search.spec.ts`（シードは`e2e/seeds/search.sql`、後始末は`search-cleanup.sql`。155-B の事例も同じ spec。155-C で、`search-cleanup.sql`に件名の写しの後始末を足した。[e2e.md](../testing/e2e.md)）
- ヘッダーに「検索」のボタンが増えたため（155-A）、名前で「検索」のボタンを探していた既存のテスト（`e2e/clients.spec.ts`・`e2e/channel-management.spec.ts`・`frontend/src/features/members/members.dm.test.tsx`・`frontend/src/channel-admin.session-switch.test.tsx`）は、本文（`main`）の中に絞った。Issue #337 でヘッダーのボタンの名前を「メッセージを検索」にしたが、この絞り込みは変えていない
- Issue #337 の画面のテスト：`frontend/src/components/TextField.test.tsx`（`hideLabel`）、`frontend/src/features/search/components/HeaderSearch.reauth.test.tsx`（再認証の後も、ヘッダーの検索欄の語が残ること。`App`全体を描画する）、`frontend/src/features/app-shell/Drawer.test.tsx`（先頭のリンク）、`SearchPage.test.tsx`（言葉なしの案内の文）。E2E は`e2e/app-shell.spec.ts`（360・1280 のヘッダー）と`e2e/search.spec.ts`

## 既知の差・未実施

| 項目 | 状態 |
| --- | --- |
| 本番の D1 での trigram、30万件の実測、Time Travel | #160 |
| ウィンドウに戻ったときの取り直し（同じキー） | 応答が届くまでの間は、前の行が見えたまま。完了した時点で、置き換わるか消える |
| 「さらに表示」の要求の数 | 押すたびに、読み込んだページ数の分の要求が出る。ページ数の上限は設けていない |
| ヘッダーの検索欄（`SearchKeywordForm`）が素の`<input>`だったこと | **解消した（Issue #337）**。`TextField`に`hideLabel`を足し、`SearchKeywordForm`は`TextField`で作る |
| スマホ幅のヘッダーに置く、アイコンだけの検索ボタン | 作らない（アイコンの決まりがないため）。後の Issue（通知のアイコン化と一緒に）。いまの入口はドロワーの先頭のリンク |
| 本番での migration 0032〜0035 の適用と、既存のメッセージ・添付の登録 | **本番に未適用**。0013 以降のほかの未適用の migration と一緒に、利用を止めて1回の作業で出す（[ADR-0032](../adr/0032-first-production-rollout-stop-and-apply-at-once.md)・手順書 [production-first-rollout.md](../operations/production-first-rollout.md)。#160 で承認を得てから）。登録が終わるまで、既存のメッセージ・添付は検索に出ない。0034・0035 の本物の D1 での確認は #160・#350 |
| `scripts/search-reindex-local.ts`が、Node の標準の`module.registerHooks`で、拡張子のない相対の import に`.ts`を補っていること | backend のコード（拡張子を省くバンドラの前提）を Node で直接読むための書き方。**ルールが決まっていない書き方で、利用者に確認中** |
| 案件の資格の喪失の後片付け | #323 が「ページごと読み込み直す」方式に変える予定（上の「画面」） |
| E2E の各`*-cleanup.sql`（`e2e/seeds/`） | 検索の索引の行を消す文は足していない。`backend/db/seeds/cleanup.sql`と`e2e/seeds/search-cleanup.sql`だけが消す（索引の行は外部キーを持たないため、ほかの後始末の失敗にはならない） |
| `search_documents.kind`の CHECK | 155-B（0035）で`'message'`・`'attachment'`・`'case_title'`にした。155-C は CHECK を変えずに足せる。さらに種類を足して作り直すときは、ADR-0031 の追記の手順（写しを空にする → 生成のままの作り直し → 登録し直し） |
| 全角・半角、合成済み・結合文字、ASCII 以外の大小文字 | 本文と同じく、添付の名前でも、trigram の一致と画面の強調（`findSearchMatches`）がずれる場合がある（全角と半角は別の文字。テストで固定した） |
| 孤立した検索用の行と、番号の使い回し | 対応の行のない検索用の行は、後始末の順・途中の失敗で残りうる（`cleanup.sql`が消す）。いまは`AUTOINCREMENT`で番号を使い回さないため誤った一致にならないが、採番の記録を失う操作（表の作り直しなど）をすると誤った一致になる。作り直しは ADR-0031 の追記の手順で行う |
| 添付の付け替えと索引 | 添付を別のメッセージへ付け替えて、移った先 → 元の順に同期すると索引が欠ける（上の「順序に依らない範囲」）。いまは付け替えの経路がないため起きない |
| 155-C に向けた注意（解消） | 155-C で、案件の結果を別の文（EP-4-02）で作ることにした（上の「設計の判断」）。メッセージの検索の SQL は変えていない |
| 案件番号・取引先名の全件の走査（155-C） | `cases`・`clients`の全件を走査する。案件が少ない前提。30万件の規模での実測は #160 |
| DB の上での件名の直接の書き換え（155-C） | 組を通らないため、次の再編集か`search-reindex`（本番は登録の処理）を通るまで、新しい件名では出ない。古い件名でも出ない（いまの件名との一致を検索の条件にしているため）。案件番号・取引先名では出る |
| 案件の終了・再開の batch（155-C） | 件名を変えないため、組を足していない。件名を変える処理をこれらに足すときは、組も足す |
| #155 の外に移した2項目 | 全社員公開アーカイブの、参加していない人向けの検索（#356）・TODO の検索（#357）。4-2 は、すべて満たした扱いにしない |
| S-15 の総件数の表示・件数の読み上げ（screens.md の S-15） | 総件数を返さないため、出していない |
| キーワードが空のときの説明（screens.md の S-15） | **解消した（Issue #337）**。`q`がないときは、見出しの下に案内の文を1つ出し、結果の区画（案件・メッセージ）は出さない |

## 関係するIssue・ADR

- Issue #270の2つ目：本文のない投稿（添付だけの投稿）は本文の写しを作らない。決定記録C-205。目印は[messages.md](messages.md)の「添付だけの投稿と本文の目印」
- Issue #155（155-A・155-B・155-C）、#356（全社員公開アーカイブの検索）・#357（TODO の検索）、#160（本番での確認と適用・実測）、#353（本番で索引を作る経路）、#350（本物の D1 での確認）、#323（資格を失ったときの後片付け）、#270（添付の削除。1つ目で実装し、索引の組を足した。添付だけの投稿は2つ目。決定記録C-204）
- ADR-0010（FTS5 trigram）、ADR-0031（手で書く migration・既存の分の登録）、ADR-0026（マークダウンの許可リスト）、ADR-0030（利用者の切り替え）、ADR-0006（カーソル）、ADR-0012（毎回サーバー側で認可）
- 決定記録 C-152・C-200・C-201（155-B）・C-202（155-C）、C-199（再編集の文の上限）、C-168（`instr`）、C-90（1〜100文字）、C-94・C-117（未参加の公開チャンネル・案件番号の前方一致）、C-120（案件番号の正規化）、C-87・C-89（結果の概要）
- 要件：4-1 AC-1〜AC-3、4-2 AC-1〜AC-3、EP-4-01・EP-4-02、S-15、R-58・R-78
