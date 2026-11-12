// DM のサーバーの状態のキー。開始・投稿のときは all か list を取り直す（サイドバー・一覧・詳細が一度に更新される）。
export const dmKeys = {
  all: ["dms"] as const,
  list: ["dms", "list"] as const,
  detail: (roomId: string) => ["dms", "detail", roomId] as const,
};
