# T-02 調査：Workers/R2 の制限と、添付・動画の直接／分割アップロード・配信方式

## 1. 目的と範囲

- 目的：要判断 Q-25 の残件（添付の確定上限・方式、1メッセージあたりの合計容量、添付後の公開可否変更）を決める前提となる、Cloudflare の制約を整理する。決定はしない。
- 範囲：公式ドキュメント（developers.cloudflare.com）の調査のみ。環境の構築・課金・実機での計測・本番への操作はしていない。
- 対象の要件：C-61（1メッセージ10ファイル、暫定上限 画像10MB・文書25MB・動画100MB、アバター2MB）、C-64（案件添付ごとの公開可否）、1-6 AC-1〜AC-4、V-13・V-20〜V-22、EP-1-09（添付アップロード）・EP-1-10（添付取得）。
- 関連Issue：#88（AC-1・AC-3・AC-4 の T-02 分）。

## 2. 調べた日

2026-10-29（`date +%F` で確認）。Cloudflare の制限・料金は変わりうるため、実装前に再確認する。

## 3. 結論（要点）

- **Workers 経由のアップロードの上限は、Workers のプランではなく Cloudflare アカウントのプランで決まる**。リクエスト本文の最大は Free・Pro が 100 MB、Business が 200 MB、Enterprise が最大 5 GB（セルフサービス）。暫定の動画上限 100MB は、Free・Pro のアカウントでは上限ちょうどで余裕がない（MB と MiB のどちらで数えるかは公式ページの要約に明記がなく未確認）。
- Workers の CPU 時間は Free が 1 リクエスト 10 ms、Paid が既定 30 秒（最大 5 分）。メモリは両プランとも 128 MB。大きなファイルを全部メモリに読み込む実装は避け、ストリームのまま R2 へ渡す必要がある。
- R2 側の上限は十分に大きい。オブジェクトは最大約 5 TiB、単一の PUT は最大約 5 GiB、分割（multipart）はパート最小 5 MiB（最後を除く）・最大 5 GiB・最大 10,000 パート。暫定の上限（最大 100MB）はどの方式でも R2 の制約には当たらない。
- **署名付き URL によるブラウザから R2 への直接アップロードは可能**（PUT。POST のフォーム形式は非対応）。ただし、**サイズ上限を署名付き URL で強制できると書いた公式の記述は確認できなかった**（Content-Type の制限は書かれている）。そのため、現行要件（1-6 AC-3・V-20・EP-1-09：上限超過は保存前に拒否）に直接アップロードが適合するかは**未確認**。アップロード後の検査・削除で補う方法は「保存後に消す」ことになり、現行要件（保存前に拒否）の変更が必要になるため、利用者の判断が要る。Workers 経由なら、本文の上限の範囲で保存前に拒否できる見込み。
- 署名付き URL はカスタムドメインでは使えず、S3互換API のエンドポイントで使う。ブラウザから使うにはバケットの CORS 設定が必要。有効期限は 1 秒〜7 日。URL は「持っていれば誰でも使える」ベアラートークンとして扱う。
- **認可つきの配信（C-61・1-6 AC-2・非機能要件）に合うのは、Workers 経由の配信**。r2.dev の公開 URL は開発用でレート制限があり、アクセス制御もできない。カスタムドメインの公開バケットは、Access や WAF のトークン認証を足せば制御できるが、このプロジェクトの「権限（メッセージの閲覧権・案件の公開承認）を都度確認する」条件に合うかは別途の検討が必要。
- 動画のシーク再生に使う Range は、R2 の Workers バインディング（`range` オプション）と S3互換API（GetObject の Range）のどちらも対応している。Workers で 206・Content-Range を正しく返す実装の詳細は、公式の例を確認できなかったため未確認（§7）。
- 課金：R2 の外向き転送（エグレス）は無料。保存は Standard で $0.015/GB・月、操作は Class A $4.50/百万・Class B $0.36/百万。無料枠は月 10 GB・Class A 100 万・Class B 1,000 万（Standard のみ）。

## 4. 項目ごとの調査結果

### 4-1. Workers の制限

出典：https://developers.cloudflare.com/workers/platform/limits/ （2026-10-29 取得）

