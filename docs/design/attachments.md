# 設計書：メッセージの添付

Issue #140（親：#133）。チャンネル・DMの投稿とスレッドの返信に、画像・文書・動画を添付し、見てよい人だけが取得する（S-05・S-06・S-07）。要件は[1-6](../requirements/01-messaging.md)と1-4 AC-5、決定は[decision-register.md](../requirements/decision-register.md)のC-176。コードは書き写さず、ファイル名・関数名で指す。

## 目的と範囲

- 1-6 AC-1〜AC-3・AC-5〜AC-7・AC-9と1-4 AC-5を実装する（C-137(1)(2)・C-153）。ファイルをアップロードし、中身を検査し、R2に保存し、投稿・返信に結び付け、見てよい人だけに配信する。
- アップロードも配信も、すべてWorkers経由。署名付きURL・`r2.dev`は使わない（C-126）。保存先のキーは応答に出さない。
- ライブラリは追加しない。zipの読み取りとExifの除去は、Workersの標準のAPI（`DecompressionStream`・`DataView`など）で自前で行う（ADR-0011）。
- **作らないもの**：添付だけの投稿（C-137(3)）は #270 の2つ目（次の PR）。添付の削除（1-6 AC-4）は #270 の1つ目で実装した（下の「添付の削除（#270 の1つ目）」。元の記述は残す）。ウイルススキャンは #116。アバターは #141。ファイル名の検索は #155。1-6 AC-8（利用者ごとの容量・回数の制限）は未決定のまま。1-6 AC-10【案】は範囲外。案件の添付の公開範囲の選択・変更は148-B-2で実装した（[cases.md](cases.md)）。編集で添付を足す・外すこと、下書きへの添付もしない。
- **本番に出すときは利用者が行う**：R2バケット（`wrangler.jsonc`の名前は`internal-system-attachments`）の作成、migration 0023・0036の適用、補完のSQLの実行、デプロイ、動画100MBの本番での通り方の確認。バインディング名`ATTACHMENTS`とバケット名は秘密情報ではない。`infra/`に`r2.tf`はまだない。

## データ

| 対象 | 内容 |
| --- | --- |
| `message_attachments`（`backend/db/schema.ts`、migration `0023_add_message_attachments.sql`） | `id`（ULID）・`room_id`（`rooms`）・`thread_parent_id`（NULL可。アップロードの文脈）・`message_id`（NULL可。結び付く前は未投稿）・`uploader_id`・`storage_key`（一意）・`original_name`（1〜255文字のCHECK）・`kind`（`image`・`document`・`video`のCHECK）・`content_type`・`size_bytes`（0より大きいCHECK）・`created_at`。索引は`message_id`、（`uploader_id`, `message_id`）、`created_at`（`message_id IS NULL`の部分索引。掃除用）。【#270の1つ目・migration `0036_add_attachment_deletion.sql`】`deleted_at`・`deleted_by`（`users`を参照）・`purge_failed_at`（いずれもNULL可・既定値なし）の3列と、後始末用の部分索引`message_attachments_deleted_at_idx`（（`deleted_at`, `id`）、`deleted_at IS NOT NULL`）を足した。意味は下の「添付の削除」。【#148の148-B-2・migration `0030_add_attachment_publication_visibility.sql`】`publication_visibility`（NOT NULL・既定`participants_only`・`participants_only`／`public_archive`のCHECK。値の定義元は`shared/attachment-rules.ts`の`PUBLICATION_VISIBILITIES`）を足した。値の意味があるのは案件の部屋の行だけで、ほかの部屋の行は既定値のまま。**読み取りの資格には使わない**（配信・一覧・メッセージの表示は値によらず従来のまま。メッセージの表示の`attachments`にも出さない）。設計は[cases.md](cases.md)の「148-B-2 の設計」 |
| `content_type`にCHECKを付けない理由 | 値`text/plain; charset=utf-8`の「;」でdrizzle-kitの生成が途中で切れ、壊れたmigrationができたため。値はTypeScriptの型と`shared/attachment-rules.ts`の`ATTACHMENT_CONTENT_TYPES`で守る（[ADR-0029](../adr/0029-attachment-delivery-headers-and-content-type-check.md)） |
| `messages` | 変えない。添付は`message_attachments`側から結び付ける |
| R2のキー | `attachments/<ULID>`。名前・利用者を含まない。応答に出さない。バケットは非公開 |
| 一覧の項目`attachments` | `{ id, name, kind, contentType, size }`の配列（ID昇順。キーは含めない）。親・返信・スレッドの親・スレッド一覧のすべての項目に含める。削除済みのメッセージは`[]`。【#270】削除済みの添付（印のある行）も含めない |

- migration 0023は`db:generate`の生成物のまま（新しい表のため、ADR-0024の書き換えは起きない）。**本番のD1への適用は未実施**（利用者が行う）。
- migration 0030（公開範囲の列）は、`db:generate`が作り直しを生成したため、ADR-0024に従って`ALTER TABLE … ADD`に書き換えた。**本番のD1への適用は未実施**（ほかのmigrationとまとめて、利用者の承認の後）。
- migration 0036（削除の3列と部分索引）は、列の追加と索引の追加だけで、`db:generate`の生成物のまま（作り直しは生成されなかった）。既存の行は3列ともNULL（削除されていない）で、古い版は列を読まないため後方互換。**本番のD1への適用は未実施**（利用者が行う。[production-first-rollout.md](../operations/production-first-rollout.md)）。

## 受け付ける値（唯一の定義元）

`shared/attachment-rules.ts`が、画面とサーバーで同じ意味の定義を1か所に持つ。

- 種類（`ATTACHMENT_KINDS`）、Content-Typeの一覧、件数の上限（`MAX_ATTACHMENTS_PER_MESSAGE`＝10）、種類ごとの上限（`ATTACHMENT_SIZE_LIMITS`。画像10MB・文書25MB・動画100MB。MB＝10^6バイト）、合計の上限（`MAX_ATTACHMENT_TOTAL_BYTES`＝200MB）、1回の受信の上限（動画と同じ）、名前の長さ（255文字）。
- 拡張子と種類の対応：jpg・jpeg・png・gif・webp（画像）、pdf・docx・xlsx・pptx・txt・csv（文書）、mp4・webm（動画）。**ここにない拡張子**（SVG・HTML・一般のzip・docm・xlsm・pptm・doc・xls・ppt）は受け付けない。
- `isValidAttachmentName`：改行・「"」・制御文字を含む名前、空の名前、256文字以上は不可。配信のヘッダーを壊さないため。
- `validateAttachmentCandidate`：画面が選んだ直後に使う確認。理由は`type`・`name`・`count`・`total`・`size`。メッセージ全体の制限（件数・合計）を、1ファイルの上限より先に伝える。
- `attachmentIdsSchema`：投稿・返信に付ける添付のID（最大10件・重複なし・ULID）。11件目以降は422。
- サーバーは画面の検査に頼らず、同じ定義で必ず検査する。テストの期待値は定義から作らず、リテラルで書く（`backend/src/lib/attachment-rules.test.ts`）。

## ファイルと役割

### バックエンド

