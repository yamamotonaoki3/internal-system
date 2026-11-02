# T-06 アクセス制限の追加の層（Cloudflare Accessなど）の調査

## 1. 目的と範囲

- 目的：ゼロトラストの原則（ADR-0012）に沿って、アプリのログインの前段でアクセスを制限する層（例：Cloudflare Access）を追加するかを、費用と運用の手間を比べて決めるための材料をそろえる（Issue #164、親Issue #108）。ADR-0012は、この層の採否を決めておらず、本書の結果を見て利用者が決める。
- 範囲：公式ドキュメントとWeb検索による調査のみ。Cloudflareのアカウント操作、設定の実施、デプロイ、ライブラリの追加、課金はしていない。
- 比較する選択肢：Cloudflare Access（IDプロバイダ／ワンタイムPIN）、Access＋デバイスポスチャ、Access＋mTLS（クライアント証明書）、WAFルールによるIP制限、Cloudflare Tunnel。
- 決定はしない。「推奨案」は理由つきの参考にとどめる。

## 2. 調べた日と前提

- 調べた日：2026-11-02。料金・無料枠・制限は変わりうるため、契約前・実装前に再確認する。
- 規模の前提（`docs/requirements/nonfunctional.md`の1章、`docs/requirements.md`の決定43）：登録する社員は数百人以内、同時に使う人数は50人程度。ASVSレベル2。学習用で運用先は未定。
- 費用の前提：Cloudflareの課金の単位は「席」。一度認証した利用者は、Removeされるまで席を占有し、既定では自動で解除されない（自動解除は設定で有効にする。出典5）。したがって席数は「登録人数」でも「同時利用者数」でも「その月に認証した人数」でもなく、**過去に認証して今も占有している人数（退職者・異動者を含む）**になる。本書は、占有席数が50・100・300の3通りと仮定して概算する。為替・税は含めない。
- 本システムはCloudflare Workers（Hono）に画面とAPIをまとめて配信し、D1を使う（ADR-0003・0004）。独自ドメインを使うかは未決定（ADR-0008が「独自ドメインを使う場合」と条件づけている）。

## 3. 結論（要点）

- **Cloudflare Accessは、Workersの前段に置ける**。Worker全体を守る方式（ダッシュボードの「Protect this Worker behind Access」）と、ホスト名ごとのAccessアプリケーションの方式がある。前者はroutes・Custom Domains・`workers.dev`・プレビューをまとめて守る。（出典1・2）
- **料金**：Zero Trust Freeは0ドルで50ユーザーまで、Pay-as-you-goは1ユーザー月7ドルで人数の上限なし（出典3の取得内容による。ただし二次確認できず、詳しくは4-1と8章）。占有席が50以内ならAccess自体は無料枠に収まる。占有席が100で月700ドル、300で月2,100ドルの見込み（4-1）。退職者を「Remove」するか、席の自動解除（1か月〜1年の無操作で解除）を有効にしないと、占有席は増え続ける。**数百人が使う前提だと、学習用としては重い**。
- **ログイン方法**：ワンタイムPIN（メールに届く使い捨てコード。Cloudflareが送る）か、会社のIDプロバイダ（IdP）で認証できる。本システムはメールを送らない（C-39）が、PINはCloudflareが送るため影響しない。ただし、PINをメールで受ける運用になるため、社員のメールアドレスの一覧をAccessのポリシーに持つ必要がある。（出典4・6）
- **Worker単位のAccessはWebSocketに対応しない**（WebSocketの接続要求が403になる）。将来ADR-0004でWebSocketに置き換えるなら、ホスト名単位のAccessアプリケーションにする必要がある。（出典2）
- **二重認証の関係**：AccessのログインとアプリのログインはCookie（`CF_Authorization`とアプリのセッションCookie）も判定の場所も別で、互いに置き換えない。管理者は、Access＋アプリのパスワード＋TOTP（ADR-0009）の3段になる。アプリ側の認証・認可・CSRF対策は、Accessがあっても省略しない（ADR-0012の趣旨）。
- **デバイスポスチャ**（端末の状態の確認）は、Accessのポリシーで使えるが、各端末にCloudflare One Client（旧WARP）の導入が前提。料金ページにポスチャ専用の行はなく、無料枠・Pay-as-you-goで使える範囲は**未確認**。社員の私物のスマートフォンをブラウザで使う本システムの想定とは相性が悪い。（出典7・8）
- **mTLS**は、Access mTLSがEnterpriseとPay-as-you-goで使える（Freeは不可）。証明書の発行・配布・失効を自前で運用する負担が大きい。（出典9）
- **IP制限（WAFカスタムルール）**は、ゾーン（独自ドメイン）が前提で、Freeでも5本まで使える。ただし、社員の接続元IPが固定でないとき（在宅・モバイル）は使えない。（出典10）
- **Cloudflare Tunnelは、この目的の選択肢にならない**。Tunnelは「公開IPのないオリジンをCloudflareにつなぐ」仕組みで、オリジンがWorkersである本システムには、隠す対象のオリジンがない。アクセス制限そのものはAccessが担う。（出典11）
- 推奨案（参考）：占有席（退職者など過去の利用者を含む）が50席以内に収まり、かつ運用が簡単な範囲で追加の層が必要と判断するなら、**Access（ワンタイムPINまたは既存IdP、ホスト名単位、本番。Cloudflare上の検証環境は、利用者と相談しADRに記録して追加する場合にそこにも適用）**。占有席が50を超える見込みなら、費用（7ドル仮定で51席なら月357ドル、100席なら月700ドル）と効果を比べ、採用しないか、IP制限（接続元が固定のとき）にとどめる。詳細は6章。

## 4. 項目ごとの調査結果

### 4-1. Cloudflare Access：仕組み・認証方法・料金・制限

仕組み（出典1・12）：

- Accessは、リクエストごとにポリシーを確認する「ID認識プロキシ」。ポリシーのアクションは、Allow（許可）・Block（拒否）・Bypass（Accessの検査を外す。ログも残らないため、社内アプリには非推奨）・Service Auth（サービストークン／mTLS）の4つ。ルールの種類はInclude（OR）・Require（AND）・Exclude（NOT）。
- 選択子には、メールアドレス、メールのドメイン、IP範囲、国、デバイスポスチャ、IdPのグループ、ログイン方法などがある。IP範囲やデバイスポスチャなど、ID以外の条件は、セッション中もリクエストごとに再確認される。
- アプリケーションは「既定で拒否」。許可するポリシーに当てはまった人だけが通れる。「Everyone」を許可に入れたり、ログイン方法をワンタイムPINにして許可の条件を緩くしたりすると、誰でも通れてしまう（設定ミスの典型）。
- 認証に成功すると、保護するドメインに`CF_Authorization`というCookie（JWT）が発行される。リクエストのたびにこのCookieを確認する。ブラウザ向けの任意の`CF_Binding`Cookieを使うと、盗まれた`CF_Authorization`の再利用を防げる。ただし、ブラウザ以外のツールでは使わない方がよい。

認証方法（出典4・6）：

| 方法 | 内容 | 本システムでの注意 |
| --- | --- | --- |
| ワンタイムPIN | 入力したメールがポリシーで許可されていれば、`noreply@notify.cloudflare.com`からPINが届く。10分で失効、1回限り、新しく依頼すると前のPINは無効 | 社内のメールセキュリティがリンクやコードを先に消費すると失敗する。`notify.cloudflare.com`を許可する。ポリシーに載っていないメールにも画面上は「送信した」と表示される（存在の有無は分からない） |
| IdP（Oktaなど。対応するIdPの一覧は今回未取得） | 会社が使っているIdPで認証する。IdPのグループを条件にできる | 会社のIdPがあるかは**未確認**（本システムのアプリ自体は外部ログインを使わない：要件定義書。Accessは別層なので別問題）。採用するIdPの対応は導入前に確認する |
| サービストークン／mTLS | 人ではなく、機械のクライアント向け | 4-5と4-7で扱う |

