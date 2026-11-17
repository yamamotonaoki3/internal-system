// S-39・S-38（#143-b）の表示の文字（1か所）。種類の印は文字で出す（D-1）。
import type { AdminChannel } from "./api/channel-api";

export const CHANNEL_PURPOSE_LABELS = {
  normal: "通常",
  department: "部署の専用",
  announcement: "お知らせ専用",
  company_general: "全社連絡",
} as const satisfies Record<AdminChannel["purpose"], string>;

export const CHANNEL_VISIBILITY_LABELS = {
  public: "公開",
  private: "非公開",
} as const satisfies Record<AdminChannel["visibility"], string>;

export const CHANNEL_STATE_LABELS = {
  active: "使用中",
  archived: "アーカイブ中",
} as const satisfies Record<AdminChannel["state"], string>;

/** 部署の表示。無効なら「（無効）」を添え、会社直属は「会社直属」 */
export function departmentLabel(department: AdminChannel["department"]) {
  if (department === null) return "会社直属";
  return `${department.name}${department.isActive ? "" : "（無効）"}`;
}

// sv-SE の書式は「YYYY-MM-DD HH:mm」の形になる。時刻帯を日本時間に固定し、実行環境に依存させない
const JST_FORMAT = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** UTC の ISO 8601 を、日本時間の「YYYY-MM-DD HH:mm」にする */
export function formatJstDateTime(iso: string): string {
  return JST_FORMAT.format(new Date(iso));
}
