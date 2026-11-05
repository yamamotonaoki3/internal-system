// 共通のボタン。見た目は variant で選ぶ。className は受け取らない（呼び出し側で見た目を上書きさせない）。
// type の既定は "button"（フォームを意図せず送信しない）。送信ボタンだけ type="submit" を渡す。
import type { ComponentProps } from "react";

type ButtonProps = Omit<ComponentProps<"button">, "className"> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
};

// クラスは完全な文字列で書く（文字列連結で作ると、Tailwind がクラスを見つけられない）
const VARIANT_CLASSES = {
  primary:
    "min-h-11 md:min-h-10 px-4 rounded-md bg-primary text-on-primary hover:bg-primary-hover font-bold disabled:bg-disabled-bg disabled:text-disabled-text disabled:cursor-not-allowed",
  secondary:
    "min-h-11 md:min-h-10 px-4 rounded-md bg-surface text-text border border-border-strong hover:bg-bg font-bold disabled:bg-disabled-bg disabled:text-disabled-text disabled:cursor-not-allowed",
  ghost:
    "min-h-11 md:min-h-10 px-3 rounded-md text-text hover:bg-bg font-bold disabled:bg-disabled-bg disabled:text-disabled-text disabled:cursor-not-allowed",
  danger:
    "min-h-11 md:min-h-10 px-4 rounded-md bg-danger text-on-primary font-bold disabled:bg-disabled-bg disabled:text-disabled-text disabled:cursor-not-allowed",
} as const satisfies Record<NonNullable<ButtonProps["variant"]>, string>;

export function Button({
  variant = "primary",
  type = "button",
  ...buttonProps
}: ButtonProps) {
  return (
    <button {...buttonProps} type={type} className={VARIANT_CLASSES[variant]} />
  );
}
