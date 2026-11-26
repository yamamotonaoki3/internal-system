// API 層：スレッド一覧（EP-3-08）とスレッドの既読（EP-3-09）の通信はここに書く。共通の apiClient（services/）を使う。
// スレッドの返信そのものの取得・投稿は features/messages にある。
import { z } from "zod";
import { UNREAD_COUNT_LIMIT } from "../../../../../shared/unread-rules";
import { apiClient } from "../../../services/api-client";
import { roomMessageSchema } from "../../messages";

const roomSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("channel"),
    id: z.string().min(1),
    name: z.string(),
  }),
  z.object({
    kind: z.literal("direct"),
    id: z.string().min(1),
    partner: z.object({
      id: z.string().min(1),
      displayName: z.string(),
      isActive: z.boolean(),
    }),
  }),
]);

const threadItemSchema = z.object({
  /** 親の投稿（削除済みなら body は null）と、返信の件数（replyCount） */
  parent: roomMessageSchema,
  room: roomSchema,
  lastReplyAt: z.string(),
  unreadCount: z.number().int().min(0).max(UNREAD_COUNT_LIMIT),
  /** スレッドの部屋の案件の ID（通常のチャンネル・DM は null）。資格の確かめの対象を決めるだけで、認可には使わない（#339） */
  caseId: z.string().min(1).nullable(),
});

const threadPageSchema = z.object({
  items: z.array(threadItemSchema),
  nextCursor: z.string().nullable(),
});

export type ThreadItem = z.infer<typeof threadItemSchema>;
export type ThreadPage = z.infer<typeof threadPageSchema>;

/** 自分が関わるスレッドを、最後の返信が新しい順に取る。cursor がなければ先頭から（件数は既定） */
export async function fetchMyThreads(
  cursor: string | undefined,
): Promise<ThreadPage> {
  const response = await apiClient.get("/me/threads", { params: { cursor } });
  return threadPageSchema.parse(response.data);
}

/** スレッドの既読位置を、指定した返信まで進める（サーバーは後戻りさせない） */
export async function markThreadRead(
  parentMessageId: string,
  lastReadMessageId: string,
): Promise<void> {
  await apiClient.put(
    `/messages/${encodeURIComponent(parentMessageId)}/thread-read-position`,
    { lastReadMessageId },
  );
}
