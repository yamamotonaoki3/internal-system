import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router";
import type { ApiError } from "../../services/api-client";
import { reauthenticate, type SessionInfo } from "./api/auth-api";
import { authKeys } from "./api/query-keys";
import { ReauthDialog } from "./components/ReauthDialog";

type ReauthValue = {
  withReauth: <T>(title: string, operation: () => Promise<T>) => Promise<T>;
};

type Pending = {
  title: string;
  startFocus: HTMLElement | null;
  run: () => Promise<void>;
  reject: (error: Error) => void;
};

export const ReauthContext = createContext<ReauthValue | null>(null);

function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    "code" in error
  );
}

function canceled(): Error {
  return new Error("再認証を中止しました");
}

export function ReauthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const location = useLocation();
  const locationKey = useRef(location.key);
  const pendingRef = useRef<Pending | null>(null);
  const activeRef = useRef(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  function finish(focus = true, release = true) {
    const current = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    setError(undefined);
    setSubmitting(false);
    if (release) activeRef.current = false;
    if (focus && current?.startFocus?.isConnected) current.startFocus.focus();
  }

  function cancel() {
    const current = pendingRef.current;
    if (!current) return;
    finish();
    current.reject(canceled());
  }

  useEffect(() => {
    if (location.key !== locationKey.current) {
      locationKey.current = location.key;
      const current = pendingRef.current;
      if (current) {
        pendingRef.current = null;
        activeRef.current = false;
        setPending(null);
        setError(undefined);
        setSubmitting(false);
        current.reject(canceled());
      }
    }
  }, [location.key]);

  useEffect(
    () => () => {
      const current = pendingRef.current;
      pendingRef.current = null;
      activeRef.current = false;
      current?.reject(canceled());
    },
    [],
  );

  async function submit(password: string) {
    const current = pendingRef.current;
    if (!current || submitting) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const response = await reauthenticate({ password });
      if (pendingRef.current !== current) return;
      queryClient.setQueryData<SessionInfo>(authKeys.session, (session) => {
        if (!session) throw new Error("ログイン状態がありません");
        return { ...session, reauthenticatedAt: response.reauthenticatedAt };
      });
      finish(false, false);
      await current.run();
    } catch (cause) {
      if (pendingRef.current !== current) return;
      if (!isApiError(cause)) {
        finish();
        current.reject(
          cause instanceof Error ? cause : new Error("再認証に失敗しました"),
        );
        return;
      }
      if (cause.status === 401) {
        finish();
        current.reject(canceled());
      } else if (cause.code === "REAUTH_FAILED") {
        setError("パスワードを確認してください");
      } else if (cause.status === 429) {
        setError("しばらくしてからお試しください");
      } else {
        setError("再認証できませんでした。もう一度お試しください");
      }
    } finally {
      if (pendingRef.current === current) setSubmitting(false);
    }
  }

  function withReauth<T>(
    title: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (activeRef.current)
      return Promise.reject(new Error("再認証が進行中です"));
    activeRef.current = true;
    const session = queryClient.getQueryData<SessionInfo>(authKeys.session);
    const at = session?.reauthenticatedAt
      ? Date.parse(session.reauthenticatedAt)
      : NaN;
    if (
      Number.isFinite(at) &&
      Date.now() - at < 5 * 60_000 &&
      Date.now() >= at
    ) {
      return Promise.resolve()
        .then(operation)
        .finally(() => {
          activeRef.current = false;
        });
    }
    return new Promise<T>((resolve, reject) => {
      const current: Pending = {
        title,
        startFocus:
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null,
        reject,
        run: async () => {
          try {
            resolve(await operation());
          } catch (error) {
            reject(error);
          } finally {
            activeRef.current = false;
          }
        },
      };
      pendingRef.current = current;
      setPending(current);
      setError(undefined);
    });
  }

  return (
    <ReauthContext value={{ withReauth }}>
      {children}
      {pending && (
        <ReauthDialog
          title={pending.title}
          error={error}
          submitting={submitting}
          onSubmit={(password) => {
            void submit(password);
          }}
          onCancel={cancel}
        />
      )}
    </ReauthContext>
  );
}
