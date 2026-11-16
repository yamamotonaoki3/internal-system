// メッセージの添付の表示（#140）。画像は img、動画は video、そのほかはダウンロードのリンク。
// URL は ID から組み立てる。ファイル名は文字として出す（HTML として解釈させない）。
import { attachmentUrl, type Attachment } from "../api/message-api";

export function MessageAttachments({
  attachments,
}: {
  attachments: readonly Attachment[];
}) {
  if (attachments.length === 0) return null;
  return (
    <ul aria-label="添付" className="mb-2">
      {attachments.map((attachment) => {
        const url = attachmentUrl(attachment.id);
        return (
          <li key={attachment.id} className="mb-1">
            {attachment.kind === "image" ? (
              <img src={url} alt={attachment.name} className="max-w-xs" />
            ) : attachment.kind === "video" ? (
              <video
                controls
                src={url}
                aria-label={attachment.name}
                className="max-w-xs"
              />
            ) : (
              <a href={url} download className="underline">
                {attachment.name}
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}