料金（出典3：https://www.cloudflare.com/plans/sase-zero-trust.md 、2026-11-02取得）：

| プラン | 月額 | 席の上限 | Accessログの保持（出典13） |
| --- | --- | --- | --- |
| Zero Trust Free | 0ドル | 50ユーザー | 24時間 |
| Pay-as-you-go | 1ユーザー月7ドル | 上限なし | 30日 |
| Enterprise | 見積もり（年額・ユーザー単位） | 契約による | 180日 |

- ZTNA（Accessを含むと読める）・Application Connector（Tunnelに相当すると読める）・Device Clientは、FreeとPay-as-you-goの両方で「Included」。（出典3。ページに「Tunnel」「デバイスポスチャ」の行はなく、対応関係は当方の読み取り）
- 請求の条件（月払いか年払いか、最低契約）は、公式ページの取得内容では確認できず、情報源によって食い違いがある。**未確認**。
- 席の数え方（出典5）：Accessでは、App Launcherまたはアプリへのログイン（認証の出来事）1回で、その利用者が1席を使う。アプリの数やログイン回数には関係しない。一度使った席は、「Remove」するまで占有され続ける。「Remove」すると席が空き、利用者の記録は残るが、請求にも含まれなくなる。「Revoke」はセッションを切るだけで席は空かない。Removeされた人が再び認証すると、また席を使う。席の自動解除（Zero Trust > Settings > Admin controls の「Remove inactive users from seats」。無操作の期間を1か月〜1年で指定。1日1回確認）は**既定でオフ**。席が全部埋まると、追加の利用者はログインを止められる（購入した席についての記載。Freeの50ユーザー超過時の動作は未確認）。
- 概算（Pay-as-you-go、7ドル／ユーザー／月、税・為替を除く）：

| 占有している席の数 | 月額 | 年額 | 備考 |
| --- | --- | --- | --- |
| 50席以内 | 0ドル | 0ドル | Freeの席の上限内（二次確認できず） |
| 100席 | 700ドル | 8,400ドル | 退職者を含めて占有している数 |
| 300席 | 2,100ドル | 25,200ドル | 数百人の上限に近い想定 |

- 50席を超えたときにFreeがどう動くか（超過した利用者がログインできなくなるのか、自動で有料になるのか）は、公式文書の取得内容では確認できなかった。**未確認**。7ドル仮定で51席なら月357ドル（年4,284ドル）。
- 制限（出典14）：Accessのアプリケーションは500、ポリシーは500、1つのルールに入れられるメールは1,000件、IPは1,000件。Freeの「Custom applications」は50。本システムの規模では上限に当たらない。

### 4-2. 設定の手順（実施はしない。実装の見通しのため）

出典15・2・1：

1. ドメインがCloudflareのゾーンにあること（ホスト名単位のAccessの前提。部分的なCNAME方式もあるが、ゾーン頂点にはCNAMEを置けない）。Worker全体を守る方式なら、`workers.dev`もまとめて守れる。
2. Zero Trustの組織（チーム名）を作る。ダッシュボードで「Access controls > Applications > Create new application > Self-hosted and private」。公開ホスト名を追加する。
3. 許可するポリシー（メールの一覧／メールのドメイン／IdPのグループ）を作る。ログイン方法（ワンタイムPIN・IdP）を選ぶ。セッションの長さを決める（全体は15分〜1か月、既定24時間）。
4. Workersの場合は、WorkerのAccessタブから「Protect this Worker behind Access」を選ぶ方法もある（previews only／All traffic）。ただし、WebSocketは使えない（4-4）。
5. オリジンが直接アクセスされる経路（Workersでは`workers.dev`や別のホスト名）を残さない。Accessを作る前にルートを公開すると、一時的に誰でも到達できる。「Accessを先に作る」「ルート・Custom Domain・`workers.dev`・プレビューのすべてを守る」。
6. （任意）Worker内でAccessのJWTを検証する。`Cf-Access-Jwt-Assertion`ヘッダー、`https://<チーム名>.cloudflareaccess.com/cdn-cgi/access/certs`の公開鍵、`iss`・`aud`の確認が必要。鍵は約6週間ごとに更新されるため、固定しない。（出典16）Worker全体を守る方式では`ctx.access.getIdentity()`で、JWTを自分で解析せずに利用者のメールを読める。ただし、Static Assetsとサービスバインディングでは`ctx.access`が渡らない制限がある。（出典2）

本システムでの運用の手間：

- 設定の件数は少ない（アプリ1〜2件、ポリシー1〜2件）。ただし、本番の環境は`infra/`のTerraformで作る方針（Skill「環境・デプロイ」）。CloudflareのAccess用のTerraformリソースが使えるか、既存のTerraformのプロバイダのバージョンで足りるかは**未確認**。管理画面での手作業は、方針との食い違いになるため、利用者に確認する。

### 4-3. 他の選択肢との比較

| 項目 | A：Access（ワンタイムPIN／IdP） | B：Access＋デバイスポスチャ | C：Access＋mTLS | D：IP制限（WAFカスタムルール） | E：Cloudflare Tunnel |
| --- | --- | --- | --- | --- | --- |
| 何を確認するか | 人（メール／IdP） | 人＋端末の状態 | 人＋端末の証明書 | 接続元のIPアドレス | 通信の経路（オリジンを隠す） |
| 実装の手間 | 小（ホスト名とポリシー） | 中〜大（全端末にクライアントの導入） | 大（CAの運用と証明書の配布） | 小（ルール1本） | 本システムでは対象外 |
| 運用の手間 | 中（利用者一覧の維持） | 大（端末の管理、クライアントの更新） | 大（発行・失効・更新の管理） | 小〜中（IP変更への追随） | — |
| 費用（概算） | 占有席50以内は0、100席で月700ドル | Aと同じ＋ポスチャの条件が未確認 | **Freeは対象外**（出典9）。Aの無料枠は適用できず、7ドル仮定では50席でも月350ドル（Pay-as-you-go）。CAの運用は自前 | Free〜（Freeでカスタムルールは5本まで） | 本システムでは不要 |
| セキュリティ上の効果 | ログイン画面そのものが非公開になり、アプリの未認証の弱点・総当たり・ボットを前段で遮る | Aの効果＋私物・脆弱な端末を除外 | Aの効果＋証明書のない端末を除外 | 許可したIP以外を遮る。固定IPでないと使いにくい | 直接の効果なし |
| 本システムの認証との関係 | 独立した別の層。アプリの認証は変えない | 同左 | 同左 | 同左。ただしADR-0008の「接続元」の判定は変わらない見込み（未確認） | — |
| 向かない場面 | 占有席が数百になり、全席に費用が発生するとき | スマートフォン中心の利用 | 非技術者の利用者が多いとき | 在宅・外出先・モバイル回線の利用 | オリジンがWorkersのとき |

各選択肢の根拠：

- A（出典1・4・6）：4-1参照。
- B（出典7・8）：4-6参照。
- C（出典9）：「Access mTLSはEnterpriseとPay-as-you-goで使える。Freeはサービストークンを使う」。ルートCAをアプリのFQDNに関連づける。選択子はValid CertificateとCommon Name。GatewayはmTLS保護ドメインの通信を検査できない。PagesやR2の公開バケットでは動かない。クライアント証明書の発行・配布・失効の手順は、社員の追加・退職・端末紛失のたびに必要になる。スマートフォンのブラウザでの証明書の扱いやすさは、今回は**未確認**。
- D（出典10）：WAFカスタムルールの上限は、Free 5本、Pro 20本、Business 100本、Enterprise 1,000本。IPアドレスで拒否する条件は、ルール式の機能として使えると見られるが、今回取得したページには`ip.src`の記載がなく、**未確認**。WAFはゾーン（独自ドメイン）の設定のため、ゾーンのない`workers.dev`のみで運用する場合は使えない見込み（当方の推測。**未確認**）。AccessのIP範囲の選択子（出典12）でも同じ条件を組める。
- E（出典11）：Tunnelは`cloudflared`がオリジン側から外向きの接続だけを張り、公開IPなしでオリジンを公開する仕組み。「オリジンを隠す」効果は、WorkersをオリジンとするCloudflare上の構成では、そもそも隠すべきサーバーがない。Tunnelの料金は今回の取得ページでは確認できなかった（未確認）が、採用しないため影響しない。

