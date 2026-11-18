// API 層：案件の一覧・概要・詳細（#147。EP-5-06〜08。概要の進捗は #149）と、参加者の追加・削除・納期の変更（147-B。EP-5-09・10）の通信はここに書く。
// 共通の apiClient（services/）を使い、応答は Zod で検証する。
import { z } from "zod";
import { apiClient } from "../../../services/api-client";

export const CASE_LIST_SCOPES = ["joined", "all"] as const;
export const CASE_STATUSES = ["active", "closed"] as const;
export const CASE_AUTO_ROLES = ["global_admin", "department_owner"] as const;

const namedSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  isActive: z.boolean(),
});
/** TODO の進捗（削除済みを除く。0件は null）。TODO の一覧の応答（case-todo-api.ts）も同じ形 */
export const todoProgressSchema = z
  .object({ done: z.number().int(), total: z.number().int() })
  .nullable();
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
  canEditDueDate: z.boolean(),
  progress: todoProgressSchema,
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
      autoRole: z.enum(CASE_AUTO_ROLES).nullable(),
      removable: z.boolean(),
    }),
  ),
});

export type CaseListScope = (typeof CASE_LIST_SCOPES)[number];
export type CaseStatus = (typeof CASE_STATUSES)[number];
export type CaseAutoRole = (typeof CASE_AUTO_ROLES)[number];
export type CaseSummary = z.infer<typeof summarySchema>;
export type CasePage = z.infer<typeof pageSchema>;
export type CaseDetail = z.infer<typeof detailSchema>;
export type CaseParticipant = CaseDetail["participants"][number];
export type TodoProgress = z.infer<typeof todoProgressSchema>;

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

const addedSchema = z.object({
  caseId: z.string().min(1),
  userId: z.string().min(1),
});
const dueDateChangedSchema = z.object({
  caseId: z.string().min(1),
  dueDate: z.string().nullable(),
});

const participantsPath = (caseId: string) =>
  `/cases/${encodeURIComponent(caseId)}/participants`;

export async function addCaseParticipant(
  caseId: string,
  userId: string,
): Promise<z.infer<typeof addedSchema>> {
  const response = await apiClient.post(participantsPath(caseId), { userId });
  return addedSchema.parse(response.data);
}

/** userId が本人なら退出 */
export async function removeCaseParticipant(
  caseId: string,
  userId: string,
): Promise<void> {
  await apiClient.delete(
    `${participantsPath(caseId)}/${encodeURIComponent(userId)}`,
  );
}

/** null は未定に戻す */
export async function changeCaseDueDate(
  caseId: string,
  dueDate: string | null,
): Promise<z.infer<typeof dueDateChangedSchema>> {
  const response = await apiClient.patch(
    `/cases/${encodeURIComponent(caseId)}/due-date`,
    { dueDate },
  );
  return dueDateChangedSchema.parse(response.data);
}
