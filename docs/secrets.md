# 秘密情報の設定の手順

パスワード・APIキー・トークンなどの秘密情報は、**利用者が自分で入力する**。AIは手順を案内するだけで、値を扱わない。

## 守ること

- 値をチャットに貼らない。スクリーンショットにも写さない
- 値を入力するコマンドは、AIに実行させず、自分でターミナルで実行する
- `.env.development`・`.env.test`など実際の値が入ったファイルはコミットしない（`.gitignore`で除外済み）

## 開発・検証（手元のPC）

開発と検証は、環境変数のファイルを分けて使う。テストは検証のファイル（`.env.test`）だけを読み込む。

1. 見本をコピーして、開発用と検証用のファイルを作る

   ```bash
   Copy-Item .env.example .env.development
   Copy-Item .env.example .env.test
   ```

   macOS/Linux では `cp .env.example .env.development` と `cp .env.example .env.test` を使います。
2. それぞれをエディタで開き、各項目に値を書いて保存する。`APP_ENV`は`.env.development`で`development`、`.env.test`で`test`にする。テスト用PostgreSQLのDB名は `_test` で終わらせ、開発と別のDB・ポート・資格情報を使う。D1とR2のローカル保存先も分かれる
3. 足りない項目がないかを確かめる（項目の名前と今の環境の名前だけが表示され、値は表示されない）

   ```bash
   npm run env:check
   npm run env:check -- test
   ```

4. 開発用コンテナに新しい値を反映するときは、環境を選ぶラッパーで再作成する

   ```bash
   npm run docker:down:local
   npm run docker:up:local
   ```

テストは `npm run test`、テスト用DB操作は `npm run db:migrate:test` などのコマンド、テスト用Dockerは `npm run docker:up:test`・`npm run docker:down:test` を使う。`npm run db:generate -- --name <名前>` は引き続きマイグレーション生成に使えます。開発・テスト用のコマンドは親プロセスの接続設定を引き継がず、設定値も診断に表示しません。テスト用のローカルDB設定であり、任意の外部DBへの接続を安全と保証するものではありません。

**本番の値（秘密情報・本番のDBの接続先）は、手元の平文のファイルに書かない**（プロジェクトの外のファイルも含む）。

## 本番の値を控えておく場所

本番の値を控えておく必要がある場合（再登録・引き継ぎ等）は、暗号化された保管場所に置く。使うソフトは、次から選んでこの欄に書く。

このプロジェクトで使う保管場所：（選んで書く）

| ソフト | 特徴 |
| --- | --- |
| Bitwarden | 個人は無料で使える。複数のPC・スマートフォンで同期できる |
| KeePassXC | 無料。暗号化したファイルを自分のPCにだけ保存する。ファイルのバックアップは自分で取る |
| 1Password | 有料。チームでの共有の機能が充実している |
| OSに標準の資格情報の管理 | 追加のインストールが要らない。ほかのPCとの共有はできない |

- 料金・機能は変わることがあるため、選ぶときに公式の情報を確かめる
- `wrangler secret put`で値を入力するときは、保管場所から貼り付ける。値をチャットやファイルに残さない

## 本番（Cloudflare）

1. 秘密情報を登録する（`<項目名>`は置き換える）

   ```bash
   npx wrangler secret put <項目名>
   ```

2. 値を聞かれたら、その場で入力する（画面には表示されず、ファイルにも残らない）
3. 登録した項目の名前を確かめる

   ```bash
   npx wrangler secret list
   ```

Cloudflare上に検証の環境を足した場合は、それぞれのコマンドに`--env <環境>`を付ける。

## CI（GitHub Actions）

- GitHubのリポジトリの Settings → Secrets and variables → Actions で登録する
- または、次を実行して、聞かれた値を入力する

  ```bash
  gh secret set <項目名>
  ```

- CI の `.env.development`・`.env.test` は、`.env.example` から作る
- `SETUP_TOKEN`・`PII_ENCRYPTION_KEY`・`LOGIN_THROTTLE_KEY` の3項目は、Secret を使わず、CI の中で実行ごとに乱数で生成して `.env.development`・`.env.test` に入れる（値はログに出さない。空のままなら失敗する。`.github/workflows/check.yml`）
- 他の秘密の項目を `.env.example` に足すとき、Secret から渡す方式が必要になるかは、足す時点で別途決める
- 以前の手順で登録した Secret の `ENV_TEST` は不要になった。削除は利用者が行う（`gh secret delete ENV_TEST`。AI は実行しない）

## Terraform

- 秘密情報はコードに書かず、環境変数で渡す。`.env.example` には入れない（`npm run dev` などの手元の実行には要らない。`infra/` で Terraform を使うときだけ、自分のターミナルで設定する）

  ```bash
  export TF_VAR_<項目名>="<値>"   # 入力した値がシェルの履歴に残らないよう、履歴の設定に注意する
  ```

- `infra/` で使う項目（値は保管場所から貼り付ける。チャットやファイルに残さない）

| 項目名 | 用途 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare の API トークン（Terraform の認証。D1・R2・Hyperdrive の編集の権限だけを付ける） |
| `TF_VAR_account_id` | Cloudflare のアカウント ID |
| `TF_VAR_hyperdrive_host`・`TF_VAR_hyperdrive_database`・`TF_VAR_hyperdrive_user`・`TF_VAR_hyperdrive_password` | Hyperdrive の接続情報（`infra/hyperdrive.tf` があるときだけ） |

- Terraform の状態ファイル（`terraform.tfstate`）には、これらの値が残ることがある。コミットせず、リモートの状態管理に置く（`infra/README.md`）

