// 編集・削除の結果を、キャッシュの該当の1件だけに反映する（取り直しの要求を増やさない）。
// 部屋の一覧の投稿はその部屋の一覧に、スレッドの返信はそのスレッドのキャッシュに反映する。
// 実行中の取得（2秒ごとの新着）が、反映の前の内容で上書きしないよう、先に止めてから書く。
import type { QueryClient } from "@tanstack/react-query";
import type { RoomMessage } from "../api/message-api";
import { messageKeys } from "../api/query-keys";
import type { ThreadRepliesData } from "./useThreadReplies";

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

/** スレッドのキャッシュの親（部屋の一覧とは別に持たれている）を書き換える。スレッドを開いていなければ何もしない */
export async function replaceThreadParent(
  queryClient: QueryClient,
  parentMessageId: string,
  replace: (message: RoomMessage) => RoomMessage,
): Promise<void> {
  const queryKey = messageKeys.thread(parentMessageId);
  await queryClient.cancelQueries({ queryKey });
  queryClient.setQueryData<ThreadRepliesData>(queryKey, (thread) =>
    thread === undefined
      ? undefined
      : { ...thread, parent: replace(thread.parent) },
  );
}

async function replaceThreadReply(
  queryClient: QueryClient,
  parentMessageId: string,
  messageId: string,
  replace: (message: RoomMessage) => RoomMessage,
): Promise<void> {
  const queryKey = messageKeys.thread(parentMessageId);
  await queryClient.cancelQueries({ queryKey });
  queryClient.setQueryData<ThreadRepliesData>(queryKey, (thread) =>
    thread === undefined
      ? undefined
      : {
          ...thread,
          replies: thread.replies.map((message) =>
            message.id === messageId ? replace(message) : message,
          ),
        },
  );
}

/** 返信（parentMessageId がある投稿）はスレッドのキャッシュに、それ以外は部屋の一覧に反映する */
export function replaceCachedMessage(
  queryClient: QueryClient,
  target: { roomId: string; parentMessageId: string | null },
  messageId: string,
  replace: (message: RoomMessage) => RoomMessage,
): Promise<void> {
  return target.parentMessageId === null
    ? replaceRoomMessage(queryClient, target.roomId, messageId, replace)
    : replaceThreadReply(
        queryClient,
        target.parentMessageId,
        messageId,
        replace,
      );
}
