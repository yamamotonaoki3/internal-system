// スレッドの領域 S-07。見出し・閉じる・返信（messages の ThreadReplies）・既読の失敗の表示を持つ。パソコンでは横に並べ、スマートフォンでは全画面にする。
// 見出し「スレッド」は、読み込み中・失敗でも出し、開いたときにフォーカスする。閉じたら、開いた要素（「返信 n 件」のボタン・一覧の行）へフォーカスを戻す。
// 参加者として最新の返信が表示されたら、スレッドの既読を送る（参加していない公開チャンネルでは ThreadReplies が知らせない）。
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { ThreadReplies } from "../../messages";
import { threadKeys } from "../api/query-keys";
import { describeError } from "../describe-error";
import { useMarkThreadRead } from "../hooks/useMarkThreadRead";
import { useThreadParam } from "../hooks/useThreadParam";

type ThreadPaneProps = {
  parentMessageId: string;
  /** 今開いている部屋（チャンネル・DM の画面）。その部屋のスレッドでなければ「見つかりません」を出す。スレッド一覧では渡さない */
  roomId?: string;
  /** 表示名に「退職者」を併記する投稿者の利用者ID（DM の相手が無効のとき） */
  retiredAuthorIds?: readonly string[];
  /** 自分の返信が成功したあとに呼ぶ（画面ごとの取り直しのため。省略できる） */
  onReplied?: () => void;
  /** 返信の削除が成功したあとに呼ぶ（画面ごとの取り直しのため。省略できる） */
  onDeleted?: () => void;
};

function OpenThreadPane({
  parentMessageId,
  roomId,
  retiredAuthorIds,
  onReplied,
  onDeleted,
}: ThreadPaneProps) {
  const { close } = useThreadParam();
  const queryClient = useQueryClient();
  const read = useMarkThreadRead(parentMessageId);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  // 開いた要素を覚えて、見出しへフォーカスを移す（外部の DOM のフォーカスとの同期）
  useEffect(() => {
    const active = document.activeElement;
    if (
      openerRef.current === null &&
      active instanceof HTMLElement &&
      active !== document.body &&
      active !== headingRef.current
    )
      openerRef.current = active;
    headingRef.current?.focus();
  }, []);

  function handleClose() {
    openerRef.current?.focus();
    close();
  }

  return (
    <section
      aria-label="スレッド"
      className="fixed inset-0 z-20 overflow-y-auto bg-surface p-4 md:static md:z-auto md:w-96 md:shrink-0 md:rounded-lg md:p-6"
    >
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 ref={headingRef} tabIndex={-1} className="text-xl font-bold">
          スレッド
        </h2>
        <Button
          variant="secondary"
          aria-label="スレッドを閉じる"
          onClick={handleClose}
        >
          閉じる
        </Button>
      </div>
      <ThreadReplies
        parentMessageId={parentMessageId}
        roomId={roomId}
        retiredAuthorIds={retiredAuthorIds}
        onLatestReplyIdChange={read.markRead}
        onDeleted={onDeleted}
        // 自分の返信で、スレッド一覧（件数・並び）をすぐ取り直す
        onReplied={() => {
          void queryClient.invalidateQueries({ queryKey: threadKeys.all });
          onReplied?.();
        }}
      />
      {read.error !== null && (
        <Alert tone="error" role="alert">
          既読の状態を更新できませんでした。{describeError(read.error)}
        </Alert>
      )}
    </section>
  );
}

export function ThreadPane(props: ThreadPaneProps) {
  // 別のスレッドへ替わったら作り直す（開いた要素・フォーカス・既読の状態を持ち越さない）
  return <OpenThreadPane key={props.parentMessageId} {...props} />;
}