| ファイル | 役割 |
| --- | --- |
| `backend/src/routes/attachments.ts` | Controller。`roomAttachmentRoutes`（通常の投稿用のアップロード）・`replyAttachmentRoutes`（返信用のアップロード）・`attachmentRoutes`（配信）。本文はファイルのバイト列そのまま、元の名前は`X-File-Name`（UTF-8のパーセントエンコード）、大きさは`Content-Length`を`uploadOf`でまとめて渡す。配信の応答ヘッダーを組み立てる。判定は持たない |
| `backend/src/services/attachment.service.ts` | `createAttachmentService`の`uploadToRoom`・`uploadToReply`・`download`。アップロードの判定の順、検査と保存、D1の登録の失敗の補償、配信の判定。`attachmentCleanupJob`（未投稿の掃除のCron）。`withAttachmentService`が認可の部品を組む【#270：`remove`（削除。判定の順は下の「添付の削除」）と`attachmentPurgeJob`（削除済みの後始末のCron）を足した。`AttachmentActor`に任意の`reauthenticatedAt`を足した（削除だけが使う）】 |
| `backend/src/services/attachment-purge.ts`（#270） | 削除済みの添付の後始末の部品。`purgeDeletedAttachments`（R2の実体を消し、成功した行だけ行を消す。R2の失敗は数えてerrorログに残し、失敗の時刻を書いて次の行へ）と、`purgeAttachmentsOfMessage`（そのメッセージの削除済みの添付を後始末する）。`attachment.service.ts`から分けたのは、`attachment.service.ts`が`message.service.ts`を読み込むため、`message.service.ts`の側から使うと循環になるから |
| `backend/src/db/attachment-delete.sql.ts`（#270） | DAO。`deletable`（削除してよい条件を1か所に置く）、`markAttachmentDeleted`（監査・印・索引を1回のbatchで書く）、後始末の読み出し`listPurgeTargets`・`listDeletedOfMessage`、行の物理削除`deletePurgedRow`、失敗の時刻の記録`markPurgeFailed`、読む位置の型`PurgeCursor` |
| `backend/src/db/attachment.repository.ts` | `findVisible`（配信で見てよい添付だけを返す）、`insertPending`、`deletePendingBefore`、`bindAttachments`（結び付けの文）、`loadMessageAttachments`（一覧の`attachments`）、`findForBinding`（結び付けが取り消された後の読み直し）、`translateAttachmentBindError`・`AttachmentBindError`【#270：削除の入口`findForDeletion`・`markDeleted`と、後始末の入口を足し、`loadMessageAttachments`に削除済みを除く条件を足した】 |
| `backend/src/db/attachment-visibility.sql.ts` | `attachmentVisible`。添付を見てよいかの条件。一覧と同じ規則をSQLにしたもの。先頭のコメントと`message.service.ts`の`requireVisible`のコメントで、互いを参照する【#270：削除済みを除く条件を足し、先頭のコメントに「削除済みを出さない7か所」の一覧を書いた】 |
| `backend/src/db/message.repository.ts`・`reply-insert.sql.ts` | 投稿・返信の`db.batch`の末尾に`bindAttachments`の文を足す。一覧・`findItem`が`attachments`を付ける。`thread.repository.ts`もスレッドの親の項目に付ける |
| `backend/src/services/message.service.ts` | `requirePostable`・`requireReplyable`を、アップロードの入口でも使えるよう公開した。投稿・返信が`attachmentIds`を受け取る。`failAttachmentBinding`が、結び付けが取り消された原因を404・409・422に分ける【#270：`requireAttachmentDeletable`（③権限と④部屋の状態）を足した。編集・削除の「部屋が見えるか」「部屋の状態」を、メッセージの編集・削除と共通の内部関数`findModifiableRoom`・`requireRoomModifiable`に分けた（動きは変えない）。`remove`が成功した後に、依存`purgeAttachmentsOf`でそのメッセージの添付の後始末を1回呼ぶ】 |
| `backend/src/lib/attachment-inspection.ts` | `inspectAttachment`。中身で形式を判定し、拡張子と一致するものだけを許可する。Content-Typeは固定の一覧から付ける |
| `backend/src/lib/ooxml-check.ts` | `checkOoxml`。docx・xlsx・pptxのzip構造を自前で確かめる（中央ディレクトリとローカルヘッダーの突き合わせ。`[Content_Types].xml`は下の`readContentTypes`で読む） |
| `backend/src/lib/content-types-xml.ts` | `readContentTypes`。`[Content_Types].xml`を、汎用のXMLの読み取りではなく、決まった形だけを受け付ける厳しい読み取りで読む。形が違えば`null` |
| `backend/src/lib/exif-strip.ts` | `stripExif`。位置情報を含みうるメタデータの入れ物を、画素を変えずに取り除く（JPEGはAPP1〔Exif・XMP〕とAPP13、PNGは`eXIf`・`tEXt`・`zTXt`・`iTXt`のすべて、WebPは`EXIF`・`XMP `とVP8Xのフラグ）。GIFは何もしない。壊れた構造は例外 |
| `backend/src/lib/content-disposition.ts` | `contentDisposition`。ASCIIに置き換えた`filename`と`filename*=UTF-8''…`を組み立てる |
| `backend/src/lib/byte-range.ts` | `parseByteRange`。正しい単一の範囲だけを返し、それ以外は`null` |
| `backend/src/lib/security.ts`・`session-middleware.ts` | 配信の応答の`Content-Security-Policy`と`Cache-Control`を、アプリ全体のヘッダーが上書きしないようにする（[ADR-0029](../adr/0029-attachment-delivery-headers-and-content-type-check.md)） |
| `backend/src/index.ts` | 3つのルートの登録（`/api/rooms`・`/api/messages`・`/api/attachments`）と、`createScheduledHandler`への`attachmentCleanupJob`の登録。機能間の参照は`index.ts`だけ【#270：`attachmentPurgeJob`も登録した。Cronの式は同じ`17 18 * * *`で、`wrangler.jsonc`は変えていない】 |
| `wrangler.jsonc`・`worker-configuration.d.ts` | R2のバインディング`ATTACHMENTS`（バケット`internal-system-attachments`）。Cronの式は既存の毎日UTC 18:17のまま、掃除が相乗りする。型は`npm run types`で作り直す |
| `backend/db/seeds/cleanup.sql` | `messages`・部屋・利用者を消す前に`message_attachments`を消し、残数`remaining_message_attachments`を返す。R2の実体は消さない（テストの手順が手元の保存先から消す） |
| `docs/api/openapi.json`、`backend/src/openapi.test.ts` | 3つのエンドポイント、`AttachmentItem`、投稿・返信の`attachmentIds`、メッセージの`attachments`。実装との一致を確かめる【#270：`DELETE /api/attachments/{attachmentId}`（204・401・403・404・409・422）を足した。`openapi.attachment-delete.test.ts`】 |
| `backend/src/lib/audit-actions.ts`・`backend/src/routes/attachments.ts`・`backend/db/schema.ts`・`backend/db/scripts/mark-attachments-of-deleted-messages.sql`（#270） | 監査の種類`attachment.delete`、`DELETE`のルート（`noStore`・ULIDの`param`の検証。判定は持たない。`reauthenticatedAt`を`principal`から渡す）、3列と部分索引、既存データの補完のSQL（下の「補完のSQLと件数の確かめ方」） |

### フロントエンド（`frontend/src/features/messages/`と共通部品）

| ファイル | 役割 |
| --- | --- |
| `frontend/src/components/FileInput.tsx` | 共通のファイル選択欄。ラベルを結び付け、選んだ後に値を空に戻す（同じファイルを続けて選べる）。形式の確認は使う側が行う |
| `components/AttachmentPicker.tsx` | 選択の窓口。選んだ直後に`validateAttachmentCandidate`で確かめ、受け付けたものだけを一覧に渡す。拒否したファイルは名前と理由を出す |
| `components/AttachmentList.tsx` | 送信前の一覧。元の名前・サイズ（MB）・取り消すボタン。サイズの整形は`format-size.ts`を使う |
| `format-size.ts` | `formatAttachmentSize`。大きさをMB（10^6バイト・小数1桁）で整形する。送信前の一覧と、案件の添付の一覧（`features/cases`の`CaseAttachments.tsx`。`index.ts`経由）で同じ形にそろえるため、`AttachmentList.tsx`の中から移した（【#148の148-B-1】）。`index.ts`は`attachmentUrl`・`formatAttachmentSize`も公開する |
| `components/MessageAttachments.tsx` | メッセージの添付の表示。画像は`<img>`、動画は`<video controls>`、そのほかはダウンロードのリンク。URLはIDから`attachmentUrl`で組み立てる【#270：任意のprops`owner`を受け取ったとき、各添付に「〈名前〉を削除」のボタンを付け、押すと`DeleteAttachmentDialog`を出す】 |
| `components/DeleteAttachmentDialog.tsx`（#270） | 添付の削除の確認のダイアログ（作りは`DeleteMessageDialog.tsx`と同じ）。「削除する」で再認証（必要なら）を挟んで送る。送信中は押せず、閉じない。失敗はダイアログの中に出し、表示を変えない |
| `hooks/useDeleteAttachment.ts`（#270） | 削除の送信。再認証（`withReauth`）が完了しなければ要求を送らず`NotSentError`にする。成功したら、再読み込みなしで表示から外す（下の「画面の更新」）。`features/cases/keys.ts`の`caseKeys.all`も取り直す |
| `hooks/replace-room-message.ts`（#270） | `replaceThreadParent`を足した（スレッドのキャッシュの親を書き換える。開いていなければ何もしない）。既存の`replaceCachedMessage`の動きは変えていない |
| `features/cases/keys.ts`（#270） | 案件のキャッシュのキー`caseKeys`だけの公開の入口。`features/cases/index.ts`は`messages`の部品を読み込むため、`messages`から`index.ts`を参照すると循環になる。検索の`features/search/keys.ts`と同じ理由で、キーだけを分けて公開した |
| `components/MessageComposer.tsx` | 投稿欄・返信欄。添付を選んだ順に持ち、送信時に`usePostMessage`へ渡す。送信中は「送信を取り消す」で`AbortController`を中断する。失敗・取り消しでは投稿せず、一覧と本文を残す。添付は下書き（`features/drafts`）に保存しない |
| `components/MessageItem.tsx` | 本文の下に`MessageAttachments`を置く【#270：自分の投稿（`canModify`）で、削除されていないときだけ`owner`を渡す】 |
| `hooks/usePostMessage.ts` | 添付があれば1件ずつアップロードし、全部成功してから`attachmentIds`（選んだ順）を付けて投稿する。失敗したら`AttachmentUploadError`（失敗したファイル名つき）で失敗にし、投稿しない |
| `api/message-api.ts` | `uploadAttachment`（部屋用・返信用の入口を`AttachmentTarget`で切り替える。`ATTACHMENT_UPLOAD_TIMEOUT_MS`の個別の時間切れ）、`attachmentUrl`、`attachmentSchema`（zod。`attachments`は必須）【#270：`deleteAttachment`（`DELETE`。成功は204）を足した】 |
| `hooks/useDeleteMessage.ts` | 削除の結果の組み立てに`attachments: []`を足した |

