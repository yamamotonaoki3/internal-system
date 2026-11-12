// API 層：DM の開始・一覧・詳細。共通の apiClient（services/）を使い、応答を Zod で検証する。失敗は ApiError のまま呼び出し元へ返す。
import { z } from "zod";
import { userStatusKindSchema } from "../../../../../shared/profile-rules";
import { apiClient } from "../../../services/api-client";

const startedSchema = z.object({
  roomId: z.string().min(1),
  partner: z.object({ id: z.string().min(1), displayName: z.string() }),
});
const dmListItemSchema = z.object({
  roomId: z.string().min(1),
  partner: z.object({
    id: z.string().min(1),
    displayName: z.string(),
    isActive: z.boolean(),
    // 相手が無効なら null
    status: z
      .object({
        kind: userStatusKindSchema,
        returnAt: z.string().nullable(),
      })
      .nullable(),
  }),
  // まだメッセージがない DM は null
  lastMessageAt: z.string().nullable(),
});
const dmPageSchema = z.object({
  items: z.array(dmListItemSchema),
  nextCursor: z.string().nullable(),
});
const dmDetailSchema = z.object({
  roomId: z.string().min(1),
  partner: z.object({
    id: z.string().min(1),
    displayName: z.string(),
    department: z
      .object({ id: z.string().min(1), name: z.string() })
      .nullable(),
    isActive: z.boolean(),
    status: z
      .object({
        kind: userStatusKindSchema,
        returnAt: z.string().nullable(),
        message: z.string().nullable(),
      })
      .nullable(),
  }),
  canPost: z.boolean(),
});

export type StartedDm = z.infer<typeof startedSchema>;
export type DmListItem = z.infer<typeof dmListItemSchema>;
export type DmPage = z.infer<typeof dmPageSchema>;
export type DmDetail = z.infer<typeof dmDetailSchema>;

export async function startDm(partnerUserId: string): Promise<StartedDm> {
  const response = await apiClient.post("/dms", { partnerUserId });
  return startedSchema.parse(response.data);
}

export async function fetchDms(cursor?: string): Promise<DmPage> {
  const response = await apiClient.get("/dms", { params: { cursor } });
  return dmPageSchema.parse(response.data);
}

export async function fetchDm(roomId: string): Promise<DmDetail> {
  const response = await apiClient.get(`/dms/${encodeURIComponent(roomId)}`);
  return dmDetailSchema.parse(response.data);
}
