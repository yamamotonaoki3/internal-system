// 付ける・取り消すの応答の集計で、キャッシュの該当の1件の reactions だけを書き換える（取り直さない）。
// 書き込む直前（更新の関数の中）に、操作を始めたときと今のセッションが同じかを確かめ、違えば書かない
// （ログアウト・別の利用者への切り替え・同じ ID の再ログイン・clear() の後に、遅れた応答が別の利用者のキャッシュを書き換えない。usePasswordChange と同じ確かめ方）。
// キャッシュがなければ作らない（更新の関数が undefined を返すと、TanStack Query は作らない）。書かなかったときはエラーにもログにもしない（正しい動作）。
import type { QueryClient } from "@tanstack/react-query";
import { authKeys, type SessionInfo } from "../../auth";
import type { Reaction, RoomMessage } from "../api/message-api";
import { messageKeys } from "../api/query-keys";
import type { ThreadRepliesData } from "./useThreadReplies";

const findSessionQuery = (queryClient: QueryClient) =>
  queryClient.getQueryCache().find({ queryKey: authKeys.session, exact: true });
const sessionUserId = (queryClient: QueryClient) =>
  queryClient.getQueryData<SessionInfo>(authKeys.session)?.user.id;

export type SessionSnapshot = {
  query: ReturnType<typeof findSessionQuery>;
  userId: string | undefined;
};

/** 操作を始めたとき（onMutate）に、セッションの Query 本体と利用者 ID を覚える */
export function captureSession(queryClient: QueryClient): SessionSnapshot {
  return {
    query: findSessionQuery(queryClient),
    userId: sessionUserId(queryClient),
  };
}

export function isSameSession(
  queryClient: QueryClient,
  snapshot: SessionSnapshot,
) {
  const userId = sessionUserId(queryClient);
  return (
    snapshot.query !== undefined &&
    snapshot.userId !== undefined &&
    findSessionQuery(queryClient) === snapshot.query &&
    userId === snapshot.userId
  );
}

const withReactions = (message: RoomMessage, reactions: Reaction[]) => ({
  ...message,
  reactions,
});

export async function replaceMessageReactions(
  queryClient: QueryClient,
  target: { roomId: string; parentMessageId: string | null },
  messageId: string,
  reactions: Reaction[],
  snapshot: SessionSnapshot,
): Promise<void> {
  if (target.parentMessageId === null) {
    // 親の投稿は、部屋の一覧とスレッドの親の両方に出る
    const roomKey = messageKeys.room(target.roomId);
    const threadKey = messageKeys.thread(messageId);
    await Promise.all([
      queryClient.cancelQueries({ queryKey: roomKey }),
      queryClient.cancelQueries({ queryKey: threadKey }),
    ]);
    queryClient.setQueryData<RoomMessage[]>(roomKey, (messages) =>
      messages === undefined || !isSameSession(queryClient, snapshot)
        ? messages
        : messages.map((message) =>
            message.id === messageId
              ? withReactions(message, reactions)
              : message,
          ),
    );
    queryClient.setQueryData<ThreadRepliesData>(threadKey, (thread) =>
      thread === undefined || !isSameSession(queryClient, snapshot)
        ? thread
        : { ...thread, parent: withReactions(thread.parent, reactions) },
    );
    return;
  }
  const threadKey = messageKeys.thread(target.parentMessageId);
  await queryClient.cancelQueries({ queryKey: threadKey });
  queryClient.setQueryData<ThreadRepliesData>(threadKey, (thread) =>
    thread === undefined || !isSameSession(queryClient, snapshot)
      ? thread
      : {
          ...thread,
          replies: thread.replies.map((message) =>
            message.id === messageId
              ? withReactions(message, reactions)
              : message,
          ),
        },
  );
}