## アップロードの流れ

2つの入口がある。お知らせ専用チャンネルの扱いが、通常の投稿と返信で違うため。

| 入口 | 部屋・親の判定 | 行の`thread_parent_id` |
| --- | --- | --- |
| `POST /api/rooms/:roomId/attachments`（EP-1-09。通常の投稿用） | `message.service.ts`の`requirePostable`と同じ。参加していない公開チャンネル・お知らせ専用で権限がない・アーカイブ・DMの相手が無効などは、投稿と同じ403・409 | NULL |
| `POST /api/messages/:messageId/replies/attachments`（返信用） | `requireReplyable`と同じ。親が見えない・返信が親・404、参加していなければ403、部屋の状態で409。**お知らせ専用でも、参加者なら添付できる** | 親のメッセージのID |

判定の順（`attachment.service.ts`の先頭のコメントと同じ。この順を変えない。**本文は、すべての判定の後に読む**）。

1. 共通のゲート：未ログインは401、初回パスワードの変更が要るときは403（`PASSWORD_CHANGE_REQUIRED`）。
2. 部屋・親の判定（上の表）。見えない・存在しないは404。
3. `perm.attachment.upload`の認可。拒否は403で、`authorize`が監査ログに残す。
4. ヘッダーの確認（422）：`X-File-Name`が読めて有効な名前か、拡張子が許可されているか、`Content-Length`があるか、種類ごとの上限と1回の受信の上限を超えていないか。ここまでは**本文を1バイトも読まない**。
5. 本文を読んで形式を検査し（422）、保存する。
6. D1に未投稿の行（`message_id`がNULL）を登録する。応答は201で`{ id, name, kind, contentType, size, publicationVisibility }`（【#148の148-B-2】`publicationVisibility`は案件の部屋なら値、ほかの部屋は`null`。OpenAPIでは新しい定義`UploadedAttachmentItem`で、メッセージの表示の`AttachmentItem`とは分けた）。
   - 【#148の148-B-2】4の後に**公開範囲の確認（422）**を足した（`attachment.service.ts`の`checkPublication`）。クエリ`publicationVisibility`は任意で、指定なしは`participants_only`。一覧にない値、または案件の部屋でない部屋での指定（`participants_only`でも）は422（`fields: ["publicationVisibility"]`）。部屋の判定（2）の後なので、部屋に入れない人には404が先。部屋が案件専用チャンネルかは、`requireRoom`が`message.service.ts`の`requirePostable`・`requireReplyable`の戻り値`caseRoom`から受け取る
   - 【#148】登録は**保存の時点の資格を条件にした`INSERT … SELECT … WHERE`**（`attachment.repository.ts`の`insertPending`。登録した行数を返す）。2の判定の後、ファイルの受信中に案件の終了・参加の解除・無効化があっても、未投稿の行を残さない。条件は部屋の種類によらない1つ：チャンネルは未アーカイブで、アップロードした人が有効な参加者、案件専用チャンネルなら案件が進行中（`caseRoomOpen`）／DMは当事者で、当事者に無効な社員がいない／返信への添付は、親が同じ部屋のトップレベルの投稿で削除されていない。通常のチャンネル・DMも同じ条件で登録する（行が残らないことの退行テストがある）
   - 【#148の148-B-2】`insertPending`は、位置合わせの`INSERT … SELECT`をやめ、**列の名前を明示した`INSERT`**に直した（表に列が足されても値がずれない。`publication_visibility`を名前で足した）。`PendingAttachmentInsert.publicationVisibility`は必須。条件に「参加者限定以外は案件専用チャンネルだけ」を足した（Serviceの422との二重の守り）
   - 条件への追加（コードレビュー1回目の重大への対応）：部屋への添付は、お知らせ専用で部署のあるチャンネルなら、その部署のオーナーか全体管理者だけ（`channel-member.sql.ts`の`announcementPostable`。投稿と同じ）。返信への添付は、部屋の部署が有効なこと（部署なしは有効。返信と同じ）
   - **2の判定が見る、DBの行で決まる条件（部屋の存在と可視・未アーカイブ・閲覧者が有効・参加中・案件が進行中・DMの相手が有効・お知らせ専用の投稿の資格・返信の親〔存在・同じ部屋・トップレベル・未削除〕・返信先の部署の有効性）と、この登録の条件は一致させる**。ロールで決まる権限（`perm.*`）はDBの行にないので、2の判定だけ
   - 0行のときは、保存した実体を消し、2の判定（`requireRoom`。部屋の判定は事前と同じ関数）を読み直して404／403／409にする。どれにも当たらなければ成功にせず409
   - 2の判定には、案件専用チャンネルの`perm.case.post`（403）と、終了中の409「終了した案件には添付できません」が加わる（C-184(5)(7)）

保存の方式は、種類で分かれる。

| 種類 | 方式 |
| --- | --- |
| 画像・文書 | `readAll`でメモリに読み込む（`Content-Length`を超えたら途中で止めて422）。`inspectAttachment`で検査し、画像は`stripExif`でメタデータを除いてから`put`する。応答の`size`は除いた後のバイト数。メタデータの除去で構造が壊れていると分かった画像は422 |
| 動画 | 先頭4KBを読んで検査し、残りを`FixedLengthStream`で流して`put`する。受信したバイト数が`Content-Length`と違えば、保存物を消して422。受信側・保存側のどちらが失敗しても、もう片方を止め、保存した実体を削除してから、エラーを返す |

- 形式は拡張子ではなく中身で判定し、**拡張子の種類と中身が一致するものだけ**を許可する。JPEG・PNG・GIF・WebP・PDF・MP4・WebM（Matroskaは拒否）・テキスト/CSV（UTF-8で正しく、NULを含まない）・docx/xlsx/pptx。SVG・HTMLは拡張子の段階で拒否する。
- Office新形式の検査（`ooxml-check.ts`、C-153と決定記録C-176）：
  - zipの末尾の構造から中央ディレクトリを読み、各エントリの**ローカルヘッダーと突き合わせる**。名前・圧縮方式・サイズの食い違い、どちらかのサイズ欄が`0xffffffff`、どちらかのZIP64の拡張情報、範囲外は拒否。**データ記述子（汎用フラグのbit3）を使うエントリは許可し、その場合はサイズの突き合わせだけを省く**（Java製のツールなどが出す正当なOfficeファイルで使われるため。統括の決定）。
  - `[Content_Types].xml`は、`content-types-xml.ts`の`readContentTypes`で読む。**決まった形だけを受け付ける**（統括の決定。C-176）。
    - 受け付ける形：XML宣言（任意）→根の要素`Types`（content-typesの名前空間。接頭辞つきでもよい）→直下に`Default`・`Override`だけ（空要素、または中身のない開始・終了の組）。コメントと空白は読み飛ばす。属性の値は二重引用符・単一引用符、順は問わない。
    - 拒否するもの：ほかの要素、3段以上の入れ子、子の中の文字、根の要素以外での名前空間の宣言（子の接頭辞つき属性・解決できない接頭辞を含む）、終了タグの名前の不一致、DOCTYPE・CDATA・処理命令（XML宣言を除く）、属性の重複、値に`<`・`&`を含む属性、根の要素の後ろの余分な内容、閉じていない構造、名前空間の宣言が17個以上（根の要素だけで、既定の`xmlns`を含めて16個まで）。
    - 作り方：先頭から1回だけ進み、位置を戻さない（正規表現で探し直さない）。保持するのは根の名前空間の対応と子の要素の一覧だけで、入れ子のスタックは持たず、処理量は入力の長さに比例する。
    - BOMは、呼び出し側の`TextDecoder`（UTF-8）が取り除く。XML宣言の前の空白は拒否する（宣言のない文書の、根の要素の前の空白は許す）。
    - XML 1.0との小さな違い：コメントの中の`--`を拒否していない。名前に使える文字を、英数字と`_`・`.`・`-`（接頭辞の区切りの`:`）に絞っている。
  - エントリ数は10,000まで。展開後は1MBまで（ヘッダーの申告を信じず、展開しながら数える）。`vbaProject.bin`を含むものは拒否、`embeddings/`は許可。暗号化・ZIP64・複数ディスクのzipは拒否。壊れたzipは「形式が正しくない」という判定で、例外にしない。
