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
| [0018](0018-client-initial-seed-migration-exception.md) | 予約取引先INTの初期登録専用migrationを1本だけ手作成する | 採用 |
