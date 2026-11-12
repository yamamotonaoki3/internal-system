// API 層：チャンネルの作成申請（申請・自分の申請・審査一覧・承認・却下・取り下げ）の通信はここに書く。共通の apiClient（services/）を使う。
import { z } from "zod";
import { apiClient } from "../../../services/api-client";

const REQUEST_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "withdrawn",
] as const;
const statusSchema = z.enum(REQUEST_STATUSES);
const visibilitySchema = z.enum(["public", "private"]);

const requestItemSchema = z.object({
  id: z.string().min(1),
  departmentId: z.string().nullable(),
  name: z.string(),
  visibility: visibilitySchema,
  status: statusSchema,
  rejectReason: z.string().nullable(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
  channelId: z.string().nullable(),
});
const reviewItemSchema = requestItemSchema.extend({
  requesterId: z.string().min(1),
  requesterDisplayName: z.string(),
  canApprove: z.boolean(),
});
const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

const approvedSchema = z.object({
  requestId: z.string().min(1),
  status: z.literal("approved"),
  channelId: z.string().min(1),
  roomId: z.string().min(1),
});
const rejectedSchema = z.object({
  requestId: z.string().min(1),
  status: z.literal("rejected"),
  reason: z.string(),
});
const withdrawnSchema = z.object({
  requestId: z.string().min(1),
  status: z.literal("withdrawn"),
});

export type RequestStatus = z.infer<typeof statusSchema>;
export type RequestVisibility = z.infer<typeof visibilitySchema>;
export type RequestScope = "department" | "company";
export type ChannelRequestItem = z.infer<typeof requestItemSchema>;
export type ChannelRequestReviewItem = z.infer<typeof reviewItemSchema>;
export type ChannelRequestPage = {
  items: ChannelRequestItem[];
  nextCursor: string | null;
};
export type ChannelRequestReviewPage = {
  items: ChannelRequestReviewItem[];
  nextCursor: string | null;
};

export type CreateChannelRequestInput = {
  scope: RequestScope;
  name: string;
  description: string;
  visibility: RequestVisibility;
};

const requestPath = (requestId: string) =>
  `/channel-requests/${encodeURIComponent(requestId)}`;

export async function createChannelRequest(
  input: CreateChannelRequestInput,
): Promise<ChannelRequestItem> {
  const response = await apiClient.post("/channel-requests", input);
  return requestItemSchema.parse(response.data);
}

export async function fetchMyChannelRequests(
  cursor?: string,
): Promise<ChannelRequestPage> {
  const response = await apiClient.get("/channel-requests/mine", {
    params: { cursor },
  });
  return pageOf(requestItemSchema).parse(response.data);
}

export async function fetchReviewChannelRequests(
  status: RequestStatus,
  cursor?: string,
): Promise<ChannelRequestReviewPage> {
  const response = await apiClient.get("/channel-requests", {
    params: { status, cursor },
  });
  return pageOf(reviewItemSchema).parse(response.data);
}

export async function approveChannelRequest(requestId: string) {
  const response = await apiClient.post(`${requestPath(requestId)}/approve`);
  return approvedSchema.parse(response.data);
}

export async function rejectChannelRequest(requestId: string, reason: string) {
  const response = await apiClient.post(`${requestPath(requestId)}/reject`, {
    reason,
  });
  return rejectedSchema.parse(response.data);
}

export async function withdrawChannelRequest(requestId: string) {
  const response = await apiClient.post(`${requestPath(requestId)}/withdraw`);
  return withdrawnSchema.parse(response.data);
}