- Content-Typeは、この検査の結果（固定の一覧）からだけ付ける。テキストとCSVは、どちらも`text/plain; charset=utf-8`。
- 画像のメタデータは「位置情報を含みうるものは残さない」を原則に、入れ物ごと除く（上の`exif-strip.ts`の表のとおり）。
- 元の名前は`original_name`にそのまま保存し、キーには含めない。

### D1の登録の失敗の補償

R2への`put`はD1の`batch`の外で行う。そのため、保存と登録がずれうる。

- 行の`INSERT`が失敗したら、今回保存した実体の`delete`を試み、**そのあと元のエラーを再送出する**（成功として扱わない）。`delete`が失敗したらerrorログに残し（キー・名前は出さない）、元のエラーを優先する。
- 動画のストリームの失敗（バイト数の不一致・受信側の失敗・`put`の失敗）も、受信側・保存側のもう片方を止め（`stopBoth`）、保存物を消してから投げ直す。**止める操作そのものが失敗しても、元のエラーの応答は変えず、errorログに残す**（キー・名前は出さない）。
- どの行にも結び付かない実体が残りうるのは、補償の`delete`も失敗した場合だけ。ログで分かるようにしてあり、定期の照合はこのIssueの範囲外。

## 結び付け（投稿・返信）

投稿・返信の入力に`attachmentIds`（最大10件・重複なし）を足した。経路は、`MessageComposer.tsx`→`usePostMessage.ts`→`message-api.ts`→`routes/messages.ts`→`message.service.ts`（`post`・`postReply`）→`message.repository.ts`の`insertIfOrdered`・`reply-insert.sql.ts`の`insertReplyIfOrdered`。

- `bindAttachments`が返す2つの文を、メッセージの条件付き`INSERT`と**同じ`db.batch`**に入れる。1つ目は未投稿の添付の`UPDATE`。条件は、IDが指定のもの・アップロードした本人・同じ部屋・`message_id IS NULL`・同じ文脈（通常の投稿は`thread_parent_id IS NULL`、返信は`thread_parent_id`が親のID）。**返信用の添付は、同じ親の返信にしか付けられない**（お知らせ専用チャンネルの投稿権限を、返信用の入口で回避させないため）。
- 2つ目は、結び付いた件数が指定と同じで、10件以内・合計200MB以内かを確かめる。合わなければ`messages.room_id`を`NULL`にして`NOT NULL`の違反を起こし、batch全体を取り消す（D1のbatchは1つのトランザクション。メッセージも作られない）。`translateAttachmentBindError`がこの違反だけを`AttachmentBindError`にし、ほかのエラーは変えない（`docs/project-rules.md`の`db.batch`の前提の確認）。
- 取り消されたら、`message.service.ts`の`failAttachmentBinding`が添付の行を読み直し、原因を分ける。
  1. 他人の・別の部屋の・別の文脈の・存在しない添付 → 404
  2. 使用済み → 409
  3. 合計が200MBを超える → 422（`fields: ["attachmentIds"]`）
  4. どれにも当たらない（読み直すまでに別の操作で状態が変わった） → 409「添付の状態が変わりました。もう一度お試しください」
- 投稿・返信の既存の判定（見える・参加・権限・部屋の状態）が先で、添付の判定は後。IDの作り直しの再試行（`insertWithAttachments`が各試行を包む）でも同じ。
- `perm.attachment.upload`は結び付けでは確かめない（アップロードのときに確かめ済み。結び付けは本人・部屋・文脈の一致で守る）。
- 【#155 の155-B（2026-11-21）】結び付けの batch の末尾（メッセージの索引の組の後ろ）に、添付のファイル名の索引の組（`search-index.sql.ts`の`syncAttachmentIndexStatements`）がある。結び付けが取り消されれば、索引も残らない。メッセージの論理削除（`deleteIfModifiable`）の末尾には`removeStaleAttachmentIndexStatements`がある。アップロード（`insertPending`）・未投稿の掃除（`deletePendingBefore`）・公開範囲の変更（`changeVisibility`）は索引に触れない。**#270（添付の削除。実装済み）など、今後`message_attachments`を変える処理を足すときは、同じ batch の末尾に索引の組を足す**（添付の削除は、`markAttachmentDeleted`の末尾に`removeStaleAttachmentIndexStatements`を足した）。添付を別のメッセージへ付け替える処理を足すときは、組だけでは足りない（同期の順で索引が欠けるため、添付の ID を基準にした古い写しの整理と、逆順の試験が要る）（[search.md](search.md)の「添付の書き込みの経路」）

## 配信

`GET /api/attachments/:attachmentId`（EP-1-10）。

判定の順。

1. 共通のゲート（401・初回パスワードの変更403）。IDの形が不正なら422（`validate`。判定より前）。
2. `findVisible`：`attachment-visibility.sql.ts`の条件で、見てよい添付だけを引く。**見えない・存在しない・メッセージが削除済み・他人の未投稿の添付は、すべて同じ404**（存在を漏らさない）。
3. DMの添付なら、`perm.dm.message.view`の認可（メッセージの一覧と同じ。拒否は403）。
   - 【#297】一覧の`attachments`を読む`loadMessageAttachments`は、閲覧者を必須で受け取り、`messageViewableBy`の条件で、本文の読み取りの後に資格を失った部屋の添付の情報を返さない（[cases.md](cases.md)）。
   - 【#294で直した】`findVisible`の「DMの添付かどうか」（`isDirect`）が、DMが1件でもあると真になり、チャンネルの添付でもDMを見る権限を求めていた（拒否しすぎる側）。列を入れ子のSQLとして渡し、内側の表に別名を付ける形に直した（C-185、`docs/project-rules.md`）。
   - 【#148】案件専用チャンネルの添付なら、`perm.case.view`の認可（R-64。拒否は403）。`findVisible`が案件の添付か（`isCase`）も返す。終了した案件でも、参加者は取得できる（結合のテスト。C-184(9)）
4. `perm.attachment.download`の認可（拒否は403。監査ログに残る）。
5. `parseByteRange`で`Range`を解釈し、R2から読む。実体がなければ404（500にしない）。

見えるかの条件（`attachmentVisible`。メッセージ一覧と同じ規則）。

| 部屋 | 条件 |
| --- | --- |
| チャンネル | 未アーカイブで、公開（参加していなくても。C-94）か、見る人が参加している非公開（#147の147-C-1：「参加している」は有効な参加者。`attachment-visibility.sql.ts`が`roomViewableBy`（`activeChannelMember`と同じ規則）で判定する。[cases.md](cases.md)） |
| DM | 見る人が当事者 |
| 投稿に結び付いた添付 | 加えて、メッセージが削除されていない（`messages.deleted_at IS NULL`） |
| 未投稿の添付 | アップロードした本人だけ |

- 毎回判定する（参加を外された直後の取得は404）。**メッセージが削除されたら、その添付は404**。【#270】**削除された添付も404**（`attachmentVisible`が削除済みを除く）。R2の実体は、削除の後に消す（下の「ファイルの実体の削除」）。元の「R2の実体は#270まで残る」は置き換えた。
- 応答ヘッダー（`routes/attachments.ts`）：`Content-Type`はサーバーの検査の結果、`Content-Disposition`は画像・動画が`inline`でそれ以外が`attachment`（元の名前は`filename`と`filename*`）、`X-Content-Type-Options: nosniff`、`Content-Security-Policy: default-src 'none'; sandbox`、`Cross-Origin-Resource-Policy: same-origin`、`Cache-Control: private, no-store`、`Accept-Ranges: bytes`。
- **Range**：正しい単一の範囲（`a-b`・`a-`・`-n`。終わりがサイズを超えたらサイズ-1に丸める）だけ、206と`Content-Range: bytes a-b/size`を返す。`bytes=`以外の単位・書式の誤り・複数の範囲・満たせない範囲は、**Rangeを無視して200で全体を返す**（RFC 9110 14.2が許す。416は返さない。`AppError`に416に当たるコードがなく、足すとAPI全体の規則の変更になるため）。1-6 AC-7のシーク再生は、正しい範囲で満たす。api-draftの`416`の案は、この実装では使わない。

## 未投稿の掃除

- `attachmentCleanupJob`（`attachment.service.ts`）を、`index.ts`の`createScheduledHandler`に登録した。既存の毎日UTC 18:17（日本時間03:17）の式に相乗りする（`wrangler.jsonc`の式は変えていない）。
- 24時間を過ぎた未投稿の行を、条件付きの`DELETE`（`message_id IS NULL AND created_at < 境界`。`deletePendingBefore`）で**先に**消し、消せた行のキーだけR2から消す。結び付いた行は条件で消さない。
- 実体の削除に失敗しても、定期実行の全体は失敗にしない。失敗ごとにerrorログに残し（キー・名前は出さない）、終了時にinfoログで、消した行数と失敗した実体の数を残す。

## 画面の流れ（S-05・S-06・S-07）

