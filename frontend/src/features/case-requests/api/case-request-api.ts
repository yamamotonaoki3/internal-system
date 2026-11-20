// API 層：案件の作成申請（申請・自分の申請・取り下げ・類似件名の確認・審査一覧・承認・却下）と、申請の欄の候補（取引先・部署・社員）の通信はここに書く。
// 共通の apiClient（services/）を使い、応答は Zod で検証する。
import { z } from "zod";
import { apiClient } from "../../../services/api-client";
import type { SearchedUser } from "../../members";

export const CASE_REQUEST_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "withdrawn",
  "auto_cancelled",
] as const;
const statusSchema = z.enum(CASE_REQUEST_STATUSES);

const itemSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  description: z.string(),
  dueDate: z.string().nullable(),
  client: z.object({
    id: z.string().min(1),
    code: z.string(),
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
  candidates: z.array(
    z.object({ userId: z.string().min(1), displayName: z.string() }),
  ),
  status: statusSchema,
  rejectReason: z.string().nullable(),
  caseId: z.string().nullable(),
  caseNumber: z.string().nullable(),
  resubmittedFrom: z.string().nullable(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
});
const pageSchema = z.object({
  items: z.array(itemSchema),
  nextCursor: z.string().nullable(),
});
// 審査一覧の項目：自分の申請の項目（案件番号を除く）に、申請者・候補の有効・類似件名・決裁できるかを足したもの
const reviewItemSchema = itemSchema.omit({ caseNumber: true }).extend({
  candidates: z.array(
    z.object({
      userId: z.string().min(1),
      displayName: z.string(),
      isActive: z.boolean(),
    }),
  ),
  requesterId: z.string().min(1),
  requesterDisplayName: z.string(),
  hasSimilarTitle: z.boolean(),
  canApprove: z.boolean(),
});
const reviewPageSchema = z.object({
  items: z.array(reviewItemSchema),
  nextCursor: z.string().nullable(),
});
const approvedSchema = z.object({
  requestId: z.string().min(1),
  status: z.literal("approved"),
  caseId: z.string().min(1),
  caseNumber: z.string(),
  roomId: z.string().min(1),
});
const rejectedSchema = z.object({
  requestId: z.string().min(1),
  status: z.literal("rejected"),
});
const createdSchema = itemSchema.extend({
  titleFormatted: z.boolean(),
  hasSimilarTitle: z.boolean(),
});
const withdrawnSchema = z.object({
  requestId: z.string().min(1),
  status: z.literal("withdrawn"),
});
const similarSchema = z.object({
  hasSimilar: z.boolean(),
  formattedTitle: z.string(),
});

const choiceSchema = z.object({ id: z.string().min(1), name: z.string() });
const clientPageSchema = z.object({
  items: z.array(choiceSchema.extend({ code: z.string() })),
  nextCursor: z.string().nullable(),
});
const departmentsSchema = z.object({ items: z.array(choiceSchema) });
export type CaseRequestStatus = z.infer<typeof statusSchema>;
export type CaseRequestItem = z.infer<typeof itemSchema>;
export type CaseRequestPage = z.infer<typeof pageSchema>;
export type CaseRequestReviewItem = z.infer<typeof reviewItemSchema>;
export type CaseRequestReviewPage = z.infer<typeof reviewPageSchema>;
export type CreatedCaseRequest = z.infer<typeof createdSchema>;
export type Choice = z.infer<typeof choiceSchema>;
/** 追加の候補の社員（社員の検索の結果と同じ形） */
export type CandidateUser = SearchedUser;

export type CreateCaseRequestInput = {
  clientId: string;
  title: string;
  description: string;
  dueDate?: string;
  departmentIds: string[];
  candidateIds: string[];
  resubmitOf?: string;
};

export async function createCaseRequest(
  input: CreateCaseRequestInput,
): Promise<CreatedCaseRequest> {
  const response = await apiClient.post("/case-requests", input);
  return createdSchema.parse(response.data);
}

export async function fetchMyCaseRequests(
  cursor?: string,
): Promise<CaseRequestPage> {
  const response = await apiClient.get("/case-requests/mine", {
    params: { cursor },
  });
  return pageSchema.parse(response.data);
}

export async function withdrawCaseRequest(requestId: string) {
  const response = await apiClient.post(
    `/case-requests/${encodeURIComponent(requestId)}/withdraw`,
  );
  return withdrawnSchema.parse(response.data);
}

export async function fetchReviewCaseRequests(
  status: CaseRequestStatus,
  cursor?: string,
): Promise<CaseRequestReviewPage> {
  const response = await apiClient.get("/case-requests", {
    params: { status, cursor },
  });
  return reviewPageSchema.parse(response.data);
}

export async function approveCaseRequest(
  requestId: string,
  additionalCandidateIds: string[],
) {
  const response = await apiClient.post(
    `/case-requests/${encodeURIComponent(requestId)}/approve`,
    { additionalCandidateIds },
  );
  return approvedSchema.parse(response.data);
}

export async function rejectCaseRequest(requestId: string, reason: string) {
  const response = await apiClient.post(
    `/case-requests/${encodeURIComponent(requestId)}/reject`,
    { reason },
  );
  return rejectedSchema.parse(response.data);
}

export async function checkSimilarTitle(input: {
  clientId: string;
  title: string;
  excludeCaseId?: string;
}) {
  const response = await apiClient.get("/case-requests/similar-title", {
    params: input,
  });
  return similarSchema.parse(response.data);
}

/** 取引先の候補（有効な取引先）。選択欄に全件を出すため、続きのページもすべて読む */
export async function fetchClientChoices(): Promise<Choice[]> {
  const choices: Choice[] = [];
  let cursor: string | undefined;
  do {
    const response = await apiClient.get("/clients/candidates", {
      params: { cursor },
    });
    const page = clientPageSchema.parse(response.data);
    choices.push(...page.items.map(({ id, name }) => ({ id, name })));
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return choices;
}

/** 担当部署の候補（有効な部署） */
export async function fetchDepartmentChoices(): Promise<Choice[]> {
  const response = await apiClient.get("/users/departments");
  return departmentsSchema.parse(response.data).items;
}
