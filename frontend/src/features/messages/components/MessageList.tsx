// メッセージの一覧（4つの状態：読み込み中・エラー・0件・あり）。本文はテキストとして出す（自動エスケープに任せる）。
// 一覧は role="log"・aria-live="polite"（新着を読み上げる）。取得に失敗しても、取得済みの一覧は残して上にエラーを出す。
import { Alert } from "../../../components/Alert";
import type { RoomMessage } from "../api/message-api";
import { describeError } from "../describe-error";

type MessageListProps = {
  messages: RoomMessage[] | undefined;
  isPending: boolean;
  error: unknown;
  emptyText?: string;
  /** 表示名に「退職者」を併記する投稿者の利用者ID（既定は併記しない） */
  retiredAuthorIds?: readonly string[];
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function MessageList({
  messages,
  isPending,
  error,
  emptyText = "まだメッセージはありません",
  retiredAuthorIds = [],
}: MessageListProps) {
  const failure =
    error === null ? null : (
      <Alert tone="error" role="alert">
        {describeError(error)}
      </Alert>
    );
  if (isPending) return <p role="status">読み込み中です</p>;
  // 取得済みの一覧がないまま失敗したときは、0件と出さない
  if (messages === undefined) return failure;
  return (
    <>
      {failure}
      <div
        role="log"
        aria-live="polite"
        aria-label="メッセージ一覧"
        className="mb-4 max-h-96 overflow-y-auto"
      >
        {messages.length === 0 ? (
          <p className="text-text-muted">{emptyText}</p>
        ) : (
          <ul>
            {messages.map((message) => (
              <li key={message.id} className="mb-3">
                <p className="text-sm">
                  <span className="font-bold">
                    {message.author.displayName}
                  </span>
                  {retiredAuthorIds.includes(message.author.id) && (
                    <span className="text-text-muted">（退職者）</span>
                  )}{" "}
                  <time
                    dateTime={message.createdAt}
                    className="text-text-muted"
                  >
                    {formatTime(message.createdAt)}
                  </time>
                </p>
                <p className="whitespace-pre-wrap break-words">
                  {message.body}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
