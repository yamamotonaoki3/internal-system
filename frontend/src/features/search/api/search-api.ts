// API 層：メッセージの検索（EP-4-01）と案件の検索（EP-4-02）の通信はここに書く。共通の apiClient（services/）を使う。
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

// ---- 案件の検索（EP-4-02）。参加していない人にも見える概要の項目だけが返る

const caseSearchItemSchema = z.object({
  id: z.string().min(1),
  caseNumber: z.string(),
  title: z.string(),
  status: z.enum(["active", "closed"]),
  client: z.object({
    id: z.string().min(1),
    name: z.string(),
    isActive: z.boolean(),
  }),
  departments: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string(),
      isActive: z.boolean(),
    }),
  ),
  dueDate: z.string().nullable(),
  progress: z.object({ done: z.number(), total: z.number() }).nullable(),
  isParticipant: z.boolean(),
  matchedIn: z.array(z.enum(["title", "caseNumber", "client"])).min(1),
});

const caseSearchPageSchema = z.object({
  items: z.array(caseSearchItemSchema),
  nextCursor: z.string().nullable(),
});

export type CaseSearchItem = z.infer<typeof caseSearchItemSchema>;
export type CaseSearchPage = z.infer<typeof caseSearchPageSchema>;

/** 件名・案件番号・取引先名で案件を検索する（案件 ID の降順）。cursor がなければ先頭から */
export async function searchCases(
  q: string,
  cursor: string | undefined,
  options: { signal?: AbortSignal } = {},
): Promise<CaseSearchPage> {
  const response = await apiClient.get("/search/cases", {
    params: { q, cursor },
    signal: options.signal,
  });
  return caseSearchPageSchema.parse(response.data);
}
