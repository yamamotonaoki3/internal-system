// 参加者の削除・本人の退出の確認（S-17）。送信中は確定・キャンセルを押せない。
import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "../../../components/Button";

type Props = {
  title: string;
  confirmLabel: string;
  pending: boolean;
  children: ReactNode;
  /** 本文の後ろに別の要素として出す注意書き */
  notice?: ReactNode;
  onConfirm: () => void;
  onClose: () => void;
};

export function CaseConfirmDialog({
  title,
  confirmLabel,
  pending,
  children,
  notice,
  onConfirm,
  onClose,
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
        <p className="mb-4">{children}</p>
        {notice}
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
