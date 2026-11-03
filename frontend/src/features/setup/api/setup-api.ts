// API 層：初回セットアップの通信はここに書く。共通の apiClient（services/）を使う（C-46）。
import { apiClient } from "../../../services/api-client";

export type SetupStatus = {
  setupRequired: boolean;
};

export type SetupRequest = {
  setupToken: string;
  companyName: string;
  departmentName: string;
  loginId: string;
  legalName: string;
  email: string;
  emailConfirmed: true;
  extension?: string;
  jobTitle?: string;
};

export type SetupResult = {
  user: { id: string; loginId: string; displayName: string };
  initialPassword: string;
};

export async function fetchSetupStatus(): Promise<SetupStatus> {
  const response = await apiClient.get<SetupStatus>("/setup/status");
  return response.data;
}

// 初期パスワードを含む応答を返す。TanStack Query の useMutation には載せない
// （MutationCache に応答と入力が残るため）。呼び出し側が、画面の中だけで扱う。
export async function submitSetup(input: SetupRequest): Promise<SetupResult> {
  const response = await apiClient.post<SetupResult>("/setup", input);
  return response.data;
}
