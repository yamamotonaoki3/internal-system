// 通知のサーバーの状態のキー。既読にしたときは all を取り直す（一覧とヘッダーの未読数が一度に更新される）。
export const notificationKeys = {
  all: ["notifications"] as const,
  list: ["notifications", "list"] as const,
  unreadCount: ["notifications", "unread-count"] as const,
};