### 4-4. 本システムの認証・セッション・API・WebSocketとの関係

関係する決定：ADR-0003（クッキー方式のセッション。画面とAPIは同じドメイン）、ADR-0004（ポーリング→WebSocket）、ADR-0007（scryptによるハッシュ）、ADR-0008（セッションをD1に保存、試行制限は接続元単位）、ADR-0009（全体管理者のTOTP）、ADR-0012（ゼロトラスト）。

| 観点 | 内容 |
| --- | --- |
| 二重認証になるか | なる。Accessのログイン（メールのPIN／IdP）を通ってから、アプリのログイン（社員ID＋パスワード、管理者はさらにTOTP）を行う。役割は別で、Accessは「前段の関門」、アプリは「個人の確認と権限の判定」。AccessがあるからといってアプリのMFAや再認証（0-5）を省かない |
| Accessの追加のMFA | Accessのアプリの設定に「独立したMFA」の任意設定がある（出典15）。詳しい仕組みは今回未確認。ADR-0009のTOTPは維持する前提 |
| Cookie | Accessのセッションは`CF_Authorization`（保護するドメインに発行）など。アプリのセッションCookieとは名前が別で、ADR-0003の属性（HttpOnly・Secure・SameSite）に影響しない。AccessのCookieにSameSite Strictを設定するとリダイレクトの繰り返し（`ERR_TOO_MANY_REDIRECTS`）が起きる。これはAccess側の設定の話で、アプリ側のCookieには関係しない（出典17）。ブラウザの第三者Cookieのブロックで、XHRが失敗する場合がある |
| セッションの時間 | Accessのセッション（既定24時間、15分〜1か月）と、アプリのセッション（無操作30分・ログインから1日、0-2 AC-5）は別。Accessのセッションが先に切れると、アプリの画面が操作の途中で認証画面に飛ぶ可能性がある。Accessの時間をアプリ以上の長さ（例：24時間以上）にそろえる |
| API／fetch | 画面とAPIは同じオリジンのため、CORSの追加は不要と見られる（未検証）。Accessのセッション切れのときにAJAXが静かに失敗しないよう、`X-Requested-With: XMLHttpRequest`ヘッダーを付けると401が返る（出典18）。フロントエンドのAxios設定（Skill「http-client-axios」）で、**Accessの401とアプリの401（ログインが必要）を区別する**必要が出る。この区別の方法（レスポンスの形）は未検証 |
| WebSocket（ADR-0004の将来） | Worker単位のAccessは**WebSocketの接続要求が403になる**（出典2）。使うならホスト名単位のAccessアプリケーションにする。Accessのセッションが切れたとき、開いたままのWebSocketが切れるか、再接続時にどうなるかは**未確認**（公式文書に記載を確認できなかった） |
| ポーリング（現行のADR-0004） | 2秒間隔のGETが、Accessを経由してもレートに影響しない見込み。Accessの処理時間（遅延）はp95 500ms目標（nonfunctional）に影響しうる。**未計測** |
| 接続元IP（ADR-0008） | Accessの前段でも、アプリ側のIPの見え方は通常どおり（`CF-Connecting-IP`）と見られるが、未検証 |
| `ctx.access`／JWT検証の依存 | アプリがAccessの利用者情報に依存する設計にすると、ローカル・テストで再現が必要になる。「Accessは外側の関門で、アプリは自前の認証を持つ」とし、アプリはAccessの情報に依存しない設計にする方が、疎結合で単純（推奨）。JWTを検証するときは、`jose`など新しいライブラリが必要になりうる（公式のサンプルが前提）。**新しいライブラリの追加には承認が必要（要承認）** |

### 4-5. ローカル・テスト・検証環境への影響

- ローカル（`wrangler dev`）とDocker：Accessは前段のCloudflareの機能で、ローカルでは働かない。アプリがAccessの情報に依存しなければ、ローカル・単体テスト・E2E（Playwright）は変更不要。
- Accessの情報に依存する場合：`wrangler.jsonc`の`access.dev`ブロック（`aud`と任意の`identity`）でローカルの再現ができる（出典2）。
- Cloudflare上の検証環境：Skill「環境・デプロイ」では、検証は手元（`.env.test`）が既定で、Cloudflare上の検証環境は既定では作らない（必要があるとき、利用者と相談してADRに記録してから足す）。したがって、**本書は、検証環境が追加される場合に限り**次のことを言う。公開URLなので、そこにもAccessを適用する必要がある（ゼロトラストの観点）。その場合、CIの自動テスト・k6・OWASP ZAPがAccessを通れなくなる。サービストークン（Freeでも使える。出典9）を発行し、テストが`CF-Access-Client-Id`／`CF-Access-Client-Secret`ヘッダーを付ける設計が必要。サービストークンの値は秘密情報で、`.env`等にのみ置く（AGENTS.mdの規則）。サービストークンの詳細な仕様（有効期限・更新）は**未確認**。
- Cloudflare上の検証環境を追加する場合は、本番と検証を別のAccessアプリケーションにして、ポリシーも分ける（検証用に本番の利用者を入れない）。
- 本番へ直接影響する設定のため、実施前に利用者の承認が必要（AGENTS.mdの「必ず立ち止まること」）。

### 4-6. デバイスポスチャ（端末の状態の確認）

出典7・8・19：

- Accessのポリシーの選択子に、ポスチャの条件（OS・ディスクの暗号化・インストールされたアプリなど）を追加できる。
- 条件の情報は、端末に入れた**Cloudflare One Client**が集めるか、第三者のエンドポイントセキュリティ（CrowdStrikeなど）のサービス間連携から取る。
- 「ポスチャのみ」のモードがあり、通信やDNSをCloudflareに通さず、ポスチャの条件だけをAccessに使える。
- クライアントが動作するOSは、取得ページでWindows・macOS・Linuxを確認。iOS・Androidについては、取得ページに記載がなく**未確認**。MDM（Intune・Jamfなど）で配布できる。
- 確認の頻度：Cloudflare One Clientが5分ごとにポーリングする（既定）。進行中のGatewayのセッションは、ポスチャの失敗で切れない。
- 費用：料金ページに「Device Client Software：Included」とあるが、ポスチャの種類ごとの対象プランは**未確認**。第三者連携が有償か、Enterpriseに限られるかも未確認。
- 評価：本システムは、社員がスマートフォンのブラウザで使うことも想定している（ADR-0003）。端末にクライアントを入れさせる運用は、私物の端末では難しい。管理された端末（会社支給のPC）だけに限定するなら効果が大きい。学習用の本システムでは、必須にしない方が実現しやすい。

### 4-7. 運用（社員の追加・退職・端末紛失、設定の負担、障害時）

