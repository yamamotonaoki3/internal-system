// 共通の複数行の入力欄。ラベル・ヒント・エラーを結び付ける。ref は textarea に渡る（react-hook-form の register が使える）。
// 見た目は TextField と同じ。className は受け取らない。
import type { ComponentProps } from "react";
import { FieldMessages, useFieldIds } from "./FieldMessages";

type TextAreaFieldProps = Omit<
  ComponentProps<"textarea">,
  "id" | "className"
> & {
  label: string;
  hint?: string;
  error?: string;
};

export function TextAreaField({
  label,
  hint,
  error,
  ...textareaProps
}: TextAreaFieldProps) {
  const { id, hintId, errorId, describedBy } = useFieldIds(hint, error);
  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1 block text-sm font-bold">
        {label}
      </label>
      <textarea
        {...textareaProps}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="min-h-24 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-base"
      />
      <FieldMessages
        hintId={hintId}
        errorId={errorId}
        hint={hint}
        error={error}
      />
    </div>
  );
}
