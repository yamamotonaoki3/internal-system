// S-22 の一覧。ユーザーIDの順にカーソルで続きを取得する。本名は取得しない（サーバーが返さない）。
// 行の操作：有効な行に「無効化」（自分の行を除く。表示の制御で、認可はサーバー）、無効な行に「再有効化」。
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { useSignedInUserId } from "../auth";
import { fetchAdminAccounts, type AccountListItem } from "./account-api";
import { DeactivateDialog } from "./DeactivateDialog";
import { accountKeys } from "./query-keys";
import { ReactivateDialog } from "./ReactivateDialog";

const COLUMNS = [
  "社員ID",
  "表示名",
  "所属部署",
  "メールアドレス",
  "内線番号",
  "役職",
  "状態",
  "操作",
] as const;

type Operation = {
  kind: "deactivate" | "reactivate";
  account: AccountListItem;
};

export function AccountsList() {
  const accounts = useInfiniteQuery({
    queryKey: accountKeys.list,
    queryFn: ({ pageParam }) => fetchAdminAccounts(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  });
  const signedInUserId = useSignedInUserId();
  const [operation, setOperation] = useState<Operation | null>(null);

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
                <td className="p-2">
                  {account.active ? (
                    account.id !== signedInUserId && (
                      <Button
                        variant="danger"
                        onClick={() =>
                          setOperation({ kind: "deactivate", account })
                        }
                      >
                        無効化
                      </Button>
                    )
                  ) : (
                    <Button
                      variant="secondary"
                      onClick={() =>
                        setOperation({ kind: "reactivate", account })
                      }
                    >
                      再有効化
                    </Button>
                  )}
                </td>
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
      {operation?.kind === "deactivate" && (
        <DeactivateDialog
          account={operation.account}
          onClose={() => setOperation(null)}
        />
      )}
      {operation?.kind === "reactivate" && (
        <ReactivateDialog
          account={operation.account}
          onClose={() => setOperation(null)}
        />
      )}
    </>
  );
}