| 場面 | 手順（Accessを採用した場合） | 注意 |
| --- | --- | --- |
| 社員の追加 | アプリのアカウントの発行（全体管理者、0-1）に加えて、Accessのポリシーにメールを追加する。メールのドメインで許可すれば、追加の手間は省ける | 「アプリのアカウントを発行したがAccessに載せていない」という抜けが起きやすい。メールのドメインを条件にするか、IdPのグループを使う。ただし、ドメインを条件にすると、そのドメインのメールを持つ人全員が通れる |
| 退職 | アプリのアカウントを無効化（0-1 AC-9）＋Accessのポリシーから外す＋Zero Trustでユーザーを「Revoke」。必要なら「Remove」で席を空ける | 管理者がRevokeした後、そのユーザーは最大1分は再ログインできない（出典18）。なお、`/cdn-cgi/access/logout`で利用者が自分でログアウトした場合に、発行済みのトークンが拒否されるまでの目安が20〜30秒で、Revokeとは別の話（出典18）。IdPを使うときは、先にIdP側で無効化する。ワンタイムPINの場合は、ポリシーからメールを外さない限り、再びPINで入れる |
| 端末の紛失 | アプリのセッションを失効（パスワード変更で他のセッションが無効、0-3 AC-4）＋AccessでそのユーザーをRevoke | `CF_Binding`を使うと、盗まれたCookieの再利用を防げる（ブラウザ向け） |
| 設定の負担 | Accessの設定はアプリ1〜2件。利用者の一覧の維持が主な負担 | Terraform管理にするか管理画面で行うかは未決定 |
| 障害時の影響 | AccessはCloudflareのサービスのため、Workers・D1と運命共同体。Accessが止まると、アプリも使えない。設定の誤りで全員がログインできなくなる事態が起こりうる | ADR-0012は止まったときの影響を小さい学習用（G）としており許容範囲と見られる。誤設定に備え、Cloudflareのアカウントの管理者を複数にしておく。ワンタイムPINはメールの到達に依存するため、メールの障害で入れなくなる |

### 4-8. 個人情報・ログの置き場所

| 項目 | 内容 | 出典 |
| --- | --- | --- |
| Accessに置かれる情報 | 利用者のメールアドレス（ポリシーとユーザー一覧）、認証ログ（時刻・メール・接続元IP・アプリ・許可／拒否） | 出典1・13 |
| Accessログの保持期間 | Free 24時間、Standard 30日、Enterprise 180日。管理操作のログ（Admin logs）は18か月 | 出典13 |
| 保存先の地域 | 未確認。データの所在地、委託先（プロセッサ）としての扱い、データ処理契約（DPA）の確認が必要 | — |
| アプリの監査ログとの関係 | アプリは自前の監査ログを持つ（ADR-0012）。Freeの24時間は監査の用途に足りないため、Accessのログに頼らず、アプリの監査ログを正とする | 出典13 |
| ログの外部への出力 | Logpush自体はFree・Pro・Business・Enterpriseで使える（出典22）が、Accessの認証ログがLogpushのデータセットか、どのプランで使えるかは、公式の取得ページで確認できなかった。**未確認**。EnterpriseのHTTPリクエストログとAccessの認証ログは別物として扱う | 出典22 |

- 影響：社員のメールアドレスと接続元IPが、Cloudflare（Accessの運用元）にも置かれる。本システムの個人情報の取り扱いの説明に、Accessを採用したときは追記が必要。本書では、実在の個人情報は扱っていない。

## 5. 比較の要約（AC-2）

| 選択肢 | 実装の手間 | 運用の手間 | 費用（占有席50／100／300） | セキュリティ上の効果 | 本システムの認証との関係 |
| --- | --- | --- | --- | --- | --- |
| A：Access（PIN／IdP） | 小 | 中 | 0／月700ドル／月2,100ドル | 大（ログイン画面を非公開にする） | 別の層。アプリの認証は変えない。WebSocketはホスト名単位が必要 |
| B：A＋デバイスポスチャ | 中〜大 | 大 | Aと同じ＋条件が未確認 | 大＋端末の状態 | Aと同じ。私物のスマートフォンと相性が悪い |
| C：A＋mTLS | 大 | 大 | **Freeは対象外**（出典9）。Pay-as-you-goまたはEnterprise必須。Aの無料枠は適用できず、7ドル仮定では50席でも月350ドル。CAは自前 | 大＋証明書のない端末の除外 | Aと同じ |
| D：IP制限（WAF／AccessのIP条件） | 小 | 小〜中 | Freeのルール範囲 | 中（固定IPのとき）。在宅・モバイルでは使えない | 独立 |
| E：Tunnel | 対象外 | 対象外 | 対象外 | なし | なし |
| なし（現状：アプリの認証のみ） | なし | なし | 0 | アプリの認証の強さに依存。ログイン画面が公開される | — |

## 6. 推奨案（参考。決定ではない）

1. **まず、Accessを採用するかの前提を決める**：占有席数の見込み（退職者など過去の利用者を含む。50席以内か）と、独自ドメインを使うか。50席以内ならAccessは0円で、1〜2件のAccessアプリケーションとポリシーだけで済み、費用対効果が高い。
2. **占有席が50以内の見込みなら、案A（ホスト名単位のAccess、ワンタイムPINまたは既存IdP）を、本番に採用する**ことを推奨する。Cloudflare上の検証環境は既定では作らない（Skill「環境・デプロイ」）ため、別途承認して追加する場合に、そこにも適用する。理由：①ログインの突破や未認証の弱点に備える層として効果が大きい（ADR-0012の趣旨）、②追加ライブラリなしで設定できる、③アプリの認証を変えない独立した層で、手戻りが少ない、④将来のWebSocketにもホスト名単位で対応できる。退職者のRemoveか席の自動解除の設定が、無料枠を保つ前提になる。
3. **占有席が50を超える見込みなら**、費用（7ドル仮定で51席なら月357ドル、100席なら月700ドル）が学習用として妥当かを利用者が判断する。許容できなければ、Accessは採用せず、現状のアプリの認証（ADR-0003・0007〜0009）とWAFのレート制限などで進める。接続元が固定（社内ネットワークなど）なら、案D（IP制限）を代わりに検討できる。
4. **案B（デバイスポスチャ）・案C（mTLS）は、現時点では推奨しない**。理由：端末への導入・証明書の配布という運用の負担が大きく、私物のスマートフォンでの利用と合わない。必要になったら再調査する。
5. **案E（Tunnel）は検討対象から外す**（オリジンがWorkersのため）。
6. **設計の方針**：アプリはAccessの利用者情報（`ctx.access`、JWT）に依存しない。Accessは外側の関門に徹し、アプリは自前で認証・認可・CSRF対策・監査ログを行う。これにより、ローカル・テストへの影響を最小にし、Accessを後から外しても動く。JWT検証など新しいライブラリが必要になる場合は、**要承認**。
7. Accessを採用する場合は、実装（Issue #120のログインなど）の前に、Accessの401とアプリの401を区別するAxiosの設計（4-4）を、設計書に反映する。Cloudflare上の検証環境を、利用者と相談しADRに記録して追加する場合は、そのテスト用サービストークンの扱い（4-5）も反映する。

## 7. 決める前に検証すべきこと

手元（`.env.test`）で確かめられることは手元で行う。Cloudflare上での確認が必要なものは、利用者と相談しADRに記録して検証環境を追加する場合に、その検証環境（本番ではなく、検証用のCloudflareアカウント・ゾーン）で行う（デプロイや本番の設定変更は利用者の承認が必要）。テストデータは架空のもの（`testuser_001@example.com`等）を使い、実在のメールアドレスは使わない。

1. **占有席数と料金**：占有する席数の見込み（退職者など過去の利用者を含む。50席以内か）と、退職者のRemove・席の自動解除の運用。Freeの50席を超えたときの動作（ログイン不能か、自動課金か）と、請求の条件（月払い・年払い、最低契約）を、Cloudflareの公式の料金ページ・営業への問い合わせで確認する。
2. **ドメイン**：独自ドメインを使うか。`workers.dev`のホスト名単位のAccessだけで足りるか（WebSocketを使う場合の要件含む）。
3. **WebSocket**：ホスト名単位のAccessで、WebSocketの接続と、Accessのセッション切れ時の挙動（接続が切れるか、再接続が拒否されるか）。ADR-0004の移行前に確認する。
4. **セッションの切れ方**：Accessのセッション切れ時、ポーリングのfetchが401を返すか（`X-Requested-With`の付与）、リダイレクトでHTMLが返るかを確かめ、Axiosの401処理に組み込む。
5. **遅延**：Accessを経由したときのAPIの応答時間（p95 500ミリ秒、nonfunctional）への影響を、k6で計測する。
6. **CI・E2E・ZAPの通し方**：Cloudflare上の検証環境を、利用者と相談しADRに記録して追加する場合に限り、サービストークンで検証環境を通る手順とトークンの有効期限・更新・保管を確かめる。追加しない場合は、手元の検証（`.env.test`）にAccessは関係しない。
7. **IdPの有無**：会社で使えるIdPがあるか。なければワンタイムPINで運用する。メールの到達性（社内のメールセキュリティが`notify.cloudflare.com`を許可するか）。
8. **データの所在地とDPA**：Accessのログ・利用者情報の保存地域、委託先としての扱い。個人情報の取り扱いの説明への追記内容。
9. **Terraformでの管理**：Accessのリソースを管理するプロバイダ・バージョンが、既存の`infra/`で使えるか（新しいプロバイダの追加は**要承認**）。
10. **デバイスポスチャを将来採るなら**：クライアントの対応OS（iOS・Android）、ポスチャの種類ごとの対象プラン、料金。
11. **IP制限を採るなら**：`ip.src`による拒否ルールの書き方、`workers.dev`への適用可否、社員の接続元IPの固定性。

