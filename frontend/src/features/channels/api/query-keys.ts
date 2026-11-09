// チャンネルのサーバーの状態のキー。参加したときは all を取り直す（一覧・サイドバー・詳細が一度に更新される）。
import type { ChannelListFilter } from "./channel-api";

export const channelKeys = {
  all: ["channels"] as const,
  list: (filter: ChannelListFilter) => ["channels", "list", filter] as const,
  detail: (channelId: string) => ["channels", "detail", channelId] as const,
};
