// S-23 アカウント登録（個別）。成功すると初期パスワードを一度だけ表示し、「一覧へ戻る」で S-22 へ移る。
// 初期パスワードは useState にだけ置く（TanStack Query のキャッシュ・ブラウザの保存領域・URL に残さない）。
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { fetchDepartmentOptions } from "../features/accounts/account-api";
import { AccountForm, type Registered } from "../features/accounts/AccountForm";
import { accountKeys } from "../features/accounts/query-keys";
import { InitialPasswordNotice } from "../features/setup/components/InitialPasswordNotice";

export function AccountCreatePage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const departments = useQuery({
    queryKey: accountKeys.departmentOptions,
    queryFn: fetchDepartmentOptions,
    retry: false,
  });
  // 例外：サーバーのデータを useState に入れている。初期パスワードを含む応答を
  // キャッシュに残さないため。この画面が外れる（離脱・再読み込み）か「一覧へ戻る」で消える。
  const [registered, setRegistered] = useState<Registered | null>(null);

  return (
    <section className="mx-auto max-w-3xl rounded-lg bg-surface p-4 md:p-6">
      <h1 className="mb-4 text-2xl font-bold">アカウント登録</h1>
      {registered !== null ? (
        <InitialPasswordNotice
          loginId={registered.loginId}
          initialPassword={registered.initialPassword}
          proceedLabel="一覧へ戻る"
          onProceed={() => {
            setRegistered(null);
            void queryClient.invalidateQueries({ queryKey: accountKeys.list });
            void navigate("/accounts", { state: { registered: true } });
          }}
        />
      ) : departments.isPending ? (
        <p role="status">読み込み中です</p>
      ) : departments.isError ? (
        <Alert tone="error" role="alert">
          <p className="mb-3">所属部署の候補を取得できませんでした。</p>
          <Button
            variant="secondary"
            onClick={() => void departments.refetch()}
          >
            再試行
          </Button>
        </Alert>
      ) : (
        <AccountForm
          departments={departments.data}
          onRegistered={setRegistered}
        />
      )}
    </section>
  );
}
