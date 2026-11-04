# 設計書：ロール・権限・会社と部署の土台・初回セットアップ

Issue #119（親Issue #108）で実装した、ロールと権限、会社・部署・利用者のテーブル、初代全体管理者の初回セットアップ（S-34）の設計。コードは書き写さず、ファイル名・関数名で指す。

## 目的

- 第1段階の固定のロール（一般メンバー・オーナー・全体管理者）とその権限を、#118の権限判定の枠（`createAuthorizer`）で使える形にする
- 会社の設定・部署・利用者・ロールの割り当てのテーブルを用意する
- ログインの前に、代表取締役社長本人が初代全体管理者を1回だけ登録できるようにする
- 範囲外：TOTPの登録（#122）、ロールの編集・新規作成（#158・#159）、ログイン（#120）、チャンネルの初期データ（「全社連絡」など。チャンネルのIssueで作る）

## ファイルと役割

### バックエンド

| ファイル | 役割 |
| --- | --- |
| `backend/src/lib/permissions.ts` | 権限ID（`PERMISSIONS`。67種類）、固定ロールのID（`ROLE_IDS`）、ロールごとの権限の初期値（`INITIAL_ROLE_PERMISSIONS`）、部署の範囲ではオーナーを兼ねるときだけ効く権限（`DEPARTMENT_OWNER_ONLY`） |
| `backend/src/services/permission-resolver.ts` | `resolvePermissions`。割り当てと範囲から権限の候補を返す純粋関数 |
| `backend/src/db/role-assignment.repository.ts` | `findByUserId`。利用者と割り当てを1回のJOINで読む |
| `backend/src/services/authorizer.ts` | `createAppAuthorizer`。`createAuthorizer`を呼ぶ**唯一の場所**（ADR-0012の「毎回サーバー側で確認する」の入口） |
| `backend/src/lib/password.ts` | `generateInitialPassword`・`hashPassword`・`verifyPassword`（scrypt。ADR-0007）。#120のログインも使う |
| `backend/src/lib/setup-token.ts` | `verifySetupToken`。SHA-256にして定数時間で比較する |
| `backend/src/lib/pii-crypto.ts` | `encryptLegalName`・`decryptLegalName`・`isValidPiiKey`（AES-256-GCM。ADR-0013） |
| `backend/src/config.ts` | `loadConfig`が`setupToken`・`piiEncryptionKey`を読む。未設定・形式不正は`null` |
| `backend/src/lib/audit-actions.ts` | 操作の種類に`setup.initial_admin.create`を足した |
| `backend/src/db/setup.repository.ts` | `isSetupCompleted`・`createInitialAdmin`・`withSetup`。一意制約の違反は`SetupConflictError`にする |
| `backend/src/services/setup.service.ts` | `getSetupStatus`・`authenticateSetup`・`completeSetup` |
| `backend/src/routes/setup.ts` | `GET /api/setup/status`・`POST /api/setup`。`backend/src/index.ts`で`/api/setup`に組み込む |
| `backend/db/schema.ts` | 下の「テーブル」の6つ |
| `backend/db/migrations/0002_add_roles_company_users_tables.sql` | 6つのテーブルと部分一意インデックス |
| `backend/db/migrations/0003_seed_initial_roles.sql` | 3つの固定ロールと`role_permissions`の初期値（シード） |
| `backend/db/seeds/cleanup.sql` | テストデータの削除（社員ID`testuser_`・`e2euser_`、部署名・会社名`[UNIT_TEST]`・`[E2E_TEST]`）。初期ロールは消さない |

### フロントエンド

