// S-22 の一覧。ユーザーIDの順にカーソルで続きを取得する。本名は取得しない（サーバーが返さない）。
import { useInfiniteQuery } from "@tanstack/react-query";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { fetchAdminAccounts } from "./account-api";
import { accountKeys } from "./query-keys";

const COLUMNS = [
  "社員ID",
  "表示名",
  "所属部署",
  "メールアドレス",
  "内線番号",
  "役職",
  "状態",
] as const;

export function AccountsList() {
  const accounts = useInfiniteQuery({
    queryKey: accountKeys.list,
    queryFn: ({ pageParam }) => fetchAdminAccounts(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  });

  if (accounts.isPending) return <p role="status">読み込み中です</p>;
  if (accounts.isError)
    return (
      <Alert tone="error" role="alert">
        アカウントを取得できませんでした。時間をおいて、もう一度お試しください。
      </Alert>
    );

  const items = accounts.data.pages.flatMap((page) => page.items);
  if (items.length === 0) return <p>アカウントがありません</p>;

  return (
    <>
      <div className="mb-4 overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr>
              {COLUMNS.map((column) => (
                <th key={column} scope="col" className="p-2">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((account) => (
              <tr key={account.id} className="border-t border-border-strong">
                <td className="p-2">{account.loginId}</td>
                <td className="p-2">{account.displayName}</td>
                <td className="p-2">{account.department?.name ?? ""}</td>
                <td className="p-2">{account.email}</td>
                <td className="p-2">{account.extension ?? ""}</td>
                <td className="p-2">{account.jobTitle ?? ""}</td>
                <td className="p-2">{account.active ? "有効" : "無効"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {accounts.hasNextPage && (
        <Button
          variant="secondary"
          disabled={accounts.isFetchingNextPage}
          onClick={() => void accounts.fetchNextPage()}
        >
          次のページ
        </Button>
      )}
    </>
  );
}
