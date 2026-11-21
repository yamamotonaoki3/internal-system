// API 層：メッセージの検索（EP-4-01）の通信はここに書く。共通の apiClient（services/）を使う。
import { z } from "zod";
import { apiClient } from "../../../services/api-client";
import type { MessageSearchConditions } from "./query-keys";

const searchItemSchema = z
  .object({
    messageId: z.string().min(1),
    parentMessageId: z.string().min(1).nullable(),
    roomId: z.string().min(1),
    roomKind: z.enum(["channel", "direct", "case"]),
    roomName: z.string(),
    author: z.object({ id: z.string().min(1), displayName: z.string() }),
    excerpt: z.string(),
    createdAt: z.string(),
    matchedIn: z.array(z.enum(["body", "attachment"])).min(1),
    matchedAttachments: z.array(
      z.object({ id: z.string().min(1), name: z.string() }),
    ),
  })
  // 名前の一致の印と名前の一覧は、片方だけが出る形を表示しない（サーバーは常に両方をそろえる）
  .refine(
    (item) =>
      item.matchedIn.includes("attachment") ===
      item.matchedAttachments.length > 0,
  );

const searchPageSchema = z.object({
  items: z.array(searchItemSchema),
  nextCursor: z.string().nullable(),
});

export type MessageSearchItem = z.infer<typeof searchItemSchema>;
export type MessageSearchPage = z.infer<typeof searchPageSchema>;

/** 見てよい部屋のメッセージを、新しい順に検索する。cursor がなければ先頭から */
export async function searchMessages(
  conditions: MessageSearchConditions,
  cursor: string | undefined,
  options: { signal?: AbortSignal } = {},
): Promise<MessageSearchPage> {
  const response = await apiClient.get("/search/messages", {
    params: { ...conditions, cursor },
    signal: options.signal,
  });
  return searchPageSchema.parse(response.data);
}
