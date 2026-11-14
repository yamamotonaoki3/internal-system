// 開いているスレッドを、URL のクエリ ?thread=<親ID> で持つ（チャンネル詳細・DM・スレッド一覧で共通）。
// URL に持つので、再読み込み・リンクの共有・戻る操作でもスレッドが保たれる。ほかのクエリは残す。
import { useSearchParams } from "react-router";

const THREAD_PARAM = "thread";

export function useThreadParam() {
  const [params, setParams] = useSearchParams();
  const raw = params.get(THREAD_PARAM);
  const withThread = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id === null) next.delete(THREAD_PARAM);
    else next.set(THREAD_PARAM, id);
    return next;
  };
  return {
    parentMessageId: raw === null || raw === "" ? null : raw,
    /** そのスレッドを開く（履歴に積む） */
    open: (parentMessageId: string) => setParams(withThread(parentMessageId)),
    /** スレッドを閉じる（thread だけを外す。履歴に積む） */
    close: () => setParams(withThread(null)),
    /** そのスレッドを開くリンクの search（現在のパスとほかのクエリは変えない） */
    searchFor: (parentMessageId: string) =>
      `?${withThread(parentMessageId).toString()}`,
  };
}
