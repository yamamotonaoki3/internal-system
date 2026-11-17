// S-22 アカウント管理（一覧）。新規登録（S-23）から戻ったときは「登録しました」を一度だけ出す。
// タブ「アカウント」と「退職処理の申請」（#128）。選んだタブは URL の tab に持たせる（通知の移動先 /accounts?tab=retirement-requests で開ける）。
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { Alert } from "../components/Alert";
import { Button } from "../components/Button";
import { AccountsList } from "../features/accounts/AccountsList";
import { RetirementRequestReviewList } from "../features/retirement-requests";

const TABS = [
  { id: "accounts", label: "アカウント" },
  { id: "retirement-requests", label: "退職処理の申請" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function AccountsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: TabId =
    searchParams.get("tab") === "retirement-requests"
      ? "retirement-requests"
      : "accounts";
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
      <div
        role="tablist"
        aria-label="アカウント管理"
        className="mb-4 flex gap-2"
      >
        {TABS.map((item) => (
          <Button
            key={item.id}
            role="tab"
            id={`accounts-tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls={`accounts-panel-${item.id}`}
            variant={tab === item.id ? "primary" : "secondary"}
            onClick={() =>
              setSearchParams(item.id === "accounts" ? {} : { tab: item.id })
            }
          >
            {item.label}
          </Button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`accounts-panel-${tab}`}
        aria-labelledby={`accounts-tab-${tab}`}
      >
        {tab === "accounts" ? (
          <>
            <p className="mb-4">
              <Link to="/accounts/new" className="text-primary underline">
                新規登録
              </Link>
            </p>
            <AccountsList />
          </>
        ) : (
          <RetirementRequestReviewList />
        )}
      </div>
    </section>
  );
}
