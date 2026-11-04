// 画面の枠。main の中に h1 を1つ置く。幅は main が決める（768px未満は画面いっぱい、以上は width の最大幅）。
// サイドバー等を含む共通レイアウトは #121。
import type { ReactNode } from "react";

type PageLayoutProps = {
  title: string;
  width?: "narrow" | "default";
  children: ReactNode;
};

// クラスは完全な文字列で書く（文字列連結で作ると、Tailwind がクラスを見つけられない）
const WIDTH_CLASSES = {
  narrow:
    "w-full max-w-md mx-auto my-6 md:my-12 p-4 md:p-6 bg-surface rounded-lg shadow-panel",
  default:
    "w-full max-w-3xl mx-auto my-6 md:my-12 p-4 md:p-6 bg-surface rounded-lg shadow-panel",
} as const satisfies Record<NonNullable<PageLayoutProps["width"]>, string>;

export function PageLayout({
  title,
  width = "default",
  children,
}: PageLayoutProps) {
  return (
    <main className={WIDTH_CLASSES[width]}>
      <h1 className="mb-4 text-2xl font-bold">{title}</h1>
      {children}
    </main>
  );
}
