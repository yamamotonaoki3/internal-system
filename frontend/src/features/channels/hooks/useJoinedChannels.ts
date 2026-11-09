// サイドバー用：参加中のチャンネル（GET /api/channels?joined=true）。
import { useChannels } from "./useChannels";

export function useJoinedChannels() {
  return useChannels({ joined: true });
}
