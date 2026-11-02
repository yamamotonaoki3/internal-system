# T-04（追加）Cloudflare WorkersでのArgon2idの実用性

## 1. 目的と範囲

- 目的：全体設計（Issue #105）の前提として、利用者の決定「パスワードのハッシュはOWASPを最優先にし、Argon2idを目標とする。OWASPの基準を満たす以上の強さにする」を、Cloudflare Workersで実現できるかを調べる。既存の調査（[T-04-password-hash.md](T-04-password-hash.md)）の続きで、Argon2idに絞って深掘りする。
- 範囲：公式ドキュメント・npm・GitHub・Web検索による調査のみ。Workersでの実測、ライブラリの導入、課金はしていない。
- 決定はしない。「推奨案」は理由つきの参考にとどめる。新しいライブラリの追加は利用者の承認が必要（AGENTS.md）。

## 2. 調べた日

2026-11-02（`date +%F`で確認）。npmの版・日付はnpm registryの値。Cloudflareの制限やライブラリの状況は変わりうるため、実装前に再確認する。

## 3. 結論（要点）

- Argon2idをWorkersで動かす現実的な候補は、WASM版の `argon2id`（openpgpjs）、`hash-wasm`、`argon2-wasm-edge`（hash-wasmの派生）、純JSの `@noble/hashes`。どれも新しいライブラリの追加になり、承認が必要。
- **第一候補は `argon2id`（openpgpjs）1.0.1**。MIT、gzip後7KB未満、WASMの読み込みを自前で差し込める設計で、Workersでの動かし方の報告がある（hash-wasm Discussion #56）。弱点は、最終公開が2023-08-03で更新が止まっていること。短く単機能なので影響は限定的だが、メンテ状況は承認時に判断が要る。
- hash-wasm（4.12.0、2024-11-19）はnpm経由でWranglerと組み合わせると動かない報告がある。`argon2-wasm-edge`（1.0.23、2024-04-02）は動くと自称するが、Workersでの実績はこの調査では確認できていない。純JSの `@noble/hashes`（2.4.0、2026-08-27）は最も保守が活発だが、作者自身が「Argon2はJSでは速くできない（ネイティブの約5倍遅い）」と明記し、argon2は第三者監査の対象外。
- OWASPの現行の最小設定は、m=19MiB・t=2・p=1（同等：m=46MiB・t=1、m=12MiB・t=3、m=9MiB・t=4、m=7MiB・t=5）。「基準以上」の案として、m=64MiB・t=3・p=1（OWASP最小の約5倍の計算量）などが考えられる（5章）。
- Workersの制限は、メモリが128MB/isolate（JSヒープとWASMの確保を合算）、CPU時間がFree 10ms／Paid 既定30秒（`limits.cpu_ms`で最大5分）。**Freeでは、OWASPの最小設定でも収まらない。Paidが前提**。
- 1回あたりの時間は、**Workers上の公開された計測は見つからなかった**。目安（スケーリングによる推定、実測ではない）では、OWASP最小で数十ms、m=64MiB・t=3で百〜数百ms。100人の一括登録は、1件100msなら約10秒、300msなら約30秒で、既定の30秒に近づく。`limits.cpu_ms`の引き上げで対応できる見込み。
- PBKDF2（WebCrypto）をフォールバックにする場合の最低ラインはHMAC-SHA256で60万回（OWASP）。ただしCloudflareの反復回数の上限が10万回という二次情報があり、事実ならOWASPを満たせない（既存の調査と同じ未確認事項）。
- 自己記述形式（PHC文字列）で方式とパラメータをハッシュに含めれば、後から強度を上げる再ハッシュはログイン成功時に行える。D1の列は1つで足りる。
- **実装前に実測が必須**。手順は7章。

## 4. 項目ごとの調査結果

### 4-1. Workersで動くArgon2idの実装候補

