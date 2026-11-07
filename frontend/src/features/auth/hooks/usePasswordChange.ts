import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import {
  changePassword,
  type PasswordChangeRequest,
  type SessionInfo,
} from "../api/auth-api";
import { authKeys } from "../api/query-keys";

export function usePasswordChange() {
  const queryClient = useQueryClient();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return async (
    input: PasswordChangeRequest,
  ): Promise<SessionInfo | undefined> => {
    const query = queryClient
      .getQueryCache()
      .find({ queryKey: authKeys.session, exact: true });
    const before = queryClient.getQueryData<SessionInfo>(authKeys.session);
    const session = await changePassword(input);
    const currentQuery = queryClient
      .getQueryCache()
      .find({ queryKey: authKeys.session, exact: true });
    const currentSession = queryClient.getQueryData<SessionInfo>(
      authKeys.session,
    );
    if (
      !mounted.current ||
      !query ||
      currentQuery !== query ||
      currentSession?.user.id !== before?.user.id
    )
      return undefined;
    queryClient.setQueryData(authKeys.session, session);
    return session;
  };
}
