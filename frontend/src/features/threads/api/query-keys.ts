// スレッド一覧のサーバーの状態のキー。スレッドの既読を送ったら all を取り直す（一覧の未読の印が再読み込みなしで消える）。
export const threadKeys = {
  all: ["threads"] as const,
  list: ["threads", "list"] as const,
};