## 8. 未確認・不確かなこと

- Free（50ユーザー）の上限を超えたときの動作、請求の条件（月払い・年払い、最低契約）。
- Accessのログ・利用者情報の保存地域、DPAの扱い。AccessのログのLogpushでの出力の可否と対象プラン。
- ポスチャの各チェックの対象プランと料金。Cloudflare One Clientのモバイル（iOS・Android）対応。
- AccessのMFA（独立したMFA）の具体的な仕組み。
- WebSocketの接続中にAccessのセッションが切れたときの動作。
- Accessを経由したときの遅延、およびアプリ側の`CF-Connecting-IP`などの見え方（ADR-0008）。
- WAFの`ip.src`ルールの詳細、`workers.dev`へのWAF適用の可否。
- Tunnelの料金（採用しないため影響なし）。
- CloudflareのAccess用のTerraformリソースと、既存の`infra/`での利用可否。
- 料金（7ドル／ユーザー／月、Freeは50ユーザー）は、出典3の取得内容のみに基づき、**二次確認できなかった**。別の公式ページ（https://www.cloudflare.com/plans/zero-trust-services/）には該当の記載がなく、https://www.cloudflare.com/plans/free/ も同様だった。二次情報（比較サイト）は同じ数字を示すが、請求が年払いとするものと月払いとするものがあり食い違っている。契約前に、ダッシュボードの購入画面・営業で確認する。
- 本書の「当方の推測」と書いた部分は、公式文書での逐語確認をしていない。

## 9. 出典（いずれも2026-11-02取得）

1. https://developers.cloudflare.com/cloudflare-one/policies/access/ （Accessのポリシー）
2. https://developers.cloudflare.com/workers/configuration/cloudflare-access/ （WorkersでのAccess、WebSocket・`ctx.access`・`access.dev`）
3. https://www.cloudflare.com/plans/sase-zero-trust.md （Zero Trustの料金と席の上限。調査担当は、このページの取得結果で「Free：0ドル・50ユーザー・ログ24時間」「Pay-as-you-go：7ドル／ユーザー／月・上限なし・ログ30日」の表示を確認した。レビュー側では取得できず、別の公式ページ（zero-trust-services、plans/free）では確認できなかったため、二次確認できず＝未確認として扱う）
4. https://developers.cloudflare.com/cloudflare-one/identity/one-time-pin/ （ワンタイムPIN）
5. https://developers.cloudflare.com/cloudflare-one/team-and-resources/users/seat-management/ （席の管理。検索結果の要約を含む）
6. https://developers.cloudflare.com/cloudflare-one/identity/one-time-pin/ （IdPの種類。今回の取得ページにIdPの一覧はなく、一覧は未確認）
7. https://developers.cloudflare.com/cloudflare-one/reusable-components/posture-checks/ （デバイスポスチャ）
8. https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/warp/ （Cloudflare One Client）
9. https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/mutual-tls-authentication/ （Access mTLS）
10. https://developers.cloudflare.com/waf/custom-rules/ （WAFカスタムルールの本数）
11. https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/ （Cloudflare Tunnel）
12. https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/ （Accessのアプリケーションの概要）
13. https://developers.cloudflare.com/cloudflare-one/insights/logs/ （ログの保持期間）
14. https://developers.cloudflare.com/cloudflare-one/account-limits/ （Zero Trustの制限）
15. https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-public-app/ （自前のアプリを追加する手順）
16. https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/ （JWTの検証）
17. https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/ （`CF_Authorization`などのCookie）
18. https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/ （セッションの管理、失効、AJAX）
19. https://developers.cloudflare.com/cloudflare-one/team-and-resources/devices/warp/configure-warp/warp-modes/ （ポスチャのみのモード）
20. https://developers.cloudflare.com/workers/configuration/routing/custom-domains/ （Custom DomainsとAccess）
21. https://developers.cloudflare.com/workers/configuration/routing/workers-dev/ （`workers.dev`とAccess）

22. https://developers.cloudflare.com/logs/logpush/ （Logpushの対象プラン。Accessの認証ログの記載はなし）
## 10. 他社製品との比較（追記。調べた日：2026-11-03）

利用者の依頼で、1〜9章とは別に追記した。1〜9章の章番号・出典番号は変えていない。この章の出典は10-7（番号23から）に示す。

### 10-1. 目的・前提・比較した製品

- 目的：4章までのCloudflare Accessと、他社の同種の製品・サービスを比べ、採否を決める材料にする。決定はしない。
- 前提：本システムは、Cloudflare Workers（Hono）に画面とAPIをまとめ、D1とR2を使う。社内の数十〜数百人規模。アプリの認証は独自（ADR-0003のクッキー方式のセッション、ADR-0007のscrypt、ADR-0008のD1のセッションと接続元単位の試行制限、ADR-0009の全体管理者のTOTP）。
- 比較した製品：依頼された7つ（Zscaler Private Access、Google Cloud IAP、AWS Verified Access、Microsoft Entra〔アプリケーション プロキシ・条件付きアクセス〕、Okta、Tailscale、オープンソース〔Pomerium・Authelia〕）。足した製品はない。理由：依頼の範囲に、前段に置く層とAccessのログイン方法になるIDプロバイダ（IdP）の両方がそろっており、補う必要を感じなかった。
- 読み方：製品は2種類に分かれる。
  - 前段のプロキシ・ネットワーク型：アプリの手前に置いて通信を通すか絞る（ZPA、IAP、Verified Access、Entraのアプリケーション プロキシ、Tailscale、Pomerium、Authelia）。
  - IdP型：ログインの確認をする（Okta、Entra ID）。Cloudflare Accessのログイン方法として組み合わせられる（出典23・24）。単独ではアプリの手前を塞がない。
- 取得できた範囲：公式ページの取得結果のみ。取得に失敗したページや、料金の記載がなかったものは、その旨を書き「未確認」とした。検索結果にある第三者の情報は「二次情報」と書いて区別した。

### 10-2. 製品ごとの調査結果（①仕組みと対象、②料金・無料枠、③制限）

