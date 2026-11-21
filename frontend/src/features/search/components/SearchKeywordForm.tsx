// 検索の語の入力欄（ヘッダーと S-15 で共用）。送信で確定し、前後の空白を除いた語を渡す。
// 空・101文字以上は送らずに、入力欄の近くにエラーを出す（定義元は shared/search-rules.ts。サーバーでも検証する）。
import { useState, type FormEvent, type ReactNode } from "react";
import { searchKeywordSchema } from "../../../../../shared/search-rules";
import { Button } from "../../../components/Button";
import { TextField } from "../../../components/TextField";

export function SearchKeywordForm({
  label,
  initialKeyword = "",
  submitLabel = "検索",
  onSearch,
  children,
}: {
  /** form の名前（role=search のランドマークの名前） */
  label: string;
  initialKeyword?: string;
  /** 送信ボタンの名前。同じ画面に「検索」のボタンが並ぶ場所（ヘッダー）では、区別できる名前にする */
  submitLabel?: string;
  onSearch: (keyword: string) => void;
  /** 語の欄の後ろに置く、ほかの条件の欄 */
  children?: ReactNode;
}) {
  const [value, setValue] = useState(initialKeyword);
  const [error, setError] = useState<string | undefined>(undefined);

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
          <TextField
            label="検索する言葉"
            hideLabel
            type="search"
            error={error}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </div>
        <Button type="submit">{submitLabel}</Button>
      </div>
      {children}
    </form>
  );
}
