// 申請の取り下げの確認（S-10）。送信中は「取り下げる」を押せない。
import { useEffect, useRef } from "react";
import { Button } from "../../../components/Button";

type Props = {
  requestName: string;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

export function WithdrawDialog({
  requestName,
  pending,
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
      aria-label="申請の取り下げ"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
      className="w-full max-w-md rounded-lg bg-surface p-6 text-text shadow-float backdrop:bg-overlay"
    >
      <section>
        <h2 className="mb-4 text-xl font-bold">申請の取り下げ</h2>
        <p className="mb-4">
          「{requestName}
          」の申請を取り下げます。取り下げた申請は承認・却下できなくなります。
        </p>
        <div className="flex gap-2">
          <Button variant="danger" disabled={pending} onClick={onConfirm}>
            取り下げる
          </Button>
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            キャンセル
          </Button>
        </div>
      </section>
    </dialog>
  );
}
