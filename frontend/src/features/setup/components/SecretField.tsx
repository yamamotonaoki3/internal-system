// 秘密の値（初回セットアップ用のトークン）の入力欄。初めは伏せ、ボタンで表示・非表示を切り替える。
import { useId, useState, type ComponentProps } from "react";

type SecretFieldProps = Omit<ComponentProps<"input">, "type" | "id"> & {
  label: string;
  hint?: string;
  error?: string;
};

export function SecretField({
  label,
  hint,
  error,
  ...inputProps
}: SecretFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const [visible, setVisible] = useState(false);
  const describedBy =
    [hint ? hintId : "", error ? errorId : ""].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <input
        {...inputProps}
        id={id}
        type={visible ? "text" : "password"}
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      <button
        type="button"
        aria-pressed={visible}
        aria-label={visible ? "トークンを隠す" : "トークンを表示"}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? "隠す" : "表示"}
      </button>
      {hint && <p id={hintId}>{hint}</p>}
      {error && <p id={errorId}>{error}</p>}
    </div>
  );
}
