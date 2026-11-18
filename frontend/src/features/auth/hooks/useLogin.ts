// ログインの送信。入力したパスワードを TanStack Query の MutationCache に残さないため、
// useMutation は使わず、呼び出し側が直接 await する。成功したらセッションのキャッシュを書き込む。
// 書く前に古いセッションの取得を取り消す（遅れた前の利用者の応答で戻さない）。
import { useQueryClient } from "@tanstack/react-query";
import { login, type LoginRequest, type SessionInfo } from "../api/auth-api";
import { publishSession } from "../user-switch-guard";

export function useLogin() {
  const queryClient = useQueryClient();
  return async (input: LoginRequest): Promise<SessionInfo> => {
    const session = await login(input);
    await publishSession(queryClient, session);
    return session;
  };
}
