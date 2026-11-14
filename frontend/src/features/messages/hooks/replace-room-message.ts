// 編集・削除の結果を、部屋の一覧のキャッシュの該当の1件だけに反映する（取り直しの要求を増やさない）。
// 実行中の取得（2秒ごとの新着）が、反映の前の一覧で上書きしないよう、先に止めてから書く。
import type { QueryClient } from "@tanstack/react-query";
import type { RoomMessage } from "../api/message-api";
import { messageKeys } from "../api/query-keys";

export async function replaceRoomMessage(
  queryClient: QueryClient,
  roomId: string,
  messageId: string,
  replace: (message: RoomMessage) => RoomMessage,
): Promise<void> {
  const queryKey = messageKeys.room(roomId);
  await queryClient.cancelQueries({ queryKey });
  queryClient.setQueryData<RoomMessage[]>(queryKey, (messages) =>
    messages?.map((message) =>
      message.id === messageId ? replace(message) : message,
    ),
  );
}