| ファイル | 役割 |
| --- | --- |
| `frontend/src/pages/SetupPage.tsx` | 画面S-34（`/setup`）。部品を組み合わせるだけ。`frontend/src/App.tsx`に経路を足した |
| `frontend/src/features/setup/components/SetupFlow.tsx` | 状態の振り分け（読み込み中・取得失敗で再試行・完了済み・未設定でフォーム）と、登録成功後の初期パスワードの表示 |
| `frontend/src/features/setup/components/SetupForm.tsx` | 入力フォーム（トークン・会社名・部署名・社員ID・本名・メール・メール確認のチェック・内線・役職）と送信 |
| `frontend/src/features/setup/components/InitialPasswordNotice.tsx` | 初期パスワードを一度だけ文字で表示する |
| `frontend/src/components/SecretField.tsx` | 秘密の入力欄（表示の切り替え）。ログイン画面（#120）と共通にするため、`features/setup/components/`から移した |
| `frontend/src/features/setup/components/SetupEntryLink.tsx` | 「初回セットアップへ」のリンク。未設定と分かっているときだけ出す。#120で`HomePage`から`LoginPage`（未ログインでも見える場所）へ移した |
| `frontend/src/features/setup/api/setup-api.ts` | `fetchSetupStatus`・`submitSetup`。共通の`apiClient`を使う |
| `frontend/src/features/setup/hooks/useSetupStatus.ts` | 状態の取得 |
| `frontend/src/features/setup/schemas/setup-form.ts` | 入力チェック（サーバーと同じ長さ・文字種。サーバー側でも検査する） |

## ロールと権限

- 権限IDは67種類で、`docs/requirements/permissions.md`の権限表と同じ。**権限のテーブルは置かず**、一覧はコード（`PERMISSIONS`）が持つ。`role_permissions`は「どのロールがどの権限IDを持つか」の行
- 固定のロールは3つ：`role_member`（一般メンバー。範囲は部署）、`role_owner`（オーナー。範囲は部署）、`role_global_admin`（全体管理者。範囲は会社全体）。IDは`ROLE_IDS`
- 権限の初期値は、コードの`INITIAL_ROLE_PERMISSIONS`と、マイグレーション`0003_seed_initial_roles.sql`の**二重持ち**。食い違いは`role-assignment.repository.db.test.ts`が検出する

### Resolverの規則（`resolvePermissions`）

入力は、利用者（`isActive`）・割り当ての一覧・範囲（会社、または部署のID）。出力は権限IDの集合。

1. 無効な利用者は、割り当てが残っていても空の集合
2. 有効な利用者は**全員**、一般メンバーの権限をすべての範囲（会社・どの部署）で持つ。**一般メンバーの割り当て行は作らず、コードで導く**（`docs/requirements/data-model.md`の3.4）。オーナー・全体管理者も同じ権限を含む
3. 全体管理者（会社範囲の割り当て）の権限は、会社範囲とすべての部署に効く。ただし部署の範囲では、`DEPARTMENT_OWNER_ONLY`（`perm.workspace.manage`・`perm.role.workspace.edit`・`perm.role.workspace.assign`の3つ）を除く。この3つは、その部署のオーナーを兼ねる（その部署のオーナーの割り当てもある）ときだけ効く
4. オーナー（部署範囲の割り当て）の権限は、**同じ部署の範囲でだけ**効く
5. 和集合を返す

`createAppAuthorizer`は、`findByUserId`で読んだ結果をResolverに渡す。存在しない利用者は空の集合（全員の権限も含めて拒否）にする。未ログインは`UNAUTHENTICATED`、権限なしは`FORBIDDEN`で、拒否は`logger.audit`に記録する（#118の`createAuthorizer`の挙動）。

### 返すのは「候補」であり「許可」ではない

Resolverが返す集合は、「この範囲で、この操作を試してよいロールの候補」であり、操作の許可ではない。権限表で「条件付き」の権限は、**各機能のServiceが、対象ごとに条件を確かめてから実行する**。Resolverと`authorize`だけで許可してはいけない（`permission-resolver.ts`のコメントにも同じ注意を書いた）。

### 条件付きの権限の責務の表

条件を確かめるのは、それぞれの機能のIssueのServiceである（本Issueでは、条件の対象のテーブル自体がないため確かめられない）。権限ID・Rの番号は`docs/requirements/permissions.md`の3章が正。

