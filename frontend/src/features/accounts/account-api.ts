// API 層：アカウントの発行・一覧・部署の候補の通信はここに書く。共通の apiClient（services/）を使う（C-46）。
import { z } from "zod";
import { apiClient } from "../../services/api-client";

const departmentOptionSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
});
const departmentOptionsSchema = z.object({
  items: z.array(departmentOptionSchema),
});
const accountSchema = z.object({
  id: z.string().min(1),
  loginId: z.string(),
  displayName: z.string(),
  department: departmentOptionSchema.nullable(),
  email: z.string(),
  extension: z.string().nullable(),
  jobTitle: z.string().nullable(),
  active: z.boolean(),
  mustChangePassword: z.boolean(),
  createdAt: z.string(),
});
const accountPageSchema = z.object({
  items: z.array(accountSchema),
  nextCursor: z.string().nullable(),
});
const createdSchema = z.object({
  id: z.string().min(1),
  loginId: z.string(),
  displayName: z.string(),
  departmentId: z.string(),
  mustChangePassword: z.boolean(),
  createdAt: z.string(),
  initialPassword: z.string().min(1),
});

export type DepartmentOption = z.infer<typeof departmentOptionSchema>;
export type AccountListItem = z.infer<typeof accountSchema>;
export type AccountPage = z.infer<typeof accountPageSchema>;
export type AccountCreated = z.infer<typeof createdSchema>;

export type AccountCreateRequest = {
  loginId: string;
  legalName: string;
  displayName: string;
  email: string;
  emailConfirmed: true;
  departmentId: string;
  extension?: string;
  jobTitle?: string;
};

export async function fetchDepartmentOptions(): Promise<DepartmentOption[]> {
  const response = await apiClient.get("/admin/accounts/department-options");
  return departmentOptionsSchema.parse(response.data).items;
}

export async function fetchAdminAccounts(
  cursor?: string,
): Promise<AccountPage> {
  const response = await apiClient.get("/admin/accounts", {
    params: { cursor },
  });
  return accountPageSchema.parse(response.data);
}

// 初期パスワードを含む応答を返す。TanStack Query の useMutation には載せない
// （MutationCache に応答と入力が残るため）。呼び出し側が、画面の中だけで扱う。
export async function submitAccount(
  input: AccountCreateRequest,
): Promise<AccountCreated> {
  const response = await apiClient.post("/admin/accounts", input);
  return createdSchema.parse(response.data);
}
