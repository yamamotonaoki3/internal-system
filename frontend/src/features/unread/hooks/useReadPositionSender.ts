// 既読位置を、表示している最新のメッセージの ID まで送る共通の部品（部屋の既読・スレッドの既読が使う。3-1 AC-2）。
// 送るのは、送った ID より大きい ID が来たときだけ。タブが非表示の間は送らず（見ていないため）、表示に戻ったときに保留していた最新の ID を送る。
// 失敗したら「送った ID」を最後に成功した ID に戻し、次の機会（次の新着・表示に戻ったとき）に送り直す。成功したら onSent（件数の取り直しなど）を呼ぶ。
// 状態は送り先（target）ごとに持ち、target が変わったら初期化する（使う側の key に頼らない）。前の送り先への送信の結果で、今の状態を変えない。
// 状態は描画に使わないため ref に置く（送る判定のためだけ）。失敗の表示だけは mutation の状態から導く。
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";

type TargetState = {
  target: string;
  /** 表示している最新の ID */
  latest: string;
  /** 送った ID（送信中を含む）。失敗したら最後に成功した ID に戻す */
  sent: string;
  /** 最後に成功した ID（より大きいときだけ更新する） */
  succeeded: string;
};

type Request = { target: string; messageId: string };

const emptyState = (target: string): TargetState => ({
  target,
  latest: "",
  sent: "",
  succeeded: "",
});

type ReadPositionSenderOptions = {
  /** 送り先（部屋の ID・スレッドの親の ID） */
  target: string;
  /** 既読位置を送る通信 */
  send: (target: string, messageId: string) => Promise<void>;
  /** 送信に成功したあと（未読の件数の取り直しなど） */
  onSent: () => Promise<unknown>;
};

export function useReadPositionSender({
  target: current,
  send,
  onSent,
}: ReadPositionSenderOptions) {
  const state = useRef<TargetState>(emptyState(current));

  const mutation = useMutation({
    mutationFn: ({ target, messageId }: Request) => send(target, messageId),
    onSuccess: async (_data, { target, messageId }) => {
      if (
        state.current.target === target &&
        messageId > state.current.succeeded
      )
        state.current.succeeded = messageId;
      await onSent();
    },
    onError: (_error, { target, messageId }) => {
      // 後から送った ID が進んでいるときは、その結果に任せる
      if (state.current.target === target && state.current.sent === messageId)
        state.current.sent = state.current.succeeded;
    },
  });
  const { mutate } = mutation;

  // 保留していた最新の ID を送る（送った ID より大きいときだけ）。非表示の間は送らない
  const sendLatest = useCallback(
    (target: string) => {
      const latestState = state.current;
      if (latestState.target !== target) return;
      if (document.visibilityState === "hidden") return;
      if (latestState.latest <= latestState.sent) return;
      latestState.sent = latestState.latest;
      mutate({ target, messageId: latestState.latest });
    },
    [mutate],
  );

  // useCallback は、使う側の effect（最新の ID が変わったら呼ぶ）の依存を安定させるためだけに使う
  const markRead = useCallback(
    (messageId: string) => {
      if (state.current.target !== current) state.current = emptyState(current);
      if (messageId > state.current.latest) state.current.latest = messageId;
      // 送った ID より大きい ID が来たときだけ送る（失敗して戻した位置より小さい・同じ ID では、新着の知らせとして送り直さない）
      if (messageId > state.current.sent) sendLatest(current);
    },
    [current, sendLatest],
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
      sendLatest(current);
    };
    document.addEventListener("visibilitychange", sendWhenVisible);
    return () =>
      document.removeEventListener("visibilitychange", sendWhenVisible);
  }, [current, sendLatest]);

  // 今の送り先への最後の送信の失敗だけを出す（前の送り先の失敗・成功したあとは出さない）
  const error =
    mutation.isError && mutation.variables.target === current
      ? mutation.error
      : null;
  return { markRead, error };
}
