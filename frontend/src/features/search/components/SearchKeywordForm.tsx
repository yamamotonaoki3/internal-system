// 検索の語の入力欄（ヘッダーと S-15 で共用）。送信で確定し、前後の空白を除いた語を渡す。
// 空・101文字以上は送らずに、入力欄の近くにエラーを出す（定義元は shared/search-rules.ts。サーバーでも検証する）。
import { useState, type FormEvent, type ReactNode } from "react";
import { searchKeywordSchema } from "../../../../../shared/search-rules";
import { Button } from "../../../components/Button";
import { FieldMessages, useFieldIds } from "../../../components/FieldMessages";

export function SearchKeywordForm({
  label,
  initialKeyword = "",
  onSearch,
  children,
}: {
  /** form の名前（role=search のランドマークの名前） */
  label: string;
  initialKeyword?: string;
  onSearch: (keyword: string) => void;
  /** 語の欄の後ろに置く、ほかの条件の欄 */
  children?: ReactNode;
}) {
  const [value, setValue] = useState(initialKeyword);
  const [error, setError] = useState<string | undefined>(undefined);
  const { id, hintId, errorId, describedBy } = useFieldIds(undefined, error);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = searchKeywordSchema.safeParse(value);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    setError(undefined);
    onSearch(parsed.data);
  }

  return (
    <form role="search" aria-label={label} onSubmit={submit} noValidate>
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <input
            id={id}
            type="search"
            aria-label="検索する言葉"
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="min-h-11 md:min-h-10 w-full rounded-md border border-border-strong bg-surface px-3 text-base"
          />
          <FieldMessages hintId={hintId} errorId={errorId} error={error} />
        </div>
        <Button type="submit">検索</Button>
      </div>
      {children}
    </form>
  );
}
