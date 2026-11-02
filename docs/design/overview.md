# 設計書：全体の構成

実装したコードが、どのファイルが何を担当し、どうつながっているかを、1か所で見渡すための文書。実装したPRの中で更新する。

- コードは書き写さない。ファイル名・関数名で指し示す
- 機能ごとの設計書は、このフォルダに`<機能の名前>.md`として置き、下の「機能ごとの設計書」に足す。**機能ごとの設計書は、各機能のIssueで書く**（このIssue #105では書かない）
- 書き方（目的・ファイルと役割・処理の流れ・主な関数の入力と出力・テストの場所・関係するIssueとADR）は、`doc-writer`の「設計書の書き方」に従う
- 2026-11-02に、Issue #105（全体に関わる設計の方針）で、全体の構成と方針の要点を書いた。実装はまだない。ここに書いた内容は**方針**であり、実装したときに、実際のファイル・関数に合わせて直す

## 全体の構成

```text
ブラウザ（React。スマートフォンもブラウザ）
   │  同じドメイン（画面もAPIも1つのWorkersから配信）
   ▼
Cloudflare Workers（Hono）
   ├─ D1        … 利用者・セッション・メッセージ・案件・監査ログなどの正本（ADR-0005）
   ├─ R2        … 添付ファイル（Workers経由でアップロード・配信。C-126）
   ├─ Cron Triggers … 期限切れのセッション・ログイン試行の記録の掃除（ADR-0008）
   └─ Durable Objects（WebSocket）… 後で足す。最初はポーリング（ADR-0004）
```

- バックエンドは Cloudflare Workers 上の Hono、DBは D1（Drizzle ORM）、添付は R2、フロントエンドは React（Vite＋React Router）。技術とバージョンは`docs/tech-stack.md`
- 画面とAPIは1つのWorkersにまとめ、同じドメインから配信する（ADR-0003）。認証はクッキー方式のセッション
- バックエンドは Controller（`backend/src/routes/`）→ Service（`backend/src/services/`）→ Repository（`backend/src/db/`）の層に分ける（Skill「バックエンド」の層構成の規則）

## 全体に関わる設計の方針（要点）

各方針の理由・選択肢・影響は、ADRに書く。ここは要点と入口だけを書く。

| 項目 | 方針 | ADR |
| --- | --- | --- |
| リアルタイム更新 | 最初は2秒間隔のポーリング（Workers Paid前提）。あとでWebSocket（Durable Objects＋Hibernation）に置き換える（別のIssue）。「最後のID以降を取るAPI」を共通の土台にする | [0004](../adr/0004-realtime-polling-then-websocket.md) |
| DB | D1のみ（本番・ローカル・テストとも）。PostgreSQLへの一本化は採らない | [0005](../adr/0005-database-d1-only.md) |
| ID・ページ送り・未読 | 時刻順のULID相当のテキストID（自前生成）。一覧はすべてカーソル方式。未読は既読位置から上限つきで数え直す | [0006](../adr/0006-id-cursor-unread.md) |
| パスワードのハッシュ | `node:crypto`のscrypt（N=2^16, r=8, p=2）。PHC形式の自己記述の文字列。ログイン成功時に再ハッシュ。本番で確認して最終決定 | [0007](../adr/0007-password-hash-scrypt.md) |
| セッション・試行制限 | セッションはD1の`sessions`。ログインの試行制限は接続元単位（D1の`login_attempts`）。社員ID単位はロックせず待ち時間を増やす | [0003](../adr/0003-auth-cookie-session.md)・[0008](../adr/0008-session-and-login-throttle.md) |
| 管理者のMFA | 全体管理者だけTOTP（RFC 6238。WebCryptoで自作）を必須にする。細部は未決定 | [0009](../adr/0009-admin-mfa-totp.md) |
| 日本語の全文検索 | D1のFTS5 trigram（3文字以上は`MATCH`、1〜2文字は`LIKE`）。性能は実装時に実測 | [0010](../adr/0010-japanese-search-fts5-trigram.md) |
| 添付の検査 | Office新形式はzip構造を自前で確認。ウイルススキャンは別のIssueで調べてから決める | [0011](../adr/0011-attachment-inspection-and-virus-scan.md) |

## DBの設計の型

D1の制約（対話型トランザクションがない、1文の束縛値は100個まで、FTS5を含むDBはエクスポートできない）への対処の型。ローカルのD1（`wrangler dev --local`）での確認結果は、[調査メモ spike-d1-hash.md](../research/spike-d1-hash.md)の4-2（5）に書いてある。**本番のD1での確認は未了**。

