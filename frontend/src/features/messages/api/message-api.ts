// API 層：メッセージの一覧・投稿・編集・削除と、スレッドの返信の通信はここに書く。共通の apiClient（services/）を使う。
import { z } from "zod";
import { REPLY_BLOCKED_REASONS } from "../../../../../shared/message-rules";
import { apiClient } from "../../../services/api-client";

const messageShape = {
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
  /** この投稿への返信の件数（削除済みの返信も数える）。返信自身は 0 */
  replyCount: z.number().int().min(0),
};

// 削除済みと本文がないことの食い違いは、サーバーの不具合として失敗にする
function withConsistentBody<
  T extends z.ZodType<{ deleted: boolean; body: string | null }>,
>(schema: T) {
  return schema.refine(
    (message) => message.deleted === (message.body === null),
    { message: "削除済みの印と本文の有無が食い違っています" },
  );
}

// 部屋の一覧とスレッドの親は、返信ではない（parentMessageId は常に null）。返信が混ざったら契約違反として失敗にする
/** 部屋の一覧の1件・スレッドの親（返信ではない投稿）。スレッド一覧の親も同じ形 */
export const roomMessageSchema = withConsistentBody(
  z.object({ ...messageShape, parentMessageId: z.null() }),
);
// スレッドの返信は、親の ID を持つ
const replySchema = withConsistentBody(
  z.object({ ...messageShape, parentMessageId: z.string().min(1) }),
);
const latestPageSchema = z.object({
  items: z.array(roomMessageSchema),
  nextCursor: z.string().nullable(),
});
const afterPageSchema = z.object({
  items: z.array(roomMessageSchema),
  hasMore: z.boolean(),
});
const replyBlockedReasonSchema = z.enum(REPLY_BLOCKED_REASONS).nullable();
const repliesLatestSchema = z.object({
  items: z.array(replySchema),
  nextCursor: z.string().nullable(),
  parent: roomMessageSchema,
  replyBlockedReason: replyBlockedReasonSchema,
  /** 今、参加者か（チャンネルは参加中、DM は当事者）。既読・自分の返信の編集・削除の可否に使う */
  joined: z.boolean(),
  /** 部屋に今書き込めるか（読み取り専用・アーカイブ・DM の相手が無効でないか）。自分の返信の編集・削除の可否に使う */
  roomWritable: z.boolean(),
});
const repliesAfterSchema = z.object({
  items: z.array(replySchema),
  hasMore: z.boolean(),
  parent: roomMessageSchema,
  replyBlockedReason: replyBlockedReasonSchema,
  /** 今、参加者か（チャンネルは参加中、DM は当事者）。既読・自分の返信の編集・削除の可否に使う */
  joined: z.boolean(),
  /** 部屋に今書き込めるか（読み取り専用・アーカイブ・DM の相手が無効でないか）。自分の返信の編集・削除の可否に使う */
  roomWritable: z.boolean(),
});
const createdSchema = z.object({
  id: z.string().min(1),
  roomId: z.string().min(1),
  createdAt: z.string(),
});
const replyCreatedSchema = z.object({
  id: z.string().min(1),
  parentMessageId: z.string().min(1),
  createdAt: z.string(),
});

const editedSchema = z.object({
  id: z.string().min(1),
  body: z.string(),
  editedAt: z.string(),
});

/** 部屋の一覧・スレッドの1件。返信ならスレッドの親の ID（parentMessageId）を持つ */
export type RoomMessage = Omit<
  z.infer<typeof roomMessageSchema>,
  "parentMessageId"
> & { parentMessageId: string | null };
export type MessagesAfterPage = z.infer<typeof afterPageSchema>;
/** スレッドの返信の取得結果（親と、返信できない理由つき） */
export type ThreadRepliesPage = {
  parent: RoomMessage;
  items: RoomMessage[];
  replyBlockedReason: z.infer<typeof replyBlockedReasonSchema>;
  joined: boolean;
  roomWritable: boolean;
};
export type ThreadRepliesAfterPage = ThreadRepliesPage & { hasMore: boolean };

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

const repliesPath = (parentMessageId: string) =>
  `${messagePath(parentMessageId)}/replies`;

/** スレッドの最新の返信。応答は新しい順のため、ID昇順（古い順）に直して返す */
export async function fetchLatestReplies(
  parentMessageId: string,
): Promise<ThreadRepliesPage> {
  const response = await apiClient.get(repliesPath(parentMessageId));
  const page = repliesLatestSchema.parse(response.data);
  return {
    parent: page.parent,
    items: page.items.toReversed(),
    replyBlockedReason: page.replyBlockedReason,
    joined: page.joined,
    roomWritable: page.roomWritable,
  };
}

/** スレッドの、指定したID以降（含まない）の返信。ID昇順 */
export async function fetchRepliesAfter(
  parentMessageId: string,
  after: string,
): Promise<ThreadRepliesAfterPage> {
  const response = await apiClient.get(repliesPath(parentMessageId), {
    params: { after },
  });
  return repliesAfterSchema.parse(response.data);
}

export async function postReply(parentMessageId: string, body: string) {
  const response = await apiClient.post(repliesPath(parentMessageId), {
    body,
  });
  return replyCreatedSchema.parse(response.data);
}
