// メッセージ1件の行。投稿者・日時・本文を出す。自分の投稿（canModify）には「編集」「削除」を付ける。
// 編集はその場で編集欄に切り替え、削除は確認のダイアログを出す。削除済みは本文の代わりに「このメッセージは削除されました」を出す（C-57）。
// onOpenThread があるときは、スレッドを開く「返信 n 件」（まだなければ「返信」）のボタンを付ける。返信（親がある投稿）には付けない（返信は1段だけ）。
// 削除済みの投稿は、返信が残っているときだけ付ける（既存の返信を見られる）。
// 添付（#140）は本文の下に出す。削除済みには出さない。
import { useState } from "react";
import { Button } from "../../../components/Button";
import type { RoomMessage } from "../api/message-api";
import { formatMessageTime } from "../format-time";
import { DeleteMessageDialog } from "./DeleteMessageDialog";
import { MessageAttachments } from "./MessageAttachments";
import { MessageBody } from "./MessageBody";
import { MessageEditForm } from "./MessageEditForm";
import { ReactionBar } from "./ReactionBar";

type MessageItemProps = {
  message: RoomMessage;
  /** 「（退職者）」を併記するか */
  retired: boolean;
  /** 自分の投稿を編集・削除できる状態か（投稿者が自分で、部屋が許すとき）。削除済みには出さない */
  canModify: boolean;
  /** スレッドを開く（親のメッセージの ID を渡す）。なければスレッドのボタンを出さない */
  onOpenThread?: (parentMessageId: string) => void;
  /** リアクションを付け外しできる状態か（部屋が許すとき。投稿者は問わない）。偽なら、付いているチップは読み取り専用で出す */
  canReact?: boolean;
  /** リアクションのピッカーが開いているか。開くのは同時に1つだけにするため、呼び出し側が持つ。なければこの行だけで持つ */
  pickerOpen?: boolean;
  onPickerOpenChange?: (open: boolean) => void;
};

function ThreadButton({
  message,
  onOpenThread,
}: {
  message: RoomMessage;
  onOpenThread: (parentMessageId: string) => void;
}) {
  const author = message.author.displayName;
  if (message.replyCount === 0)
    return (
      <Button
        variant="ghost"
        aria-label={`${author}の投稿に返信する`}
        onClick={() => onOpenThread(message.id)}
      >
        返信
      </Button>
    );
  return (
    <Button
      variant="ghost"
      aria-label={`返信 ${message.replyCount} 件（${author}の投稿）`}
      onClick={() => onOpenThread(message.id)}
    >
      返信 {message.replyCount} 件
    </Button>
  );
}

function MessageActions({
  message,
  canModify,
  editing,
  onOpenThread,
  onEdit,
  onDelete,
}: {
  message: RoomMessage;
  canModify: boolean;
  editing: boolean;
  onOpenThread?: (parentMessageId: string) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const canOpenThread =
    onOpenThread !== undefined &&
    message.parentMessageId === null &&
    (!message.deleted || message.replyCount > 0);
  const canEditOrDelete = canModify && !message.deleted && !editing;
  if (!canOpenThread && !canEditOrDelete) return null;
  return (
    <div className="flex gap-2">
      {canOpenThread && (
        <ThreadButton message={message} onOpenThread={onOpenThread} />
      )}
      {canEditOrDelete && (
        <>
          <Button variant="ghost" onClick={onEdit}>
            編集
          </Button>
          <Button variant="ghost" onClick={onDelete}>
            削除
          </Button>
        </>
      )}
    </div>
  );
}

export function MessageItem({
  message,
  retired,
  canModify,
  onOpenThread,
  canReact = false,
  pickerOpen,
  onPickerOpenChange,
}: MessageItemProps) {
  const [mode, setMode] = useState<"view" | "edit" | "delete">("view");
  const [localPickerOpen, setLocalPickerOpen] = useState(false);
  const close = () => setMode("view");
  return (
    <li className="mb-3">
      <p className="text-sm">
        <span className="font-bold">{message.author.displayName}</span>
        {retired && <span className="text-text-muted">（退職者）</span>}{" "}
        <time dateTime={message.createdAt} className="text-text-muted">
          {formatMessageTime(message.createdAt)}
        </time>
        {message.editedAt !== null && (
          <span className="text-text-muted">（編集済み）</span>
        )}
      </p>
      {message.deleted || message.body === null ? (
        <p className="text-text-muted">このメッセージは削除されました</p>
      ) : mode === "edit" ? (
        <MessageEditForm
          roomId={message.roomId}
          parentMessageId={message.parentMessageId}
          messageId={message.id}
          originalBody={message.body}
          originalMentions={message.mentions}
          onClose={close}
        />
      ) : (
        <MessageBody body={message.body} mentions={message.mentions} />
      )}
      {!message.deleted && (
        <MessageAttachments attachments={message.attachments} />
      )}
      {!message.deleted && (
        <ReactionBar
          message={message}
          canReact={canReact}
          pickerOpen={pickerOpen ?? localPickerOpen}
          onPickerOpenChange={onPickerOpenChange ?? setLocalPickerOpen}
        />
      )}
      <MessageActions
        message={message}
        canModify={canModify}
        editing={mode === "edit"}
        onOpenThread={onOpenThread}
        onEdit={() => setMode("edit")}
        onDelete={() => setMode("delete")}
      />
      {canModify && !message.deleted && mode === "delete" && (
        <DeleteMessageDialog
          roomId={message.roomId}
          parentMessageId={message.parentMessageId}
          messageId={message.id}
          onClose={close}
        />
      )}
    </li>
  );
}
