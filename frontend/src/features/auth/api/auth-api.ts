// API 層：認証の通信はここに書く。共通の apiClient（services/）を使う（C-46）。
import { apiClient } from "../../../services/api-client";
import { z } from "zod";

export type SessionInfo = {
  user: { id: string; displayName: string; loginId: string };
  mustChangePassword: boolean;
  reauthenticatedAt: string | null;
};

export type LoginRequest = { loginId: string; password: string };
export type PasswordChangeRequest = {
  currentPassword: string;
  newPassword: string;
};
export type ReauthenticateRequest = { password: string };
export type ReauthenticateResponse = { reauthenticatedAt: string };

const reauthenticatedAtSchema = z.iso.datetime();
const sessionInfoSchema = z.object({
  user: z.object({
    id: z.string(),
    displayName: z.string(),
    loginId: z.string(),
  }),
  mustChangePassword: z.boolean(),
  reauthenticatedAt: reauthenticatedAtSchema.nullable(),
});
const reauthenticateResponseSchema = z.object({
  reauthenticatedAt: reauthenticatedAtSchema,
});

export async function fetchSession(): Promise<SessionInfo> {
  const response = await apiClient.get<SessionInfo>("/auth/session");
  return sessionInfoSchema.parse(response.data);
}

export async function login(input: LoginRequest): Promise<SessionInfo> {
  const response = await apiClient.post<SessionInfo>("/auth/login", input);
  return sessionInfoSchema.parse(response.data);
}

export async function logout(): Promise<void> {
  await apiClient.post("/auth/logout");
}

export async function changePassword(
  input: PasswordChangeRequest,
): Promise<SessionInfo> {
  const response = await apiClient.put<SessionInfo>("/me/password", input);
  return sessionInfoSchema.parse(response.data);
}

export async function reauthenticate(
  input: ReauthenticateRequest,
): Promise<ReauthenticateResponse> {
  const response = await apiClient.post<ReauthenticateResponse>(
    "/auth/reauthenticate",
    input,
  );
  return reauthenticateResponseSchema.parse(response.data);
}
