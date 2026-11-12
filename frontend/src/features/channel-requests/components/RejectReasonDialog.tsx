// 却下の理由の入力（S-11）。前後の空白を除いて 1〜200 文字でなければ確定できない（送らない）。
import { useEffect, useRef, useState, type FormEvent } from "react";
import { rejectReasonSchema } from "../../../../../shared/channel-name-rules";
import { Button } from "../../../components/Button";
import { TextAreaField } from "../../../components/TextAreaField";

type Props = {
  pending: boolean;
  onSubmit: (reason: string) => void;
  onClose: () => void;
};

export function RejectReasonDialog({ pending, onSubmit, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const parsed = rejectReasonSchema.safeParse(reason);
    if (!parsed.success) {
      setError("理由を1〜200文字で入力してください");
      return;
    }
    setError(undefined);
    onSubmit(parsed.data);
  }

  return (
    <dialog
      ref={dialogRef}
      aria-label="却下の理由"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
      className="w-full max-w-md rounded-lg bg-surface p-6 text-text shadow-float backdrop:bg-overlay"
    >
      <section>
        <h2 className="mb-4 text-xl font-bold">却下の理由</h2>
        <form onSubmit={submit} noValidate>
          <TextAreaField
            label="理由"
            hint="1〜200文字。申請した人に表示されます"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            error={error}
          />
          <div className="flex gap-2">
            <Button type="submit" variant="danger" disabled={pending}>
              却下する
            </Button>
            <Button variant="secondary" disabled={pending} onClick={onClose}>
              キャンセル
            </Button>
          </div>
        </form>
      </section>
    </dialog>
  );
}
