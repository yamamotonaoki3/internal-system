// 入力した内容が失われることを確かめる確認ダイアログ。初めのフォーカスは「編集を続ける」。Esc も「編集を続ける」と同じ。
import { useEffect, useId, useRef } from "react";
import { Button } from "../../../components/Button";

type Props = {
  onContinue: () => void;
  onDiscard: () => void;
};

export function LeaveConfirmDialog({ onContinue, onDiscard }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    dialogRef.current?.showModal();
    continueRef.current?.focus();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onContinue();
      }}
      className="w-full max-w-md rounded-lg bg-surface p-6 text-text shadow-float backdrop:bg-overlay"
    >
      <section>
        <h2 id={titleId} className="mb-4 text-xl font-bold">
          入力した内容は失われます
        </h2>
        <p className="mb-4">このまま離れると、入力中の内容を破棄します。</p>
        <div className="flex gap-2">
          <Button ref={continueRef} onClick={onContinue}>
            編集を続ける
          </Button>
          <Button variant="danger" onClick={onDiscard}>
            破棄して離れる
          </Button>
        </div>
      </section>
    </dialog>
  );
}
