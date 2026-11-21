// S-15 の「案件」の区画。読み込み中・0件・失敗と再試行・さらに表示を出す。失敗したときは、取得済みのページも出さない。
// 行は件名（語を強調）・案件番号・状態・取引先・担当部署・納期・TODO の進捗（一覧の行と同じ部品）。押すと案件の画面（S-17。参加していない人には非公開の案内が出る）。
import { Link } from "react-router";
import { Button } from "../../../components/Button";
import { CaseTodoProgress } from "../../cases";
import type { CaseSearchItem } from "../api/search-api";
import { useCaseSearch } from "../hooks/useCaseSearch";
import { HighlightedExcerpt } from "./HighlightedExcerpt";

const STATUS_LABELS: Record<CaseSearchItem["status"], string> = {
  active: "進行中",
  closed: "終了",
};

function CaseRow({ item, keyword }: { item: CaseSearchItem; keyword: string }) {
  return (
    <li className="rounded-md border border-border p-3">
      <Link
        to={`/cases/${encodeURIComponent(item.id)}`}
        className="block break-words underline"
      >
        <HighlightedExcerpt text={item.title} keyword={keyword} />
      </Link>
      <p className="text-sm text-text-muted">
        <span>{item.caseNumber}</span>
        {" ・ "}
        <span>{STATUS_LABELS[item.status]}</span>
        {" ・ "}
        <span>{item.client.name}</span>
        {item.departments.length > 0 && (
          <>
            {" ・ "}
            <span>{item.departments.map((d) => d.name).join("、")}</span>
          </>
        )}
        {item.dueDate !== null && (
          <>
            {" ・ 納期 "}
            <span>{item.dueDate}</span>
          </>
        )}
        {" ・ "}
        <span>
          TODO：
          <CaseTodoProgress progress={item.progress} />
        </span>
      </p>
    </li>
  );
}

function CaseSearchBody({ q }: { q: string }) {
  const { query, showMore } = useCaseSearch(q);
  // 失敗したら、取得済みの結果があっても出さない。再試行は1ページ目から取り直す
  if (query.isError)
    return (
      <div role="alert" className="mb-4 flex items-center gap-2 text-danger">
        <p>案件を検索できませんでした</p>
        <Button variant="secondary" onClick={() => void query.refetch()}>
          再試行
        </Button>
      </div>
    );
  if (query.data === undefined)
    return (
      <p role="status" className="text-text-muted">
        案件を読み込み中です
      </p>
    );
  const { items, hasMore } = query.data;
  return (
    <>
      {items.length === 0 ? (
        <p>一致する案件はありません</p>
      ) : (
        <ul
          aria-label="案件の検索結果の一覧"
          className="mb-4 flex flex-col gap-2"
        >
          {items.map((item) => (
            <CaseRow key={item.id} item={item} keyword={q} />
          ))}
        </ul>
      )}
      {hasMore && (
        <Button
          variant="secondary"
          disabled={query.isFetching}
          onClick={showMore}
        >
          さらに表示
        </Button>
      )}
    </>
  );
}

export function CaseSearchResults({ q }: { q: string }) {
  return (
    <section aria-labelledby="case-search-heading" className="mb-6">
      <h2 id="case-search-heading" className="mb-2 text-xl font-bold">
        案件
      </h2>
      <CaseSearchBody q={q} />
    </section>
  );
}