| 困る点 | 対処の型 |
| --- | --- |
| 複数の文を1つの塊にしたい | `db.batch([...])`を使う。途中で失敗すれば全体が取り消される。`db.transaction()`は使わない（Skill「データアクセス（Drizzle）」） |
| 「読む→判断→書く」 | 条件つきの1文（`UPDATE ... WHERE status = ...`の更新件数を見る、`INSERT ... SELECT ... WHERE NOT EXISTS`）にする。更新件数0は衝突として扱い、`409`を返す。楽観的ロック（`version`列）と組み合わせる |
| `batch`の中で、前の文の結果を使えない | IDをアプリ側で先に生成する（ADR-0006）。案件＋専用チャンネル＋参加者の同時作成、アカウント登録などで使う |
| 1文の束縛値が100個まで | 複数行を入れるときは、JSONを**1つの束縛値**で渡し、`json_each`で展開して1文で入れる。または`batch`に1行ずつの文を並べる（上限は文ごとの判定）。1つのINSERT文に複数行分の束縛値を並べる書き方は、`too many SQL variables`で失敗する |
| 連番の採番（案件番号など） | 1文の`INSERT ... ON CONFLICT DO UPDATE ... RETURNING`で採番する（読む・足す・返すが1文で完結する）。ローカルで20件を同時に発行して重複しなかった。ユニーク制約を最後の守りにする。欠番は再利用しない（C-122） |
| FTS5を含むDBのエクスポート不可 | C-127で定期エクスポートを設けないため衝突しない。手動エクスポートは、仮想テーブルを削除して書き出し、`'rebuild'`で索引を作り直す（ADR-0010） |
| 一意性の最後の守り | ユーザーIDの正規化値、チャンネル名の大文字小文字を区別しない重複、`direct_key`、案件番号は、アプリの確認に加えて、DBの一意索引を置く |

## 索引の候補

「一覧の絞り込み条件＋並び順」と同じ並びの索引を、一覧ごとに作る。索引は書き込みのたびに更新され、D1の書き込み行数の課金にも効くため、使われる一覧だけに限る。下の表は**候補**であり、**確定は、実装時に`EXPLAIN QUERY PLAN`で確認して行う**。

| 対象 | 索引の候補 | 使う場面 |
| --- | --- | --- |
| `messages` | （ルーム, ID）。スレッド用に（親メッセージ, ID） | ルームの新しい順の一覧、スレッドの返信、未読の数え直し、「最後のID以降」の取得 |
| `read_positions` | 主キー（ユーザー, ルーム） | 未読の判定。ユーザーの全ルームをまとめて引く |
| `channel_members` / `case_participants` | （ユーザー, 状態）など | サイドバー、見られる範囲の判定 |
| `audit_logs` | （発生日時, ID）。絞り込み列は使われ方を見て追加 | 監査ログの絞り込みとページ送り、1年保持の掃除 |
| `sessions` | 主キー（ID＝トークンのハッシュ）。（ユーザー）。掃除用に（作成日時） | 認証、全端末の失効、掃除 |
| `login_attempts` | 主キー（種別, キー） | 試行制限 |
| 通知 | （ユーザー, 状態, ID） | 未読の通知 |
| 検索 | FTS5の仮想テーブル（ADR-0010） | 日本語の全文検索 |

## フォルダとファイルの役割

| 場所 | 役割 |
| --- | --- |
| `backend/src/routes/` | Controller。入力の受け取りと応答だけ |
| `backend/src/services/` | Service。業務のルール |
| `backend/src/db/` | Repository。DBへのアクセス |
| `backend/src/lib/` | 共通の部品（エラー・入力チェック・セキュリティなど。ハーネスが用意） |
| `backend/src/rules-examples/` | Skillの良い例・悪い例のテスト（ハーネスが管理する。消さない） |
| `frontend/src/` | 画面（React） |

（追加・変更したファイルを、実装したPRの中で、この表に足す）

## 処理の流れ

（主な処理の入口から出口までの流れを、実装したPRの中で書く）

## 機能ごとの設計書

| 機能 | 設計書 | 関係するIssue |
| --- | --- | --- |
| （まだありません。各機能のIssueで書く） | | |

## 関係する文書

- 要件：`docs/requirements.md`、`docs/requirements/`（決定記録は`docs/requirements/decision-register.md`のC-145〜C-153）
- 技術とバージョン：`docs/tech-stack.md`
- 調査メモ：`docs/research/`（[design-foundation.md](../research/design-foundation.md)・[db-d1-vs-postgres.md](../research/db-d1-vs-postgres.md)・[spike-d1-hash.md](../research/spike-d1-hash.md)ほか）
