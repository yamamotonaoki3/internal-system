// メッセージの添付の表示（#140）。画像は img、動画は video、そのほかはダウンロードのリンク。
// URL は ID から組み立てる。ファイル名は文字として出す（HTML として解釈させない）。
// owner を渡したとき（自分の投稿で、編集・削除できるとき。#270）は、各添付に「〈名前〉を削除」を付け、確認のダイアログを出す。
// 本文のない投稿の最後の添付（lastOfBodyless）は、ダイアログで投稿ごとの削除を案内するだけにする（#270・決定2）。
import { useState } from "react";
import { Button } from "../../../components/Button";
import { attachmentUrl, type Attachment } from "../api/message-api";
import type { AttachmentOwner } from "../hooks/useDeleteAttachment";
import { DeleteAttachmentDialog } from "./DeleteAttachmentDialog";

export function MessageAttachments({
  attachments,
  owner,
  lastOfBodyless = false,
}: {
  attachments: readonly Attachment[];
  /** 削除できるときだけ渡す（添付の持ち主のメッセージ） */
  owner?: AttachmentOwner;
  /** 本文のない投稿で、見える添付が1件だけか（#270。真なら削除は案内だけ） */
  lastOfBodyless?: boolean;
}) {
  const [deleting, setDeleting] = useState<Attachment | null>(null);
  if (attachments.length === 0) return null;
  return (
    <>
      <ul aria-label="添付" className="mb-2">
        {attachments.map((attachment) => {
          const url = attachmentUrl(attachment.id);
          return (
            <li key={attachment.id} className="mb-1">
              {attachment.kind === "image" ? (
                <img src={url} alt={attachment.name} className="max-w-xs" />
              ) : attachment.kind === "video" ? (
                <video
                  controls
                  src={url}
                  aria-label={attachment.name}
                  className="max-w-xs"
                />
              ) : (
                <a href={url} download className="underline">
                  {attachment.name}
                </a>
              )}
              {owner !== undefined && (
                <Button
                  variant="ghost"
                  aria-label={`${attachment.name}を削除`}
                  onClick={() => setDeleting(attachment)}
                >
                  削除
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {owner !== undefined && deleting !== null && (
        <DeleteAttachmentDialog
          owner={owner}
          attachment={deleting}
          lastOfBodyless={lastOfBodyless}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}
