// S-25 監査ログ（全体管理者だけ。表示の制御であり、認可はサーバーが毎回行う）。
// 新しい順の一覧を、日時（JST）・操作した人・操作の種類・対象・結果で出す。パソコンは表、狭い画面はカード形式（CSS で切り替える）。
// 取得のたびに閲覧の記録が残るため、自動の再取得（フォーカス・再接続・再試行）はせず、「絞り込む」「さらに読み込む」「再試行」を押したときだけ送る。
// 変更・削除・書き出しの操作は置かない（0-6 AC-4）。
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import type { ApiError } from "../../services/api-client";
import { useSignedInUserId } from "../auth";
import { actionLabel, targetTypeLabel } from "./action-labels";
import {
  searchAuditLogs,
  type AuditLogFilters,
  type AuditLogItem,
} from "./audit-log-api";
import {
  AuditLogFilters as AuditLogFilterForm,
  EMPTY_DRAFT,
  type FilterDraft,
} from "./AuditLogFilters";
import { auditLogKeys } from "./query-keys";

const COLUMNS = ["日時", "操作した人", "操作の種類", "対象", "結果"] as const;

// 名前（label）をサーバーが解決する対象の種類。行がなければ「（削除された対象）」と出す。それ以外は種類の名前だけを出す
const NAMED_TARGET_TYPES: ReadonlySet<string> = new Set([
  "user",
  "department",
  "client",
  "channel",
]);

const FIELD_MESSAGES = {
  from: "開始日を確かめてください",
  to: "終了日を確かめてください",
  action: "操作の種類を確かめてください",
  result: "結果を確かめてください",
} as const;

function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    "code" in error &&
    "message" in error
  );
}

const pad = (value: number, length = 2) => String(value).padStart(length, "0");

