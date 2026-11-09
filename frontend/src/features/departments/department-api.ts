import { z } from "zod";
import { apiClient } from "../../services/api-client";

const departmentSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  isActive: z.boolean(),
  ownerUserId: z.string().nullable(),
  ownerDisplayName: z.string().nullable(),
  memberCount: z.number().int(),
  version: z.number().int(),
});
const departmentPageSchema = z.object({
  items: z.array(departmentSchema),
  nextCursor: z.string().nullable(),
});
const candidateSchema = z.object({
  id: z.string().min(1),
  displayName: z.string(),
  departmentId: z.string().nullable(),
  ownedDepartmentId: z.string().nullable(),
  isGlobalAdmin: z.boolean(),
});
const candidatePageSchema = z.object({
  items: z.array(candidateSchema),
  nextCursor: z.string().nullable(),
});
const createdSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string(),
  ownerUserId: z.string().min(1),
  dedicatedChannelId: z.string().min(1),
  announcementChannelId: z.string().min(1),
  version: z.number().int(),
  createdAt: z.string(),
});
const renamedSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  version: z.number().int(),
  updatedAt: z.string(),
});
const ownerChangedSchema = z.object({
  departmentId: z.string().min(1),
  ownerUserId: z.string().min(1),
  version: z.number().int(),
  updatedAt: z.string(),
});

export type Department = z.infer<typeof departmentSchema>;
export type DepartmentPage = z.infer<typeof departmentPageSchema>;
export type OwnerCandidate = z.infer<typeof candidateSchema>;
export type OwnerAssignment = {
  ownerUserId: string;
  previousDepartmentSuccessorUserId?: string;
};

// 一度に読み込む候補の上限ページ数（社員が極端に多いときに無限に読み込まないための保険）
const MAX_CANDIDATE_PAGES = 40;

export async function fetchDepartments(
  cursor?: string,
): Promise<DepartmentPage> {
  const response = await apiClient.get("/admin/departments", {
    params: { cursor },
  });
  return departmentPageSchema.parse(response.data);
}

/** オーナー候補（有効な社員）を、最後のページまで読み込む。選択欄に全員を出すため */
export async function fetchOwnerCandidates(): Promise<OwnerCandidate[]> {
  const candidates: OwnerCandidate[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_CANDIDATE_PAGES; page += 1) {
    const response = await apiClient.get(
      "/admin/departments/owner-candidates",
      {
        params: { cursor },
      },
    );
    const parsed = candidatePageSchema.parse(response.data);
    candidates.push(...parsed.items);
    if (parsed.nextCursor === null) return candidates;
    cursor = parsed.nextCursor;
  }
  throw new Error("オーナー候補が多すぎるため、すべて読み込めませんでした");
}

export async function createDepartment(
  input: { name: string; description: string } & Partial<OwnerAssignment>,
) {
  const response = await apiClient.post("/departments", input);
  return createdSchema.parse(response.data);
}

export async function renameDepartment(
  id: string,
  input: { name: string; version: number },
) {
  const response = await apiClient.patch(
    `/admin/departments/${encodeURIComponent(id)}`,
    input,
  );
  return renamedSchema.parse(response.data);
}

export async function changeDepartmentOwner(
  id: string,
  input: OwnerAssignment & { version: number },
) {
  const response = await apiClient.put(
    `/departments/${encodeURIComponent(id)}/owner`,
    input,
  );
  return ownerChangedSchema.parse(response.data);
}
