// スレッドを開ける画面（チャンネル・DM）の枠。スレッドを開いているときは、本体（children）の隣（スマートフォンでは全画面）に ThreadPane を出す。
// 開いているスレッドは URL の ?thread= が持つ（useThreadParam）。本体の側は、スレッドを開く操作（open）だけを useThreadParam から受け取る。
import type { ReactNode } from "react";
import { useThreadParam } from "../hooks/useThreadParam";
import { ThreadPane } from "./ThreadPane";

type ThreadLayoutProps = {
  /** 本体の部屋の ID。別の部屋のスレッドを、この部屋のものとして開かない */
  roomId: string;
  /** 表示名に「退職者」を併記する投稿者の利用者ID（DM の相手が無効のとき） */
  retiredAuthorIds?: readonly string[];
  /** 自分の返信が成功したあとに呼ぶ（画面ごとの取り直しのため。省略できる） */
  onReplied?: () => void;
  children: ReactNode;
};

export function ThreadLayout({
  roomId,
  retiredAuthorIds,
  onReplied,
  children,
}: ThreadLayoutProps) {
  const { parentMessageId } = useThreadParam();
  // 開いていても開いていなくても同じ構造を返す。構造が変わると、React が本体（一覧・入力欄）を作り直し、開いた要素・スクロール位置・入力中の状態を失う
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 md:flex-row md:items-start">
      {children}
      {parentMessageId !== null && (
        <ThreadPane
          parentMessageId={parentMessageId}
          roomId={roomId}
          retiredAuthorIds={retiredAuthorIds}
          onReplied={onReplied}
        />
      )}
    </div>
  );
}