/** UTC の ISO 8601 を、日本時間（JST）の「YYYY-MM-DD HH:mm:ss」にする。実行環境の時刻帯に依存しない */
function formatJst(iso: string): string {
  const date = new Date(Date.parse(iso) + 9 * 60 * 60_000);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function toFilters(draft: FilterDraft): AuditLogFilters {
  return {
    ...(draft.from !== "" ? { from: draft.from } : {}),
    ...(draft.to !== "" ? { to: draft.to } : {}),
    ...(draft.action !== "" ? { action: draft.action } : {}),
    ...(draft.result !== "" ? { result: draft.result } : {}),
    ...(draft.actor !== null ? { actorId: draft.actor.id } : {}),
    ...(draft.target !== null
      ? { targetType: draft.target.type, targetId: draft.target.id }
      : {}),
  };
}

/** 対象の表示名。名前を解決しない種類は null（種類の名前だけを出す） */
function targetName(target: NonNullable<AuditLogItem["target"]>) {
  if (target.label !== null)
    return `${target.label}${target.isActive === false ? "（無効）" : ""}`;
  return NAMED_TARGET_TYPES.has(target.type) ? "（削除された対象）" : null;
}

function CellLabel({ children }: { children: string }) {
  return <span className="mr-1 font-bold md:hidden">{children}：</span>;
}

type RowProps = {
  item: AuditLogItem;
  onPickActor: (actor: NonNullable<FilterDraft["actor"]>) => void;
  onPickTarget: (target: NonNullable<FilterDraft["target"]>) => void;
};

function AuditLogRow({ item, onPickActor, onPickTarget }: RowProps) {
  const { actor, target } = item;
  const actorName = actor?.displayName ?? null;
  const hasFailureInfo =
    item.failureCategory !== undefined || item.affectedCount !== undefined;
  return (
    <tr className="border-t border-border-strong max-md:mb-3 max-md:block max-md:rounded-md max-md:border">
      <td className="p-2 align-top max-md:block">
        <CellLabel>日時</CellLabel>
        {formatJst(item.occurredAt)}
      </td>
      <td className="p-2 align-top max-md:block">
        <CellLabel>操作した人</CellLabel>
        {actor === null ? (
          <span>（不明）</span>
        ) : (
          <>
            <span>
              {actorName ?? "（不明）"}
              {actorName !== null && !actor.isActive ? "（無効）" : ""}
            </span>{" "}
            <Button
              variant="ghost"
              onClick={() =>
                onPickActor({ id: actor.id, name: actorName ?? "（不明）" })
              }
            >
              この人で絞り込む
            </Button>
          </>
        )}
      </td>
      <td className="p-2 align-top max-md:block">
        <CellLabel>操作の種類</CellLabel>
        <span>{actionLabel(item.action)}</span>
      </td>
      <td className="p-2 align-top max-md:block">
        <CellLabel>対象</CellLabel>
        {target === null ? (
          !hasFailureInfo && <span>―</span>
        ) : (
          <>
            {targetName(target) !== null && <span>{targetName(target)}</span>}{" "}
            <span className="text-text-muted">
              {targetTypeLabel(target.type)}
            </span>{" "}
            <Button
              variant="ghost"
              onClick={() =>
                onPickTarget({
                  type: target.type,
                  id: target.id,
                  name: targetName(target) ?? targetTypeLabel(target.type),
                })
              }
            >
              この対象で絞り込む
            </Button>
          </>
        )}
        {item.failureCategory !== undefined && (
          <span className="block">分類：{item.failureCategory}</span>
        )}
        {item.affectedCount !== undefined && (
          <span className="block">件数：{item.affectedCount}</span>
        )}
      </td>
      <td className="p-2 align-top max-md:block">
        <CellLabel>結果</CellLabel>
        <span>{item.result === "success" ? "成功" : "失敗"}</span>
        {item.reason !== undefined && (
          <span className="block text-text-muted">理由：{item.reason}</span>
        )}
      </td>
    </tr>
  );
}

export function AuditLogsPage() {
  const userId = useSignedInUserId();
  const [draft, setDraft] = useState<FilterDraft>(EMPTY_DRAFT);
  // 「絞り込む」を押した時点の条件と、押した回数
  const [applied, setApplied] = useState<{
    filters: AuditLogFilters;
    requestNumber: number;
  }>({ filters: {}, requestNumber: 0 });
  const [rangeError, setRangeError] = useState<string | null>(null);

  const logs = useInfiniteQuery({
    // 利用者の ID が確かめられる前は取得しない（前の利用者の一覧を出さない）
    queryKey: auditLogKeys.search(
      userId ?? "",
      applied.filters,
      applied.requestNumber,
    ),
    enabled: userId !== undefined,
    queryFn: ({ pageParam }) =>
      searchAuditLogs({ ...applied.filters, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // 取得のたびに閲覧の記録が残るため、自動で送らない。閲覧の内容を長く手元に残さない
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    gcTime: 0,
  });

  const submit = () => {
    if (draft.from !== "" && draft.to !== "" && draft.from > draft.to) {
      setRangeError("開始日は終了日以前の日付にしてください");
      return;
    }
    setRangeError(null);
    setApplied((previous) => ({
      filters: toFilters(draft),
      requestNumber: previous.requestNumber + 1,
    }));
  };

  const apiError = isApiError(logs.error) ? logs.error : null;
  const fieldErrors: Partial<Record<keyof typeof FIELD_MESSAGES, string>> = {};
  if (apiError?.status === 422) {
    for (const field of apiError.fields ?? []) {
      if (field in FIELD_MESSAGES)
        fieldErrors[field as keyof typeof FIELD_MESSAGES] =
          FIELD_MESSAGES[field as keyof typeof FIELD_MESSAGES];
    }
  }

  function errorNotice() {
    if (!logs.isError) return null;
    if (apiError?.status === 403)
      return (
        <Alert tone="error" role="alert">
          権限がありません。監査ログを見られるのは全体管理者だけです。
        </Alert>
      );
    if (apiError?.status === 422)
      return (
        <Alert tone="error" role="alert">
          {apiError.message}
        </Alert>
      );
    return (
      <Alert tone="error" role="alert">
        <p className="mb-2">
          監査ログを取得できませんでした。時間をおいて、もう一度お試しください。
        </p>
        <Button
          variant="secondary"
          onClick={() =>
            void (logs.isFetchNextPageError
              ? logs.fetchNextPage()
              : logs.refetch())
          }
        >
          再試行
        </Button>
      </Alert>
    );
  }

  function listContent() {
    if (logs.data === undefined)
      return logs.isError ? null : <p role="status">読み込み中です</p>;
    const items = logs.data.pages.flatMap((page) => page.items);
    if (items.length === 0 && !logs.isError)
      return <p>該当する記録はありません</p>;
    return (
      <>
        <div className="mb-4 md:overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead className="max-md:sr-only">
              <tr>
                {COLUMNS.map((column) => (
                  <th key={column} scope="col" className="p-2">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <AuditLogRow
                  key={item.id}
                  item={item}
                  onPickActor={(actor) => setDraft({ ...draft, actor })}
                  onPickTarget={(target) => setDraft({ ...draft, target })}
                />
              ))}
            </tbody>
          </table>
        </div>
        {logs.hasNextPage && (
          <Button
            variant="secondary"
            disabled={logs.isFetchingNextPage}
            onClick={() => void logs.fetchNextPage()}
          >
            さらに読み込む
          </Button>
        )}
      </>
    );
  }

  return (
    <section className="mx-auto max-w-5xl rounded-lg bg-surface p-4 md:p-6">
      <h1 className="mb-4 text-2xl font-bold">監査ログ</h1>
      <AuditLogFilterForm
        draft={draft}
        onChange={setDraft}
        onSubmit={submit}
        rangeError={rangeError}
        fieldErrors={fieldErrors}
      />
      {errorNotice()}
      {listContent()}
    </section>
  );
}
