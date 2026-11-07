import { useEffect, useRef, useState, type FormEvent } from "react";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { SecretField } from "../../../components/SecretField";

type Props = {
  title: string;
  error?: string;
  submitting: boolean;
  onSubmit: (password: string) => void;
  onCancel: () => void;
};

const TOGGLE_LABELS = { show: "パスワードを表示", hide: "パスワードを隠す" };

export function ReauthDialog({
  title,
  error,
  submitting,
  onSubmit,
  onCancel,
}: Props) {
  const [password, setPassword] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
    dialogRef.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length > 0 && password.length <= 1024 && !submitting)
      onSubmit(password);
  }

  return (
    <dialog
      ref={dialogRef}
      aria-label="再認証"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      className="w-full max-w-md rounded-lg bg-surface p-6 text-text shadow-float backdrop:bg-overlay"
    >
      <section>
        <h2 className="mb-4 text-xl font-bold">{title}の再認証</h2>
        <p className="mb-4">続けるにはパスワードを入力してください。</p>
        <form onSubmit={submit} noValidate>
          <SecretField
            label="パスワード"
            toggleLabels={TOGGLE_LABELS}
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={error}
          />
          {error && (
            <Alert tone="error" role="alert" as="p">
              {error}
            </Alert>
          )}
          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={submitting || password.length === 0}
            >
              {submitting ? "確認中" : "再認証"}
            </Button>
            <Button variant="secondary" onClick={onCancel}>
              キャンセル
            </Button>
          </div>
        </form>
      </section>
    </dialog>
  );
}
