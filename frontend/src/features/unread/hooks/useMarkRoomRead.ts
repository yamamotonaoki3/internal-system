// 部屋で表示している最新のメッセージの ID まで、既読を送る（3-1 AC-2）。
// 送るのは、送った ID より大きい ID が来たときだけ。タブが非表示の間は送らず（見ていないため）、表示に戻ったときに保留していた最新の ID を送る。
// 失敗したら「送った ID」を最後に成功した ID に戻し、次の機会（次の新着・表示に戻ったとき）に送り直す。成功したら未読の件数を取り直す。
// 状態は部屋ごとに持ち、部屋が変わったら初期化する（使う側の key に頼らない）。前の部屋への送信の結果で、今の部屋の状態を変えない。
// 状態は描画に使わないため ref に置く（送る判定のためだけ）。失敗の表示だけは mutation の状態から導く。
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { unreadKeys } from "../api/query-keys";
import { markRoomRead } from "../api/unread-api";

type RoomState = {
  roomId: string;
  /** 表示している最新の ID */
  latest: string;
  /** 送った ID（送信中を含む）。失敗したら最後に成功した ID に戻す */
  sent: string;
  /** 最後に成功した ID（より大きいときだけ更新する） */
  succeeded: string;
};

type Request = { roomId: string; messageId: string };

const emptyState = (roomId: string): RoomState => ({
  roomId,
  latest: "",
  sent: "",
  succeeded: "",
});

export function useMarkRoomRead(roomId: string) {
  const queryClient = useQueryClient();
  const state = useRef<RoomState>(emptyState(roomId));

  const mutation = useMutation({
    mutationFn: ({ roomId: target, messageId }: Request) =>
      markRoomRead(target, messageId),
    onSuccess: async (_data, { roomId: target, messageId }) => {
      if (
        state.current.roomId === target &&
        messageId > state.current.succeeded
      )
        state.current.succeeded = messageId;
      await queryClient.invalidateQueries({ queryKey: unreadKeys.all });
    },
    onError: (_error, { roomId: target, messageId }) => {
      // 後から送った ID が進んでいるときは、その結果に任せる
      if (state.current.roomId === target && state.current.sent === messageId)
        state.current.sent = state.current.succeeded;
    },
  });
  const { mutate } = mutation;

  // 保留していた最新の ID を送る（送った ID より大きいときだけ）。非表示の間は送らない
  const sendLatest = useCallback(
    (target: string) => {
      const current = state.current;
      if (current.roomId !== target) return;
      if (document.visibilityState === "hidden") return;
      if (current.latest <= current.sent) return;
      current.sent = current.latest;
      mutate({ roomId: target, messageId: current.latest });
    },
    [mutate],
  );

  // useCallback は、使う側の effect（最新の ID が変わったら呼ぶ）の依存を安定させるためだけに使う
  const markRead = useCallback(
    (messageId: string) => {
      if (state.current.roomId !== roomId) state.current = emptyState(roomId);
      if (messageId > state.current.latest) state.current.latest = messageId;
      // 送った ID より大きい ID が来たときだけ送る（失敗して戻した位置より小さい・同じ ID では、新着の知らせとして送り直さない）
      if (messageId > state.current.sent) sendLatest(roomId);
    },
    [roomId, sendLatest],
  );

  // 非表示から表示に戻ったら、保留していた最新の ID（失敗して戻した分を含む）を送る。外部のイベントとの同期
  useEffect(() => {
    let wasHidden = document.visibilityState === "hidden";
    const sendWhenVisible = () => {
      if (document.visibilityState === "hidden") {
        wasHidden = true;
        return;
      }
      if (!wasHidden) return;
      wasHidden = false;
      sendLatest(roomId);
    };
    document.addEventListener("visibilitychange", sendWhenVisible);
    return () =>
      document.removeEventListener("visibilitychange", sendWhenVisible);
  }, [roomId, sendLatest]);

  // 今の部屋への最後の送信の失敗だけを出す（前の部屋の失敗・成功したあとは出さない）
  const error =
    mutation.isError && mutation.variables.roomId === roomId
      ? mutation.error
      : null;
  return { markRead, error };
}