| 製品 | ①仕組みと、アクセスを制限する対象 | ②料金・無料枠（2026-11-03取得） | ③制限事項 |
| --- | --- | --- | --- |
| Zscaler Private Access（ZPA） | ゼロトラストのネットワークアクセス（ZTNA）。利用者とアプリを1対1でつなぎ、アプリを公開インターネットに出さない。対象は「プライベートなアプリ、ワークロード、OT」。データセンターやクラウドのアプリへの遠隔アクセス（出典39） | 公開されていない。デモの依頼を案内している（出典39）。未確認 | 取得したページには、コネクタの仕組みや制限の記載がない。未確認 |
| Google Cloud IAP | アプリの手前でGoogleのアカウントを確認する。対象は、App Engine、Cloud Run、Compute Engine、GKE、オンプレミスのアプリ。Google以外のクラウドのウェブアプリにも、コンテキストを考慮したアクセスを使える（出典25） | Google Cloud上のアプリ・リソースを守る基本機能は無料（ロードバランサー等は別課金）。Google Cloud以外のリソースのプロキシ、IAPのカスタマイズ、端末属性をアクセスレベルに使うこと、独自のアクセスレベルは、Chrome Enterprise Premiumの有料機能（出典26。検索結果の要約で確認。ページ本文は直接取得できなかった）。Chrome Enterprise Premiumの金額は未確認 | 外部のIdPはWorkforce Identity Federationを使う（出典25）。Cloudflare Workersの手前に置けるかは、取得したページに記載がない。未確認 |
| AWS Verified Access | VPNなしで、アプリへの要求ごとに利用者と端末が条件を満たすかを評価する。IDと端末管理のサービス（AWSと第三者）と連携し、アクセスの試行をすべて記録する（出典27） | 時間あたりのアプリ数と、処理したデータ量で課金される（出典27）。出典28の料金例：米国東部（オハイオ）、HTTP(S)のアプリで、0.27ドル／アプリ時間、0.02ドル／GB（検索結果の要約で確認。ページ本文は直接取得できなかった）。利用量が多いと単価が下がる段階がある。地域が違うと異なる可能性があり、AWSの通常のデータ転送料金は別にかかる。他の地域の金額は未確認 | 取得したページには、対象にできるアプリの種類や、AWS外のアプリへの対応の記載がない。未確認 |
| Microsoft Entra アプリケーション プロキシ | 社内（オンプレミス）のウェブアプリを、クラウドの外部URLで公開し、Entra IDの認証・条件付きアクセスを前段にかける。社内にコネクタ（Windows Serverで動く軽いエージェント）を置き、外向きの通信だけを使う（出典29） | 料金ページ（出典31）はアプリケーション プロキシを載せていない。未確認 | 対象は社内のウェブアプリ。社内ネットワークの利用者向けではない（出典29）。Windows Serverのコネクタが前提 |
| Microsoft Entra 条件付きアクセス | Entra IDでの1段目の認証が終わったあとに、場所・端末・リスクなどの条件で許可・拒否・MFAの要求を決める。DoS攻撃などの最前線の防御ではない（出典30） | 場所・端末などの条件を使う条件付きアクセスはEntra ID P1が必要（1ユーザー月7.00ドル、年払い）。サインインリスク・ユーザーリスクに基づくポリシーはEntra ID Protectionで、Entra ID P2が必要（P2は月10.00ドル）。Freeには条件付きアクセスの記載なし（出典30・31）。Microsoft 365 Business Premiumでも条件付きアクセスを使える（出典30） | 対象はEntra IDと連携したアプリ。Cloudflare Workers自体を直接守るものではない（Accessのログイン方法としてEntra IDをつなぐ形になる） |
| Okta（IdPとして） | 会社のIDを管理し、OIDCまたはSAMLで他のサービスにログインさせる。Cloudflare AccessのIdPとして設定でき、SCIMでグループの同期・退職者の無効化もできる（出典23。ただし、Okta側のSCIMにはライフサイクル管理の契約が要る。②を参照） | 公開価格：Starter 6ドル、Core Essentials 14ドル、Essentials 17ドル（1ユーザー月、年払い）。年間契約の最低額は1,500ドル。Professional・Enterpriseは非公開。**ライフサイクル管理（SCIMによる自動のプロビジョニング・無効化）は、Starterでは追加オプション（追加の金額は公式ページに記載なし）で、Essentials以上に含まれる**（Core Essentialsは表が空欄で未確認）。社員向けの本番運用の無料プランは確認できない（30日の無料トライアルがある。開発・検証向けのIntegrator Free Planは別にある）（出典32） | Okta単体では本システムの手前を塞がない。Cloudflare Access（または別の前段）と組み合わせる。グループが100を超えるときは、APIトークンが必要になる場合がある（出典23） |
| Tailscale | WireGuardを使ったメッシュVPN。tailnet（利用者と端末の閉じたネットワーク）に入った端末だけが、tailnet内のサービスに届く。Funnelは公開用、Serveはtailnet内限定の共有（出典34） | Personal：0ドル（6ユーザーまで。ただし**非商用の利用限定**で、社員が使う社内運用には使えない。独自ドメインのtailnetは事業利用として扱われる。出典33）、Standard：1ユーザー月8ドル、Premium：18ドル、Enterprise：個別見積もり（出典33） | Funnelは誰でも到達できる公開用で、訪問者を絞るACLは記載がない（出典34）。Workersがtailnetに参加する手段は確認できない（取得したページはWorkersに触れていない。未確認） |
| Pomerium（オープンソース） | 自分で動かすアイデンティティ・コンテキスト対応のプロキシ。IdPでログインさせ、ポリシーを評価して社内アプリへの通信を通す。Core（自己運用）、Zero（制御面はPomeriumが運用）、Enterprise（管理コンソール等）の3つの形態（出典35） | ソースはApache License 2.0。公式ビルド（バイナリ・コンテナ）は修正版のApache 2.0（Pomerium Community License 1.0）（出典36）。ZeroとEnterpriseの料金は未確認 | 自前でサーバーを運用し、TLS・DNS・スケールを管理する（出典35）。対応するIdPの一覧は取得ページにない。未確認 |
| Authelia（オープンソース） | 2要素認証とSSOのサーバー。リバースプロキシ（Traefik、Caddy、nginx、Envoy、HAProxyなど）と組み合わせて、要求を許可・拒否・リダイレクトする（出典37・38） | Apache License 2.0（出典38）。サーバーの運用費用は別（未確認） | 自前でサーバーとリバースプロキシを運用する。OIDCの詳細は取得ページにない（出典37）。未確認 |

### 10-3. 本システムへの適用・運用・端末・ログ（④〜⑦）

