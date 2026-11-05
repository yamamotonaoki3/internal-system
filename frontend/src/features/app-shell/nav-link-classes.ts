// サイドバー・ドロワー・管理メニューのリンクの見た目。現在のページは色だけでなく太字でも示す。
// クラスは完全な文字列で書く（文字列連結で作ると、Tailwind がクラスを見つけられない）
export const NAV_LINK_CLASSES = {
  active:
    "flex min-h-11 items-center rounded-md bg-info-bg px-3 font-bold text-info-text md:min-h-10",
  bottomActive:
    "flex min-h-12 w-full items-center justify-center bg-info-bg px-3 font-bold text-info-text",
  bottomIdle:
    "flex min-h-12 w-full items-center justify-center px-3 text-text hover:bg-bg",
  idle: "flex min-h-11 items-center rounded-md px-3 text-text hover:bg-bg md:min-h-10",
} as const;
