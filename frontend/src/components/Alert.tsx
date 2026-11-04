// 共通の通知。tone で見た目を選ぶ。role は呼び出し側が渡したものだけを付ける（勝手に読み上げさせない）。
import type { ComponentProps, ReactNode } from "react";

type AlertProps = {
  tone: "error" | "info" | "warning";
  role?: ComponentProps<"div">["role"];
  // もとの要素の種類を保つために選ぶ。固定の2値だけ（任意のタグは受け取らない）
  as?: "p" | "div";
  children: ReactNode;
};

// クラスは完全な文字列で書く（文字列連結で作ると、Tailwind がクラスを見つけられない）
const TONE_CLASSES = {
  error:
    "mb-4 rounded-md border border-danger-border bg-danger-bg p-3 text-danger",
  info: "mb-4 rounded-md bg-info-bg p-3 text-info-text",
  warning: "mb-4 rounded-md bg-warning-bg p-3 text-warning-text",
} as const satisfies Record<AlertProps["tone"], string>;

export function Alert({ tone, role, as = "div", children }: AlertProps) {
  if (as === "p") {
    return (
      <p role={role} className={TONE_CLASSES[tone]}>
        {children}
      </p>
    );
  }
  return (
    <div role={role} className={TONE_CLASSES[tone]}>
      {children}
    </div>
  );
}