| 項目 | Workers Free | Workers Paid |
| --- | --- | --- |
| 1 リクエストあたりの CPU 時間 | 10 ms | 既定 30 秒、最大 5 分 |
| メモリ（isolate あたり） | 128 MB | 128 MB |
| サブリクエスト（1 呼び出しあたり） | 50 | 10,000（最大 1,000 万まで引き上げ可） |
| HTTP リクエストの実行時間 | 制限なし | 制限なし |

- CPU・メモリの超過はいずれもエラー 1102。
- リクエスト本文の最大サイズ：「Workers のプランではなく Cloudflare アカウントのプランに依存する」と書かれている。

| Cloudflare アカウントのプラン | リクエスト本文の最大 |
| --- | --- |
| Free | 100 MB |
| Pro | 100 MB |
| Business | 200 MB |
| Enterprise | 最大 5 GB（セルフサービス）。それ以上は担当者へ相談 |

- レスポンス本文：サイズの強制上限なし（CDN キャッシュの上限は Free・Pro・Business 512 MB、Enterprise 5 GB）。
- 料金（出典：https://developers.cloudflare.com/workers/platform/pricing/ 、2026-10-29 取得）：Workers Paid は月額最低 $5。含まれる量は 1,000 万リクエスト・3,000 万 CPU ms。超過は 100 万リクエストあたり $0.30、100 万 CPU ms あたり $0.02。Free は 1 日 10 万リクエスト。
- このプロジェクトがどの Workers プラン・どの Cloudflare アカウントのプランを使うかは、読んだ範囲の文書（tech-stack.md など）では確認できなかった。**未確認（§7）**。

### 4-2. R2 の制限

出典：https://developers.cloudflare.com/r2/platform/limits/ 、https://developers.cloudflare.com/r2/objects/multipart-objects/ （2026-10-29 取得）

| 項目 | 値 |
| --- | --- |
| オブジェクトの最大サイズ | 5 TiB（約 4.995 TiB と脚注にある） |
| 単一アップロード（single-part）の最大 | 5 GiB（約 4.995 GiB と脚注にある） |
| 分割アップロードの最大パート数 | 10,000 |
| パートの最小サイズ | 5 MiB（最後のパートを除く） |
| パートの最大サイズ | 5 GiB |
| パートの大きさ | 最後を除き、すべて同じサイズ |
| 未完了の分割アップロード | 既定で 7 日後に自動中止（ライフサイクルの設定で変更可） |
| 同じキーへの同時書き込み | 1 回／秒（超えると HTTP 429） |
| オブジェクトキーの長さ | 1,024 バイト |
| オブジェクトのメタデータ | 8,192 バイト |
| バケットあたりの容量・オブジェクト数 | 無制限 |

- 注意：limits ページの表は分割アップロードの最大を「4.995 TiB」、脚注を「4.995 GiB」と書いていて、ページ内で不一致がある。今回の用途（最大でも数百 MB）では結論に影響しないが、事実として記録する。
- r2.dev の公開エンドポイントは、概ね毎秒数百リクエスト程度の可変のレート制限があり、本番用ではないと書かれている。

### 4-3. Workers の R2 バインディングと S3互換API の違い

出典：https://developers.cloudflare.com/r2/api/workers/workers-api-reference/ 、https://developers.cloudflare.com/r2/api/s3/api/ （2026-10-29 取得）

- **Workers バインディング**：`get`・`put`・`createMultipartUpload`・`resumeMultipartUpload` などを Workers のコードから直接呼ぶ。`put` の本文は ReadableStream・ArrayBuffer・Blob 等を受け付ける。分割は `createMultipartUpload()` → `uploadPart(partNumber, data)` → `complete(parts)`、失敗時は `abort()`。別々のリクエストにまたがる場合は `resumeMultipartUpload()` で uploadId を指定して再開する（uploadId の妥当性はチェックされない）。`get` の `range` オプションは offset／length／suffix、または Range ヘッダーを持つ Headers を受け付ける。`onlyIf` で条件付き取得ができる。
- **S3互換API**：PutObject、CreateMultipartUpload、UploadPart、CompleteMultipartUpload、AbortMultipartUpload、ListParts などが実装済み。GetObject は Range に対応（HeadObject では Range は効果なし）。PutObject は If-Match 等の条件ヘッダー、Content-MD5 に対応。同じパート番号を再アップロードすると前のパートを置き換え、その再アップロードが失敗すると元のパートも失われる。オブジェクトロック・ACL・タグ付けは未実装。**POST Object（ブラウザのフォーム形式のアップロード）は、署名付き URL のページで非対応と明記されている**。
- 使い分け（整理）：Workers を通す処理はバインディングで書ける（アクセスキーをコードに持たなくてよい）。ブラウザや外部から直接アクセスさせるには S3互換API の認証情報（アクセスキー）が必要で、署名付き URL の生成に使う。アクセスキーは秘密情報なので、AGENTS.md の方針に従い値はコミットしない。

