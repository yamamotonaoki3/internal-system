// S-16 の案件の一覧。「自分が参加する案件／すべての案件」と「進行中／終了した案件」を切り替える。
// 読み込み中・エラー・0件・ありの4つの状態を出し分け、続きは「次のページ」で読む。
import { useState } from "react";
import { Link } from "react-router";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { RadioGroup } from "../../../components/RadioGroup";
import {
  CASE_LIST_SCOPES,
  CASE_STATUSES,
  type CaseListScope,
  type CaseStatus,
} from "../api/case-api";
import { describeError } from "../describe-error";
import { useCases } from "../hooks/useCases";
import { CaseSummaryFacts } from "./CaseSummaryFacts";

const SCOPE_OPTIONS = CASE_LIST_SCOPES.map((value) => ({
  value,
  label: value === "joined" ? "自分が参加する案件" : "すべての案件",
}));
const STATUS_OPTIONS = CASE_STATUSES.map((value) => ({
  value,
  label: value === "active" ? "進行中" : "終了した案件",
}));

function emptyText(scope: CaseListScope, status: CaseStatus): string {
  if (status === "closed") return "終了した案件はありません";
  return scope === "joined"
    ? "参加している案件はありません"
    : "案件はありません";
}

export function CaseList() {
  const [scope, setScope] = useState<CaseListScope>("joined");
  const [status, setStatus] = useState<CaseStatus>("active");
  const cases = useCases(scope, status);

  function renderItems() {
    if (cases.isPending) return <p role="status">読み込み中です</p>;
    if (cases.isError)
      return (
        <Alert tone="error" role="alert">
          {describeError(cases.error)}
        </Alert>
      );
    const items = cases.data.pages.flatMap((page) => page.items);
    if (items.length === 0) return <p>{emptyText(scope, status)}</p>;
    return (
      <>
        <ul className="mb-4">
          {items.map((item) => (
            <li key={item.id} className="border-t border-border-strong p-3">
              <Link
                to={`/cases/${item.id}`}
                className="font-bold text-primary underline"
              >
                {item.title}
              </Link>
              <CaseSummaryFacts item={item} />
            </li>
          ))}
        </ul>
        {cases.hasNextPage && (
          <Button
            variant="secondary"
            disabled={cases.isFetchingNextPage}
            onClick={() => void cases.fetchNextPage()}
          >
            次のページ
          </Button>
        )}
      </>
    );
  }

  return (
    <>
      <RadioGroup
        label="表示する案件"
        options={SCOPE_OPTIONS}
        value={scope}
        onChange={setScope}
      />
      <RadioGroup
        label="状態"
        options={STATUS_OPTIONS}
        value={status}
        onChange={setStatus}
      />
      {renderItems()}
    </>
  );
}
