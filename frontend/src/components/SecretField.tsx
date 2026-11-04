// 秘密の値（トークン・パスワード）の入力欄。初めは伏せ、ボタンで表示・非表示を切り替える。
// 既定はトークン用の動き。パスワードでは toggleLabels と autoComplete を渡す。
import { useState, type ComponentProps } from "react";
import { Button } from "./Button";
import { FieldMessages, useFieldIds } from "./FieldMessages";

type SecretFieldProps = Omit<
  ComponentProps<"input">,
  "type" | "id" | "className"
> & {
  label: string;
  // 表示切替ボタンの名前（スクリーンリーダー向け）
  toggleLabels?: { show: string; hide: string };
  hint?: string;
  error?: string;
};

export function SecretField({
  label,
  hint,
  error,
  toggleLabels = { show: "トークンを表示", hide: "トークンを隠す" },
  autoComplete = "off",
  ...inputProps
}: SecretFieldProps) {
  const { id, hintId, errorId, describedBy } = useFieldIds(hint, error);
  const [visible, setVisible] = useState(false);

  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1 block text-sm font-bold">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          {...inputProps}
          id={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className="min-h-11 md:min-h-10 min-w-0 flex-1 rounded-md border border-border-strong bg-surface px-3 text-base"
        />
        <Button
          variant="secondary"
          aria-pressed={visible}
          aria-label={visible ? toggleLabels.hide : toggleLabels.show}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? "隠す" : "表示"}
        </Button>
      </div>
      <FieldMessages
        hintId={hintId}
        errorId={errorId}
        hint={hint}
        error={error}
      />
    </div>
  );
}
