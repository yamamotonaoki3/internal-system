// 退職処理の申請の却下（理由の入力）。前後の空白を除いて 1〜200 文字でなければ送らない（チャンネルの作成申請と同じ定義）。
// 再認証（期限内なら省略）の後に送る。失敗はダイアログの中に出し、閉じない。
import { useEffect, useRef, useState, type FormEvent } from "react";
import { rejectReasonSchema } from "../../../../../shared/channel-name-rules";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { TextAreaField } from "../../../components/TextAreaField";
import type { RetirementRequestReviewItem } from "../api/retirement-request-api";
import { useRejectRetirementRequest } from "../hooks/useRetirementRequests";
import { useMutationError } from "./useMutationError";

type Props = {
  request: RetirementRequestReviewItem;
  onClose: () => void;
  onDone: () => void;
};

export function RejectDialog({ request, onClose, onDone }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const reject = useRejectRetirementRequest();
  const [reason, setReason] = useState("");
  const { error, setError, run } = useMutationError();

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (reject.isPending) return;
    const parsed = rejectReasonSchema.safeParse(reason);
    if (!parsed.success) {
      setError("却下の理由を1〜200文字で入力してください");
      return;
    }
    const sent = await run(() =>
      reject.mutateAsync({ id: request.id, reason: parsed.data }),
    );
    if (sent) onDone();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-label="退職処理の申請の却下"
      onCancel={(event) => {
        event.preventDefault();
        if (!reject.isPending) onClose();
      }}
      className="w-full max-w-md rounded-lg bg-surface p-6 text-text shadow-float backdrop:bg-overlay"
    >
      <section>
        <h2 className="mb-4 text-xl font-bold">退職処理の申請の却下</h2>
        <p className="mb-4">
          「{request.target.displayName}」への申請を却下します。
        </p>
        <form onSubmit={(event) => void submit(event)} noValidate>
          <TextAreaField
            label="却下の理由"
            hint="1〜200文字。申請した人に表示されます"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          {error !== undefined && (
            <Alert tone="error" role="alert">
              {error}
            </Alert>
          )}
          <div className="flex gap-2">
            <Button type="submit" variant="danger" disabled={reject.isPending}>
              却下する
            </Button>
            <Button
              variant="secondary"
              disabled={reject.isPending}
              onClick={onClose}
            >
              キャンセル
            </Button>
          </div>
        </form>
      </section>
    </dialog>
  );
}