| 候補 | 最新版（公開日） | ライセンス | 実装・サイズ | 週間DL数（2026-10-23〜29） | Workersでの動かし方・注意 |
| --- | --- | --- | --- | --- | --- |
| `argon2id`（openpgpjs） | 1.0.1（2023-08-03） | MIT | Rust不使用の小さなWASM（SIMD版と非SIMD版）。READMEは「gzip後7KB未満（WASMはbase64でインライン時）」。npmの展開後サイズは約56KB | 約1.6万 | `argon2id/lib/setup` の `setupWasm` に、SIMD版・非SIMD版のWASMをそれぞれ読み込む関数を渡せる。Workersでは `.wasm` をモジュールとしてimportし、`WebAssembly.instantiate(module, imports)` で生成する（Discussion #56の投稿者の例）。SIMDはWorkersで対応（公式）。出力は生のバイト列で、PHC文字列は自前で組む。メモリは呼び出しごとに消去されるが解放はされない（READMEの記載） |
| `hash-wasm` | 4.12.0（2024-11-19） | MIT | Argon2は約11KB（gzip。README）。アルゴリズムごとのWASM | 約264万 | npm経由でWranglerと組み合わせると「Wasm code generation disallowed by embedder」で動かない（Discussion #56、2023-11）。メンテナは「Cloudflare独自の非標準の読み込みのため、WASMを取り出して再パッケージする」と回答。READMEにWorkersの記載はない。保守の負担が増えるため非推奨 |
| `argon2-wasm-edge` | 1.0.23（2024-04-02） | MIT | hash-wasmの派生。Argon2のみ。Vercel EdgeとCloudflare向けと自称。npmの展開後サイズは約280KB | 約9.8千 | `setWASMModules` に、Argon2とBlake2bの2つのWASMを渡す。WASMのimport方法がCloudflareとVercelで異なる旨がREADMEにある。更新が止まっており、Workersでの実績はこの調査では確認できなかった |
| `@noble/hashes` の `argon2id` | 2.4.0（2026-08-27） | MIT | 純JS（WASMなし）。ESMのみ | 約1.4億（パッケージ全体） | WASMの読み込み問題がない。作者の計測：argon2id（t=1・m=128MB）が276ms/op（Apple M4）。作者は「Argon2はJSでは速くならない。ネイティブの約5倍遅い。scryptを勧める」と記載。Cure53の監査（2022年）は、argon2を対象外（未監査）としている。非同期版はargon2にはない（同期のみ）ため、CPUを占有する |
| `@node-rs/argon2`等のネイティブ | — | — | ネイティブアドオン | — | Workersでは動かない。対象外 |
| `node:crypto` の `argon2` | — | — | — | — | Workersでは未対応と明記（既存の調査の出典6）。将来対応されれば、追加ライブラリなしで使える可能性がある |

補足：

- 周辺で見つかった実例：Rustで書いたArgon2idのWASMを使うCloudflare Workers向けのテンプレート（imjlk/cloudflare-auth-hasher-template）は、既定を m=12MiB・t=3・p=1（OWASPの同等の組み合わせ）とし、Free向けの退避設定（m=4MiB・t=1。OWASP相当ではないと自ら記載）を別に持つ。Freeでは既定の設定がCPU時間の超過になりうるという報告もある。具体的な計測値はページに載っていなかった。
- いずれの候補も、**ViteとCloudflare Viteプラグイン（本プロジェクトの構成）で `.wasm` をimportする方法は、この調査では実際に確かめていない**。Workersの公式は、`WebAssembly.instantiate()` は事前にコンパイル済みのモジュールだけを受け付けるとだけ記載している。ビルド設定（`.wasm` のモジュール扱い）と、`vitest-pool-workers` 上での動作は、7章の試験で確かめる。
- 結論として、「Workersで動く」ことは候補1つ（`argon2id`）で報告があるが、**当プロジェクトの構成での動作は未検証**。

### 4-2. OWASPの推奨パラメータと「基準以上」の案

出典：https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html（2026-11-02取得）

OWASPの最小設定（どれも防御の強さは同等。CPUとメモリの配分だけが違う）：

| 組み合わせ | m（メモリ） | t（反復） | p（並列） |
| --- | --- | --- | --- |
| 要約の推奨 | 19MiB（19456KiB） | 2 | 1 |
| 同等 | 46MiB（47104KiB） | 1 | 1 |
| 同等 | 12MiB（12288KiB） | 3 | 1 |
| 同等 | 9MiB（9216KiB） | 4 | 1 |
| 同等 | 7MiB（7168KiB） | 5 | 1 |

- OWASPは、アルゴリズムとパラメータを各ハッシュと一緒に保存する（PHC文字列形式）こと、作業量は時間とともに引き上げ、次回ログイン成功時に再ハッシュする方法を示している。
- pepper（全パスワード共通の秘密）は、塩と遅いハッシュの代わりにはならない多層防御。使う場合、漏れたときはパスワードの再設定が必要になる。本書では扱わない（採否は別の判断）。

