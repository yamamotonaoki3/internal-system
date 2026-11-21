// 共通のテキスト入力欄。ラベル・ヒント・エラーを結び付ける。ref は input に渡る（react-hook-form の register が使える）。
import type { ComponentProps } from "react";
import { FieldMessages, useFieldIds } from "./FieldMessages";

type TextFieldProps = Omit<ComponentProps<"input">, "id" | "className"> & {
  label: string;
  hint?: string;
  error?: string;
  /** ラベルを画面から隠す（label 要素は残し、読み上げには使う）。ヘッダーの検索欄など、見出しの役割の文字が別にある場所で使う */
  hideLabel?: boolean;
};

// クラスは完全な文字列で書く（連結で作ると Tailwind が見つけられない）
const WRAPPER_CLASSES = { shown: "mb-4", hidden: "" } as const;
const LABEL_CLASSES = {
  shown: "mb-1 block text-sm font-bold",
  hidden: "sr-only",
} as const;

export function TextField({
  label,
  hint,
  error,
  hideLabel = false,
  ...inputProps
}: TextFieldProps) {
  const { id, hintId, errorId, describedBy } = useFieldIds(hint, error);
  const mode = hideLabel ? "hidden" : "shown";
  return (
    <div className={WRAPPER_CLASSES[mode]}>
      <label htmlFor={id} className={LABEL_CLASSES[mode]}>
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
