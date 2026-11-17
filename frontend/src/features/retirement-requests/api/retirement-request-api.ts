// API 層：退職処理の申請（申請・自分の申請・取り下げ・全体管理者の一覧・却下）の通信はここに書く。共通の apiClient（services/）を使う。
// 承認は専用の API がなく、アカウントの無効化（features/accounts）で申請が完了になる。本名・メールは応答に含まれない。
import { z } from "zod";
import { apiClient } from "../../../services/api-client";

const statusSchema = z.enum(["pending", "approved", "rejected", "withdrawn"]);
const userRefSchema = z.object({
  id: z.string().min(1),
  displayName: z.string(),
});

const myItemSchema = z.object({
  id: z.string().min(1),
  status: statusSchema,
  target: userRefSchema,
  department: z.object({ id: z.string().min(1), name: z.string() }),
  decisionReason: z.string().nullable(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
});
const reviewItemSchema = myItemSchema.extend({ requester: userRefSchema });
const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

const createdSchema = z.object({
  id: z.string().min(1),
  targetUserId: z.string(),
  departmentId: z.string(),
  status: z.literal("pending"),
  createdAt: z.string(),
});
const rejectedSchema = z.object({
  id: z.string().min(1),
  status: z.literal("rejected"),
});
const withdrawnSchema = z.object({
  id: z.string().min(1),
  status: z.literal("withdrawn"),
});

export type RetirementRequestStatus = z.infer<typeof statusSchema>;
export type MyRetirementRequestItem = z.infer<typeof myItemSchema>;
export type RetirementRequestReviewItem = z.infer<typeof reviewItemSchema>;

export async function createRetirementRequest(targetUserId: string) {
  const response = await apiClient.post("/retirement-requests", {
    targetUserId,
  });
  return createdSchema.parse(response.data);
}

export async function fetchMyRetirementRequests(cursor?: string) {
  const response = await apiClient.get("/retirement-requests/mine", {
    params: { cursor },
  });
  return pageOf(myItemSchema).parse(response.data);
}

export async function withdrawRetirementRequest(requestId: string) {
  const response = await apiClient.post(
    `/retirement-requests/${encodeURIComponent(requestId)}/withdraw`,
  );
  return withdrawnSchema.parse(response.data);
}

export async function fetchReviewRetirementRequests(
  status: RetirementRequestStatus,
  cursor?: string,
) {
  const response = await apiClient.get("/admin/retirement-requests", {
    params: { status, cursor },
  });
  return pageOf(reviewItemSchema).parse(response.data);
}

export async function rejectRetirementRequest(
  requestId: string,
  reason: string,
) {
  const response = await apiClient.post(
    `/admin/retirement-requests/${encodeURIComponent(requestId)}/reject`,
    { reason },
  );
  return rejectedSchema.parse(response.data);
}
