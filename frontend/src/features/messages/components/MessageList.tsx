// メッセージの一覧（4つの状態：読み込み中・エラー・0件・あり）。1件ごとの表示は MessageItem、本文は MessageBody が出す。
// 一覧は role="log"・aria-live="polite"（新着を読み上げる。名前は label で替えられる）。取得に失敗しても、取得済みの一覧は残して上にエラーを出す。
import { useState } from "react";
import { Alert } from "../../../components/Alert";
import type { RoomMessage } from "../api/message-api";
import { describeError } from "../describe-error";
import { isRetiredAuthor } from "../retired-author";
import { MessageItem } from "./MessageItem";

type MessageListProps = {
  messages: RoomMessage[] | undefined;
  isPending: boolean;
  error: unknown;
  emptyText?: string;
  /** 一覧の読み上げの名前（既定は「メッセージ一覧」） */
  label?: string;
  /** サーバーの isActive に加えて「退職者」を併記する投稿者の利用者ID（既定は追加なし） */
  retiredAuthorIds?: readonly string[];
  /** ログイン中の利用者のID。自分の投稿の判定に使う。なければ、どの投稿も自分のものとしない */
  currentUserId?: string;
  /** 自分の投稿に「編集」「削除」を出すか（部屋が許すとき。既定は出さない） */
  canModifyOwn?: boolean;
  /** スレッドを開く。あれば、各メッセージにスレッドのボタンを出す */
  onOpenThread?: (parentMessageId: string) => void;
  /** リアクションを付け外しできるか（部屋が許すとき。投稿者は問わない。既定は出さない） */
  canReact?: boolean;
  /** リアクションのピッカーを開いている投稿の ID。別の一覧（スレッドの親など）と合わせて同時に1つにするとき、呼び出し側が持つ */
  pickerOpenId?: string | null;
  onPickerOpenIdChange?: (messageId: string | null) => void;
};

export function MessageList({
  messages,
  isPending,
  error,
  emptyText = "まだメッセージはありません",
  label = "メッセージ一覧",
  retiredAuthorIds = [],
  currentUserId,
  canModifyOwn = false,
  onOpenThread,
  canReact = false,
  pickerOpenId: controlledOpenId,
  onPickerOpenIdChange,
}: MessageListProps) {
  const [localOpenId, setLocalOpenId] = useState<string | null>(null);
  const pickerOpenId =
    controlledOpenId === undefined ? localOpenId : controlledOpenId;
  const setPickerOpenId = onPickerOpenIdChange ?? setLocalOpenId;
  const failure =
    error === null ? null : (
      <Alert tone="error" role="alert">
        {describeError(error)}
      </Alert>
    );
  if (isPending) return <p role="status">読み込み中です</p>;
  // 取得済みの一覧がないまま失敗したときは、0件と出さない
  if (messages === undefined) return failure;
  return (
    <>
      {failure}
      <div
        role="log"
        aria-live="polite"
        aria-label={label}
        className="mb-4 max-h-96 overflow-y-auto"
      >
        {messages.length === 0 ? (
          <p className="text-text-muted">{emptyText}</p>
        ) : (
          <ul>
            {messages.map((message) => (
              <MessageItem
                key={message.id}
                message={message}
                retired={isRetiredAuthor(message.author, retiredAuthorIds)}
                canModify={
                  canModifyOwn &&
                  currentUserId !== undefined &&
                  message.author.id === currentUserId
                }
                onOpenThread={onOpenThread}
                canReact={canReact}
                pickerOpen={pickerOpenId === message.id}
                onPickerOpenChange={(open) =>
                  setPickerOpenId(open ? message.id : null)
                }
              />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
