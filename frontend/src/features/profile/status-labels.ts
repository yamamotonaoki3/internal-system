// ステータスの表示名と色。種類の定義元は shared/profile-rules.ts。色は index.css の @theme（--color-status-*）。
import type { UserStatusKind } from "../../../../shared/profile-rules";

export const STATUS_LABELS = {
  available: "在席",
  away: "外出",
  absent: "欠席",
  vacation: "休暇",
  meeting: "会議中",
} as const satisfies Record<UserStatusKind, string>;

// クラスは完全な文字列で書く（文字列連結で作ると、Tailwind がクラスを見つけられない）
export const STATUS_DOT_CLASSES = {
  available: "inline-block size-3 shrink-0 rounded-full bg-status-available",
  away: "inline-block size-3 shrink-0 rounded-full bg-status-away",
  absent: "inline-block size-3 shrink-0 rounded-full bg-status-absent",
  vacation: "inline-block size-3 shrink-0 rounded-full bg-status-vacation",
  meeting: "inline-block size-3 shrink-0 rounded-full bg-status-meeting",
} as const satisfies Record<UserStatusKind, string>;

// 読み込み中・取得に失敗したときの丸（色のトークンは文字の補足色を使う）。種類は読み上げ用の文字で伝える
export const STATUS_UNKNOWN_DOT_CLASS =
  "inline-block size-3 shrink-0 rounded-full bg-text-muted";
