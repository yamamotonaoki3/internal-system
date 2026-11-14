// スレッドで表示している最新の返信の ID まで、既読を送る（EP-3-09）。送り方は useReadPositionSender（部屋の既読と共通）。
// 成功したら、スレッド一覧を取り直す（未読の印が再読み込みなしで消える）。部屋の未読には返信を数えないので、部屋の未読は取り直さない（U-2）。
import { useQueryClient } from "@tanstack/react-query";
import { useReadPositionSender } from "../../unread";
import { threadKeys } from "../api/query-keys";
import { markThreadRead } from "../api/thread-api";

export function useMarkThreadRead(parentMessageId: string) {
  const queryClient = useQueryClient();
  return useReadPositionSender({
    target: parentMessageId,
    send: markThreadRead,
    onSent: () => queryClient.invalidateQueries({ queryKey: threadKeys.all }),
  });
}
