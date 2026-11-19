// S-17 の添付の「公開範囲を変更」（#148。5-2 AC-9）。いまの値を選んだ状態で開き、2つの選択肢と案内を出す。
// 送信と結果の表示は使う側（CaseAttachments）が持つ。サーバーの 422 だけはダイアログの中に出す。送信中は「変更」「キャンセル」を押せない。
import { useEffect, useRef, useState } from "react";
import type { PublicationVisibility } from "../../../../../shared/attachment-rules";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { RadioGroup } from "../../../components/RadioGroup";
import {
  CASE_ATTACHMENTS_TEXTS,
  PUBLICATION_VISIBILITY_HINT,
  PUBLICATION_VISIBILITY_OPTIONS,
} from "../labels";

type Props = {
  current: PublicationVisibility;
  pending: boolean;
  /** サーバーの 422 の文 */
  error: string | undefined;
  onSubmit: (value: PublicationVisibility) => void;
  onClose: () => void;
};

export function CaseAttachmentVisibilityDialog({
  current,
  pending,
  error,
  onSubmit,
  onClose,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(current);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-label={CASE_ATTACHMENTS_TEXTS.visibilityDialogTitle}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
      className="w-full max-w-md rounded-lg bg-surface p-6 text-text shadow-float backdrop:bg-overlay"
    >
      <h2 className="mb-4 text-xl font-bold">
        {CASE_ATTACHMENTS_TEXTS.visibilityDialogTitle}
      </h2>
      {error !== undefined && (
        <Alert tone="error" role="alert">
          {error}
        </Alert>
      )}
      <RadioGroup
        label={CASE_ATTACHMENTS_TEXTS.visibilityGroup}
        options={PUBLICATION_VISIBILITY_OPTIONS}
        value={value}
        onChange={setValue}
        disabled={pending}
      />
      <p className="mb-4 text-sm text-text-muted">
        {PUBLICATION_VISIBILITY_HINT}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending} onClick={() => onSubmit(value)}>
          {CASE_ATTACHMENTS_TEXTS.visibilitySubmit}
        </Button>
        <Button variant="ghost" disabled={pending} onClick={onClose}>
          {CASE_ATTACHMENTS_TEXTS.visibilityCancel}
        </Button>
      </div>
    </dialog>
  );
}