### 4-4. 署名付き URL によるブラウザからの直接アップロード

出典：https://developers.cloudflare.com/r2/api/s3/presigned-urls/ 、https://developers.cloudflare.com/r2/buckets/cors/ （2026-10-29 取得）

- 仕組み：署名付き URL はサーバー側（R2 と通信せず）で生成する。URL 1 つが「1 つのオブジェクトと 1 つの操作」に結び付く。GET・HEAD・PUT・DELETE に対応。**POST（HTML フォームのマルチパート）は未対応**。
- 有効期限：1 秒〜7 日（604,800 秒）。同じ URL は期限まで何度でも使える。
- URL は「持っていれば誰でも期限まで操作できる」ベアラートークンとして扱う。リソース・操作・期限を変えると 403 `SignatureDoesNotMatch`。
- **カスタムドメインでは使えず、S3互換APIのドメインを使う**。カスタムドメインで認証つきにするなら WAF の HMAC 検証（Pro 以上のプランが必要と書かれている）。
- CORS：ブラウザから使うには、バケットの CORS ルールが必須。PUT の場合、AllowedOrigins にアプリのオリジン、AllowedMethods に PUT、AllowedHeaders に送るすべてのヘッダー（Content-Type 等）を指定する。ETag を読むなら ExposeHeaders に ETag。CORS がないと、URL が有効でもブラウザからのアップロードは失敗する。期限切れの URL は 403 `ExpiredRequest` を返すが CORS ヘッダーが付かず、ブラウザの JavaScript から本文を読めない（期限前に更新する）。設定の反映に最大 30 秒かかる場合がある。
- Content-Type の制限：署名時に許可する Content-Type を指定でき、違うヘッダーで送ると失敗する。
- **サイズ上限の強制**：公式ページに Content-Length や最大サイズを署名で縛れるという記述は見つからなかった。検索でも、公式に上限を強制する方法は確認できなかった（S3 の `content-length-range` 条件に相当するものは確認できていない）。**未確認（§7）**。
- **アップロード完了の検知**：R2 のイベント通知（出典：https://developers.cloudflare.com/r2/buckets/event-notifications/ ）で、PutObject・CopyObject・CompleteMultipartUpload のときに Cloudflare Queues へメッセージ（キー・サイズ・ETag を含む）を送れる。受け手は Queues のコンシューマー Worker か HTTP pull。配信保証・遅延・必要なプランはこのページに記載がなく**未確認**。Queues 自体は Workers Free でも使え（1 日 1 万オペレーション）、Paid は月 100 万オペレーションまで含まれ超過は 100 万あたり $0.40（出典：https://developers.cloudflare.com/queues/platform/pricing/ ）。別の方法として、クライアントが完了後にアプリの API を呼び、サーバーが R2 に HEAD（Class B）でサイズを確認する形も考えられる（これはドキュメントの記述ではなく設計上の選択肢）。

### 4-5. 配信方式

| 方式 | 内容と制約（出典：https://developers.cloudflare.com/r2/buckets/public-buckets/ ほか） |
| --- | --- |
| Workers 経由（認可つき） | アプリの API（EP-1-10）で権限を確認してから、R2 バインディングの `get` の本文をそのまま返す。権限の確認を毎回自由に書ける。Workers のリクエスト数・CPU 時間に数える。レスポンス本文の強制上限はない。 |
| 公開バケット（r2.dev） | 開発用。レート制限あり。キャッシュ・WAF・アクセス制御は使えない。本番では使わない前提と書かれている。 |
| 公開バケット（カスタムドメイン） | キャッシュ・WAF・アクセス制御（Cloudflare Access または WAF のトークン認証）が使える。ドメインは同じアカウントのゾーンが必要。アクセス制御を使う場合は r2.dev を無効にする。アプリ側の権限（メッセージの閲覧権・案件の公開承認）を都度確認する用途に合うかは別途検討が必要。 |
| 署名付き URL での取得 | GET の署名付き URL を発行して直接取得させる。期限内は URL を知る誰でも取得できる。カスタムドメインでは使えない。有効期限を短くすることで「権限を確認してから配信する」に近づけられるが、URL を共有されうる点は残る（ベアラートークンのため）。 |

