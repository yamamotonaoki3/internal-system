// S-15 のメッセージの検索の結果。読み込み中・0件・失敗と再試行・さらに表示を出す。
// 失敗したときは、前の結果を出さない（取得済みのページも含めて）。
// ファイル名で一致した行には、印と一致した名前の一覧を出す。
// 行のリンクは元の場所（チャンネル・案件の部屋は /channels、DM は /dms）の該当のスレッドへ。返信は親のスレッドを開く。
import { Link } from "react-router";
import { Button } from "../../../components/Button";
import { ATTACHMENT_ONLY_LABEL, formatMessageTime } from "../../messages";
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

// ファイル名はリンクにしない（結果からファイルを直接開かせず、配信の経路を増やさない）
function MatchedAttachmentNames({
  attachments,
  keyword,
}: {
  attachments: MessageSearchItem["matchedAttachments"];
  keyword: string;
}) {
  return (
    <div className="mt-1 text-sm">
      <p className="text-text-muted">ファイル名で一致</p>
      <ul aria-label="一致したファイル名" className="flex flex-col">
        {attachments.map((attachment) => (
          <li key={attachment.id} className="break-all">
            <HighlightedExcerpt text={attachment.name} keyword={keyword} />
          </li>
        ))}
      </ul>
    </div>
  );
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
  const { query, showMore } = useMessageSearch(conditions);
  // 失敗したら、取得済みの結果があっても出さない（資格を失った後の抜粋を残さない）。再試行は1ページ目から取り直す
  if (query.isError) return <Failure onRetry={() => void query.refetch()} />;
  if (query.data === undefined)
    return (
      <p role="status" className="text-text-muted">
        読み込み中です
      </p>
    );
  const { items, hasMore } = query.data;
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
                {item.excerpt === "" ? (
                  ATTACHMENT_ONLY_LABEL
                ) : (
                  <HighlightedExcerpt
                    text={item.excerpt}
                    keyword={conditions.q}
                  />
                )}
              </Link>
              {item.matchedIn.includes("attachment") && (
                <MatchedAttachmentNames
                  attachments={item.matchedAttachments}
                  keyword={conditions.q}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {hasMore && (
        <Button
          variant="secondary"
          disabled={query.isFetching}
          onClick={showMore}
        >
          さらに表示
        </Button>
      )}
    </>
  );
}
