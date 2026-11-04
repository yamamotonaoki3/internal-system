// 共通のテキスト入力欄。ラベル・ヒント・エラーを結び付ける。ref は input に渡る（react-hook-form の register が使える）。
import type { ComponentProps } from "react";
import { FieldMessages, useFieldIds } from "./FieldMessages";

type TextFieldProps = Omit<ComponentProps<"input">, "id" | "className"> & {
  label: string;
  hint?: string;
  error?: string;
};

export function TextField({
  label,
  hint,
  error,
  ...inputProps
}: TextFieldProps) {
  const { id, hintId, errorId, describedBy } = useFieldIds(hint, error);
  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1 block text-sm font-bold">
        {label}
      </label>
      <input
        {...inputProps}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="min-h-11 md:min-h-10 w-full rounded-md border border-border-strong bg-surface px-3 text-base"
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
