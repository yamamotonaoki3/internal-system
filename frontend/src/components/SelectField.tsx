// 共通の選択欄。ラベル・ヒント・エラーを結び付ける。ref は select に渡る（react-hook-form の register が使える）。
// 見た目は TextField と同じ。className は受け取らない。
import type { ComponentProps } from "react";
import { FieldMessages, useFieldIds } from "./FieldMessages";

type SelectFieldProps = Omit<ComponentProps<"select">, "id" | "className"> & {
  label: string;
  hint?: string;
  error?: string;
};

export function SelectField({
  label,
  hint,
  error,
  children,
  ...selectProps
}: SelectFieldProps) {
  const { id, hintId, errorId, describedBy } = useFieldIds(hint, error);
  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1 block text-sm font-bold">
        {label}
      </label>
      <select
        {...selectProps}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="min-h-11 md:min-h-10 w-full rounded-md border border-border-strong bg-surface px-3 text-base"
      >
        {children}
      </select>
      <FieldMessages
        hintId={hintId}
        errorId={errorId}
        hint={hint}
        error={error}
      />
    </div>
  );
}
