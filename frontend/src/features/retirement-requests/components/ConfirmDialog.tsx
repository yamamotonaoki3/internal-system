// 退職処理の申請の確認のダイアログ（申請・取り下げ）。失敗はダイアログの中に出し、閉じない。
import { useEffect, useRef, type ReactNode } from "react";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";

type Props = {
  title: string;
  confirmLabel: string;
  pending: boolean;
  error: string | undefined;
  onConfirm: () => void;
  onClose: () => void;
  children: ReactNode;
};

export function ConfirmDialog({
  title,
  confirmLabel,
  pending,
  error,
  onConfirm,
  onClose,
  children,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
      className="w-full max-w-md rounded-lg bg-surface p-6 text-text shadow-float backdrop:bg-overlay"
    >
      <section>
        <h2 className="mb-4 text-xl font-bold">{title}</h2>
        <div className="mb-4">{children}</div>
        {error !== undefined && (
          <Alert tone="error" role="alert">
            {error}
          </Alert>
        )}
        <div className="flex gap-2">
          <Button variant="danger" disabled={pending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            キャンセル
          </Button>
        </div>
      </section>
    </dialog>
  );
}
