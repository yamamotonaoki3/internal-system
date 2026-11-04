// ログインの送信。入力したパスワードを TanStack Query の MutationCache に残さないため、
// useMutation は使わず、呼び出し側が直接 await する。成功したらセッションのキャッシュを書き込む。
import { useQueryClient } from "@tanstack/react-query";
import { login, type LoginRequest, type SessionInfo } from "../api/auth-api";
import { authKeys } from "../api/query-keys";

export function useLogin() {
  const queryClient = useQueryClient();
  return async (input: LoginRequest): Promise<SessionInfo> => {
    const session = await login(input);
    queryClient.setQueryData(authKeys.session, session);
    return session;
  };
}
