# 設計書：メッセージのメンション

Issue #139（親：#110）。メッセージ入力で社員を指名し、指名範囲を保存して表示を強調する。投稿・返信・編集の指名を、参加者にアプリ内通知する。要件は[1-8](../requirements/01-messaging.md)、通知は[3-2](../requirements/03-notification.md)、決定は[decision-register.md](../requirements/decision-register.md)のC-173。

## 目的と範囲

- `@`入力で社員を検索し、選んだ社員IDと本文中のUTF-16半開区間を送る。通常の`@文字列`は指名として扱わない。
- チャンネル・DM・返信・編集に指名を含める。メッセージDTOは`mentions`配列を返し、表示と更新に使う。
- 指名箇所を強調表示する。リンク・コード・HTML内の文字列は変換しない。プロフィール等へのリンクは作らない。
- 編集時は新たに加わった宛先だけに通知する。維持された宛先には再通知せず、いったん外して後で再追加した場合は通知する。自分への通知は作らず、指名を解除しても過去の通知を残す。
- 全員宛て指名、退職者の指名候補、全文検索、メール通知、新しいライブラリ、本番適用は対象外。

## データ

| 対象 | 内容 |
| --- | --- |
| `message_mentions`（migration `0021_add_message_mentions.sql`） | メッセージID・社員ID・`start`・`end`を保存する。主キーは（メッセージID, `start`）。社員ID・メッセージID索引と、`start >= 0`かつ`end > start`の制約を置く。両IDは既存のメッセージ・社員を参照する |
| `notifications` | 種類は`message.mentioned`。`messageId`は指名された実メッセージ、`targetId`は親メッセージ（通常投稿なら同じID）。`containsRoomContent: true`とし、閲覧認可を失った部屋の通知は既存の一覧条件で隠す |
| `MessageItem` | 一覧・返信・スレッド親に`mentions`を含める。削除済み項目の`mentions`は空配列 |

## ファイルと役割

### バックエンド

| ファイル | 役割 |
| --- | --- |
| `shared/message-rules.ts` | `mentionSchema`・`messageContentSchema`が指名配列と本文範囲の形を定義する。開始・終了はUTF-16単位の半開区間で、重なり、本文外、`@`以外から始まる範囲、サロゲートペアの分割を拒否する |
| `backend/db/schema.ts`、`backend/db/migrations/0021_add_message_mentions.sql` | `message_mentions`表と主キー・索引・範囲制約を定義する |
| `backend/src/routes/messages.ts` | `messageRoutes`で`GET /api/rooms/:roomId/mention-candidates`を受け、queryを検証してServiceへ渡す。投稿・返信・編集routeは本文と指名配列を渡す |
| `backend/src/services/message.service.ts` | `mentionCandidates`は部屋の閲覧・参加資格（DMは送信権限と相手の有効状態も）を先に判定し候補を返す。`validateMentions`は範囲形状・現在有効な社員ID・本文の表示文字列（`@表示名`）・コード範囲を検証する。`edit`は更新後の指名配列も返す |
| `backend/src/db/profile.repository.ts`、`backend/src/db/message.repository.ts` | `listDirectory`が有効社員・部署所属に絞り、表示名順のカーソルページを返す。`listMentionCandidates`はID・表示名・部署名だけを返す。`toItem`と各一覧取得は`loadMessageMentions`の結果をDTOへ付ける |
| `backend/src/db/message-mentions.sql.ts` | `insertMessageMentions`が指名範囲を保存し、`loadMessageMentions`が各メッセージの配列を作る。`activeMentionNames`が有効な表示名を取得する。`insertMentionNotifications`が適格な宛先の通知文を作る |
| `backend/src/db/message.repository.ts`、`backend/src/db/reply-insert.sql.ts` | 条件付きの通常投稿・返信挿入、指名行、通知行を同じ`db.batch`に含める |
| `backend/src/db/message-modify.sql.ts` | `updateBodyIfModifiable`が編集条件の確認・新規宛先通知・旧指名削除・新指名保存・本文更新を同じ`db.batch`で確定する。維持されている宛先は既存行との比較で再通知しない |
| `backend/src/db/thread-list.sql.ts` | `listThreadRows`が自分の投稿・返信・メンションを含む親を一覧候補にし、参加中の部屋に絞る |
| `shared/notification-kinds.ts`、`frontend/src/features/notifications/notification-views.ts` | 通知種類の部屋内容属性、通知一覧の文言・移動先を定義する |
| `backend/src/routes/messages.mentions.test.ts` | 候補API、入力拒否、保存、通知宛先・再通知条件、部分更新が残らないことを検証する |

