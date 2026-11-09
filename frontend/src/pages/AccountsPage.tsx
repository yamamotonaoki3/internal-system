// S-22 アカウント管理（一覧）。新規登録（S-23）から戻ったときは「登録しました」を一度だけ出す。
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Alert } from "../components/Alert";
import { AccountsList } from "../features/accounts/AccountsList";

export function AccountsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  // 戻ってきた直後だけ出す。履歴の state は消し、再読み込みで再表示しない
  const [registered] = useState(
    (location.state as { registered?: boolean } | null)?.registered === true,
  );
  useEffect(() => {
    if (registered) void navigate(location.pathname, { replace: true });
  }, [registered, navigate, location.pathname]);

  return (
    <section className="mx-auto max-w-5xl rounded-lg bg-surface p-4 md:p-6">
      <h1 className="mb-4 text-2xl font-bold">アカウント管理</h1>
      {registered && (
        <Alert tone="info" role="status">
          登録しました
        </Alert>
      )}
      <p className="mb-4">
        <Link to="/accounts/new" className="text-primary underline">
          新規登録
        </Link>
      </p>
      <AccountsList />
    </section>
  );
}