- **動画の Range（シーク再生）**：R2 の Workers バインディングと S3互換API は Range に対応（§4-3）。キャッシュの Range 動作の公式ページ（https://developers.cloudflare.com/cache/reference/range-requests/ ）によると、単一の範囲（`bytes=100-199`・`bytes=100-`・`bytes=-100`）は 206 を返し、満たせない範囲は 416 と `Content-Range: bytes */<サイズ>`。Workers が自前で返した 206 のキャッシュの扱いについては、検索結果の要約に「Workers が 206 を返すとキャッシュ不可として扱われる」との記述があったが、原文の確認ができていないため断定しない。公開バケット（カスタムドメイン）の Range 対応は、public-buckets ページに記載がなく**未確認**。
- **ダウンロード時のファイル名**：元のファイル名を表示し、保存名はランダムにする（C-61）ため、`Content-Disposition` で元のファイル名を指定する必要がある。R2 の `httpMetadata` に `contentDisposition` があり、取得時に上書きもできる（出典：Workers API リファレンス）。

### 4-6. 課金の考え方

出典：https://developers.cloudflare.com/r2/pricing/ （2026-10-29 取得、米ドル）

| 項目 | Standard | Infrequent Access |
| --- | --- | --- |
| 保存 | $0.015／GB・月 | $0.01／GB・月（最低保存 30 日） |
| Class A 操作 | $4.50／百万 | $9.00／百万 |
| Class B 操作 | $0.36／百万 | $0.90／百万 |
| データ取得 | なし | $0.01／GB |
| インターネットへの外向き転送（エグレス） | 無料 | 無料 |

- 無料枠（Standard のみ、月あたり）：保存 10 GB・月、Class A 100 万、Class B 1,000 万。
- 操作の分類：Class A は PutObject・CreateMultipartUpload・UploadPart・CompleteMultipartUpload・ListObjects など。Class B は GetObject・HeadObject など。DeleteObject・AbortMultipartUpload は無料。
- 考え方：1 ファイルの分割アップロードは「作成＋パート数＋完了」が Class A として数えられる。単一の PUT なら 1 回。Workers 経由の配信でも R2 のエグレスは無料だが、Workers のリクエスト数と CPU 時間は別に課金対象になる（§4-1）。
- 算術の例（実際の利用量は未定）：1,000 GB を保存した場合の保存料は、単価の掛け算で約 $15／月（無料枠の差し引き前）。

## 5. 要件（C-61・C-64・Q-25）への影響と選択肢の比較

### 5-1. アップロード方式の比較

| 項目 | A. Workers 経由の単一アップロード | B. 署名付き URL の直接アップロード（PUT） | C. 分割（multipart）アップロード |
| --- | --- | --- | --- |
| 概要 | ブラウザ → Workers → R2。Workers で認可・検査してストリームで R2 へ | Workers が署名付き URL を発行し、ブラウザが R2 へ直接 PUT | 大きなファイルを複数のパートに分け、順に送って最後に完了を呼ぶ（Workers 経由でも、署名付き URL の UploadPart でも可） |
| 本文の上限 | アカウントのプランの本文上限（Free・Pro 100 MB、Business 200 MB）に従う | Workers の本文上限を受けない。R2 の単一 PUT は最大約 5 GiB | パートごとに 5 MiB〜5 GiB、最大 10,000 パート。Workers 経由なら各パートが本文上限内 |
| 動画 100MB の可否 | Free・Pro では上限ちょうどで余裕なし（MB/MiB は未確認）。Business 以上、またはパート分割と併用なら可 | 可 | 可 |
| サイズ上限の強制（V-20「保存前に拒否」） | Workers で受信中にバイト数を数えて打ち切れる見込み（実装次第。計測していない） | 保存前にサイズ上限を強制する方法が公式に確認できず、現行要件（保存前に拒否）への適合は未確認。保存後の検査・削除で補う場合は要件の変更が必要（利用者の判断） | A と同様（Workers 経由の場合）。直接の場合は B と同様 |
| 権限・検査（形式の中身判定、位置情報の削除） | Workers で一貫して実施できる | R2 に着いた後の検査になる。不正なファイルが一時的に保存される | パートが揃ってから検査する形になる |
| 実装の複雑さ | 低い | 中（CORS、署名、完了の検知、孤立ファイルの掃除） | 高（パート管理、再開、中止、未完了の掃除） |
| 秘密情報 | バインディングのみ（アクセスキー不要） | S3互換API のアクセスキーが必要（コミット禁止） | 同左（直接の場合） |
| 費用面 | Workers のリクエスト・CPU が増える | Workers を通さない分だけ軽い | Class A 操作が増える |

