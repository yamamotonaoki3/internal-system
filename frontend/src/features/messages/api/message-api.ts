// API 層：メッセージの一覧・投稿・編集・削除の通信はここに書く。共通の apiClient（services/）を使う。
import { z } from "zod";
import { apiClient } from "../../../services/api-client";

const messageSchema = z
  .object({
    id: z.string().min(1),
    roomId: z.string().min(1),
    author: z.object({
      id: z.string().min(1),
      displayName: z.string(),
      isActive: z.boolean(),
    }),
    /** 削除済みは null */
    body: z.string().nullable(),
    createdAt: z.string(),
    /** 編集した日時。編集していなければ null */
    editedAt: z.string().nullable(),
    deleted: z.boolean(),
  })
  // 削除済みと本文がないことの食い違いは、サーバーの不具合として失敗にする
  .refine((message) => message.deleted === (message.body === null), {
    message: "削除済みの印と本文の有無が食い違っています",
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

const editedSchema = z.object({
  id: z.string().min(1),
  body: z.string(),
  editedAt: z.string(),
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

const messagePath = (messageId: string) =>
  `/messages/${encodeURIComponent(messageId)}`;

export async function editMessage(messageId: string, body: string) {
  const response = await apiClient.patch(messagePath(messageId), { body });
  return editedSchema.parse(response.data);
}

export async function deleteMessage(messageId: string): Promise<void> {
  await apiClient.delete(messagePath(messageId));
}
