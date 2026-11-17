// S-16 の案件の一覧。「自分が参加する案件／すべての案件」と「進行中／終了した案件」を切り替える。
// 読み込み中・エラー・0件・ありの4つの状態を出し分け、続きは「次のページ」で読む。
import { useId, useState } from "react";
import { Link } from "react-router";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import {
  CASE_LIST_SCOPES,
  CASE_STATUSES,
  type CaseListScope,
  type CaseStatus,
} from "../api/case-api";
import { describeError } from "../describe-error";
import { useCases } from "../hooks/useCases";
import { CaseSummaryFacts } from "./CaseSummaryFacts";

const SCOPE_LABELS: Readonly<Record<CaseListScope, string>> = {
  joined: "自分が参加する案件",
  all: "すべての案件",
};
const STATUS_FILTER_LABELS: Readonly<Record<CaseStatus, string>> = {
  active: "進行中",
  closed: "終了した案件",
};

function emptyText(scope: CaseListScope, status: CaseStatus): string {
  if (status === "closed") return "終了した案件はありません";
  return scope === "joined"
    ? "参加している案件はありません"
    : "案件はありません";
}

type RadioGroupProps<T extends string> = {
  label: string;
  options: readonly T[];
  labels: Readonly<Record<T, string>>;
  value: T;
  onChange: (value: T) => void;
};

function RadioGroup<T extends string>({
  label,
  options,
  labels,
  value,
  onChange,
}: RadioGroupProps<T>) {
  const labelId = useId();
  const name = useId();
  return (
    <div role="radiogroup" aria-labelledby={labelId} className="mb-3">
      <p id={labelId} className="mb-1 text-sm font-bold">
        {label}
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {options.map((option) => (
          <label
            key={option}
            className="flex min-h-11 items-center gap-2 md:min-h-10"
          >
            <input
              type="radio"
              name={name}
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
              className="size-5"
            />
            {labels[option]}
          </label>
        ))}
      </div>
    </div>
  );
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
        options={CASE_LIST_SCOPES}
        labels={SCOPE_LABELS}
        value={scope}
        onChange={setScope}
      />
      <RadioGroup
        label="状態"
        options={CASE_STATUSES}
        labels={STATUS_FILTER_LABELS}
        value={status}
        onChange={setStatus}
      />
      {renderItems()}
    </>
  );
}
