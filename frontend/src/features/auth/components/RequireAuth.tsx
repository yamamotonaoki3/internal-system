// ログイン済みのときだけ中身を出す。未ログイン（401）なら /login へ移り、
// 初回パスワードの変更が必要な利用者には案内だけを出す。
import type { ReactNode } from "react";
import { Navigate } from "react-router";
import type { ApiError } from "../../../services/api-client";
import { useSession } from "../hooks/useSession";
import { PasswordChangePending } from "./PasswordChangePending";

export function RequireAuth({ children }: { children: ReactNode }) {
  const session = useSession();

  if (session.isPending) return <p role="status">確認中です</p>;

  if (session.isError) {
    // apiClient は失敗を ApiError の形で返す（services/api-client.ts）
    const error = session.error as unknown as ApiError;
    if (error.code === "UNAUTHENTICATED")
      return <Navigate to="/login" replace />;
    return (
      <div role="alert">
        <p>ログイン状態を確認できませんでした。</p>
        <button type="button" onClick={() => void session.refetch()}>
          再試行
        </button>
      </div>
    );
  }

  if (session.data.mustChangePassword) return <PasswordChangePending />;
  return <>{children}</>;
}