### 5-2. 確定上限・合計容量の選択肢（決定はしない）

| 選択肢 | 前提 | 注意点 |
| --- | --- | --- |
| ① 暫定の上限（画像10MB・文書25MB・動画100MB）をそのまま確定し、A（Workers 経由）で実装 | アカウントのプランの本文上限が 100 MB 以上であること。動画 100MB が上限内に収まること | Free・Pro では動画の余裕がない。100MB ちょうどが通るかは未確認。形式・サイズ検査を Workers で一貫して行える利点 |
| ② 動画上限を 100MB より下げて A（Workers 経由）で実装 | Free・Pro のアカウント | 本文上限に余裕を持たせる（例：90MB など）。動画の用途が上限内かの確認が必要 |
| ③ 画像・文書は A、動画だけ B（署名付き URL）または C（分割）で実装 | 動画の上限を 100MB 超へ広げたい要望があること | 方式が 2 本になり実装・テストが増える。B は保存前の上限強制が未確認で、現行要件（保存前に拒否）への適合が未確認。保存後の検査・削除で補うなら要件の変更が必要 |
| ④ すべて B（直接アップロード）で実装 | 認可・検査を R2 到着後に行う設計を許容すること | 完了検知（イベント通知または完了 API）、孤立ファイルの掃除、CORS 設定、アクセスキーの管理が必要 |

- 合計容量（1 メッセージ・1 人あたり）：C-61 の 10 ファイル × 各暫定上限だと、最悪で 10 × 100MB = 約 1 GB。EP-1-09 は 1 ファイルずつ保存し、メッセージ投稿で紐づける設計のため、Workers 経由（A）でも合計は本文上限と直接は関係しない。したがって合計容量は技術制約というより、保存コストと運用方針（利用者ごとの容量・回数。V-22）で決める性質。R2 の保存単価は $0.015／GB・月（§4-6）。
- 推奨案（決定ではない）：まず ① または ② を検討する。理由は、EP-1-09 が既に「1 ファイルずつ Workers の API で保存する」形で書かれており、認可・形式の中身判定・位置情報の削除・上限の保存前拒否を Workers で一貫して実施でき、アクセスキーの秘密情報も増えないため。動画を 100MB より大きくしたい要望が出た場合に、③ を再検討する。ただし、利用するプランが未確認のため、プランの確認が先に必要。

### 5-3. C-64（案件添付ごとの公開可否）への影響

- 配信を Workers 経由にすれば、添付ごとの「公開可否」「公開アーカイブの承認状態」「参加者かどうか」を、取得のたびにアプリの DB で判定できる。署名付き URL や公開バケットでの取得では、権限の変更（公開可否の変更・案件の再開後の非公開化）が、URL の有効期限が切れるまで反映されない可能性がある（署名付き URL は期限まで有効なベアラートークンのため。公式ページの記述からの推論）。
- 添付後の公開可否の変更（C-64 の残件）は、配信を Workers 経由にして属性を都度確認する場合、R2 のオブジェクトを動かさず DB の属性の更新だけで足りる設計にできる（設計上の見通し）。変更を許す条件（誰が・いつまで）は仕様の決定事項であり、技術調査では決まらない。

## 6. 出典の一覧（すべて 2026-10-29 に取得）