「基準以上」のパラメータ案（決定ではない。実測で選ぶ）：

| 案 | m | t | p | OWASP最小に対する計算量（m×t） | 位置づけ |
| --- | --- | --- | --- | --- | --- |
| A | 19MiB | 2 | 1 | 1倍（38） | OWASPの最小。これ以下にしない |
| B | 32MiB | 3 | 1 | 約2.5倍（96） | 余裕を持たせた案 |
| C | 64MiB | 3 | 1 | 約5倍（192） | 強い案。メモリ64MiBは128MBの半分で、同じisolateのほかの処理との兼ね合いに注意 |

- p（並列度）は1にする。Workersは1つのリクエストで複数スレッドを使えないため、p>1はCPU時間を増やすだけで速くならない（OWASPのpも1が基準）。
- 強さを上げるときは、まずt（反復）より**m（メモリ）**を上げる方が、GPU・ASICによる攻撃への耐性が高い。ただし、Workersのメモリ（128MB）が上限で、同時に動く処理と共有する。
- 「OWASPの基準を満たす以上」の度合い（案B・案C）は、利用者が決める。実測の結果（所要時間・同時実行）を見てから決めるのが安全。

### 4-3. Workersのメモリ・CPU時間の制限と所要時間の目安

出典：https://developers.cloudflare.com/workers/platform/limits/（2026-11-02取得）

| 項目 | Free | Paid |
| --- | --- | --- |
| HTTPリクエストあたりのCPU時間 | 10ms | 既定30秒（`limits.cpu_ms`で最大5分） |
| メモリ | 128MB/isolate（JSヒープとWASMの確保を合算） | 同左 |

- CPU時間は待ち時間（ネットワーク・D1）を含まない。Argon2id（WASM）の計算はCPU時間に数えられる。WebCryptoの計算が数えられるかは、公式ページに記載がない（既存の調査の未確認事項のまま）。
- 所要時間の目安（**実測ではなく推定**）：
  - 公開された、Workers上のArgon2id（OWASP設定）の計測は、この調査では見つからなかった。
  - 参考にできる数値は、`@noble/hashes`（純JS）の「t=1・m=128MB で276ms（Apple M4）」。メモリ×反復に比例するとして、案A（m×t=38MiB回）は約82ms、案C（m×t=192MiB回）は約410msと推定できる。WASM版は純JSより速い（作者の言う「ネイティブの約5倍遅い」を超える遅さは通常ない）ため、**WASM版は案Aで数十ms、案Cで百〜数百msの範囲**と見込む。Workersの実機は、手元のCPUより遅いことが多いため、倍程度の余裕を見る。
  - hash-wasmのREADMEの数値（m=512KiB・t=8で約438回/秒）は、ブラウザでの小さなメモリの計測で、Workersの目安にはならない。
- Freeの10msでは、案Aでも収まらない見込み。Paid前提は既存の調査と同じ。
- **ログインの同時実行**：Workersの1つのisolateは、JavaScriptを1スレッドで実行する。Argon2id（同期呼び出し）の計算中は、同じisolateの他のリクエストの処理が止まる。Cloudflareは負荷に応じてisolateを増やすため、同時に多数のログインが来てもほかのisolateで処理される。ただし、
  - 計算中のisolateは他の要求に応答できない（そのisolate上の軽いAPIも遅れる）。
  - 1つのisolateのWASMのメモリは、使い回し（解放されない）で保たれる。メモリは「同時の計算数」ではなく「isolate数」に比例して増える。
  - 攻撃で大量のログインが来ると、CPU時間の料金とisolateの負荷が増える。ハッシュ計算の前に試行制限を判定する設計（C-41、I-09）が重要。
- **CSV100人の一括登録（C-34・C-35）**：1リクエストで100件を逐次計算する場合の合計の目安は次のとおり（推定）。

