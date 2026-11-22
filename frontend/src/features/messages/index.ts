// メッセージの機能の公開部分。ほかの機能（channels・threads など）は、ここだけを通して使う。
export { messageKeys } from "./api/query-keys";
export {
  attachmentUrl,
  roomMessageSchema,
  type RoomMessage,
} from "./api/message-api";
export { ATTACHMENT_ONLY_LABEL } from "./attachment-only-label";
export type { AttachmentPublicationConfig } from "./components/AttachmentList";
export { RoomMessages } from "./components/RoomMessages";
export { ThreadReplies } from "./components/ThreadReplies";
export { formatAttachmentSize } from "./format-size";
export { formatMessageTime } from "./format-time";
export { MESSAGE_POLL_INTERVAL_MS } from "./polling";
