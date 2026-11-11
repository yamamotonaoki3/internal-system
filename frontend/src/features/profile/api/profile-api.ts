// API 層：自分のプロフィールの取得・変更と、プロフィールカードの取得。共通の apiClient（services/）を使う。
import { z } from "zod";
import { userStatusKindSchema } from "../../../../../shared/profile-rules";
import { apiClient } from "../../../services/api-client";

export const userStatusSchema = z.object({
  kind: userStatusKindSchema,
  returnAt: z.string().nullable(),
  message: z.string().nullable(),
});
export const departmentRefSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
});

const myProfileSchema = z.object({
  id: z.string().min(1),
  loginId: z.string(),
  displayName: z.string(),
  legalName: z.string(),
  department: departmentRefSchema.nullable(),
  jobTitle: z.string().nullable(),
  email: z.string(),
  extension: z.string().nullable(),
  status: userStatusSchema,
});
const updatedSchema = z.object({
  displayName: z.string(),
  status: userStatusKindSchema,
  returnAt: z.string().nullable(),
  statusMessage: z.string().nullable(),
  updatedAt: z.string(),
});
const profileCardSchema = z.object({
  userId: z.string().min(1),
  displayName: z.string(),
  legalName: z.string(),
  department: departmentRefSchema.nullable(),
  status: userStatusSchema,
});

export type UserStatus = z.infer<typeof userStatusSchema>;
export type MyProfile = z.infer<typeof myProfileSchema>;
export type ProfileCardData = z.infer<typeof profileCardSchema>;

/** 変える項目だけを渡す（サーバーも、送られた項目だけを変える） */
export type ProfileUpdate = {
  displayName?: string;
  status?: UserStatus["kind"];
  returnAt?: string;
  statusMessage?: string;
};

export async function getMyProfile(): Promise<MyProfile> {
  const response = await apiClient.get("/me/profile");
  return myProfileSchema.parse(response.data);
}

export async function updateMyProfile(input: ProfileUpdate) {
  const response = await apiClient.patch("/me/profile", input);
  return updatedSchema.parse(response.data);
}

export async function getProfileCard(userId: string): Promise<ProfileCardData> {
  const response = await apiClient.get(
    `/users/${encodeURIComponent(userId)}/profile-card`,
  );
  return profileCardSchema.parse(response.data);
}