| 1件あたり | 100件の合計 | 既定の30秒に対して |
| --- | --- | --- |
| 50ms | 5秒 | 余裕あり |
| 100ms | 10秒 | 収まる |
| 300ms | 30秒 | 超過のおそれ。`limits.cpu_ms`の引き上げが必要 |
| 500ms | 50秒 | 引き上げが必要（上限は5分） |

  - 全件成功か全件取消の要件（0-1 AC-6）と、平文を応答で一度だけ返す要件（C-34）に素直に合うのは、1リクエストでの逐次計算。`limits.cpu_ms`を引き上げて対応する案が基本になる。
  - 100件を同じWASMのインスタンスで逐次処理するため、メモリは1回分（案Cで64MiB）で足りる見込み。
  - 初期パスワード（システムが生成。C-34・C-40）だけ軽いハッシュにする案（既存の調査の案2）は、「OWASPの基準以上」という利用者の決定の趣旨と合わないおそれがある。**まず実測し、収まらないときだけ、利用者に諮る**のが安全。

### 4-4. PBKDF2（WebCrypto）をフォールバックにする場合

- OWASPの最低ライン：PBKDF2-HMAC-SHA256は60万回、PBKDF2-HMAC-SHA512は22万回（FIPS-140が必要なときのみの位置づけ）。これ未満は、OWASPの基準を満たさない。
- Cloudflareでの反復回数の上限が10万回という二次情報がある（既存の調査の出典4・5）。事実なら、OWASPの最低ライン（60万回）を満たせず、**フォールバックとしても基準未満になる**。上限は7章の試験で確かめる。
- したがって、Argon2idが使えない場合の代案は、PBKDF2（反復回数に上限がある場合は基準未満）よりも、`node:crypto` の `scrypt`（`nodejs_compat`。OWASPの組み合わせはN=2^17で128MiBを要し、isolateのメモリを超えるおそれ。N=2^14・r=8・p=5等の同等の組み合わせはメモリ16MiB程度）の方が基準を満たしやすい可能性がある。これも未検証で、7章に含める。

### 4-5. 自己記述形式と後からの強度の引き上げ

- ハッシュは、PHC文字列形式で保存する。例の形：`$argon2id$v=19$m=65536,t=3,p=1$<塩（base64）>$<ハッシュ（base64）>`。方式・版・パラメータ・塩・ハッシュが1つの文字列に入り、D1の列は1つで足りる（C-34：現在のハッシュのみ保持）。
- 検証は、保存された文字列のパラメータを読み取り、その設定で計算して比較する（比較は定数時間で。Workersには `crypto.subtle.timingSafeEqual` がある。Discussion #56の例でも使用）。
- 再ハッシュのタイミング：
  1. ログイン成功時（パスワードの平文が手元にあるときだけ可能）に、保存されたハッシュの方式・パラメータが現行の目標と異なれば、新しい設定でハッシュし直し、同じリクエストの中で置き換える。
  2. 初期パスワードでのログイン後の変更（0-3 AC-5）と、パスワード変更・再発行では、常に現行の設定でハッシュする。
  3. 長期間ログインしない利用者は古い設定のまま残る。OWASPも同様に述べており、許容するか、期限を決めて再設定を求めるかは運用の判断。
- 再ハッシュは追加のCPU時間を使うため、ログインのリクエスト内で行うと、その要求だけ遅くなる。更新時期は、設定を上げた直後に集中する。
- 再ハッシュの失敗は、ログイン自体の成否を変えない（付随する後始末として扱う）。その場合も、AGENTS.mdのとおりログに残す。
- ライブラリ自体を差し替える場合（例：`argon2id`を別実装へ）も、PHC文字列が同じなら、保存済みのハッシュはそのまま検証できる。方式を乗り換える余地を残せる点が、自己記述形式の利点。

## 5. 推奨案（参考。決定ではない）

1. **前提：Workers Paid**（Freeの10msでは、OWASP最小のArgon2idも収まらないため）。
2. **方式：Argon2id（WASM）**。実装は `argon2id`（openpgpjs）1.0.1を第一候補とする。理由：MIT・小さい・WASMの読み込みを自前で差し込める（WorkersのWASM制約に合う）・Workersでの動かし方の報告がある。弱点（2023-08以降更新なし）は、短く単機能で、PHC文字列は自前のため、後から別実装へ差し替えられる設計で和らげる。第二候補：`argon2-wasm-edge` 1.0.23。純JSの `@noble/hashes` 2.4.0は、WASMの問題を避けたい場合の代案（遅い・argon2は未監査）。
3. **パラメータ**：案A（m=19MiB・t=2・p=1）を下限とし、実測で案B（m=32MiB・t=3）または案C（m=64MiB・t=3）から選ぶ。最終の値は、実測の所要時間・同時実行・CSV100人の合計時間を見て、利用者が決める。
4. **CSV100人**：1リクエストで逐次計算し、`limits.cpu_ms`を必要な値まで引き上げる。軽い方式を初期パスワードにだけ使う案は、実測で収まらない場合に限り、利用者に諮る。
5. **ハッシュ形式はPHC文字列**にし、ログイン成功時の再ハッシュで強度を上げる。
6. **PBKDF2は、Argon2idが使えない場合の退避としても基準未満（上限が10万回の場合）**になりうる。退避が必要になったら、scrypt（`node:crypto`）を先に検討する。
7. 試行制限（C-41、I-09）は、ハッシュ計算の前に判定する。