1. 投稿欄・返信欄に「ファイルを添付」を出す（`AttachmentPicker`→`FileInput`。複数選択）。選んだ直後に`validateAttachmentCandidate`で確かめ、超えたファイルは名前と理由を出して一覧に入れない。
2. 送信前の一覧（`AttachmentList`）に、元の名前・サイズ・取り消すボタンを出す。
3. 送信すると、`usePostMessage`が1件ずつアップロードする。投稿欄は通常の投稿用、返信欄は返信用の入口（`AttachmentTarget`）。アップロードの要求だけ、個別の時間切れ（`ATTACHMENT_UPLOAD_TIMEOUT_MS`＝10分。共通の10秒では大きな添付が途中で切れるため）を設定する。
4. 全部成功してから、`attachmentIds`を付けて投稿する。成功したら入力欄と一覧を空にし、一覧を取り直す。
5. 失敗・時間切れでは投稿せず、失敗したファイル名と理由を出す。「送信を取り消す」は、**アップロード中だけ**出す（投稿の要求を送った後は取り消せない）。取り消すと、取り消したことだけを伝え、投稿しない。どちらも一覧と本文は残る。
6. メッセージの表示は`MessageAttachments`。画像は`<img>`、動画は`<video controls>`、そのほかはダウンロードのリンク。ファイル名は文字として出す。アプリのCSP（`public/_headers`）は変えない（`img-src 'self'`・`default-src 'self'`で表示できる）。

## 添付の削除（#270 の1つ目）

Issue #270 を2つのPRに分けた（利用者の決定。決定記録C-204）。1つ目（このPR）が、投稿・返信に付けた**自分の添付を1件ずつ削除する**こと（1-6 AC-4）。2つ目（添付だけの投稿・本文を空にする編集・本文のない投稿の最後の添付の扱い）は次のPR。**このPRの時点では、本文のない投稿は作れない**（本文の検査と`messages.body`のCHECKが空を断る）ので、添付を全部消しても、本文のある投稿が残るだけ。

- **作るもの**：EP-1-11 `DELETE /api/attachments/:attachmentId`（204）、削除の印の3列、削除済みを出さない7か所、R2の実体の削除（要求の中で1回・毎日の定期の処理で再試行）、メッセージの削除が添付にも印を付けること、画面の削除の操作、既存データの補完のSQL。
- **作らないもの**：他人の添付の削除（R-34。全ロール初期値で不可。経路を作らず、403と監査）／未投稿の添付の削除（送信前の一覧の取り消しと24時間の掃除のまま。この入口では409）／削除の取り消し・復元（C-127。戻せない）／自動の期限削除（C-74）。
- 応答の形：成功は204。失敗は401・403（`FORBIDDEN`・`FORBIDDEN_ORIGIN`・`REAUTH_REQUIRED`・`PASSWORD_CHANGE_REQUIRED`）・404・409・422。新しいエラーコードは足していない。契約は`docs/api/openapi.json`。

### 判定の順（`attachment.service.ts`の`remove`。この順を変えない）

| 順 | 確かめること | 断るとき | 理由 |
| --- | --- | --- | --- |
| 0 | 共通のゲート（未ログイン・初回パスワードの変更）と、IDの形（`validate`） | 401・403`PASSWORD_CHANGE_REQUIRED`・422 | 判定より前 |
| ① | 見えるか（`findForDeletion`。`attachmentVisible`の条件） | 404 | 見えない部屋・存在しない・**削除済み**・メッセージが削除済みを区別しない（存在を開示しない） |
| ①' | 投稿に結び付いているか | 409「送信前の添付は、送信前の一覧で取り消してください」 | 未投稿の添付は、この入口では消さない |
| ② | アップロードした本人か | 403。`logger.audit`に`attachment.delete`・失敗・`not_author` | 他人の添付の削除は、どのロールでも不可（R-34） |
| ③ | `perm.attachment.delete.own`（`message.service.ts`の`requireAttachmentDeletable`） | 403（`authorize`が監査に残す） | 権限は3つの役割すべてが持つが、認可は毎回行う |
| ④ | 部屋の状態（同じ`requireAttachmentDeletable`）。DMは`perm.dm.message.view`、チャンネルは参加していること（未参加は403・監査`not_member`）、案件の部屋は`perm.case.post`と進行中（終了中は409・監査`case_closed`）、部署が無効なら409、DMの相手が無効なら409 | 404・403・409 | メッセージの削除と同じ規則（編集・削除の共通の内部関数`findModifiableRoom`・`requireRoomModifiable`）。お知らせ専用の投稿権限は問わない（今参加している本人なら消せる。C-171 U-3と同じ） |
| ⑥ | 再認証（`assertRecentReauth`） | 403`REAUTH_REQUIRED` | **最後に置く**。断られる操作でパスワードを入力させないため（C-171(2)と同じ。①〜④で断られるときは、再認証より先にその応答になる） |
| ⑦ | 書き込み（下の1回のbatch） | 0行なら読み直し（下） | 確認から書き込みまでの間の変化を、SQLの条件で拾う |

⑥・⑦の番号は、メッセージの削除の判定の順（[message-edit-markdown.md](message-edit-markdown.md)）の⑥再認証・⑦書き込みに合わせた（⑤は欠番。添付の削除の①〜④は、メッセージの削除の①〜⑤とは対応しない。「削除済みなら409」の段は、削除済みの添付が①で404になるため、ない）。

### 書き込み（`attachment-delete.sql.ts`の`markAttachmentDeleted`）

1回の`db.batch`で、次の3つの文を、この順に書く。

1. 監査`attachment.delete`（成功。対象の種類`attachment`。`detail`は`roomId`・`messageId`だけで、ファイル名・本文を入れない）。**UPDATEの前に置く**（UPDATEの後は条件が偽になるため。メッセージの削除と同じ）
2. `message_attachments`の`deleted_at`・`deleted_by`を書くUPDATE
3. 末尾に、検索の索引の組`removeStaleAttachmentIndexStatements`（削除が確定したときだけ、ファイル名の写しが消える。拒否なら残る）