| 製品 | ④本システムに置けるか・つなげるか | ⑤運用の手間 | ⑥端末の状態の確認 | ⑦ログ・個人情報の置き場所 |
| --- | --- | --- | --- | --- |
| ZPA | Workersの手前に置けるかは、取得した公式ページに記載がない。ZPAは「プライベートなアプリ」向けで、公開のWorkersとは目的が違う（当方の読み取り）。未確認 | 未確認（営業への問い合わせが前提） | 「コンテキストを考慮したポリシー」とあるが、端末の状態の記載はない（出典39）。未確認 | 未確認 |
| Google Cloud IAP | Googleのクラウド上のアプリ向け。WorkersのオリジンをGoogle側で前に置く構成は、取得ページに記載がない。未確認。なお、会社がGoogle Workspaceを使っているなら、Cloudflare AccessのIdPとして「Google Workspace（SAML／SCIM）」を使える（出典40。SCIMはベータで、Googleのカスタム SCIM プロファイルが前提。専用の連携ではSCIMは使えず、汎用SAMLを使う） | 未確認 | 「コンテキストを考慮したアクセス」があるが、端末の状態の記載は取得ページにない（出典25）。未確認 | 未確認 |
| AWS Verified Access | 対象のアプリの種類は取得ページに記載がない。Workersの手前に置く構成は、公式の記載を確認できなかった。未確認 | AWSの設定・料金管理が加わる。それ以外は未確認 | IDと端末管理のサービスと連携して、端末の信頼性を評価できる（出典27）。連携先の一覧・費用は未確認 | アクセスの試行をすべて記録する（出典27）。保存先・保持期間は未確認 |
| Entra アプリケーション プロキシ | 社内アプリの公開用。クラウドのWorkersは対象外と読める（出典29）。コネクタをWindows Serverに置く前提で、本システムの構成（サーバーレス）と合わない | コネクタの運用が必要 | 条件付きアクセスと組み合わせて端末の状態を条件にできる（出典29・30） | 未確認 |
| Entra 条件付きアクセス／Entra ID（IdPとして） | Cloudflare AccessのIdPとしてEntra IDをつなぐ（Terraformの例にazureADの記載あり、出典24）。会社が既にMicrosoft 365を使うなら現実的な組み合わせ。条件付きアクセスは、Entra IDのログイン時に適用される | 社員の追加・退職をEntra IDに集約できる見込み。アプリのアカウント（0-1）とAccessのポリシーをIdPのグループで連携する詳細は未確認 | 端末が準拠している、またはEntra hybrid joinであることを要求できる（P1。出典30）。Intuneなど別製品のライセンスが必要になる場合がある（出典30）。サインインリスク・ユーザーリスクに基づく制御はP2が必要（出典30） | Entra IDにサインインの記録が置かれる。保存先・保持期間は未確認 |
| Okta（IdPとして） | Cloudflare AccessのIdPとして、OIDC／SAMLで接続し、SCIMを使えば退職者の無効化・席の削除・セッションの失効まで連動できる（出典23。Okta側のSCIMはライフサイクル管理の契約が前提で、Starterの6ドルには含まれない）。本システムの手前を実際に塞ぐのはAccess | 追加・退職をOktaに集約できる。ただし、年間契約の最低額1,500ドルが前提。SCIMによる退職者の自動の無効化は、Starterではライフサイクル管理の追加オプション（金額は未確認）、Essentials（17ドル）以上に含まれる（出典32）。SCIMを使わない場合は、退職者のOkta側の無効化とAccessのポリシー・席の整理を手で行う | Oktaの端末の状態の確認は、取得したページに記載がない。未確認 | Oktaにログイン記録が置かれる。保存先・保持期間は未確認 |
| Tailscale | Workersがtailnetに参加できるとは確認できない（出典34）。利用者の全端末にTailscaleのクライアントを入れる運用になり、スマートフォンのブラウザ中心の利用（ADR-0003）と合わない。本システムの構成には置きにくいと見られる（推測を含む）。学習用の個人検証ならPersonal（非商用）で試せるが、社員が使う運用はStandard以上の有料契約になる（出典33） | 全端末へのクライアント導入・ACLの管理・退職者の削除が必要 | 基本的な端末の状態（OSとTailscaleのバージョン）は全プランで使える。MDM・EDR・XDRの連携は有料プラン（出典33） | 設定の監査ログは全プランで使える。通信のログ（ネットワークのフローログ）はPremium以上。保持期間は記載なし（出典33） |
| Pomerium | 自前のサーバーを前段に置く。Workersの公開URLが残るかぎり、それを経由せず直接アクセスされるため、直接アクセスを塞ぐ仕組みが別に要る。未確認 | サーバー・TLS・DNS・IdP連携の運用が必要（出典35）。サーバーレス構成にサーバー運用が加わる | 「端末の状態を確認する」とあるが、具体的な機能は取得ページにない（出典35）。未確認 | 自前のサーバーに置く。Enterpriseは監査履歴の機能がある（出典35） |
| Authelia | 同上。リバースプロキシとサーバーの運用が必要で、本システムの構成と合わない | 自前のサーバーの運用が必要 | 取得ページに記載なし。未確認 | 自前のサーバーに置く。詳細は未確認 |

共通する構造上の注意（当方の推測を含む。公式の文書で逐語確認したものではない）：

- ZPA・IAP・Verified Access・Entraのアプリケーション プロキシ・Pomerium・Authelia・Tailscaleは、いずれも「自社のネットワークやクラウドにあるアプリ」の手前に置く作りに見える。本システムのように「Cloudflareのエッジで動くWorkers」の手前に別の会社のプロキシを重ねる構成は、取得した公式の文書に例が見つからなかった。
- 重ねる場合、Workersの公開URL（`workers.dev`やCustom Domain）を残すと、前段のプロキシを通らずに直接アクセスできてしまう。Workers側で前段のプロキシ専用にする仕組み（共有の秘密、mTLS等）が別に要る。Cloudflare Accessは、Workers自体の設定で全ドメインをまとめて守れる点（出典2）で、この問題がない。
- IdP型（Okta・Entra ID）は、前段に置くものではなく、Cloudflare AccessのIdPとして組み合わせる形になる。

### 10-4. 既存のCloudflare Accessとの比較

費用は、公開の定価を使った概算（税・為替を除く。年払いの単価を12か月で掛けた）。人数は50人と100人の例で、実際に課金される数え方は製品ごとに異なる（Cloudflare Accessは占有席、他は契約するユーザー数と読んだ）。社内の運用は、学習用の個人検証とは分けて考える（Tailscale Personalは社内運用に使えない）。

| 製品 | 実装の手間 | 運用の手間 | 費用の概算と前提 | セキュリティ上の効果 | 本システムの認証との関係 |
| --- | --- | --- | --- | --- | --- |
| Cloudflare Access（本編） | 小（Workersの設定または1ホスト名） | 中（利用者一覧、席のRemove） | 占有席50以内は0、100席で月700ドル（出典3。二次確認できず） | 大（ログイン画面を非公開にする。Workersの全ドメインをまとめて守る） | 別の層。アプリの認証は変えない |
| Access＋Okta（IdP） | 小〜中（AccessにOktaを登録） | 中（追加・退職をOktaに集約。SCIMで自動化するにはライフサイクル管理が要る） | Accessの費用に加え、Okta。**自動の無効化（SCIM）を前提にする場合**はEssentials 17ドルが確実で、50人で年10,200ドル、100人で年20,400ドル。Starter 6ドル（50人で年3,600ドル、100人で年7,200ドル）にライフサイクル管理を足す場合の追加費用は**未確認**。Starterだけなら、自動の無効化はなく手作業になる。年間契約の最低額は1,500ドル | 大（Accessと同じ。IdPのMFAと無効化が加わる） | 別の層。追加・退職の入口がアプリとOktaの2つになる |
| Access＋Entra ID（IdP） | 小〜中 | 中（Entra IDに集約。既にMicrosoft 365があれば小） | Accessの費用に加え、Entra IDの費用。Entra ID Freeの範囲で足りるか、P1（月7ドル）が要るかは、必要な機能による。P1なら50人で月350ドル（年4,200ドル）、100人で月700ドル（年8,400ドル）。既存のMicrosoft 365で足りる可能性は未確認 | 大（Accessと同じ。P1の条件付きアクセスで場所・端末の条件を加えられる。リスクに基づく制御はP2） | 別の層。追加・退職の入口が2つになる |
| Entra アプリケーション プロキシ（＋条件付きアクセス） | 大（社内のWindows Serverにコネクタを置く。社内アプリ向けで、Workersの前段に置く構成の例は確認できず） | 大（コネクタの運用、更新、障害対応） | ライセンスの区分は未確認。条件付きアクセスはP1（50人で月350ドル、100人で月700ドル）。Windows Serverの費用は別 | 社内アプリには大（事前認証で未認証の通信を遮る）。Workersの前段としての効果は未確認 | 別の層。Workersの公開URLへの直接アクセスを塞がないと迂回される |
| ZPA | 大（Workersの前段に置く例を確認できず） | 大（別のクラウドの契約と運用。詳細は未確認） | 非公開（営業への問い合わせ）。未確認 | 製品の目的（プライベートなアプリ）には大。Workersの前段としては未確認 | 別の層。直接アクセスへの対策が別に要る |
| Google Cloud IAP | 大（Google Cloud上のアプリ向け。Google Cloud以外のリソースのプロキシは有料機能） | 大（Googleのクラウドの運用が加わる） | Google Cloud上の基本機能は無料。Google Cloud以外のリソースのプロキシ・端末属性はChrome Enterprise Premium（金額は未確認） | 製品の目的に合えば大。Workersの前段としては未確認 | 別の層。直接アクセスへの対策が別に要る |
| AWS Verified Access | 大（AWSの設定。対象のアプリの種類は未確認） | 大（AWSの運用と課金の管理） | 米国東部（オハイオ）・HTTP(S)の料金例で、1アプリ0.27ドル／時間（月約197ドル、0.27×730時間）＋0.02ドル／GB＋AWSのデータ転送料金（出典28） | 製品の目的に合えば大（要求ごとに利用者と端末を評価）。Workersの前段としては未確認 | 別の層。直接アクセスへの対策が別に要る |
| Tailscale | 大（全端末へのクライアント導入。Workersの参加は確認できず） | 大（クライアントの更新、ACL、退職者の削除） | 社内運用はStandard 8ドル×人数で、50人で月400ドル（年4,800ドル）、100人で月800ドル。Personalは非商用で、学習用の個人検証だけに使える | tailnetの端末だけを通す設計なら大。ただしブラウザ中心の利用（スマートフォン）に向かない | 別の層。tailnetの外のブラウザからは使えない |
| Pomerium | 大（サーバー、TLS、DNS、IdP連携の構築） | 大（サーバーの保守、更新、障害対応） | ライセンス（ソース）は無料。公式ビルドは修正版のApache 2.0（出典36）。サーバーの費用は未確認。ZeroとEnterpriseは未確認 | プロキシの前段でログイン前の通信を遮る点はAccessと同種。ただしWorkersの公開URLへの直接アクセスを塞ぐ仕組みが前提。運用の質（更新、設定）に依存 | 別の層。IdPのログインが加わる。直接アクセスを塞がないと迂回される |
| Authelia | 大（サーバーとリバースプロキシの構築） | 大（同上） | ライセンスは無料（Apache 2.0、出典38）。サーバーの費用は未確認 | Pomeriumと同種。2要素認証とSSOを前段に置ける（出典37）。運用の質に依存 | 別の層。2要素認証が前段にもう1つ増える。直接アクセスを塞がないと迂回される |

