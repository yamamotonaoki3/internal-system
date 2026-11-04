// S-34 の状態の振り分け（読み込み中・エラー・完了済み・未設定）と、登録成功後の初期パスワードの表示。
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { setupKeys } from "../api/query-keys";
import { useSetupStatus } from "../hooks/useSetupStatus";
import { InitialPasswordNotice } from "./InitialPasswordNotice";
import { SetupForm, type Registered } from "./SetupForm";

export function SetupFlow() {
  const status = useSetupStatus();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // 例外：サーバーのデータを useState に入れている。初期パスワードを含む応答を
  // TanStack Query のキャッシュ（QueryCache・MutationCache）に残さないため。
  // この部品が外れる（離脱・再読み込み）か「ログイン画面へ進む」で消える。
  const [registered, setRegistered] = useState<Registered | null>(null);

  if (registered !== null) {
    return (
      <InitialPasswordNotice
        loginId={registered.loginId}
        initialPassword={registered.initialPassword}
        onProceed={() => {
          setRegistered(null);
          void navigate("/login", { replace: true });
        }}
      />
    );
  }

  if (status.isPending)
    return (
      <p role="status" className="mb-3 text-text-muted">
        読み込み中です
      </p>
    );

  if (status.isError)
    return (
      <Alert tone="error" role="alert">
        <p className="mb-3">状態を確認できませんでした。</p>
        <Button variant="secondary" onClick={() => void status.refetch()}>
          再試行
        </Button>
      </Alert>
    );

  if (!status.data.setupRequired)
    return (
      <p className="mb-3">
        初回セットアップは完了しています。
        <Link to="/login" className="text-primary underline">
          ログイン画面
        </Link>
        へ進んでください。
      </p>
    );

  return (
    <SetupForm
      onRegistered={(result) => {
        setRegistered(result);
        // 応答に初期パスワードを含まない状態だけを書き込む。次に開いたとき「完了済み」にする
        queryClient.setQueryData(setupKeys.status, { setupRequired: false });
      }}
      onConflict={async () => {
        const result = await status.refetch();
        return result.data?.setupRequired === true;
      }}
    />
  );
}
