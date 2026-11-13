// API 層：メッセージの一覧・投稿の通信はここに書く。共通の apiClient（services/）を使う。
import { z } from "zod";
import { apiClient } from "../../../services/api-client";

const messageSchema = z.object({
  id: z.string().min(1),
  roomId: z.string().min(1),
  author: z.object({
    id: z.string().min(1),
    displayName: z.string(),
    isActive: z.boolean(),
  }),
  body: z.string(),
  createdAt: z.string(),
});
const latestPageSchema = z.object({
  items: z.array(messageSchema),
  nextCursor: z.string().nullable(),
});
const afterPageSchema = z.object({
  items: z.array(messageSchema),
  hasMore: z.boolean(),
});
const createdSchema = z.object({
  id: z.string().min(1),
  roomId: z.string().min(1),
  createdAt: z.string(),
});

export type RoomMessage = z.infer<typeof messageSchema>;
export type MessagesAfterPage = z.infer<typeof afterPageSchema>;

const messagesPath = (roomId: string) =>
  `/rooms/${encodeURIComponent(roomId)}/messages`;

/** 最新の一覧。応答は新しい順のため、ID昇順（古い順）に直して返す */
export async function fetchLatestMessages(
  roomId: string,
): Promise<RoomMessage[]> {
  const response = await apiClient.get(messagesPath(roomId));
  return latestPageSchema.parse(response.data).items.toReversed();
}

/** 指定したID以降（含まない）の新着。ID昇順 */
export async function fetchMessagesAfter(
  roomId: string,
  after: string,
): Promise<MessagesAfterPage> {
  const response = await apiClient.get(messagesPath(roomId), {
    params: { after },
  });
  return afterPageSchema.parse(response.data);
}

export async function postMessage(roomId: string, body: string) {
  const response = await apiClient.post(messagesPath(roomId), { body });
  return createdSchema.parse(response.data);
}