| 条件の種類 | 主な権限（R番号） | 確かめる内容 |
| --- | --- | --- |
| 参加者のみ | 非公開チャンネルの閲覧 R-48、招待 R-49、案件の内容・投稿・参加者の編集・TODO・終了（R-59・R-61〜R-64・R-76・R-77） | 対象のチャンネル・案件の参加者であること。全体管理者・オーナーも例外なし |
| 投稿できる場所のみ | 添付 R-32、メンション R-37、チャンネルの投稿 R-23 | 参加しているチャンネルなど、投稿できる場所であること。公開チャンネルは読むだけなら参加不要、投稿は参加者のみ |
| 見られる範囲のみ | 返信 R-30、リアクション R-35、添付の取得 R-33、検索 R-58、リアルタイム受信 R-38 | 対象のメッセージを見られること |
| 本人のみ | 却下された自分の申請の確認 R-46、自分専用の整理スペース R-75、自分の投稿の編集・削除、自分が添付したファイルの公開可否 R-85 | 操作者が対象の本人（作成者）であること |
| 当事者のみ | DMの閲覧 R-25 | DMの当事者であること |
| 対象の部署を範囲にする | 代理のステータス設定 R-11、お知らせの投稿 R-70、フォルダの管理 R-74、チャンネルのアーカイブ R-81、案件のアーカイブ R-83 など（オーナー） | 操作の対象が、オーナーの自部署に属すること。全体管理者は全部署 |
| 複数の担当部署のどれか | 案件の承認 R-65、案件のアーカイブ R-83 | 案件の担当部署のうち1つでも自部署であること |
| 自分の申請の扱い | 案件の承認 R-65（オーナーは自分の申請は不可）、チャンネル作成の承認 R-45 | 申請者が自分でないこと。例外は下の「R-45の申し送り」 |
| 状態の条件 | 終了中の案件への投稿 R-63、アーカイブ済みの扱い | 対象の状態が、その操作を許すこと |

## R-45の申し送り（チャンネル作成の承認。後続Issue 2-2へ）

- `DEPARTMENT_OWNER_ONLY`は3つで、`perm.channel.request.approve.owner`（R-45）は**含めない**。権限表R-45と2-2 AC-8は「未任命の部署でも、その部署のオーナー本人の申請は全体管理者が承認できる」としているため、Resolverの段階で全体管理者の候補を遮断してはいけない
- Resolverは、全体管理者に**会社範囲とすべての部署でR-45の候補**を返す。オーナーには自部署でだけ、一般メンバーには返さない
- **契約**：チャンネル作成の承認の機能（2-2）は、申請者の条件を対象ごとに必ず確かめる。確かめずに`authorize`だけで許可してはいけない。確かめる条件は次のとおり
  - 会社直属のチャンネルの申請：全体管理者だけが承認できる（自己承認も可）
  - 部署のチャンネルの申請：その部署のオーナーが承認できる。そのオーナーに任命されていない全体管理者は、一般社員の申請を承認できない（拒否する）
  - 申請者がその部署のオーナー本人の場合：全体管理者が承認する（その部署のオーナーに任命されていなくても可）
  - オーナーが自分の申請を承認できるのは、全体管理者を兼ねる（全体管理者の割り当ても持つ）場合だけ
- **形の案**：`canApproveChannelRequest(approver, request)`のような、申請（会社直属か部署のチャンネルか、申請者、申請先の部署）と承認者の割り当てから真偽を返す部品を、2-2で作る。本Issueでは申請のテーブルも呼び出し元もないため作らない
- **テストの観点**（2-2で書く）：会社直属を全体管理者が自己承認できる／部署のチャンネルを他部署のオーナーが承認できない／一般メンバーは候補を持たない／オーナーが自分の申請を承認できない／全体管理者を兼ねるオーナーは自分の申請を承認できる／未任命の部署のオーナー本人の申請を全体管理者が承認できる／未任命の部署の一般社員の申請は、全体管理者でも承認できない

## テーブル（`backend/db/schema.ts`）

| テーブル | 主な列と制約 |
| --- | --- |
| `company_settings` | `id`（`'company'`に固定するCHECK制約。2件目を入れられない）・`company_name`・`created_at` |
| `departments` | `id`（ULID）・`name`・`name_normalized`（一意。前後の空白を除いて小文字にした値をアプリ側で作る）・`is_active`・`created_at`。**`owner_id`は持たない**（オーナーは`user_role_assignments`だけで表す） |
| `users` | `id`・`login_id`・`login_id_normalized`（一意）・`display_name`・`legal_name`（**暗号化した値**。`v1:<iv>:<暗号文>`）・`email`・`email_normalized`（一意）・`email_verified_by`・`email_verified_at`・`department_id`・`extension`・`job_title`・`password_hash`・`must_change_password`・`is_active`・`deactivated_at`・`created_at` |
| `roles` | `id`（固定）・`name`・`scope_type`（`company`か`department`のCHECK制約）・`department_id`・`is_system`・`created_at` |
| `role_permissions` | `role_id`と`permission_id`の複合主キー |
| `user_role_assignments` | `id`・`user_id`・`role_id`・`scope_type`・`department_id`・`assigned_at` |

