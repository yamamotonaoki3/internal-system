// スレッド一覧（S-35）の一覧部分。4つの状態：読み込み中・失敗・0件・あり。
// 1行は、その行のスレッド（S-07）を開くリンク。部屋・親の本文・最後の返信の日時・返信の件数・未読の印を出す。
// 続きは「さらに表示」で取り足す。先頭から THREAD_LIST_MAX_PAGES ページまで読み込み、上限に達してなお続きがあるときは案内を出す。
// 並びが変わって同じスレッドが複数のページに現れたら、親の ID で重複を除く（新しいページを優先）。
import { Link } from "react-router";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { formatMessageTime } from "../../messages";
import { UnreadCountBadge } from "../../unread";
import type { ThreadItem } from "../api/thread-api";
import { describeError } from "../describe-error";
import {
  THREAD_LIST_MAX_ITEMS,
  THREAD_LIST_MAX_PAGES,
  useMyThreads,
} from "../hooks/useMyThreads";
import { useThreadParam } from "../hooks/useThreadParam";

function RoomLabel({ room }: { room: ThreadItem["room"] }) {
  if (room.kind === "channel") return <>{room.name}</>;
  return (
    <>
      {room.partner.displayName}
      {!room.partner.isActive && (
        <span className="text-text-muted">（退職者）</span>
      )}
    </>
  );
}

function uniqueByParent(items: ThreadItem[]): ThreadItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.parent.id)) return false;
    seen.add(item.parent.id);
    return true;
  });
}

export function ThreadList() {
  const threads = useMyThreads();
  const { searchFor } = useThreadParam();

  if (threads.isPending) return <p role="status">読み込み中です</p>;
  // 取得済みの一覧がないまま失敗したときは、0件と出さない
  if (threads.data === undefined)
    return (
      <Alert tone="error" role="alert">
        {describeError(threads.error)}
      </Alert>
    );

  const pages = threads.data.pages;
  const items = uniqueByParent(pages.flatMap((page) => page.items));
  const lastPage = pages.at(-1);
  const hasMore = lastPage !== undefined && lastPage.nextCursor !== null;
  const reachedLimit = pages.length >= THREAD_LIST_MAX_PAGES;
  return (
    <>
      {threads.isError && (
        <Alert tone="error" role="alert">
          {describeError(threads.error)}
        </Alert>
      )}
      {items.length === 0 ? (
        <p>スレッドはまだありません</p>
      ) : (
        <ul aria-label="スレッド一覧" className="mb-4">
          {items.map((item) => (
            <li key={item.parent.id} className="mb-2">
              <Link
                to={{ search: searchFor(item.parent.id) }}
                className="block rounded-md p-3 hover:bg-bg"
              >
                <span className="font-bold">
                  <RoomLabel room={item.room} />
                </span>{" "}
                <time
                  dateTime={item.lastReplyAt}
                  className="text-sm text-text-muted"
                >
                  {formatMessageTime(item.lastReplyAt)}
                </time>
                <span className="block">
                  {item.parent.body ?? "このメッセージは削除されました"}
                </span>
                <span className="text-sm text-text-muted">
                  返信 {item.parent.replyCount} 件
                </span>
                <UnreadCountBadge count={item.unreadCount} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {hasMore &&
        (reachedLimit ? (
          <p className="text-sm text-text-muted">
            最近のスレッドを{THREAD_LIST_MAX_ITEMS}件まで表示しています
          </p>
        ) : (
          <Button
            variant="secondary"
            disabled={threads.isFetchingNextPage}
            onClick={() => void threads.fetchNextPage()}
          >
            さらに表示
          </Button>
        ))}
    </>
  );
}