### フロントエンド

| ファイル | 役割 |
| --- | --- |
| `frontend/src/features/messages/api/message-api.ts` | 投稿・返信・編集要求に指名配列を含め、候補APIとメッセージDTOをZodで検証する |
| `frontend/src/features/messages/components/MentionTextArea.tsx` | カーソル位置の`@`候補を取得し、選択後に本文とUTF-16範囲を更新する。入力編集で位置を移動し、重なる指名を解除する。矢印・Enter・Escapeで候補を操作する |
| `MessageComposer.tsx`、`MessageEditForm.tsx` | 投稿・編集の状態として指名配列を保持し、本文と一緒に送信する |
| `frontend/src/features/messages/markdown/remark-mentions.ts`、`MarkdownBody.tsx` | `remarkMentions`が原文位置と一致する指名を`.mention`のspanにする。複数のMarkdown節にまたがる指名に対応し、リンク・コード・HTMLは変換しない |
| `MessageBody.tsx`、`MessageItem.tsx` | DTOの指名配列をMarkdown表示へ渡して強調する。指名はリンクにしない |
| `frontend/src/features/messages/messages.mentions.test.tsx`、`frontend/src/features/messages/markdown/MarkdownBody.test.tsx、`frontend/src/features/messages/api/message-api.test.ts`` | 候補選択・表示・Markdownの強調・編集・API入出力を検証する |

## 処理の流れ

1. 入力欄の`@`候補を開く。候補routeはServiceで閲覧・参加資格を判定し、プロフィール一覧からカーソル付き候補を取る。チャンネルのお知らせ専用の投稿権限は問わず、DMでは送信権限と相手の有効状態も確認する。
2. 候補を選ぶと本文に`@表示名`を挿入し、`userId`と文字範囲を保持する。文字編集で範囲が崩れた指名は解除する。
3. 投稿・返信・編集要求をServiceで検証する。範囲形状、現在有効な社員、表示名との一致、コード内でないことを確認する。
4. 投稿・返信では条件付きメッセージ挿入・指名行・通知行を同じbatchに含める。編集では旧指名行と比較して新規宛先だけへ通知し、指名行と本文を更新する。全て同時に確定する。
5. 一覧・返信・スレッド親のRepositoryが指名範囲を読み、`toItem`がDTOに付ける。スレッド一覧は`message_mentions`から自分が指名された親を含める。
6. `remarkMentions`が有効範囲をspanとして表示する。通知一覧は`message.mentioned`の表示定義に従う。

## 主な関数の入出力

| 関数 | 入力 | 出力・責務 |
| --- | --- | --- |
| `createMessageService().mentionCandidates` | 投稿者、部屋ID、`keyword?`・`limit`・`cursor?` | 候補ページ`{ items: [{ id, displayName, departmentName }], nextCursor }`。閲覧・参加資格を確認する（DMは送信権限と相手の有効状態も） |
| `createMessageService().edit` | 投稿者、メッセージID、本文、`Mention[]` | `{ id, body, editedAt, mentions }`。権限・指名検証後に編集し、新規宛先だけへ通知する |
| `insertMessageMentions` | DB、メッセージID、部屋ID、指名配列、任意の許可条件 | 指名行を作るSQL文 |
| `insertMentionNotifications` | DB、実メッセージID、部屋ID、送信者、親ID、指名配列、新規宛先限定 | 適格な宛先への通知SQL文 |
| `loadMessageMentions` | DB、メッセージID配列、閲覧者ID（必須。#297） | メッセージIDから指名配列へのMap。閲覧者がそのメッセージの部屋をいま見てよい行だけ（`messageViewableBy`） |
| `remarkMentions` | 本文と指名範囲 | AST内の原文範囲に一致した指名だけを強調する変換 |

## 関係するIssue・ADR

- Issue #139（親 #110）。スレッド一覧へのメンション条件（#137）と、投稿編集・Markdown表示（#134）に接続する。
- C-173（編集時の通知差分・自己通知なし・過去通知保持）。C-171（Markdownでメンションを強調し、クリック動作は付けない）。
- 関連する設計書：[threads.md](threads.md)、[message-edit-markdown.md](message-edit-markdown.md)、[notifications.md](notifications.md)。
