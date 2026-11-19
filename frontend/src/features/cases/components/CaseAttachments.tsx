// S-17 の添付ファイルの区画（#148。5-2 AC-7）。見出し「添付ファイル」と、案件のメッセージの添付の一覧（新しい順）。
// 4つの状態（読み込み中・エラーと再試行・0件・あり）を分ける。続きの失敗は、読み込み済みの行を残して区画の中に出す。取得は CaseDetailView が持つ（参加者で詳細が取れたときだけ）。
// 「元のメッセージへ」は、スレッド（S-07）を ?thread= で開く。返信なら親の ID、トップレベルならそのメッセージの ID（C-184(4)）。
// ファイルは元のメッセージに結び付いたまま、取得は配信（/api/attachments/{id}）が毎回判定する（C-62）。
// 各行に公開範囲を出し、変えられる行（canChangeVisibility）だけに「公開範囲を変更」を出す（5-2 AC-9。表示の制御だけで、認可はサーバー）。
// 開いている変更の対象は CaseDetailView が持つ（外されたときに、ほかのダイアログと一緒に閉じるため）。結果は区画の中に出す：
// 成功・422 以外の失敗はダイアログを閉じて区画に出し、422 はダイアログの中に出す。成功の文は次の変更の開始で、失敗の文は次の結果で消す。
import { useId, useState } from "react";
import type { PublicationVisibility } from "../../../../../shared/attachment-rules";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import {
  attachmentUrl,
  formatAttachmentSize,
  formatMessageTime,
} from "../../messages";
import { useThreadParam } from "../../threads";
import type { CaseAttachment } from "../api/case-api";
import { describeError, isApiError } from "../describe-error";
import type { useCaseAttachments } from "../hooks/useCaseAttachments";
import { useChangeAttachmentVisibility } from "../hooks/useCaseWrites";
import {
  CASE_ATTACHMENTS_TEXTS,
  PUBLICATION_VISIBILITY_LABELS,
  retiredName,
} from "../labels";
import { CaseAttachmentVisibilityDialog } from "./CaseAttachmentVisibilityDialog";

type ChangeResult = { tone: "info" | "error"; text: string };

function AttachmentRow({
  attachment,
  changing,
  onJump,
  onChangeVisibility,
}: {
  attachment: CaseAttachment;
  changing: boolean;
  onJump: (parentMessageId: string) => void;
  onChangeVisibility: (attachment: CaseAttachment) => void;
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
      <span className="text-sm">
        {PUBLICATION_VISIBILITY_LABELS[attachment.publicationVisibility]}
      </span>
      <Button
        variant="ghost"
        onClick={() =>
          onJump(attachment.threadParentId ?? attachment.messageId)
        }
      >
        {CASE_ATTACHMENTS_TEXTS.jump}
      </Button>
      {attachment.canChangeVisibility && (
        <Button
          variant="ghost"
          disabled={changing}
          onClick={() => onChangeVisibility(attachment)}
        >
          {CASE_ATTACHMENTS_TEXTS.changeVisibility(attachment.name)}
        </Button>
      )}
    </li>
  );
}

export function CaseAttachments({
  attachments,
  visibilityTarget,
  onVisibilityTargetChange,
}: {
  attachments: ReturnType<typeof useCaseAttachments>;
  /** 公開範囲の変更のダイアログで開いている添付（閉じていれば null） */
  visibilityTarget: CaseAttachment | null;
  onVisibilityTargetChange: (attachment: CaseAttachment | null) => void;
}) {
  const headingId = useId();
  const thread = useThreadParam();
  const change = useChangeAttachmentVisibility();
  const [result, setResult] = useState<ChangeResult>();
  const [dialogError, setDialogError] = useState<string>();

  function openDialog(attachment: CaseAttachment) {
    setDialogError(undefined);
    onVisibilityTargetChange(attachment);
  }

  function submit(attachmentId: string, value: PublicationVisibility) {
    setDialogError(undefined);
    if (result?.tone === "info") setResult(undefined);
    change.mutate(
      { attachmentId, publicationVisibility: value },
      {
        onSuccess: () => {
          setResult({
            tone: "info",
            text: CASE_ATTACHMENTS_TEXTS.visibilityChanged,
          });
          onVisibilityTargetChange(null);
        },
        onError: (cause) => {
          if (isApiError(cause) && cause.status === 422) {
            setDialogError(cause.message);
            return;
          }
          setResult({ tone: "error", text: describeError(cause) });
          onVisibilityTargetChange(null);
        },
      },
    );
  }

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
              changing={change.isPending}
              onJump={thread.open}
              onChangeVisibility={openDialog}
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
      {result !== undefined && (
        <Alert
          tone={result.tone}
          role={result.tone === "error" ? "alert" : "status"}
        >
          {result.text}
        </Alert>
      )}
      {renderBody()}
      {visibilityTarget !== null && (
        <CaseAttachmentVisibilityDialog
          // 別の添付を開いたら、選択を持ち越さない
          key={visibilityTarget.id}
          current={visibilityTarget.publicationVisibility}
          pending={change.isPending}
          error={dialogError}
          onSubmit={(value) => submit(visibilityTarget.id, value)}
          onClose={() => onVisibilityTargetChange(null)}
        />
      )}
    </section>
  );
}
