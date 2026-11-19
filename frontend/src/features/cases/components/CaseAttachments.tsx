// S-17 の添付ファイルの区画（#148。5-2 AC-7）。見出し「添付ファイル」と、案件のメッセージの添付の一覧（新しい順）。
// 4つの状態（読み込み中・エラーと再試行・0件・あり）を分ける。続きの失敗は、読み込み済みの行を残して区画の中に出す。取得は CaseDetailView が持つ（参加者で詳細が取れたときだけ）。
// 「元のメッセージへ」は、スレッド（S-07）を ?thread= で開く。返信なら親の ID、トップレベルならそのメッセージの ID（C-184(4)）。
// ファイルは元のメッセージに結び付いたまま、取得は配信（/api/attachments/{id}）が毎回判定する（C-62）。
import { useId } from "react";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import {
  attachmentUrl,
  formatAttachmentSize,
  formatMessageTime,
} from "../../messages";
import { useThreadParam } from "../../threads";
import type { CaseAttachment } from "../api/case-api";
import type { useCaseAttachments } from "../hooks/useCaseAttachments";
import { CASE_ATTACHMENTS_TEXTS, retiredName } from "../labels";

function AttachmentRow({
  attachment,
  onJump,
}: {
  attachment: CaseAttachment;
  onJump: (parentMessageId: string) => void;
}) {
  const { uploader } = attachment;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border py-2">
      <a
        href={attachmentUrl(attachment.id)}
        download
        className="font-bold underline"
      >
        {attachment.name}
      </a>
      <span className="text-sm text-text-muted">
        {formatAttachmentSize(attachment.size)}
      </span>
      <span className="text-sm text-text-muted">
        {uploader.isActive
          ? uploader.displayName
          : retiredName(uploader.displayName)}
      </span>
      <time dateTime={attachment.uploadedAt} className="text-sm">
        {formatMessageTime(attachment.uploadedAt)}
      </time>
      <Button
        variant="ghost"
        onClick={() =>
          onJump(attachment.threadParentId ?? attachment.messageId)
        }
      >
        {CASE_ATTACHMENTS_TEXTS.jump}
      </Button>
    </li>
  );
}

export function CaseAttachments({
  attachments,
}: {
  attachments: ReturnType<typeof useCaseAttachments>;
}) {
  const headingId = useId();
  const thread = useThreadParam();

  function renderBody() {
    // 続き（2ページ目以降）の失敗は、1ページ目の失敗と分ける（読み込み済みの行を隠さない）
    if (attachments.isError && !attachments.isFetchNextPageError)
      return (
        <Alert tone="error">
          <p>{CASE_ATTACHMENTS_TEXTS.loadError}</p>
          <Button
            variant="secondary"
            onClick={() => void attachments.refetch()}
          >
            {CASE_ATTACHMENTS_TEXTS.retry}
          </Button>
        </Alert>
      );
    if (attachments.isPending)
      return <p role="status">{CASE_ATTACHMENTS_TEXTS.loading}</p>;
    const items = attachments.data.pages.flatMap((page) => page.items);
    if (items.length === 0) return <p>{CASE_ATTACHMENTS_TEXTS.empty}</p>;
    return (
      <>
        <ul>
          {items.map((attachment) => (
            <AttachmentRow
              key={attachment.id}
              attachment={attachment}
              onJump={thread.open}
            />
          ))}
        </ul>
        {attachments.isFetchNextPageError && (
          <Alert tone="error" role="alert">
            <p>{CASE_ATTACHMENTS_TEXTS.moreError}</p>
            <Button
              variant="secondary"
              disabled={attachments.isFetchingNextPage}
              onClick={() => void attachments.fetchNextPage()}
            >
              {CASE_ATTACHMENTS_TEXTS.retry}
            </Button>
          </Alert>
        )}
        {attachments.hasNextPage && (
          <div className="mt-2">
            <Button
              variant="secondary"
              disabled={attachments.isFetchingNextPage}
              onClick={() => void attachments.fetchNextPage()}
            >
              {CASE_ATTACHMENTS_TEXTS.more}
            </Button>
          </div>
        )}
      </>
    );
  }

  return (
    <section aria-labelledby={headingId} className="mt-6">
      <h2 id={headingId} className="mb-2 text-lg font-bold">
        {CASE_ATTACHMENTS_TEXTS.heading}
      </h2>
      {renderBody()}
    </section>
  );
}
