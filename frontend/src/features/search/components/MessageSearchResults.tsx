// S-15 のメッセージの検索の結果。読み込み中・0件・失敗と再試行・さらに表示を出す。
// 失敗したときは、前の結果を出さない（読み込み済みのページがある「さらに表示」の失敗だけ、読み込み済みの分を残す）。
// 行のリンクは元の場所（チャンネル・案件の部屋は /channels、DM は /dms）の該当のスレッドへ。返信は親のスレッドを開く。
import { Link } from "react-router";
import { Button } from "../../../components/Button";
import { formatMessageTime } from "../../messages";
import type { MessageSearchConditions } from "../api/query-keys";
import type { MessageSearchItem } from "../api/search-api";
import { useMessageSearch } from "../hooks/useMessageSearch";
import { HighlightedExcerpt } from "./HighlightedExcerpt";

function linkOf(item: MessageSearchItem): string {
  const thread = encodeURIComponent(item.parentMessageId ?? item.messageId);
  const room = encodeURIComponent(item.roomId);
  // 案件の部屋は、チャンネルの画面が案件の画面へ移す（?thread= を引き継ぐ）
  return item.roomKind === "direct"
    ? `/dms/${room}?thread=${thread}`
    : `/channels/${room}?thread=${thread}`;
}

function Failure({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="mb-4 flex items-center gap-2 text-danger">
      <p>検索できませんでした</p>
      <Button variant="secondary" onClick={onRetry}>
        再試行
      </Button>
    </div>
  );
}

export function MessageSearchResults({
  conditions,
}: {
  conditions: MessageSearchConditions;
}) {
  const search = useMessageSearch(conditions);
  if (search.data === undefined) {
    if (search.isError)
      return <Failure onRetry={() => void search.refetch()} />;
    return (
      <p role="status" className="text-text-muted">
        読み込み中です
      </p>
    );
  }
  const items = search.data.pages.flatMap((page) => page.items);
  return (
    <>
      {items.length === 0 ? (
        <p>一致するメッセージはありません</p>
      ) : (
        <ul aria-label="検索結果の一覧" className="mb-4 flex flex-col gap-2">
          {items.map((item) => (
            <li
              key={item.messageId}
              className="rounded-md border border-border p-3"
            >
              <p className="text-sm text-text-muted">
                <span>{item.roomName}</span>
                {" ・ "}
                <span>{item.author.displayName}</span>
                {" ・ "}
                <time dateTime={item.createdAt}>
                  {formatMessageTime(item.createdAt)}
                </time>
              </p>
              <Link to={linkOf(item)} className="block break-words underline">
                <HighlightedExcerpt
                  text={item.excerpt}
                  keyword={conditions.q}
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {search.isError ? (
        <Failure
          onRetry={() =>
            void (search.isFetchNextPageError
              ? search.fetchNextPage()
              : search.refetch())
          }
        />
      ) : (
        search.hasNextPage && (
          <Button
            variant="secondary"
            disabled={search.isFetchingNextPage}
            onClick={() => void search.fetchNextPage()}
          >
            さらに表示
          </Button>
        )
      )}
    </>
  );
}
