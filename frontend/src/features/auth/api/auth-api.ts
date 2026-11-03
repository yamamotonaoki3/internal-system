// API 層：認証の通信はここに書く。共通の apiClient（services/）を使う（C-46）。
import { apiClient } from "../../../services/api-client";

export type SessionInfo = {
  user: { id: string; displayName: string };
  mustChangePassword: boolean;
};

export type LoginRequest = { loginId: string; password: string };

export async function fetchSession(): Promise<SessionInfo> {
  const response = await apiClient.get<SessionInfo>("/auth/session");
  return response.data;
}

export async function login(input: LoginRequest): Promise<SessionInfo> {
  const response = await apiClient.post<SessionInfo>("/auth/login", input);
  return response.data;
}

export async function logout(): Promise<void> {
  await apiClient.post("/auth/logout");
}
