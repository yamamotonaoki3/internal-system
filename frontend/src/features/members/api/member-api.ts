// API 層：社員一覧・部署の候補・ステータスの代理設定。共通の apiClient（services/）を使う。本名は一覧に含まれない。
import { z } from "zod";
import type { UserStatusKind } from "../../../../../shared/profile-rules";
import { apiClient } from "../../../services/api-client";
import {
  departmentRefSchema,
  userStatusSchema,
} from "../../profile/api/profile-api";

const memberSchema = z.object({
  id: z.string().min(1),
  displayName: z.string(),
  department: departmentRefSchema,
  extension: z.string().nullable(),
  email: z.string(),
  status: userStatusSchema,
  canSetStatus: z.boolean(),
});
const memberPageSchema = z.object({
  items: z.array(memberSchema),
  nextCursor: z.string().nullable(),
});
const departmentsSchema = z.object({ items: z.array(departmentRefSchema) });

export type Member = z.infer<typeof memberSchema>;
export type MemberPage = z.infer<typeof memberPageSchema>;
export type DepartmentRef = z.infer<typeof departmentRefSchema>;

export async function fetchMembers(
  departmentId: string,
  q: string,
  cursor?: string,
): Promise<MemberPage> {
  const response = await apiClient.get("/users", {
    // 空の絞り込みは送らない（q は空だとサーバーが 422 にする）
    params: {
      cursor,
      departmentId: departmentId || undefined,
      q: q || undefined,
    },
  });
  return memberPageSchema.parse(response.data);
}

export async function fetchDepartments(): Promise<DepartmentRef[]> {
  const response = await apiClient.get("/users/departments");
  return departmentsSchema.parse(response.data).items;
}

export async function setMemberStatus(
  userId: string,
  input: { status: UserStatusKind; returnAt?: string },
): Promise<void> {
  await apiClient.put(`/users/${encodeURIComponent(userId)}/status`, input);
}
