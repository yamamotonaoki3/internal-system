// チャンネルの作成申請のサーバーの状態のキー。書き込み（申請・取り下げ・承認・却下）が成功したら all を取り直す
// （自分の申請と審査一覧が一度に更新される）。
import type { RequestStatus } from "./channel-request-api";

export const channelRequestKeys = {
  all: ["channel-requests"] as const,
  mine: ["channel-requests", "mine"] as const,
  review: (status: RequestStatus) =>
    ["channel-requests", "review", status] as const,
};
