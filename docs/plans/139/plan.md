# #139 計画レビュー第2回の修正案

## 最終採用記録（2026-11-15）
- 第1回Claude: 重大2/軽微5、第2回Claude: 重大0/軽微3。統括が技術計画を採用。利用者回答により自己指名は通知せず強調表示のみで確定。既知保留への回答なのでClaude再レビューは不要。
- API契約: GET /api/rooms/:roomId/mention-candidates。投稿/返信/編集は任意mentions[{userId,start,end}]（UTF-16）。DTO mentions[]は既存分では空配列。候補/保存対象はactive社員（公開ch未参加も含む）、通知対象はactive参加者のみ。
- 投稿guard確定: INSERT直後、requestedRoomIdで固定したrooms行の必須列をCASE changes()=1で検証。room存在時のINSERT0行は限定NOT NULL例外でbatch rollbackし、既存Service状態分類/ID再試行に接続。後続のメッセージ結合はmessageId AND requestedRoomId。room不在なら後続0件、同ID別roomへの副作用も禁止。sender/timeを真の固有値と扱う二重防御案は不採用。実D1のRedで証明する。
- 通知資格述語はDAO内1箇所へまとめ、投稿/返信/編集で参照。権限喪失後は通知一覧・未読数から除外し保存行保持、テスト側の独立期待値で確認する。
- #154の未実装機能は追加しない。既存の役割分離・認可を維持する。
- 第1回軽微の根拠なき指名50件上限と非参加指名をエラーにする案は不採用。第2回は自己通知既知保留を除いた技術計画のレビュー。

文書担当への引継ぎ: 自己通知なし・強調のみを決定新CおよびIssue記録へ同時反映する。

以下はレビューへ渡した計画本文と指示の記録。最終採用記録と食い違う箇所は上記を優先する。

あなたはClaudeによる独立した計画レビュー担当です。日本語で報告してください。実装・テスト・ファイル変更・シェルコマンド・追加エージェントは禁止。Read/Grep/Globのみ使えます。秘密情報ファイル(.env等)とdebug.logは読まないでください。今回は第2回であり、前回重大指摘2件の修正（編集のSQL内差分batch、通知時の参加かつ閲覧認可）と投稿0行の原子性保証の技術計画に絞ってください。自己通知は利用者回答待ちの既知の保留事項で、今回の技術レビューの対象外です。その未決定を新たな重大指摘として繰り返さず、自己通知以外の技術計画を評価してください。

先頭に「重大 n件 / 軽微 m件」を書き、指摘を重要度、根拠ファイル、問題、最小修正案の表で報告してください。最後に実装へ進めるか結論を明記。空/短い成功扱いは禁止。該当Skillと接続点だけ絞って確認し、大量探索を避けてください。

## 確定範囲・受け入れ条件
- 1-8 AC1-3: @入力で社員候補、表示名/部署、同名はuserIdで区別、全員宛なし。
- 3-2 AC1-3: 指名本人のアプリ通知だけ、メールなし。未参加公開チャンネルへの通知なし。
- チャンネル/DM/返信/編集が対象。既存の参加・閲覧認可を維持する。
- 1-4 AC4: 自分が指名されたスレッドをS35 mineへ含める。
- 1-5 AC7: 指名は強調表示のみ、クリック不可。
- 編集通知は2026-11-15利用者合意: 編集で新規追加のuserIdだけ通知。維持は再通知なし。除去後の再追加は再通知。過去の通知を保持。自分を指名した場合は通知せず強調表示のみ（2026-11-15利用者承認）。
- 退職者強調のAC4案、全文検索、新規ライブラリ、本番変更は対象外。依存#137/#124は完了。

