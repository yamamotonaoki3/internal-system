// アーカイブしたチャンネルの復元の確認（#143。EP-2-38）。S-39・S-38（#143-b）が使う共通の部品。
// 「復元」→ 再認証（S-26）→ 送る。409（ほかの操作が先に確定した）は文を出す。
import { useEffect, useRef } from "react";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { useSession } from "../../auth";
import { describeManageError } from "../describe-error";
import { useRestoreChannel } from "../hooks/useManageChannel";

export function ChannelRestoreDialog({
  channelId,
  channelName,
  version,
  onClose,
  onRestored,
}: {
  channelId: string;
  channelName: string;
  version: number;
  onClose: () => void;
  onRestored?: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restore = useRestoreChannel(channelId);
  // 再認証は読み込んだセッションの再認証の時刻を更新するため、単独で開かれた場合もセッションを読み込んでおく
  useSession();
  const title = `チャンネル「${channelName}」を復元しますか`;

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!restore.isPending) onClose();
      }}
      className="w-full max-w-md rounded-lg bg-surface p-6 text-text shadow-float backdrop:bg-overlay"
    >
      <h2 className="mb-4 text-xl font-bold">{title}</h2>
      <p className="mb-4">
        復元すると、元の参加者・メッセージのまま、また使えるようになります。参加者に通知します。
      </p>
      {restore.isError && (
        <Alert tone="error" role="alert">
          {describeManageError(restore.error)}
        </Alert>
      )}
      <div className="flex gap-2">
        <Button
          disabled={restore.isPending}
          onClick={() => restore.mutate(version, { onSuccess: onRestored })}
        >
          復元
        </Button>
        <Button
          variant="secondary"
          disabled={restore.isPending}
          onClick={onClose}
        >
          キャンセル
        </Button>
      </div>
    </dialog>
  );
}
