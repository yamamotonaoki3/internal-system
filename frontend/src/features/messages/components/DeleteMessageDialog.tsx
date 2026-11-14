// メッセージの削除の確認（1-3 AC-4）。「削除する」で再認証（必要なら）を挟んで送る。送信中は押せない。
// 成功すると一覧の行が削除済みに替わり、このダイアログは呼び出し側で外れる。失敗は、ダイアログの中に出す。
import { useEffect, useRef } from "react";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { describeError } from "../describe-error";
import { useDeleteMessage } from "../hooks/useDeleteMessage";

type DeleteMessageDialogProps = {
  roomId: string;
  messageId: string;
  onClose: () => void;
};

export function DeleteMessageDialog({
  roomId,
  messageId,
  onClose,
}: DeleteMessageDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const remove = useDeleteMessage(roomId);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    // 外れるときに閉じて、開いた元のボタンへフォーカスを戻す
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-label="メッセージの削除"
      onCancel={(event) => {
        event.preventDefault();
        if (!remove.isPending) onClose();
      }}
      className="w-full max-w-md rounded-lg bg-surface p-6 text-text shadow-float backdrop:bg-overlay"
    >
      <section>
        <h2 className="mb-4 text-xl font-bold">メッセージの削除</h2>
        <p className="mb-4">
          このメッセージを削除します。削除すると、本文は表示されなくなります。
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
            onClick={() => remove.mutate(messageId)}
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