### 利用者の承認が必要なライブラリ（候補・バージョン固定）

| ライブラリ | 固定する版 | 用途 | 備考 |
| --- | --- | --- | --- |
| `argon2id` | 1.0.1（`^`・`~`を付けない） | Argon2id本体（WASM） | 第一候補。MIT。最終更新2023-08-03 |
| `@noble/hashes` | 2.4.0（同上） | 代案（純JSのArgon2id） | MIT。WASMの問題を避けたい場合。遅く、argon2は未監査 |
| `argon2-wasm-edge` | 1.0.23（同上） | 代案（WASM） | MIT。最終更新2024-04-02 |

PHC文字列の組み立てと検証、`.wasm` の読み込み、定数時間の比較は、自前の小さなモジュールとして書く想定（追加のライブラリは不要。Discussion #56の例は、`rfc4648` にも依存するが、Base64は標準のAPIで代替できる）。

## 6. 決める前に確かめること（未確認事項）

- 当プロジェクトの構成（Vite＋`@cloudflare/vite-plugin`、`vitest-pool-workers`、`compatibility_date` 2026-08-04）で、`argon2id` のWASMがimportでき、動くこと。
- Workers上の実測値（案A・B・C）。公開された計測は見つからなかった。
- WebCryptoと `node:crypto` の計算が、CPU時間にどう数えられるか。
- PBKDF2の反復回数の上限（二次情報のみ）。
- `argon2id`（openpgpjs）のメンテ状況（更新が止まっている理由。重大な不具合・脆弱性の報告の有無）。GitHubのIssueと最近のコミットを、導入前に確認する。
- `argon2id` の第三者による監査の有無（確認できなかった）。
- Cloudflareがisolateを増やす条件、1つのisolateでの同時リクエスト数（メモリの上限と合わせた設計）。
- 取得はWebFetch・WebSearch（要約）経由で、原文の逐語確認ではない。数値は実装前に公式ページで再確認する。

## 7. 実測で検証する手順

検証環境：本番ではなく、検証用のWorkers（Paid）。ローカルの `wrangler dev` の時間は本番と一致しないため、数値は**デプロイ先**で取る。テストデータは架空のもの（`testuser_001`等）と、テスト専用の固定パスワード（`TestPass123!`）を使う。検証用のWorkerは、終了後に削除する。

### 7-1. 最小の試験コード案

試験用のWorkerを別フォルダに作り（本番のコードに入れない）、次のエンドポイントを持たせる。

| エンドポイント | 内容 |
| --- | --- |
| `GET /argon2id?m=&t=&p=&n=` | 指定のパラメータで、ランダムな塩を使い、固定のテスト用パスワードをn回ハッシュする。各回の壁時計時間（`performance.now()`）と合計、WASMのメモリのバイト数（`instance.exports.memory.buffer.byteLength`）を返す |
| `GET /argon2id-verify` | 保存したPHC文字列を検証する（正しいパスワード・誤ったパスワード）。定数時間の比較を使う |
| `GET /pbkdf2?iter=` | WebCryptoのPBKDF2-HMAC-SHA256を、指定の反復回数（10万・21万・60万）で呼び、エラーの有無と時間を返す |
| `GET /scrypt?n=&r=&p=` | `node:crypto` のscryptを、指定の組み合わせで呼び、エラー・時間を返す（`nodejs_compat`が必要） |
| `GET /ping` | ハッシュを計算しない軽いAPI（同時実行時の影響の確認用） |

