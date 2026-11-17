// API 層：監査ログの閲覧（S-25）の通信はここに書く。共通の apiClient（services/）を使い、応答を zod で検証する（C-46）。
// 取得のたびにサーバーが閲覧の記録を残すため POST にしている。変更・削除・書き出しの通信は作らない（0-6 AC-4）。
// 応答は、決めた項目だけを取り出す（detail・trace_id などが紛れても画面に渡さない）。
import { z } from "zod";
import { apiClient } from "../../services/api-client";

const actorSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().nullable(),
  isActive: z.boolean(),
});
const targetSchema = z.object({
  type: z.string().min(1),
  id: z.string().min(1),
  label: z.string().nullable(),
  isActive: z.boolean().nullable(),
});
const itemSchema = z.object({
  id: z.string().min(1),
  occurredAt: z.iso.datetime(),
  action: z.string().min(1),
  result: z.enum(["success", "failure"]),
  actor: actorSchema.nullable(),
  target: targetSchema.nullable(),
  failureCategory: z.string().optional(),
  affectedCount: z.number().optional(),
  reason: z.string().optional(),
});
const pageSchema = z.object({
  items: z.array(itemSchema),
  nextCursor: z.string().nullable(),
});

export type AuditLogItem = z.infer<typeof itemSchema>;
export type AuditLogPage = z.infer<typeof pageSchema>;

/** 絞り込み。期間は日本時間（JST）の日付（YYYY-MM-DD） */
export type AuditLogFilters = {
  from?: string;
  to?: string;
  actorId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  result?: "success" | "failure";
};

export type AuditLogSearchRequest = AuditLogFilters & {
  cursor?: string;
  limit?: number;
};

export async function searchAuditLogs(
  request: AuditLogSearchRequest,
): Promise<AuditLogPage> {
  const response = await apiClient.post("/admin/audit-logs/search", request);
  return pageSchema.parse(response.data);
}
