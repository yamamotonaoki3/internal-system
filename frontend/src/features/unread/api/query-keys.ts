// 未読のサーバーの状態のキー（1か所）。既読にしたときは all を取り直す（サイドバーの件数が再読み込みなしで消える）。
export const unreadKeys = {
  all: ["unread"] as const,
  counts: ["unread", "counts"] as const,
};
