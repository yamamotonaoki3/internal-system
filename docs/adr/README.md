# 設計判断の記録（ADR）

後から参照する大きな設計判断（構成の選択・ライブラリの選定の理由など）を、1件1ファイルで残す。

- ファイル名は `<4桁の番号>-<内容>.md`（例：`0002-session-store.md`）。番号は順に増やす
- `0000-template.md` を写して書く。背景・選択肢・決定・理由・影響をそろえる
- 決定を変えるときは、元のADRを消さずに、新しいADRを追加する。元のADRの「状態」を「置き換え（新しいADRの番号）」にする
- 作業中のやり取り・レビューの指摘への対応は、ADRではなくIssue・PRに書く

## 一覧

| 番号 | 内容 | 状態 |
| --- | --- | --- |
| [0001](0001-accepted-warnings.md) | 許容する警告 | 採用 |
| [0002](0002-issue-by-feature.md) | Issueは機能の単位で立てる | 採用 |
| [0003](0003-auth-cookie-session.md) | 認証にクッキー方式のセッションを使う | 採用 |
| [0004](0004-realtime-polling-then-websocket.md) | リアルタイム更新は、最初はポーリングで作り、あとでWebSocketに置き換える | 採用 |
| [0005](0005-database-d1-only.md) | DBはD1のみとする | 採用 |
| [0006](0006-id-cursor-unread.md) | IDは時刻順のテキスト、一覧はカーソル方式、未読は既読位置から数え直す | 採用 |
| [0007](0007-password-hash-scrypt.md) | パスワードのハッシュはscryptを採用する（本番で確認して最終決定） | 採用 |
| [0008](0008-session-and-login-throttle.md) | セッションはD1に保存し、ログインの試行制限は接続元単位でD1に記録する | 採用 |
| [0009](0009-admin-mfa-totp.md) | 全体管理者にだけTOTPを必須にする | 採用 |
| [0010](0010-japanese-search-fts5-trigram.md) | 日本語の全文検索はFTS5 trigramで行い、1〜2文字はLIKEで補う | 採用 |
| [0011](0011-attachment-inspection-and-virus-scan.md) | 添付の検査は自前で行い、ウイルススキャンは別Issueで決める | 採用 |
| [0012](0012-zero-trust-principle.md) | ゼロトラストを設計の原則とする | 採用 |
| [0013](0013-initial-setup-auth-and-pii-encryption.md) | 初回セットアップの認証は環境のシークレットで行い、本名はAES-256-GCMで暗号化して保存する | 採用 |
| [0014](0014-ai-may-set-dev-test-secrets.md) | 開発・テスト用の使い捨ての秘密の値は、AIが環境ファイルに書いてよい | 採用 |
| [0015](0015-style-foundation.md) | スタイルの方針は、Tailwind CSS 4とCSS変数のデザイントークンと、自前の小さな共通部品にする | 採用 |
| [0016](0016-supervised-automation.md) | プロジェクト継続作業の監視付き自動実行 | 採用 |
| [0017](0017-password-composition-policy.md) | パスワードの構成規則 | 採用 |
| [0018](0018-client-initial-seed-migration-exception.md) | 予約取引先INTの初期登録専用migrationを1本だけ手作成する | 採用 |
| [0019](0019-efficiency-trial.md) | 次の1Issueで運用改善を試行する | 採用（1Issueの試行。ミューテーション・E2Eの全体実行の部分は0020が置き換え） |
| [0020](0020-test-scope-mutation-e2e.md) | ミューテーションとE2Eの実行範囲を、開発中は影響範囲に絞り、決めた時期に全体を確認する | 採用 |
| [0021](0021-department-channel-backfill-migration-exception.md) | 初代部署の専用チャンネルを補うmigrationを1本だけ手作成する | 採用 |
| [0022](0022-company-general-channel-seed-migration-exception.md) | 全社連絡を補うmigrationを1本だけ手作成する | 採用 |
| [0023](0023-mutation-equivalent-mutants-exception.md) | ファイル別ミューテーションスコア80%の基準に、同値変異体による例外を設ける | 採用 |
| [0024](0024-add-column-rewrite-for-table-rebuild.md) | 既存テーブルへの列追加でテーブルの作り直しが生成されたとき、migrationをADD COLUMNに書き換える | 採用 |
| [0025](0025-rebuild-referenced-table-defer-foreign-keys.md) | 他の表から参照されるroomsのCHECKを変えるための作り直し（D1ではPRAGMA foreign_keys=OFFが効かないためdefer_foreign_keysに置き換える。0016の1本だけ） | 採用 |
| [0026](0026-markdown-rendering.md) | マークダウンの描画にreact-markdownとremark-gfmを使い、生のHTMLを通さず、描画する要素とリンクを許可リストで限る | 採用 |
| [0027](0027-self-made-emoji-picker.md) | 絵文字のピッカーを自前の小さな部品にし、emoji-picker-react を入れない（本番のCSP `style-src 'self'` で動かないため。スタンプは文字6つ） | 採用 |
| [0028](0028-lighter-process-and-narrowed-scope.md) | 進め方を軽くし、範囲を絞る（文書・テストだけの差分のレビュー省略、ミューテーションの後回し、計画レビューの回数、並列の進め方） | 採用 |
| [0029](0029-attachment-delivery-headers-and-content-type-check.md) | 添付の配信の応答だけ、共通のセキュリティヘッダー（CSP・Cache-Control）を上書きさせない。`content_type`にCHECK制約を付けない（drizzle-kitが「;」で生成を切るため） | 採用 |
| [0030](0030-clear-cache-on-user-switch.md) | 利用者の切り替えのときは、枠でセッション以外のキャッシュを一括して捨てる（キーごとに利用者のIDを足さない。進行中の操作は#300、別のタブは#298） | 採用 |
| [0031](0031-search-fts-handwritten-migration.md) | 検索用の表（FTS5 の仮想の表）の migration を手で書く（`--custom --name`で空の migration を作る。`schema.ts`に書かない。生成の後に差分が出ないことを毎回確かめる。既存のメッセージの索引は登録の処理で作る。2026-11-21 追記：`search_documents`を作り直すときは、先に写しを全部消す手で書いた migration を置き、生成のままの作り直しの後に登録し直す） | 採用 |
| [0032](0032-first-production-rollout-stop-and-apply-at-once.md) | 本番への最初のまとまった適用（migration 0013 以降）を、利用を止めて、1回の作業で行う（今回1回だけの例外。戻すときはアプリと DB を組で戻す） | 採用 |
| [0033](0033-reload-page-after-access-loss.md) | 案件の資格を失ったと確定したら、数え上げの片付けの後に、ページごと読み込み直す（メモリの中のすべてを消すため。参加者だったことを見た後に限る。残る範囲は #339〜#342） | 採用 |
| [0034](0034-cross-tab-access-loss-hint.md) | 別のタブには、資格の喪失を`BroadcastChannel`で「確かめのきっかけ」として伝える。受けたタブは、自分で概要を確かめ直し、非参加・404 なら、片付け・下書きの消去はせず、画面を隠して読み込み直すだけにする（画面と通信の利用者が食い違うタブでの取り違えを避けるため。ログアウト・利用者の切り替えには使わない） | 採用 |
| [0035](0035-session-user-mismatch-header.md) | 画面が想定の利用者を要求ヘッダー`X-Expected-User-Id`で伝え、有効なセッションの利用者と食い違えば、サーバーが 409 `SESSION_USER_MISMATCH` で断る（断る向きにだけ使い、認可には使わない。ヘッダーが無い要求は通す。サーバーの側は実装済み、画面の側は後の PR で実装し ADR-0030 の一部を置き換える予定） | 採用 |
| [0036](0036-case-access-loss-outside-view.md) | 案件の画面の外でも資格の喪失に気づけるよう、スレッド一覧・返信の成功応答に案件の ID（`caseId`）を足す。取得の実績は Query のキャッシュから求め（台帳を作らない）、Query の出来事を受ける購読を1つにして、S-17 は担当として登録する。スレッド一覧の行の消失は確かめのきっかけにとどめ、実績がある初回の非参加・404 と、別のタブの合図の対象も広げる（検索だけの経路は別の Issue（#388）） | 採用 |
| [0037](0037-keep-cookie-on-invalid-session.md) | 使えない（失効・期限切れ・無効な）セッションの Cookie が付いた通常の要求には、401 で拒否するだけで、応答で Cookie を消さない（別のタブのログイン直後に、古いタブの 401 が新しい Cookie を消す競合を防ぐ）。Cookie を消すのは、失効を確定した後のログアウトだけにする（Cookie の名前を分ける案などは採らない）。遅れたログアウトの応答などの競合は解消しない（Issue #383。C-211） | 採用 |