### 10-5. 結論と推奨（参考。採否は決めない）

- **前段に置く層としては、Cloudflare Accessが本システムの構成に最も素直に合うと見られる**。Workers・workers.dev・Custom Domainをまとめて守れ、サーバーを持たず、占有席が50以内なら無料枠に収まる（出典2・3。ただし料金は二次確認できていない）。他社の前段製品（ZPA、IAP、Verified Access、Entraのアプリケーション プロキシ）は、いずれも自社のクラウド・ネットワークのアプリ向けに見え、Workersの前段に重ねる構成の例を取得した公式の文書から確認できなかった。**現時点で、これらを採用する積極的な理由は見つかっていない**。
- **Tailscaleは、本システムの構成に合いにくい**。全端末へのクライアント導入が必要で、Workersがtailnetに参加できると確認できない。無料のPersonalは非商用の個人利用限定なので、学習用の個人検証には使えても、社員が使う社内運用はStandard以上（8ドル／ユーザー／月）の有料契約になる。
- **Pomerium・Authelia**は、ライセンス費用は無料でも、サーバーの運用が加わり、サーバーレスのWorkers構成の利点を失う。学習用の本システムでは、割に合わない見込み。
- **OktaとEntra IDは、競合ではなく、Cloudflare Accessと組み合わせるIdPの候補**。会社が既にMicrosoft 365（Entra ID）を使っているなら、社員の追加・退職・MFAをIdPに集約できる可能性がある。Oktaは、年間契約の最低額（1,500ドル）があり、さらにSCIMによる退職者の自動の無効化にはライフサイクル管理（Starterでは追加オプション、Essentials 17ドル以上に含まれる）が要るため、学習用としては重い。IdPが会社にない場合は、AccessのワンタイムPIN（4-1）で足りる。
- 次に確認すること：①会社でEntra ID・Okta・Google Workspaceなどが既に使われているか（Google Workspaceは、AccessのIdPとして使える。出典40）。②Entra IDで条件付きアクセスが必要か（場所・端末の条件ならP1、リスクに基づく制御ならP2）。③Accessと他社IdPを組み合わせたときの席の数え方（IdP側の利用者数とは別に、Accessで認証した人が席を占有する。出典5）。

### 10-6. 追加の未確認・不確かなこと

- ZPAの料金・仕組みの詳細・端末の状態の確認・ログの置き場所。取得した公式ページに記載がなかった。
- Google Cloud IAPのChrome Enterprise Premiumの金額。基本機能は無料、Google Cloud以外のリソースのプロキシと端末属性は有料機能であることまでは確認した（出典26。ページ本文は直接取得できず、検索結果の要約）。端末の状態の確認の詳細、ログの置き場所も未確認。
- AWS Verified Accessの料金は、米国東部（オハイオ）・HTTP(S)のアプリの例（0.27ドル／アプリ時間、0.02ドル／GB）まで。他の地域の金額と、対象にできるアプリの種類は未確認。公式ページの本文は直接取得できず、検索結果の要約で確認した（出典28）。
- Entraアプリケーション プロキシのライセンスの区分。料金ページに記載がなかった。
- Cloudflare AccessのIdPとしてのGoogle Workspace（SAML／SCIM）は使える（出典40）。ただしSCIMはベータで、Googleのカスタム SCIM プロファイルが前提。出典24の取得ページ自体には、Googleの記載が見つからなかった。
- Oktaの端末の状態の確認、ログの保存先・保持期間。Starterにライフサイクル管理を足す追加費用、Core Essentialsにライフサイクル管理が含まれるか。
- Tailscaleの有料プランごとの端末の状態の確認の細かい対応、ログの保持期間、Workersとの接続の可否。
- PomeriumのZero・Enterpriseの料金、対応するIdPの一覧、端末の状態の確認の具体的な機能。Autheliaのサーバー運用費用。
- 「Workersの前段に別の会社のプロキシを重ねる構成」が成立するか、直接アクセスを塞ぐ方法は、公式の文書で確認していない（当方の推測）。
- Cloudflare Accessの料金（7ドル、50ユーザー）が二次確認できていない点は8章のとおり。この章の比較にも影響する。

### 10-7. 追加の出典（いずれも2026-11-03取得。1〜9章の出典番号の続き）

23. https://developers.cloudflare.com/cloudflare-one/identity/idp-integration/okta/ （Okta：OIDC・SAML・SCIM）
24. https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/ （AccessのIdP。一覧はなく、Entra ID・汎用OIDC・汎用SAMLを確認）
25. https://docs.cloud.google.com/iap/docs/concepts-overview （Google Cloud IAPの概要）
26. https://cloud.google.com/iap/pricing （IAPの料金。基本機能は無料、Google Cloud以外のリソースのプロキシ・端末属性はChrome Enterprise Premiumの有料機能。ページ本文は直接取得できず、検索結果の要約で確認）
27. https://docs.aws.amazon.com/verified-access/latest/ug/what-is-verified-access.html （AWS Verified Accessの概要）
28. https://aws.amazon.com/verified-access/pricing/ （Verified Accessの料金。米国東部（オハイオ）・HTTP(S)の例で0.27ドル／アプリ時間、0.02ドル／GB。ページ本文は直接取得できず、検索結果の要約で確認）
29. https://learn.microsoft.com/en-us/entra/identity/app-proxy/overview-what-is-app-proxy （Entra アプリケーション プロキシ）
30. https://learn.microsoft.com/en-us/entra/identity/conditional-access/overview （Entra 条件付きアクセス）
31. https://www.microsoft.com/en-us/security/business/microsoft-entra-pricing （Entra IDの料金）
32. https://www.okta.com/pricing/ （Oktaの料金）
33. https://tailscale.com/pricing （Tailscaleの料金）
34. https://tailscale.com/kb/1223/funnel （Tailscale Funnel）
35. https://www.pomerium.com/docs （Pomerium）
36. https://github.com/pomerium/pomerium （Pomeriumのライセンス）
37. https://www.authelia.com/overview/prologue/introduction/ （Authelia）
38. https://github.com/authelia/authelia （Autheliaのライセンスと対応プロキシ）
39. https://www.zscaler.com/products-and-solutions/zscaler-private-access （Zscaler Private Access）
40. https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google-workspace-saml/ （Google Workspace（SAML／SCIM）をAccessのIdPにする手順。検索結果の要約で確認。ページ本文は直接取得していない）