`user_role_assignments`の制約：

- CHECK：会社範囲なら`department_id`は`null`、部署範囲なら`null`でない
- **部分一意インデックス**：`role_global_admin`の行は1件だけ（全体管理者は1人）。`role_owner`の行は`department_id`ごとに1件だけ（オーナーは部署ごとに1人）
- 索引：`user_id`
- 同じ利用者が、会社範囲（全体管理者）と部署範囲（オーナー）の両方の割り当てを持てる（全体管理者のオーナー兼任）

`audit_logs.actor_id`は外部キーを付けない（#118。操作者が消えても監査ログを残すため）。

## セットアップの流れ

画面S-34から`POST /api/setup`までの流れ。

1. 画面：`SetupFlow`が`GET /api/setup/status`で状態を取る（未認証・キャッシュしない）。`setupRequired`が`true`のときだけフォームを出す。`LoginPage`の`SetupEntryLink`（#120までは`HomePage`）も同じ状態を使い、`true`と分かっているときだけリンクを出す（取得中・取得失敗は出さない）
2. 送信：`submitSetup`が`POST /api/setup`を呼ぶ。送信元の確認（`Origin`。許可されていない・欠落は`403 FORBIDDEN_ORIGIN`）は、`/api/*`の共通の処理で行う
3. サーバーの処理順（認証より前に、入力の検証や完了の状態を知らせない）：
   1. 本文がJSONのオブジェクトであること
   2. **接続元の試行制限（#120で適用済み）**：`LOGIN_THROTTLE_KEY`が未設定・不正、または本番で接続元を特定できない場合は**503**。接続元の受付枠（`setup_source`。窓15分・30回・ロック15分）を使い切ると**429**と`Retry-After`。トークンの確認より前に行う（総当たりを数えるため）。詳細は[auth-session.md](auth-session.md)
   3. **503**：`SETUP_TOKEN`または`PII_ENCRYPTION_KEY`が未設定・形式不正（`authenticateSetup`）
   4. **403**：トークンが誤り・欠落。`logger.audit`にだけ記録する
   5. **422**：入力の検証（`VALIDATION_ERROR`。`fields`に誤った項目名）。`emailConfirmed`が`true`でないときも422
   6. **409**：すでに完了している、または同時実行に負けた、社員ID・メール・部署名が重複した（`completeSetup`）
   7. 成功は**201**。応答は`{ user: { id, loginId, displayName }, initialPassword }`で、`Cache-Control: no-store`
4. 401は使わない（ログインの前の入口のため）

### 原子性と同時実行

`createInitialAdmin`は、会社の設定→部署→利用者→ロールの割り当て（全体管理者を会社範囲、オーナーを部署範囲）→監査ログ（`auditLogInsert`）を**1つの`db.batch`**で実行する。途中で失敗すれば全体が取り消される。

「すでに完了している」は、事前の確認（`isSetupCompleted`）と、一意制約（`company_settings`の`id`、全体管理者の部分一意インデックス）の**両方**で守る。同時に複数の要求が来ても、成功するのは1件だけで、他は`SetupConflictError`（理由`already_completed`）を経て409になる。社員ID・メール・部署名の重複は、それぞれ別の理由（`login_id`・`email`・`department_name`）の409になる。

### 初代管理者の所属と権限

- 初代管理者は、入力した部署に所属し（`users.department_id`）、その部署の**オーナーにもなる**（オーナーの割り当て）。全体管理者の割り当ては会社範囲
- 初期の表示名は本名と同じ値。セットアップでは本名・表示名とも1〜30文字（D-7。ADR-0013）

## 初期パスワード

