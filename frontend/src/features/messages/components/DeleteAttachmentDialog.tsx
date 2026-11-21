// 添付の削除の確認（#270。1-6 AC-4）。「削除する」で再認証（必要なら）を挟んで送る。送信中は押せず、閉じない。
// 成功すると、その添付が表示から外れ、このダイアログは呼び出し側で外れる。失敗は、ダイアログの中に出し、表示を変えない。
import { useEffect, useRef } from "react";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import type { Attachment } from "../api/message-api";
import { describeError } from "../describe-error";
import {
  useDeleteAttachment,
  type AttachmentOwner,
} from "../hooks/useDeleteAttachment";

type DeleteAttachmentDialogProps = {
  owner: AttachmentOwner;
  attachment: Pick<Attachment, "id" | "name">;
  onClose: () => void;
};

export function DeleteAttachmentDialog({
  owner,
  attachment,
  onClose,
}: DeleteAttachmentDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const remove = useDeleteAttachment(owner);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    // 外れるときに閉じて、開いた元のボタンへフォーカスを戻す
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-label="添付の削除"
      onCancel={(event) => {
        event.preventDefault();
        if (!remove.isPending) onClose();
      }}
      className="w-full max-w-md rounded-lg bg-surface p-6 text-text shadow-float backdrop:bg-overlay"
    >
      <section>
        <h2 className="mb-4 text-xl font-bold">添付の削除</h2>
        <p className="mb-4">
          「{attachment.name}
          」を削除します。削除すると、表示されなくなり、元に戻せません。
        </p>
        {remove.isError && (
          <Alert tone="error" role="alert">
            {describeError(remove.error)}
          </Alert>
        )}
        <div className="flex gap-2">
          <Button
            variant="danger"
            disabled={remove.isPending}
            onClick={() => remove.mutate(attachment.id, { onSuccess: onClose })}
          >
            削除する
          </Button>
          <Button
            variant="secondary"
            disabled={remove.isPending}
            onClick={onClose}
          >
            キャンセル
          </Button>
        </div>
      </section>
    </dialog>
  );
}
