// チャンネルのアーカイブの確認（#143。EP-2-37。S-05 の「⋯」、のちに S-39・S-38 からも開く）。
// 理由は任意で 500 文字まで（V-48。規則は shared/channel-name-rules.ts）。「アーカイブ」→ 再認証（S-26）→ 送る。
// 409（ほかの操作が先に確定した）は文を出して、詳細を取り直す。
import { useEffect, useRef, useState } from "react";
import {
  ARCHIVE_REASON_MAX_LENGTH,
  archiveReasonSchema,
} from "../../../../../shared/channel-name-rules";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { TextAreaField } from "../../../components/TextAreaField";
import { describeManageError, isApiError } from "../describe-error";
import {
  useArchiveChannel,
  useRefetchChannelDetail,
} from "../hooks/useManageChannel";

export function ChannelArchiveDialog({
  channelId,
  channelName,
  version: openedVersion,
  onClose,
  onArchived,
}: {
  channelId: string;
  channelName: string;
  version: number;
  onClose: () => void;
  onArchived: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // 送る版は開いた時点のもの（背景の再取得で進んだ版で送らない）
  const [version] = useState(openedVersion);
  const archive = useArchiveChannel(channelId);
  const refetchDetail = useRefetchChannelDetail(channelId);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string>();
  const title = `チャンネル「${channelName}」をアーカイブしますか`;

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  function confirm() {
    const parsed = archiveReasonSchema.safeParse(reason);
    if (!parsed.success) {
      setReasonError(
        `理由は${ARCHIVE_REASON_MAX_LENGTH}文字以内で入力してください`,
      );
      return;
    }
    setReasonError(undefined);
    const input =
      parsed.data == null ? { version } : { version, reason: parsed.data };
    archive.mutate(input, {
      onSuccess: onArchived,
      onError: (error) => {
        if (isApiError(error) && error.status === 409) void refetchDetail();
      },
    });
  }

  return (
    <dialog
      ref={dialogRef}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!archive.isPending) onClose();
      }}
      className="w-full max-w-md rounded-lg bg-surface p-6 text-text shadow-float backdrop:bg-overlay"
    >
      <h2 className="mb-4 text-xl font-bold">{title}</h2>
      <p className="mb-4">
        アーカイブすると、一覧から消え、誰も投稿・閲覧できなくなります。メッセージは残り、復元できます。
      </p>
      <TextAreaField
        label="理由（任意）"
        hint={`残り${Math.max(0, ARCHIVE_REASON_MAX_LENGTH - reason.length)}文字。参加者への通知に表示されます`}
        error={reasonError}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      {archive.isError && (
        <Alert tone="error" role="alert">
          {describeManageError(archive.error)}
        </Alert>
      )}
      <div className="flex gap-2">
        <Button variant="danger" disabled={archive.isPending} onClick={confirm}>
          アーカイブ
        </Button>
        <Button
          variant="secondary"
          disabled={archive.isPending}
          onClick={onClose}
        >
          キャンセル
        </Button>
      </div>
    </dialog>
  );
}
