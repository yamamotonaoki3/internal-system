// リアクションを付ける・取り消す。成功（すでに付いている・外れている冪等の成功も）したら、応答の集計でその投稿の reactions だけを書き換える。
// 拒否（上限・削除済み・書き込めない部屋・見えない）や通信の失敗は、失敗として返すだけで、取り直さない（部屋を開き直すと最新になる。U-10）。
//
// 同じ投稿への操作は、投稿の ID ごとに直列にする（TanStack Query の scope）。同じ親の投稿は部屋の一覧とスレッドの両方に出て、
// それぞれの表示が別々にこのフックを持つため、直列にしないと応答の順が入れ替わり、古い集計が新しい集計を上書きする。
// scope は呼び出しごとに変わる（投稿の ID が引数）ため、useMutation の固定のオプションではなく、呼び出しごとに MutationObserver を作って渡す。
// 要求と書き戻しを同じ scope の中で終えるので、次の操作は書き戻しの後に始まる。
// 同じ投稿の送信中・待機中の状態は、mutationKey を使って useIsMutating（useIsReactionPending）で、すべての表示から読める。
import {
  MutationObserver,
  useIsMutating,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { addReaction, removeReaction, type Reaction } from "../api/message-api";
import {
  captureSession,
  isSameSession,
  replaceMessageReactions,
} from "./replace-message-reactions";

export type ToggleReactionInput = {
  messageId: string;
  kind: Reaction["kind"];
  value: string;
  /** 押した時点の画面の表示（真なら取り消し、偽なら付ける） */
  reactedByMe: boolean;
};

const reactionMutationKey = (messageId: string) =>
  ["message-reaction", messageId] as const;

/** その投稿へのリアクションの操作が、送信中か待機中か（同じ投稿を出しているすべての表示で同じ値になる） */
export function useIsReactionPending(messageId: string): boolean {
  return useIsMutating({ mutationKey: reactionMutationKey(messageId) }) > 0;
}

export function useToggleReaction(target: {
  roomId: string;
  parentMessageId: string | null;
}) {
  const queryClient = useQueryClient();
  return useMutation({
    // 外側はオフラインでも待たずに mutationFn に入り、セッションの記録（操作を始めたとき）を済ませる。
    // オフラインの待機は、記録の後の内側（既定の networkMode）に集める。復帰の時点で、内側が同じセッションかを確かめて送る
    networkMode: "always",
    mutationFn: ({
      messageId,
      kind,
      value,
      reactedByMe,
    }: ToggleReactionInput) => {
      // 操作を始めたときのセッションを覚える（待機の間に利用者が替わったら書かない）
      const snapshot = captureSession(queryClient);
      const observer = new MutationObserver(queryClient, {
        mutationKey: reactionMutationKey(messageId),
        scope: { id: `message-reaction:${messageId}` },
        gcTime: 0,
        mutationFn: async () => {
          // 順番待ちの間に利用者が替わったら、前の利用者の操作を次の利用者の Cookie で送らない。
          // 正しい動作なので、エラーにもキャッシュの書き換えにもしない
          if (!isSameSession(queryClient, snapshot)) return null;
          const result = reactedByMe
            ? await removeReaction(messageId, kind, value)
            : await addReaction(messageId, { kind, value });
          await replaceMessageReactions(
            queryClient,
            target,
            messageId,
            result.reactions,
            snapshot,
          );
          return result;
        },
      });
      // 成功・失敗・取りやめのどれで終わっても、Observer を外して、完了した mutation を MutationCache から回収する
      return observer.mutate().finally(() => observer.reset());
    },
  });
}
