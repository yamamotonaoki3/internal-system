// メッセージ1件の行。投稿者・日時・本文を出す。自分の投稿（canModify）には「編集」「削除」を付ける。
// 編集はその場で編集欄に切り替え、削除は確認のダイアログを出す。削除済みは本文の代わりに「このメッセージは削除されました」を出す（C-57）。
import { useState } from "react";
import { Button } from "../../../components/Button";
import type { RoomMessage } from "../api/message-api";
import { DeleteMessageDialog } from "./DeleteMessageDialog";
import { MessageBody } from "./MessageBody";
import { MessageEditForm } from "./MessageEditForm";

type MessageItemProps = {
  message: RoomMessage;
  /** 「（退職者）」を併記するか */
  retired: boolean;
  /** 自分の投稿を編集・削除できる状態か（投稿者が自分で、部屋が許すとき）。削除済みには出さない */
  canModify: boolean;
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function MessageItem({ message, retired, canModify }: MessageItemProps) {
  const [mode, setMode] = useState<"view" | "edit" | "delete">("view");
  const close = () => setMode("view");
  return (
    <li className="mb-3">
      <p className="text-sm">
        <span className="font-bold">{message.author.displayName}</span>
        {retired && <span className="text-text-muted">（退職者）</span>}{" "}
        <time dateTime={message.createdAt} className="text-text-muted">
          {formatTime(message.createdAt)}
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
          messageId={message.id}
          originalBody={message.body}
          onClose={close}
        />
      ) : (
        <MessageBody body={message.body} />
      )}
      {canModify && !message.deleted && mode !== "edit" && (
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setMode("edit")}>
            編集
          </Button>
          <Button variant="ghost" onClick={() => setMode("delete")}>
            削除
          </Button>
        </div>
      )}
      {canModify && !message.deleted && mode === "delete" && (
        <DeleteMessageDialog
          roomId={message.roomId}
          messageId={message.id}
          onClose={close}
        />
      )}
    </li>
  );
}
