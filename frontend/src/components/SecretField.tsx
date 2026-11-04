// 秘密の値（トークン・パスワード）の入力欄。初めは伏せ、ボタンで表示・非表示を切り替える。
// 既定はトークン用の動き。パスワードでは toggleLabels と autoComplete を渡す。
import { useId, useState, type ComponentProps } from "react";

type SecretFieldProps = Omit<ComponentProps<"input">, "type" | "id"> & {
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
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      <button
        type="button"
        aria-pressed={visible}
        aria-label={visible ? toggleLabels.hide : toggleLabels.show}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? "隠す" : "表示"}
      </button>
      {hint && <p id={hintId}>{hint}</p>}
      {error && <p id={errorId}>{error}</p>}
    </div>
  );
}