- `argon2id` のWASM（SIMD・非SIMD）は、`.wasm` をモジュールとしてimportし、`WebAssembly.instantiate(module, imports)` で生成する（4-1の例）。`wrangler.jsonc` と `vite` の設定で `.wasm` が `WebAssembly.Module` として読み込まれることを確かめる。
- CPU時間は、Workers Logs・`wrangler tail` のCPU時間、またはレスポンスヘッダー（`performance.now()`は、Workersでは時刻が粗く丸められるため、壁時計の目安にとどめる）で確認する。

### 7-2. 測る項目

1. 案A・B・C（4-2）の、1件あたりのCPU時間と壁時計時間（各20回。中央値・p95）。SIMD版と非SIMD版の両方。
2. WASMのメモリの実使用量と、Workerのメモリ上限（128MB）に対する余裕。`m=64MiB` の連続実行でメモリ超過が起きないか。
3. 100件の逐次ハッシュ（1リクエスト）のCPU時間・壁時計時間。`limits.cpu_ms` の既定で収まるか、収まらない場合に必要な値。
4. 同時実行：管理者がCSVを実行している間に、`/ping` と別のログイン検証の応答時間がどれだけ遅れるか。ログインを同時に50〜100件送ったときの応答時間とエラー率（k6。Skill「test-tools」）。
5. PBKDF2の反復回数（10万・21万・60万）でのエラーの有無（上限の確認）。
6. `node:crypto` のscryptの動作と、OWASPの同等の組み合わせ（N=2^14・r=8・p=5等）での時間とメモリ。
7. 存在するID・存在しないIDの応答時間に差がないこと（存在しないIDでもダミーのハッシュを計算する場合）。
8. 再ハッシュ：古いパラメータのハッシュを検証した直後に、新しいパラメータで置き換えられること。
9. `vitest-pool-workers` 上で、同じWASMがimportでき、検証がテストできること。

### 7-3. 合格の基準（提案）

利用者が承認する前提で、次を合格の基準の案とする。

- パラメータは、案A（OWASP最小）以上であること。案A未満は不合格。
- ログイン1回（検証）のCPU時間が、`limits.cpu_ms`の値に対して十分小さいこと（例：1回あたり500ms以下。目安であり、決定ではない）。
- 100件の一括登録が、`limits.cpu_ms` の設定（最大5分以内）で完了し、全件成功か全件取消の動作が保たれること。
- メモリ使用量が128MBに対して、案Cでも余裕があること（例：WASMのメモリ＋JSヒープが100MB以下）。
- 同時ログイン100件で、エラー（メモリ超過・CPU時間超過）が出ないこと。
- 存在するIDと存在しないIDの応答時間に、有意な差がないこと。
- `argon2id` のWASMが、ビルド（`vite build`／`wrangler deploy --dry-run`）とテスト（`vitest-pool-workers`）の両方で動くこと。

不合格の場合の順序の案：案Cから案B・案Aに下げる → ライブラリを `argon2-wasm-edge`・`@noble/hashes` へ変える → scryptを検討する → それでも収まらなければ、利用者に諮る（初期パスワードだけ軽くする案など）。

## 8. 次に利用者が決めること（質問の素案）

1. ライブラリ `argon2id`（openpgpjs）1.0.1（固定）の追加を承認するか。メンテが止まっている点をどう扱うか。
2. パラメータの下限（案A）と、「基準以上」の度合い（案B・案C）。実測の後に決める。
3. 運用のプランをWorkers Paidとし、`limits.cpu_ms` を引き上げてよいか。
4. 実測で100人が収まらない場合に、初期パスワードだけ軽い方式にすることを認めるか（認めない場合は、`limits.cpu_ms` の引き上げ、または分割のしかたを再検討する）。

## 出典の一覧

1. https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
2. https://developers.cloudflare.com/workers/platform/limits/
3. https://developers.cloudflare.com/workers/runtime-apis/webassembly/
4. https://github.com/Daninet/hash-wasm/discussions/56
5. https://github.com/openpgpjs/argon2id
6. https://www.npmjs.com/package/argon2id（npm registry：版・公開日・ライセンス）
7. https://github.com/Daninet/hash-wasm
8. https://github.com/ComicScrip/hash-wasm-edge
9. https://github.com/paulmillr/noble-hashes
10. https://github.com/imjlk/cloudflare-auth-hasher-template
11. [T-04-password-hash.md](T-04-password-hash.md)（既存の調査。PBKDF2の上限の出典を含む）
