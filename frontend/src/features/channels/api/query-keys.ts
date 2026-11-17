// チャンネルのサーバーの状態のキー。参加したときは all を取り直す（一覧・サイドバー・詳細が一度に更新される）。
// 管理者用の一覧（#143-b）は、利用者の ID をキーに入れる（利用者が替わったときに前の利用者の一覧を出さない）。all の下なので、管理の操作の後に一緒に取り直される
import type { AdminChannelFilter, ChannelListFilter } from "./channel-api";

export const channelKeys = {
  all: ["channels"] as const,
  list: (filter: ChannelListFilter) => ["channels", "list", filter] as const,
  detail: (channelId: string) => ["channels", "detail", channelId] as const,
  admin: (userId: string, filter: AdminChannelFilter) =>
    ["channels", "admin", userId, filter] as const,
  archived: (userId: string) => ["channels", "archived", userId] as const,
};
