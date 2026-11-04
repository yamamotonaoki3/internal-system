// 入力欄の下に出すヒントとエラー。TextField と SecretField で共用する内部の部品。
// id は呼び出し側が aria-describedby に使う（useFieldIds で作る）。
import { useId } from "react";

export function useFieldIds(hint?: string, error?: string) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  // ヒント → エラーの順に、あるものだけを結ぶ
  const describedBy =
    [hint ? hintId : "", error ? errorId : ""].filter(Boolean).join(" ") ||
    undefined;
  return { id, hintId, errorId, describedBy };
}

type FieldMessagesProps = {
  hintId: string;
  errorId: string;
  hint?: string;
  error?: string;
};

export function FieldMessages({
  hintId,
  errorId,
  hint,
  error,
}: FieldMessagesProps) {
  return (
    <>
      {hint && (
        <p id={hintId} className="mt-1 text-xs text-text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1 text-sm text-danger">
          {error}
        </p>
      )}
    </>
  );
}
