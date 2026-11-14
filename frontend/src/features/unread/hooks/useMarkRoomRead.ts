// 部屋で表示している最新のメッセージの ID まで、既読を送る（3-1 AC-2）。送り方は useReadPositionSender（スレッドの既読と共通）。
// 成功したら未読の件数を取り直す（サイドバーの件数が再読み込みなしで消える）。
import { useQueryClient } from "@tanstack/react-query";
import { unreadKeys } from "../api/query-keys";
import { markRoomRead } from "../api/unread-api";
import { useReadPositionSender } from "./useReadPositionSender";

export function useMarkRoomRead(roomId: string) {
  const queryClient = useQueryClient();
  return useReadPositionSender({
    target: roomId,
    send: markRoomRead,
    onSent: () => queryClient.invalidateQueries({ queryKey: unreadKeys.all }),
  });
}
