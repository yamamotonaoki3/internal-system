// S-17 のヘッダーの「納期を変更」（#147 の 147-B。AC-17・AC-21〔Q6〕）。日付（下限は日本時間の今日）を保存するか、未定に戻す。
// 今日より前の日付は、送る前に欄のエラーにする。サーバーの 422 は欄に、それ以外は欄の外に出す。送信中は保存・未定に戻すを押せない。
import { useEffect, useRef, useState } from "react";
import {
  isDueDateBeforeToday,
  jstDateOf,
} from "../../../../../shared/case-rules";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { TextField } from "../../../components/TextField";
import { describeError, isApiError } from "../describe-error";
import { useChangeCaseDueDate } from "../hooks/useCaseWrites";

const PAST_DATE_ERROR = "納期は今日以降の日付にしてください";
const EMPTY_DATE_ERROR =
  "日付を選んでください（未定にするときは「未定に戻す」を押してください）";

type Props = {
  caseId: string;
  dueDate: string | null;
  onClose: () => void;
};

export function CaseDueDateDialog({ caseId, dueDate, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const change = useChangeCaseDueDate(caseId);
  const [value, setValue] = useState(dueDate ?? "");
  const [fieldError, setFieldError] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  function submit(next: string | null) {
    setFieldError(undefined);
    setError(undefined);
    if (next === "") {
      setFieldError(EMPTY_DATE_ERROR);
      return;
    }
    if (next !== null && isDueDateBeforeToday(next, new Date())) {
      setFieldError(PAST_DATE_ERROR);
      return;
    }
    change.mutate(next, {
      onSuccess: onClose,
      onError: (cause) => {
        if (isApiError(cause) && cause.status === 422)
          setFieldError(cause.message);
        else setError(describeError(cause));
      },
    });
  }

  return (
    <dialog
      ref={dialogRef}
      aria-label="納期の変更"
      onCancel={(event) => {
        event.preventDefault();
        if (!change.isPending) onClose();
      }}
      className="w-full max-w-md rounded-lg bg-surface p-6 text-text shadow-float backdrop:bg-overlay"
    >
      <h2 className="mb-4 text-xl font-bold">納期の変更</h2>
      {error !== undefined && (
        <Alert tone="error" role="alert">
          {error}
        </Alert>
      )}
      <TextField
        label="納期"
        type="date"
        min={jstDateOf(new Date()).date}
        value={value}
        error={fieldError}
        onChange={(event) => setValue(event.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Button disabled={change.isPending} onClick={() => submit(value)}>
          保存する
        </Button>
        <Button
          variant="secondary"
          disabled={change.isPending}
          onClick={() => submit(null)}
        >
          未定に戻す
        </Button>
        <Button variant="ghost" disabled={change.isPending} onClick={onClose}>
          キャンセル
        </Button>
      </div>
    </dialog>
  );
}