- 生成：`generateInitialPassword`。16文字。大文字・小文字・数字・記号を各1文字以上。読み間違えやすい文字と空白は使わない。乱数は`crypto.getRandomValues`で、範囲の端数を捨てる方法（棄却サンプリング）で偏りを作らない
- 保存：`hashPassword`でscrypt（N=2^16・r=8・p=2）のPHC形式にして`users.password_hash`に保存する。**平文は保存しない**。`must_change_password`は`true`（初回ログインで変更を必須にする）。パラメータは`password.ts`の定数1か所
- 表示：登録成功の応答に**一度だけ**含める（応答は`no-store`）。ログ・監査ログ・DBに残さない
- 画面側の保持：`submitSetup`は`useMutation`を使わず、応答を`SetupFlow`の`useState`にだけ入れる（TanStack QueryのQueryCache・MutationCacheに初期パスワードとトークンを残さないため。Skill「frontend-state」の「サーバーデータを`useState`にコピーしない」の**例外**。理由は`SetupFlow.tsx`のコメントとPRに書いた）
- 消去：「ログイン画面へ進む」で状態を空にして`/login`へ置き換え遷移する。離脱・再読み込みでは部品が外れて消え、再び開くと状態が`setupRequired: false`なので「完了済み」と表示される。URL・ルーターの`state`・`localStorage`・`sessionStorage`・コンソールには出さない。表示前に失った場合は、全体管理者が再発行する（0-3。画面にも書く）

## メールの自己確認

- 画面に必須のチェック「会社が発行した自分のメールアドレスだと確認しました」を置く。APIは`emailConfirmed: true`を必須にする（欠落・`false`は422）。保存する値には含めない
- `users.email_verified_by`は作った利用者自身のID、`email_verified_at`は`created_at`と同じ値（時刻の取得は1回）。監査ログの`detail`には`emailVerification: "self"`を入れる（本名・メールアドレスは入れない）
- 初代管理者の自己確認は、確認する全体管理者がまだいないための例外（0-1 AC-10に注記）

## テストの場所

| 対象 | ファイル |
| --- | --- |
| 権限ID・初期値 | `backend/src/lib/permissions.test.ts`（`backend/test/permission-table.fixture.ts`が権限表の代表行） |
| Resolver | `backend/src/services/permission-resolver.test.ts` |
| 権限判定・JOIN・シードとコードの一致・制約 | `backend/src/services/authorizer.db.test.ts`、`backend/src/db/role-assignment.repository.db.test.ts` |
| パスワード | `backend/src/lib/password.test.ts`、workerdでのscryptの可否は`backend/src/lib/scrypt-runtime.test.ts` |
| トークン・暗号・設定 | `backend/src/lib/setup-token.test.ts`、`backend/src/lib/pii-crypto.test.ts`、`backend/src/config.test.ts` |
| セットアップのService・ルート | `backend/src/services/setup.service.test.ts`、`backend/src/routes/setup.test.ts`、接続元の試行制限（#120）は`backend/src/routes/setup-throttle.test.ts` |
| ログの伏せ字 | `backend/src/lib/logger/logger.test.ts` |
| 画面 | `frontend/src/pages/SetupPage.test.tsx`、`frontend/src/pages/LoginPage.test.tsx`（リンクの表示。#120）、`frontend/src/components/SecretField.test.tsx`、`frontend/src/features/setup/`配下の`*.test.ts(x)` |
| E2E | `e2e/setup.spec.ts`（架空データ`e2euser_`・`@example.com`・`[E2E_TEST]`） |
| テスト用の部品 | `backend/test/role-fixtures.ts`・`backend/test/random-secrets.ts`（テストごとに乱数のシークレットを作る） |

## 関係するIssueとADR

- Issue：#119（親 #108）、依存 #118。後続：#120（ログイン。試行制限を`/api/setup`にも適用した。[auth-session.md](auth-session.md)）、#122（TOTP）、#158・#159（ロールの編集・新規作成）、2-2のIssue（R-45の承認）
- ADR：[0007](../adr/0007-password-hash-scrypt.md)（パスワードのハッシュ）、[0008](../adr/0008-session-and-login-throttle.md)（試行制限）、[0009](../adr/0009-admin-mfa-totp.md)（TOTP）、[0012](../adr/0012-zero-trust-principle.md)（ゼロトラスト）、[0013](../adr/0013-initial-setup-auth-and-pii-encryption.md)（初回専用の認証と本名の暗号化）
- 決定記録：C-154〜C-158（`docs/requirements/decision-register.md`）
- 秘密情報の設定：`docs/secrets.md`の`SETUP_TOKEN`・`PII_ENCRYPTION_KEY`
