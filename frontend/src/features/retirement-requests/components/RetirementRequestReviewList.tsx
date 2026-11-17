// S-22 の「退職処理の申請」タブ。申請中の申請を、対象の表示名・部署・申請者・日時で出す。
// 行から「無効化」（features/accounts の無効化のダイアログ。無効化で申請が完了になる）と「却下」（理由の入力）。
// 完了の文は一覧の上に出し、次の操作を始めたら消す。ダイアログは一覧の状態の分岐の外に置く（再取得の失敗・読み込み中でも入力を失わない）。
import { useState } from "react";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { DeactivateDialog } from "../../accounts";
import type { RetirementRequestReviewItem } from "../api/retirement-request-api";
import {
  useInvalidateRetirementRequests,
  useReviewRetirementRequests,
} from "../hooks/useRetirementRequests";
import { RejectDialog } from "./RejectDialog";

const COLUMNS = ["対象", "部署", "申請者", "申請日時", "操作"] as const;

type Operation = {
  kind: "deactivate" | "reject";
  request: RetirementRequestReviewItem;
};

export function RetirementRequestReviewList() {
  const requests = useReviewRetirementRequests("pending");
  const invalidate = useInvalidateRetirementRequests();
  const [operation, setOperationState] = useState<Operation | null>(null);
  // 完了のメッセージ。次の操作を始めたら消す（時間では消さない）
  const [done, setDone] = useState<string | null>(null);
  const setOperation = (next: Operation) => {
    setDone(null);
    setOperationState(next);
  };
  const finish = (message: string) => {
    setOperationState(null);
    setDone(message);
  };

  function listContent() {
    if (requests.isPending) return <p role="status">読み込み中です</p>;
    if (requests.isError)
      return (
        <Alert tone="error" role="alert">
          退職処理の申請を取得できませんでした。時間をおいて、もう一度お試しください。
        </Alert>
      );
    const items = requests.data.pages.flatMap((page) => page.items);
    if (items.length === 0) return <p>申請中の退職処理の申請はありません</p>;
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
              {items.map((request) => (
                <tr key={request.id} className="border-t border-border-strong">
                  <td className="p-2">{request.target.displayName}</td>
                  <td className="p-2">{request.department.name}</td>
                  <td className="p-2">{request.requester.displayName}</td>
                  <td className="p-2">{request.createdAt}</td>
                  <td className="p-2">
                    <div className="flex gap-2">
                      <Button
                        variant="danger"
                        onClick={() =>
                          setOperation({ kind: "deactivate", request })
                        }
                      >
                        無効化
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() =>
                          setOperation({ kind: "reject", request })
                        }
                      >
                        却下
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {requests.hasNextPage && (
          <Button
            variant="secondary"
            disabled={requests.isFetchingNextPage}
            onClick={() => void requests.fetchNextPage()}
          >
            次のページ
          </Button>
        )}
      </>
    );
  }

  return (
    <>
      {done !== null && (
        <Alert tone="info" role="status">
          {done}
        </Alert>
      )}
      {listContent()}
      {operation?.kind === "deactivate" && (
        <DeactivateDialog
          account={operation.request.target}
          onClose={() => setOperationState(null)}
          onDone={() => {
            finish("アカウントを無効化しました");
            // 無効化で申請が完了になるため、申請の一覧も取り直す（アカウントの一覧は無効化の hook が取り直す）
            void invalidate();
          }}
        />
      )}
      {operation?.kind === "reject" && (
        <RejectDialog
          request={operation.request}
          onClose={() => setOperationState(null)}
          onDone={() => finish("却下しました")}
        />
      )}
    </>
  );
}