## 実装計画案
1. bodyは通常Markdownを維持し、任意のmentions:{userId,start,end}[]をAPIへ追加。UTF-16半開区間で本文内の選択した@表示文字を指し、範囲/整数/非重複/不正サロゲート境界を検証する。通常の@文字列は指名として扱わない。同じ意味の制約は最小範囲で共通定義する。
2. message_mentionsを追加し、メッセージID/指名先ID/位置を保存する。DTOはID/位置を返す。投稿者について既存の部屋閲覧・投稿認可を検証し、候補APIもその認可を確認して社員の部署/表示名を返す。候補・指名保存対象・通知先を混同しない。既存合意により未参加の公開チャンネルの社員も指名可、非参加を理由に指名保存をエラーにしない。DM関係、無効化/退出/退職状態は既存ルールを維持。通知だけは作成時点の有効参加者かつ閲覧可能な指名本人に限定する。
3. 投稿/指名/通知を同一db.batchで確定し、投稿条件不成立0行なら指名・通知副作用0件とする。新規投稿/返信でINSERT0行でも同ID既存行がある場合、単なるmessageIDのEXISTSだけでは副作用が既存行へ付くため使わない。INSERT直後のchanges()=1を、既存project-rulesのNOT NULL失敗型guardで確認する（部屋の必須列にCASEを使う等、具体schema列はDB担当が確認）。0行ならbatch全体をrollbackし、当該guardの限定した失敗だけを翻訳して既存の状態再判定/ID再試行へ接続する。他エラーをもみ消さない。D1上のchanges()・batch原子性・同ID既存行への副作用なしをRedで検証する。編集は旧指名集合をSQL内で読む単一db.batch方式に確定し、write_token列は追加しない。順序は通知のINSERT…SELECT（新userIdのうち旧message_mentionsに存在しないもの）→旧指名DELETE→新指名INSERT→本文UPDATE。すべてに同じmodifiable条件を付け、DB担当が競合時の順序・条件と0行時の副作用0件を検証する。通知INSERTのSQL自身で有効参加者条件と閲覧可能条件の両方を検証する（公開チャンネルは閲覧可能だけでは未参加者を除外できないため）。Serviceの事前確認だけで通知資格を決めない。非参加者の指名保存は許可したまま通知を作らない。同一人物の複数位置は通知1件。過去通知を削除しない。
4. S35 mineは親/返信の指名先から親IDを合流する。既存の最近100件、権限、未読、並び順、ページングの意味を維持し、削除返信の除外条件も既存mineと合わせてテストする。新通知種別はcontainsRoomContent:trueを明記し、権限喪失時は通知一覧から除外する。保存済み過去通知の保持と表示除外を分ける。
5. フロントは候補選択でuserId/範囲を保持し、入力変更に応じて位置更新・編集された指名の解除を行う。Composer/EditForm/Body/Markdownと下書きを更新。旧bodyのみ下書きを互換読込。Markdown/XSS安全性を維持し、強調はクリック不可。IMEとキーボード操作に対応。
6. 指名数に根拠のない50件などの新業務上限を加えない。既存thread-unread-counts.sql.tsのjson_eachにJSON.stringify(targets)を1パラメータで渡す方式を採用し、本文長由来の最大入力でもD1 bind上限を避ける。本文長・範囲の検証は維持し、上限付近の有効入力をテストする。新規ライブラリは加えない。
7. Red担当が先に受け入れ条件テストを追加し失敗を確認。実装担当は本番コードのみでGreen/整理。品質担当がプロジェクト全体のlint/型/format/test/build、全体mutation80%以上、開発形・本番形のE2E全件を実行する（shared変更のためproject-rules/ADR0020に従う）。Claudeが最新headのコードを別会話でレビュー。文書担当がOpenAPI、設計、必要決定を更新。統括採否の後に実装へ進む。自己通知は通知なし・強調のみで確定。

## 変更入口
backendのschema.ts、routes/messages.ts、services/message.service.ts、db/message.repository.ts、message-modify.sql.ts、reply-insert.sql.ts、thread-list.sql.ts、notification.repository.ts、shared/notification-kinds.tsと関連DTO/API/テスト/マイグレーション。
frontendのメッセージComposer/EditForm/Body/Markdown、draft、notificationsと関連API型/テスト。
docs/api、docs/design、必要な要件決定の記録。既存の命名・配置に合わせ、不要な大規模整理をしない。

## テスト計画
候補の同名/部署/認可/無効状態、ID偽装/本文範囲/サロゲート/重複/普通@、親/返信/DM投稿、未参加公開ch、自分指名、重複人物、編集追加/維持/削除/再追加、競合編集/条件0行/ID再試行/バッチrollback、下書き旧互換/範囲更新/IME/keyboard、Markdownリンク/code/XSS、S35 mineと既存並び/100件/未読/ページング、権限喪失通知の表示除外/過去保持を確認する。実データ/本物APIを使わず識別付き架空データを使う。

## 従うルール
AGENTS.md、docs/project-rules.md、.agents/skillsのimplementation-process/review/backend/backend-hono/error-api/data-access-drizzle/security/logger/frontend/frontend-build/frontend-state/http-client-axios/testing/test-tools/quality-toolsに従う。計画レビューでは関連Skillを読んで層分離、サーバー認可/入力検証、エラー非隠蔽、ログの秘密排除、定義の一元化、独立期待値、DBの原子性を確認する。新規ライブラリや要件変更が必要なら止めて統括へ返す。