- **条件は`deletable(attachmentId, userId)`の1か所**で、1と2の両方に同じ条件を置く（`onlyWhen`とWHERE）。添付が存在し、削除されておらず、投稿に結び付き、アップロードしたのが本人で、結び付いたメッセージが同じ部屋にあり、メッセージが`message-modify.sql.ts`の`modifiable`（本人の投稿・未削除・部屋に書き込める）を満たす。`modifiable`は、メッセージのIDを値か外側の行の列で受けられるように広げた
- **前提の確かめ方**：[#196の`CASE WHEN … NULL`の形](../project-rules.md)は使わない。確かめたい事実が「いま削除してよいか」の1つで、それ自体を書き込みの条件と監査の条件に置けば、確認から書き込みまでの変化を同じbatchの中で拾えるため。存在しない行へのUPDATEは0行で失敗しないので、先頭に確かめの文を足しても、後ろの文から条件を外せない。末尾の不変条件は、この1つ目にはない（2つ目で「本文が空なら添付が1件以上」を足すときに#196の形を使う）
- **戻り値**：主のUPDATEの`meta.changes`（1か0）。末尾に索引の文があるため、**積んだ位置を保持して読む**（`updateAt`。155-Cの`buildEditStatements`と同じ。末尾からの添字では読まない）。索引の文の件数は使わない
- **0行のとき**：`remove`が①〜④を読み直し、理由があればその応答（404・403・409）にする。理由が分からなくても成功にせず、409「状態が変わったため、削除できませんでした」にする。書き込みはやり直さない
- batchの中では、R2を呼ばない（D1の外の操作を混ぜない）。batchが失敗したら、印・監査・索引のどれも残らず、R2も呼ばない。元のエラーをそのまま投げる

### 削除済みの添付を出さない7か所

削除済みの添付（`deleted_at`が入った行）は、画面・配信・一覧・検索のどこにも出さない。条件`deleted_at IS NULL`は次の7か所にある。**`message_attachments`を読む処理を足すときも、同じ条件を足す**（`attachment-visibility.sql.ts`の先頭のコメントにも同じ一覧がある）。

| # | 場所 | 出さない対象 |
| --- | --- | --- |
| 1 | `attachment-visibility.sql.ts`の`attachmentVisible` | 配信（EP-1-10）・削除の①・案件の添付の公開範囲の変更の見える判定 |
| 2 | `attachment.repository.ts`の`loadMessageAttachments` | メッセージ一覧・1件・スレッドの親と返信・スレッド一覧の`attachments` |
| 3 | `case-attachment.repository.ts`の`listCaseAttachments` | 案件の添付の一覧（EP-5-19） |
| 4 | `case-attachment.repository.ts`の公開範囲の変更（1の条件を通す） | 削除済みは404 |
| 5 | `search-index.sql.ts`の`staleAttachmentDocuments`・`syncAttachmentIndexStatements` | 索引（削除済みは古い写しとして消し、入れない。`reindexMessages`の登録し直しでも出ない） |
| 6 | `search.repository.ts`の添付の行の結合 | 検索の結果（索引が遅れても出さない） |
| 7 | `backend/db/seeds/cleanup.sql` | 変更は要らない（削除済みの行も同じ条件で消える。`cleanup-sql.attachment-delete.db.test.ts`で確かめた） |

`bindAttachments`は未投稿（`message_id IS NULL`）だけを結ぶので、削除済み（必ず結び付き済み）には触れない。変えていない。

### ファイルの実体の削除

順は「**印（`deleted_at`）→ R2の実体 → 行の物理削除**」。未投稿の掃除（行を先に消す）とは逆にした。行を先に消すと、R2の削除に失敗したときにキーが失われ、再試行できないため。

- **部品**（`attachment-purge.ts`の`purgeDeletedAttachments`）：行ごとにR2の`delete`→成功したら`deletePurgedRow`で行を消す（条件は`deleted_at IS NOT NULL`。要求の中の削除と定期の処理が重なっても、片方が0行になるだけ）。**R2の失敗**は、数えて（`failedObjects`）errorログに残し（キー・名前は出さない）、`markPurgeFailed`で失敗の時刻（`purge_failed_at`）を書いて、次の行へ進む。この時刻の書き込みの失敗も、主の結果を変えずにerrorログに残す（後始末に付随する失敗）。**D1の行の削除の失敗は投げる**
- **始める場所は3つ**で、同じ部品を使う：
  1. `remove`の中。batchの成功の後に、その1行を1回試す。失敗しても応答は204（errorログに残し、次の定期の処理が消す）
  2. メッセージの削除の中（下の「メッセージの削除との関係」）
  3. `attachmentPurgeJob`（Cron）
- **定期の処理**（`attachment.service.ts`の`attachmentPurgeJob`）：既存の毎日UTC 18:17（日本時間03:17）の式に相乗りする（`wrangler.jsonc`は変えていない）。
  - **読む順**：失敗したことのない行（`purge_failed_at IS NULL`）を`(deleted_at, id)`の昇順で**先に**、その後に失敗したことのある行を`(purge_failed_at, id)`の昇順（失敗が古い順）で読む。1ページ100行（`PURGE_PAGE_SIZE`）、1回の実行で試す行は500行まで（`PURGE_LIMIT_PER_RUN`。失敗した行も数える）。上限で止めたら、残りは次の回（翌日）に先頭から読む
  - **同じ実行で2回試さない仕組み**：次のページは「直前のページの最後の位置より後」（`PurgeCursor.after`。読んだときの値で決める）で読み、先頭から読み直さない。失敗したことのある行は、**実行の開始の時刻（`failedBefore`）より前に失敗した行だけ**を読む。この実行の中で失敗を書いた行の時刻は開始以後になるので、同じ実行の後ろのページで読み直されない
  - **この読む順にした理由**：初めの案（毎回先頭から`(deleted_at, id)`で読み、失敗した行も500行の枠に数える）では、失敗し続ける行が先頭の500件を占めると、後ろの削除可能な行が試されなかった（コードレビュー1回目の重大の指摘）。失敗の時刻を記録し、失敗したことのない行を先に読む形にして、失敗し続ける行が後ろの行を止めないようにした。失敗した行は、失敗のたびに時刻が新しくなって後ろへ回るので、次の回は別の行を先に試す。部分索引`message_attachments_deleted_at_idx`は、失敗したことのない行を`(deleted_at, id)`で読むためのもの。失敗した行は少ない前提で、その並べ替えは索引に頼らない
  - **終わりのログ**：infoで、読んだ行数・消せた行数・R2の失敗の数・上限で止めたか（`reachedLimit`。続きの行が1行以上あるか）。キー・名前は出さない
- **べき等**：何度実行しても同じ結果になり、成功すると行もなくなる。R2の`delete`は存在しないキーでも例外にならない（Miniflareで確認。本物のR2では未確認で、#160）
- **物理削除にした理由**：削除した添付の情報は画面・APIで使わず、誰がいつ消したかは監査に残る。`purged_at`の列で残す案は、使わない行と列が増える
- **途中で失敗したときの状態**：

| 失敗の場所 | 状態 | 回復 |
| --- | --- | --- |
| 書き込みのbatch | 何も変わらない。R2も呼ばない | 利用者が再試行 |
| batchの成功の後、R2の`delete` | 行は削除済みで見えない。`purge_failed_at`が入る | 次の定期の処理が試す |
| R2の成功の後、行の削除 | 実体はない。行は削除済みで残る | 次の定期の処理（無いキーの`delete`は成功）で行を消す |

### メッセージの削除との関係

メッセージを削除すると、その添付もすべて削除済みになる。

- `message-modify.sql.ts`の`deleteIfModifiable`のbatchに、添付に印を付けるUPDATEを足した（`message_id`が対象・まだ印がない・`modifiable`を満たす）。順は、監査 → 添付のUPDATE → メッセージのUPDATE → 索引の組2つ。添付のUPDATEは、メッセージのUPDATEの後では条件が偽になるため前に置く。戻り値はメッセージの更新件数（1か0）のまま（積んだ位置を保持して読む。添付の件数に左右されない）
- **監査は`message.delete`の1件に含める**（添付の個別の監査は増やさない。既定の方針4）。拒否されたときは、添付も変わらない
- 削除が成功した後に、`message.service.ts`の`remove`が、依存`purgeAttachmentsOf(messageId)`を同じ要求の中で1回呼ぶ（`withMessageService`が`attachment-purge.ts`の`purgeAttachmentsOfMessage`を組んで渡す。省略すると何もしない）。失敗・0行のときは呼ばない。後始末の失敗は、削除の結果（204）を変えず、errorログに残す
- **#140の後、#270の前に削除されたメッセージの添付**には印がない。補完のSQLで印を付ける（下）

### 画面の更新

- 自分の投稿（`canModify`）で削除されていないメッセージの各添付に「〈名前〉を削除」を出し、押すと確認のダイアログ → 再認証 → 送信。成功すると、再読み込みなしで、その添付が一覧・スレッドから消える。失敗はダイアログの中に出し、表示を変えない。送信中は押せず、閉じない
- **キャッシュの更新先**：部屋の一覧とスレッドの親は別のキャッシュに持たれているので、成功したら、部屋の投稿（`parentMessageId`がnull）は部屋の一覧の該当の行（`replaceCachedMessage`）と、スレッドの親（`replaceThreadParent`。開いていなければ何もしない）の両方から該当の添付を外す。返信はスレッドの返信の該当の行だけ。案件の添付の一覧は、`caseKeys.all`を取り直す（`features/cases/keys.ts`経由）
- 監査ログの画面の種類の日本語名に「添付の削除」を足した（`frontend/src/features/audit-logs/action-labels.ts`）

### 補完のSQLと件数の確かめ方

#140の後、#270の前にメッセージを削除した添付には、削除の印がない（そのとき、添付に印を付ける処理がなかった）。`backend/db/scripts/mark-attachments-of-deleted-messages.sql`が、削除済みのメッセージに結び付き、まだ印のない添付に、メッセージの`deleted_at`・`deleted_by`を写す。**migrationにはしない**（既定の方針1。手作成のmigrationの例外は増やさない）。R2の実体は、定期の処理が消す。SQLのファイルの先頭のコメントは、この節を指している。

- べき等：印のない行だけを対象にするので、何度流しても同じ結果になる。削除されていないメッセージの添付・未投稿の添付・すでに印のある添付には触れない。相関の副問い合わせで書く（`UPDATE … FROM`はD1で確かめていないため使わない）
- 適用の順：migration 0036の**後**に流す。本番への適用は機能の完了条件に含めず、利用者が別に承認して行う。本番では、migration 0023が未適用で添付の行が0行の見込みのため、対象も0件の見込み（それでも[production-first-rollout.md](../operations/production-first-rollout.md)の手順で件数を確かめる）
- **件数の確かめ方**（読み取りだけ）：流す前と後に、次の件数を数える。流す前は0以上、流した後は**0**になる。

```sql
SELECT COUNT(*) AS n FROM message_attachments a
WHERE a.deleted_at IS NULL AND a.message_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM messages m WHERE m.id = a.message_id AND m.deleted_at IS NOT NULL);
```

- 手元：`wrangler d1 execute DB --local --persist-to <保存先> --file backend/db/scripts/mark-attachments-of-deleted-messages.sql`（`scripts/db-local.ts`の`seed-file`は`e2e/seeds/`の下だけを受け付けるため、使えない）。このSQLは検索の索引の表に触れない。削除済みのメッセージの添付の写しは、検索の結果には出ない（上の7か所の6）

### 添付の削除のテストの場所

| 場所 | 内容 |
| --- | --- |
| `backend/src/db/attachment-delete.db.test.ts` | `deletable`の事例表（対象でない添付が別にある状態で。本人・他人・削除済み・未投稿・メッセージ削除済み・未参加・無効・アーカイブ・案件の終了・部署が無効・DMの相手が無効・DMの第三者）、batchの中身 |
| `backend/src/db/message-modify.attachments.db.test.ts` | メッセージの削除が添付に印を付けること、戻り値が添付の件数（0件・複数件・全件が削除済み）に左右されないこと |
| `backend/src/db/attachment-deletion.upgrade.db.test.ts`・`attachment-publication.schema.db.test.ts` | migration 0036の更新の試験（0035まで当てて添付の行を入れ、0036だけを当てる。件数・既存の列・結び付き・3列がNULL・索引）と、列の期待（3列を足した） |
| `backend/src/db/mark-attachments-of-deleted-messages.db.test.ts`・`cleanup-sql.attachment-delete.db.test.ts` | 補完のSQLのべき等と件数、後始末のSQLが削除済みの行も消すこと |
| `backend/src/routes/attachments.delete.test.ts`・`attachments.delete.case-room.test.ts` | 判定の順の全段（401・403・404・409・422・再認証が最後・204）、権限の拒否、案件の部屋、R2の失敗の注入 |
| `backend/src/services/attachment.service.delete.test.ts`・`attachment.delete.interleave.test.ts` | Serviceの判定、確認の後・書き込みの直前に状態が変わる場合（参加の解除・無効化・アーカイブ・案件の終了・部署の無効化・DMの相手の無効化・メッセージの削除）の読み直し |
| `backend/src/routes/attachments.deleted-visibility.test.ts` | 削除済みの添付が、配信・一覧・スレッド・案件の一覧・公開範囲の変更・検索のどこにも出ないこと |
| `backend/src/services/attachment-purge.test.ts` | 後始末のジョブ：べき等・失敗・同時の実行、進め方（1ページ100行・1回500行・同じ時刻の行をidで区切る）、失敗し続ける行が後ろを止めないこと、`purge_failed_at`の記録 |
| `backend/src/routes/messages.delete-attachments.test.ts`・`backend/src/services/message.delete-purge.test.ts` | メッセージの削除の後に、要求の中で1回だけ実体の削除を試すこと（失敗・0行では呼ばない。後始末が失敗しても204） |
| `backend/src/openapi.attachment-delete.test.ts`・`backend/src/lib/audit-actions.attachment-delete.test.ts` | 契約と監査の種類 |
| `frontend/src/features/messages/messages.attachment-delete.test.tsx`・`messages.attachment-delete-cache.test.tsx`、`frontend/src/test/attachment-delete-handlers.ts` | ボタンの出し分け・確認 → 再認証 → 成功・失敗の表示・送信中・キャッシュの更新先（部屋とスレッドの同時表示） |
| `e2e/attachment-delete.spec.ts`、`e2e/seeds/attachment-delete.sql`・`attachment-delete-cleanup.sql` | 実ブラウザの確認（1件。S-05で自分の添付を消すと、再読み込みなしで消え、そのURLは404）。一覧は[e2e.md](../testing/e2e.md) |

SQLのテンプレートの中の条件は、Strykerが変異を作らない（[mutation.md](../testing/mutation.md)の147-C-1の記録）ため、条件を1つずつ外した版で対応するテストが落ちることの手での確かめ（SQLの条件の対照）で代える。その結果はPRの本文に書く。

## 情報漏えいの経路と対策

| 経路 | 対策 |
| --- | --- |
| 見えない部屋の添付の配信 | `attachment-visibility.sql.ts`に一覧と同じ規則を置き、互いのコメントで参照する。同じ事例表を、一覧と配信の両方のテストに当てる |
| お知らせ専用の権限の回避 | 入口を2つに分け、返信用の添付は`thread_parent_id`が一致する返信にだけ結び付けられる |
| URL・IDの推測 | IDはULID（乱数80ビット）。キーは別の乱数で、応答に出さない。署名付きURL・`r2.dev`は使わない。配信は毎回認可 |
| Content-Typeの偽装 | サーバーの検査の結果（固定の一覧）からだけ付ける。申告・拡張子は使わない |
| ブラウザでの実行 | SVG・HTMLを受け付けない／テキストは`text/plain; charset=utf-8`／`nosniff`／配信の`Content-Security-Policy: default-src 'none'; sandbox`と`Cross-Origin-Resource-Policy: same-origin` |
| `Content-Disposition`の注入 | 改行・「"」・制御文字を含む名前は保存時に422。配信でも`filename`はASCIIに置き換え、`filename*`はパーセントエンコード |
| キャッシュ | `Cache-Control: private, no-store`（共通のミドルウェアが`no-store`を含む値を残す） |
| 位置情報 | JPEG（APP1・APP13）・PNG（`eXIf`・`tEXt`・`zTXt`・`iTXt`）・WebP（`EXIF`・`XMP `）のメタデータを保存前に除く。壊れた画像は422 |
| zipによる資源の消費 | エントリ数・展開後のサイズを展開しながら数えて上限を守る |
| ログ | ファイル名・保存先のキーを出さない |

## 同時の操作

- 同じ未投稿の添付を2つの投稿が同時に使う：D1は書き込みを直列に実行するため、片方だけが結び付く。もう片方はbatchごと失敗して409になり、メッセージは作られない。
- 投稿と掃除が重なる：掃除は条件付きの`DELETE`で、結び付いた行を消さない。投稿の側は、行が消えていれば404。
- 配信の途中でメッセージが削除される：次の取得から404。R2が`null`を返したら404。
- 受信が打ち切られる・D1の登録が失敗する：保存物を消してから元のエラーを返す。消すのに失敗したらerrorログに残す。

## 主な入出力

| 処理 | 入力 | 出力 |
| --- | --- | --- |
| `createAttachmentService().uploadToRoom` | 操作者・部屋のID・`{ name, contentLength, body, publicationVisibility }`（`publicationVisibility`はクエリの値。未確認の文字列か`undefined`） | `{ id, name, kind, contentType, size, publicationVisibility }`（案件の部屋以外は`null`）。404・403・409・422（`AppError`） |
| `createAttachmentService().uploadToReply` | 操作者・親のメッセージのID・同上 | 同上。親が見えない・返信なら404、参加していなければ403 |
| `createAttachmentService().download` | 操作者・添付のID・`Range`ヘッダーまたは`null` | `{ name, kind, contentType, size, range, body }`。見えない・存在しない・実体がないは404、権限なしは403 |
| `createMessageService().post`・`postReply` | 既存の引数に`attachmentIds` | 既存の応答。404・409・422（結び付けの失敗） |
| `inspectAttachment(name, bytes)` | 元の名前・バイト列（動画は先頭だけ） | `{ ok: true, kind, contentType }`または`{ ok: false }` |
| `checkOoxml(bytes, extension)` | zipのバイト列・`docx`/`xlsx`/`pptx` | 真偽（壊れたzipは偽） |
| `stripExif(bytes, contentType)` | 画像のバイト列・種類 | メタデータを除いたバイト列。壊れた構造は例外 |
| `parseByteRange(header, size)` | `Range`ヘッダー・サイズ | `{ start, end }`（終わりを含む）または`null` |
| `contentDisposition(name, type)` | 元の名前・`inline`か`attachment` | ヘッダーの値 |
| `bindAttachments(db, input)` | 投稿のID・部屋・本人・文脈・添付のID | batchに足す文の配列（添付がなければ空） |
| `attachmentCleanupJob().run` | `env` | なし。消した行数・失敗した実体の数をログに残す |
| `createAttachmentService().remove`（#270） | 操作者（`reauthenticatedAt`を含む）・添付のID | なし（204）。404・403・409（`AppError`）。再認証が古い・ないときは403`REAUTH_REQUIRED` |
| `markAttachmentDeleted(db, input)`（#270） | 添付・メッセージ・部屋・本人のID・削除の時刻・トレースID | 印を付けた行数（1か0） |
| `purgeDeletedAttachments(env, rows, logger)`（#270） | 後始末の対象の行（`id`・`storageKey`）・ロガー | `{ purgedRows, failedObjects }`。R2の失敗は投げず数える。D1の行の削除の失敗は投げる |
| `attachmentPurgeJob().run`（#270） | `env` | なし。読んだ行数・消せた行数・R2の失敗の数・上限で止めたかをinfoログに残す |

## 既知の限界

- **形式の検査（zip・`[Content_Types].xml`の読み取り・画像のメタデータの除去）は自前の実装**。`[Content_Types].xml`は決まった形だけを受け付けるため、正当なOfficeのファイルでも、この形から外れるもの（根の要素以外での名前空間の宣言など）は拒否される。リリース前の検証（#160）で、細工したファイルを多数与えるテストか、実績のあるライブラリへの置き換えを検討する。
- 動画100MBちょうどがWorkers経由で通るかは、本番で未確認（利用者がデプロイの時に確認する。C-153(4)）。手元では`FixedLengthStream`とR2の`put`が3MBで動くことと、足りないバイト数で`put`が失敗して何も残らないことを確かめた（[ADR-0011](../adr/0011-attachment-inspection-and-virus-scan.md)の未確認の一部を埋めた）。
- データ記述子を使うzipのエントリは、サイズの突き合わせをしない（正当なファイルを通すための決定。C-176）。
- 添付の付いた送信が失敗して再送すると、成功済みのファイルも、もう一度アップロードする（一覧を残すため）。前回のものはどの投稿にも結び付かず、24時間後の掃除で消える。
- 【#270で解消】メッセージを削除しても、R2の実体が残る問題は、メッセージの削除が添付にも印を付け、削除の後に実体を消すことで解消した。ただし、**R2の実体は戻せない**：D1のTime Travelで行を戻しても、消したファイルは戻らない（配信は404になる。C-127）。
- 【#270】本物のR2で、存在しないキーの`delete`が成功するかは確かめていない（Miniflareでは例外にならない）。失敗する場合、その行は毎回の定期の処理で失敗し続け、`purge_failed_at`で後ろに回りながら、errorログに残る。#160で確かめる。
- 【#270】定期の処理が、Workersの1回の実行の時間の上限に当たるかは未確認。1回500行の上限で抑えている。実測は#160。
- 【#270】添付の削除と案件の公開範囲の変更が重なったときは、削除が先に確定すれば、公開範囲の変更は404になる（削除済みの添付は`attachmentVisible`と変更の条件の両方で除かれる）。D1は書き込みを直列に実行する前提に依存する。
- ウイルススキャン（#116）はしない。今回の検査は「種類の一致」の確認で、安全性の保証ではない。
- 補償の`delete`も失敗した実体を探す定期の照合はない。
- 無効な部署のチャンネルへの通常の投稿が拒否されない既存の不足は、アップロードにも同じ形で及ぶ。#154で扱う。

## テストの場所

| 場所 | 内容 |
| --- | --- |
| `backend/src/lib/attachment-rules.test.ts` | 上限・拡張子・名前・`validateAttachmentCandidate`・`attachmentIdsSchema`（リテラルの期待） |
| `backend/src/lib/attachment-inspection.test.ts`・`ooxml-check.test.ts`・`exif-strip.test.ts`・`content-disposition.test.ts`・`byte-range.test.ts` | バイト列の判定。拡張子の偽装・SVG・一般のzip・マクロつき・旧形式・暗号化・ZIP64・エントリ数・展開の途中の上限・圧縮したXML・Exifの除去・Rangeの全事例 |
| `backend/src/db/attachment.repository.db.test.ts` | SQL：可視性の事例表、文脈つきの条件付きUPDATE（他人・別の部屋・別の文脈・使用済み・存在しない）、batchの失敗（10件・合計200,000,000バイトの境界）、返信への結び付け |
| `backend/src/services/attachment.service.test.ts` | `perm.attachment.upload`・`perm.attachment.download`の判定の位置（部屋が見えなければ権限の前に404、見えない添付は権限を確かめずに404、拒否は403） |
| `backend/src/routes/attachments.test.ts` | 2つの入口の認可の違い（お知らせ専用）、本文を読む前の拒否、422と保存物が残らないこと、D1の登録の失敗の補償（実体の削除の失敗を含む）、配信の404・200・206・無効なRangeの200、ヘッダー、毎回の判定、実体がないときの404 |
| `backend/src/routes/messages.attachments.test.ts` | 投稿・返信への結び付けの応答（404・409・422）、同時の使用、一覧の`attachments`（ID昇順・削除済みは空・公開チャンネルの未参加者にも入る） |
| `backend/src/attachment-cleanup.test.ts` | 24時間を過ぎた未投稿の掃除、結び付いた行は消えないこと、実体の削除の失敗 |
| `backend/src/openapi.test.ts` | 3つのエンドポイントと`AttachmentItem`の一致 |
| `backend/src/db/attachment.repository.pending.db.test.ts`・`backend/src/services/attachment.upload-race.test.ts`・`backend/src/routes/attachments.case-room.test.ts`・`backend/src/services/case-room.permissions.test.ts`（#148） | 条件つきの登録（条件を外れれば0行・満たせば1行。通常のチャンネル・DM・案件の部屋）、受信中の状態変化（案件の終了・参加の解除・無効化）で行が残らず実体が消えること、案件の部屋の添付のアップロード・取得（終了中のアップロード409・ダウンロード200）、`perm.case.view`だけを外したときの配信403 |
| `backend/test/attachment-files.ts`・`attachment-fixtures.ts` | 架空・無害なバイト列（zipを自前で組む補助を含む）と、DBの準備・後始末。識別子`testuser_attdb_`・`[UNIT_TEST]` |
| `frontend/src/features/messages/messages.attachments.test.tsx`・`messages.attachments-thread.test.tsx`・`api/message-api.attachments.test.ts`、`frontend/src/test/attachment-handlers.ts` | 上限の判定・取り消し・失敗と時間切れの表示・個別の時間切れ・送信中の取り消し・返信欄・APIの呼び出し |
| `e2e/attachments.spec.ts`、`e2e/seeds/attachments.sql`・`attachments-cleanup.sql` | 実ブラウザの確認（3件、直列）。一覧は[e2e.md](../testing/e2e.md) |

## 関係するIssue・ADR

- Issue #140（親：#133）。#270（添付の削除は1つ目で実装した。添付だけの投稿は2つ目）・#116（ウイルススキャン）・#141（アバター）・#155（ファイル名の検索。155-B で実装した。[search.md](search.md)）・#154（無効な部署への投稿）・#160（本番での確認・全体のミューテーション）に申し送る。
- 決定：C-176（C-153の未決定の項目を置き換えた）。C-126・C-137・C-153・C-94に従う。
- Issue #270の1つ目（添付の削除。1-6 AC-4、EP-1-11、R-39・R-34、migration 0036）。決定記録C-204（判定の順・実体の削除の失敗の扱い・メッセージの削除との関係・PRを2つに分けること）。C-127（削除したら戻せない）・C-74・C-171・C-176に従う。2つ目（添付だけの投稿）は次のPR。**本番への適用（migration 0036・補完のSQL）は利用者が行う**（[production-first-rollout.md](../operations/production-first-rollout.md)）。
- [ADR-0011](../adr/0011-attachment-inspection-and-virus-scan.md)（検査の方式）・[ADR-0029](../adr/0029-attachment-delivery-headers-and-content-type-check.md)（配信のヘッダーの扱い・`content_type`のCHECKをやめた理由）・[ADR-0012](../adr/0012-zero-trust-principle.md)（毎回認可する）・[ADR-0015](../adr/0015-style-foundation.md)・[ADR-0028](../adr/0028-lighter-process-and-narrowed-scope.md)（ミューテーションの範囲）。
- 関連する設計書：[messages.md](messages.md)・[threads.md](threads.md)・[reactions.md](reactions.md)。
- 要件：1-6 AC-1〜AC-3・AC-5〜AC-7・AC-9、1-4 AC-5、EP-1-09・EP-1-10、perm.attachment.upload・download（R-32・R-33）、S-05・S-06・S-07。
- Issue #148の148-A：案件専用チャンネルの添付。登録を保存の時点の資格を条件にした条件つきの登録にした（部屋の種類によらない）、案件の終了中は409、配信に`perm.case.view`。公開範囲の選択・変更は148-B-2。詳細は[cases.md](cases.md)の「148-A の設計」。決定記録C-184。要件：5-2 AC-2・AC-3（参加者の部分）
- Issue #148の148-B-2：案件の添付の公開範囲（5-2 AC-8・AC-9、R-85）。列`publication_visibility`（migration 0030）、アップロードのクエリ`publicationVisibility`、`insertPending`の列の名前の明示、アップロードの応答の定義の分離、変更の API（EP-1-23 `PATCH /api/attachments/:attachmentId`。`attachmentRoutes()`に足した。業務の判定は`case-attachment.service.ts`）。**配信・結び付け・一覧の読み取りの資格は変えていない**（値は読み取りに使わない）。詳細は[cases.md](cases.md)の「148-B-2 の設計」。決定記録C-195。ADR-0024
- Issue #148の148-B-1：案件の添付の一覧（EP-5-19 `GET /api/cases/:caseId/attachments`）。**アップロード・結び付け・配信の経路は変えていない**（migrationもない）。一覧は`backend/src/db/case-attachment.repository.ts`が、配信の`attachmentVisible`と同じ規則（部屋を見てよい・投稿済み・メッセージが削除されていない）で、資格を中身を読む文に入れて読む。どちらかの規則を変えるときは、両方を直す（`attachment-visibility.sql.ts`の先頭のコメントに書いた）。一覧に出ることは取得の許可ではなく、取得は従来どおり配信が毎回判定する。応答の項目名は、この設計書の「一覧の項目`attachments`」と同じ名前（`name`・`kind`・`contentType`・`size`）に合わせた。詳細は[cases.md](cases.md)の「148-B-1 の設計」。決定記録C-191