- Workers の制限：https://developers.cloudflare.com/workers/platform/limits/
- Workers の料金：https://developers.cloudflare.com/workers/platform/pricing/
- R2 の制限：https://developers.cloudflare.com/r2/platform/limits/
- R2 の分割アップロード：https://developers.cloudflare.com/r2/objects/multipart-objects/
- R2 の Workers API：https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
- R2 の S3互換API：https://developers.cloudflare.com/r2/api/s3/api/
- R2 の署名付き URL：https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- R2 の CORS：https://developers.cloudflare.com/r2/buckets/cors/
- R2 の公開バケット：https://developers.cloudflare.com/r2/buckets/public-buckets/
- R2 のイベント通知：https://developers.cloudflare.com/r2/buckets/event-notifications/
- R2 の料金：https://developers.cloudflare.com/r2/pricing/
- Queues の料金：https://developers.cloudflare.com/queues/platform/pricing/
- Cache の Range リクエスト：https://developers.cloudflare.com/cache/reference/range-requests/

注：取得は WebFetch の要約を介しているため、数値は要約結果に基づく。実装前の確定時は、原文のページで数値を再確認する。

## 7. 未確認・不確かなこと

1. このプロジェクトが使う Workers のプラン（Free／Paid）と Cloudflare アカウントのプラン（Free／Pro／Business 等）。リクエスト本文の上限・CPU 時間に直結する。
2. 本文上限「100 MB」を MB（10^6）と MiB（2^20）のどちらで数えるか、およびフォームの付加分を含むか。取得した内容に明記がなく、100MB ちょうどのファイルが通るかは実測していない（実機での計測は今回の範囲外）。
3. 署名付き URL でアップロードのサイズ上限を保存前に強制できるか。公式ページに記載を確認できなかったため、直接アップロードが現行要件（1-6 AC-3・V-20・EP-1-09：保存前に拒否）に適合するかは未確認。保存後の検査・削除で補う場合は現行要件の変更が必要。
4. R2 のイベント通知の配信保証・遅延・必要なプラン。ページに記載がなかった。
5. Workers が R2 のオブジェクトを 206 で返す公式の実装例。取得を試みた公式の例ページ（authenticated-r2-bucket）は 404 で取得できなかった。Workers が自前で返した 206 のキャッシュの扱いは検索結果の要約のみで、原文は未確認。動画のシークが実際に動くかは未検証（実装時に動作確認が必要）。
6. 公開バケット（カスタムドメイン）での Range リクエストの対応。public-buckets ページに記載がなかった。
7. limits ページ内の、分割アップロードの最大サイズの表記の不一致（TiB と GiB）。本件の用途には影響しない。
8. 署名付き URL の GET を使った場合の、権限変更の反映の遅れの程度。URL の期限を何秒にするかは設計事項で、公式文書には答えがない。
9. 利用規模の想定が要件側にないため、課金額の試算はしていない。
10. WebFetch の要約を介した取得のため、数値の転記ミスの可能性がゼロではない。

## 8. 次に利用者が決めること（Q-25 の質問の素案）

1. **利用するプラン**：Workers と Cloudflare アカウントのプランは何か（Free／Paid、Pro 以上か）。Workers 経由で受けられる最大ファイルサイズが決まる。
2. **各種類のサイズ上限の確定**：画像（暫定10MB）・文書（暫定25MB）・動画（暫定100MB）・アバター（暫定2MB）の上限を、単位（MB＝10^6 バイトか、MiB＝2^20 バイトか）も含めて確定する。
   - **動画の上限**：動画は 100MB を上限として確定するか（その場合 Workers 経由でも通るか、実装前に実機で確認する）。より大きな動画（例：数百 MB）が必要か。
3. **方式**：全ファイルを Workers 経由（選択肢 ①②）にするか、動画だけ直接アップロード（選択肢 ③）にするか。直接アップロードを選ぶ場合は、保存前の上限強制が確認できていないため、「上限超過は保存前に拒否」の要件を「保存後に検査して削除」へ変更してよいか（要件の変更）の判断が要る。完了検知の方法も合わせて決める。
4. **確定する形式の一覧**（V-21）：画像・動画・文書のそれぞれで許可する形式（中身で判定。SVG 等は不可）。
5. **合計容量と回数**（V-22）：1 メッセージあたりの合計容量（10 ファイル × 上限の最悪値は約 1 GB）、1 人あたりの容量・1 日あたりの回数に上限を置くか、置くなら数値はいくつか。
6. **配信の方式**：認可つきの配信は Workers 経由で確定してよいか（署名付き URL による取得は使わない前提でよいか）。
7. **添付後の公開可否の変更**（C-64 の残件）：添付後に変更できるか。変更できる人（添付した本人のみか、案件の管理者も含むか）と、変更できる期間（案件の終了後・公開申請中は不可にするか）。
