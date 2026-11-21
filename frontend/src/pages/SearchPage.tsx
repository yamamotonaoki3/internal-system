// S-15 検索結果（/search）。URL の条件（q・roomId・from・to）で検索し、条件の欄から送ると URL を書き換えて取り直す。
// 案件の区画（語だけで取る）を、メッセージの結果の上に置く。q がなければ API を呼ばず、検索を促す案内の文を出す。
import { useSearchParams } from "react-router";
import {
  CaseSearchResults,
  MessageSearchResults,
  SearchConditionsForm,
  type MessageSearchConditions,
} from "../features/search";

const CONDITION_NAMES = ["q", "roomId", "from", "to"] as const;

function conditionsOf(
  params: URLSearchParams,
): Partial<MessageSearchConditions> {
  const conditions: Partial<MessageSearchConditions> = {};
  for (const name of CONDITION_NAMES) {
    const value = params.get(name);
    // 空白（全角を含む）だけの値は、ないものとして扱う（案内の文・結果の区画・API の呼び出しを同じ条件で決める）
    if (value !== null && value.trim() !== "") conditions[name] = value;
  }
  return conditions;
}

export function SearchPage() {
  const [params, setParams] = useSearchParams();
  const conditions = conditionsOf(params);
  const { q } = conditions;
  return (
    <section className="mx-auto max-w-4xl rounded-lg bg-surface p-4 md:p-6">
      <h1 className="mb-4 text-2xl font-bold">検索結果</h1>
      {q === undefined && (
        <p className="mb-3">検索する言葉を入れて、『検索』を押してください。</p>
      )}
      <SearchConditionsForm
        // URL が変わったら（ヘッダーから検索し直したとき等）、欄をいまの条件で作り直す（欄の値は useState の初期値のため）。
        // 兄弟の結果の部品と key が重ならないよう、接頭辞で分ける
        key={`form:${params.toString()}`}
        conditions={conditions}
        onSearch={(next) => setParams(next)}
      />
      {q !== undefined && (
        // 案件の区画は語だけで取るので、部屋・期間を変えても作り直さない
        <CaseSearchResults key={`cases:${q}`} q={q} />
      )}
      {q !== undefined && (
        // 条件が変わったら、見せるページ数を1に戻す
        <MessageSearchResults
          key={`results:${params.toString()}`}
          conditions={{ ...conditions, q }}
        />
      )}
    </section>
  );
}
