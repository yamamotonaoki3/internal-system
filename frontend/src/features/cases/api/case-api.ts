// API 層：案件の一覧・概要・詳細（#147。EP-5-06〜08）の通信はここに書く。
// 共通の apiClient（services/）を使い、応答は Zod で検証する。
import { z } from "zod";
import { apiClient } from "../../../services/api-client";

export const CASE_LIST_SCOPES = ["joined", "all"] as const;
export const CASE_STATUSES = ["active", "closed"] as const;

const namedSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  isActive: z.boolean(),
});
const summarySchema = z.object({
  id: z.string().min(1),
  caseNumber: z.string(),
  title: z.string(),
  status: z.enum(CASE_STATUSES),
  client: namedSchema,
  departments: z.array(namedSchema),
  dueDate: z.string().nullable(),
  isParticipant: z.boolean(),
  canManage: z.boolean(),
  participantCount: z.number().int().nullable(),
});
const pageSchema = z.object({
  items: z.array(summarySchema),
  nextCursor: z.string().nullable(),
});
const detailSchema = summarySchema.extend({
  description: z.string(),
  channelId: z.string().min(1),
  createdBy: z.string().min(1),
  participants: z.array(
    z.object({
      userId: z.string().min(1),
      displayName: z.string(),
      departmentName: z.string().nullable(),
      isActive: z.boolean(),
      isCreator: z.boolean(),
    }),
  ),
});

export type CaseListScope = (typeof CASE_LIST_SCOPES)[number];
export type CaseStatus = (typeof CASE_STATUSES)[number];
export type CaseSummary = z.infer<typeof summarySchema>;
export type CasePage = z.infer<typeof pageSchema>;
export type CaseDetail = z.infer<typeof detailSchema>;
export type CaseParticipant = CaseDetail["participants"][number];

export async function fetchCases(
  scope: CaseListScope,
  status: CaseStatus,
  cursor?: string,
): Promise<CasePage> {
  const response = await apiClient.get("/cases", {
    params: { scope, status, cursor },
  });
  return pageSchema.parse(response.data);
}

export async function fetchCaseSummary(caseId: string): Promise<CaseSummary> {
  const response = await apiClient.get(`/cases/${encodeURIComponent(caseId)}`);
  return summarySchema.parse(response.data);
}

export async function fetchCaseDetail(caseId: string): Promise<CaseDetail> {
  const response = await apiClient.get(
    `/cases/${encodeURIComponent(caseId)}/detail`,
  );
  return detailSchema.parse(response.data);
}