## 設定する項目の一覧

| 項目名 | 用途 | 開発 | 検証 | 本番 |
| --- | --- | --- | --- | --- |
| `APP_ENV` | 環境の名前 | development | test | production |
| `ALLOWED_ORIGINS` | 状態を変える要求を許可する送信元（カンマ区切り） | 手元の画面のURL | 手元の画面のURL | 本番のドメイン（wrangler.jsonc の vars・IaC で設定する） |
| `APP_PORT` | Docker で動かすときに、手元で開くポート（docker-compose.yml が読む） | 5173（ほかのアプリと重なるときだけ変える。変えたら ALLOWED_ORIGINS も合わせる） | 5173 | 使わない（Cloudflare の Workers で動く） |
| `SETUP_TOKEN` | 初代全体管理者の初回セットアップ用の認証（ADR-0013）。43文字の乱数 | 利用者が生成して `.env.development` に入れる | 利用者が生成して `.env.test` に入れる（開発と別の値） | 利用者が `wrangler secret put` で入れ、セットアップ完了後に削除する |
| `PII_ENCRYPTION_KEY` | 本名（個人情報）を暗号化する鍵（AES-256-GCM。ADR-0013）。43文字の乱数 | 利用者が生成して `.env.development` に入れる | 利用者が生成して `.env.test` に入れる（開発と別の値） | 利用者が `wrangler secret put` で入れる。削除しない |
| `LOGIN_THROTTLE_KEY` | ログインと初回セットアップの試行制限で、接続元・社員IDのキーを作る HMAC の鍵（ADR-0008）。43文字の乱数 | 利用者が生成して `.env.development` に入れる | 利用者が生成して `.env.test` に入れる（開発と別の値） | 利用者が `wrangler secret put` で入れる。削除しない |

## 初回セットアップ用の項目（SETUP_TOKEN・PII_ENCRYPTION_KEY）

初代全体管理者の登録（画面 S-34）に使う2つの項目。どちらも**32バイトの乱数を base64url にした、ちょうど43文字**の値にする。開発・検証・本番で**別の値**にする。値はチャット・Issue・PR・コミットに貼らない。設計の理由は [ADR-0013](adr/0013-initial-setup-auth-and-pii-encryption.md) にある。

### 値の作り方

利用者が自分のターミナルで実行し、表示された値を、`.env.development`・`.env.test`（手元）または `wrangler secret put` の入力欄（本番）に入れる。2つの項目は、別々に2回実行して、別の値にする。

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

### 本番に入れる（利用者が実施。AI は実行しない）

```bash
npx wrangler secret put SETUP_TOKEN
npx wrangler secret put PII_ENCRYPTION_KEY
```

値は、実行後の入力欄に貼る（保管場所から貼り付ける）。足りない・形式が正しくない場合、初回セットアップの API は 503 を返す（アプリ全体は止まらない）。

### セットアップが終わったら SETUP_TOKEN を削除する（利用者が実施）

初代全体管理者の登録が終わったら、入口を閉じるため、本番の `SETUP_TOKEN` を削除する。削除しなくても、登録後は正しいトークンでも 409 になる（完了の判定は DB の状態）が、不要なシークレットを残さない。

```bash
npx wrangler secret delete SETUP_TOKEN
```

削除したあと、`npx wrangler secret list` で `SETUP_TOKEN` が消えたことを確かめる。以後、`/api/setup` の POST は 503 を返す。

### PII_ENCRYPTION_KEY を控える

`PII_ENCRYPTION_KEY` を**紛失すると、保存済みの本名を復号できない**。「本番の値を控えておく場所」に、本番の値を控えておく。鍵を別の値に入れ替える（ローテーション）手順と、紛失した場合の復旧手順は**未決定**（ADR-0013）。入れ替えると、すでに保存した本名が復号できなくなるため、手順が決まるまで入れ替えない。

## ログインの試行制限用の項目（LOGIN_THROTTLE_KEY）

ログイン（`/api/auth/login`）と初回セットアップ（`/api/setup`）の試行制限で、接続元と社員IDを**秘密の鍵つきHMAC**にしてDBに保存するための鍵（生のIP・社員IDは保存しない。[ADR-0008](adr/0008-session-and-login-throttle.md)、設計は [auth-session.md](design/auth-session.md)）。値は**32バイトの乱数を base64url にした、ちょうど43文字**。開発・検証・本番で**別の値**にする。値はチャット・Issue・PR・コミットに貼らない。

### 値の作り方

`SETUP_TOKEN` と同じコマンドを、利用者が自分のターミナルで実行する。別の項目とは別々に実行して、別の値にする。

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

- 手元：表示された値を `.env.development`・`.env.test` の `LOGIN_THROTTLE_KEY=` に入れる（利用者が入れる）
- CI：Secret は使わず、実行ごとに乱数で生成して入れる（上の「CI」の節。`.github/workflows/check.yml`）

### 本番に入れる（利用者が実施。AI は実行しない）

```bash
npx wrangler secret put LOGIN_THROTTLE_KEY
```

値は、実行後の入力欄に貼る。未設定・形式不正の場合、ログインと初回セットアップの POST は 503 を返す（アプリ全体は止まらない）。

### 鍵を変えるとき

鍵を変えると、それまでの試行の記録（`login_attempts`）は新しい鍵では参照できなくなり、**試行の数が数え直しになる**（ロック中の接続元の制限も外れる）。ほかの機能が壊れるわけではないが、攻撃を受けている最中の入れ替えは避ける。古い行は、掃除（Cron）が最終更新から1日後に消す。
