// 表示名の検索欄（S-20・DM の相手の選択で共用）。送信（検索ボタン・Enter）で確定する。入力のたびには検索しない。
// 前後の空白を除き、空なら onSearch("")（絞り込みを外す）。100文字を超える語は、送らずに画面でもエラーにする（定義元は shared/search-rules.ts）。
import { useState, type FormEvent } from "react";
import { searchKeywordSchema } from "../../../../shared/search-rules";
import { Button } from "../../components/Button";
import { TextField } from "../../components/TextField";

export function MemberSearchField({
  onSearch,
}: {
  onSearch: (q: string) => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | undefined>(undefined);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const keyword = value.trim();
    if (keyword === "") {
      setError(undefined);
      onSearch("");
      return;
    }
    const parsed = searchKeywordSchema.safeParse(keyword);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }
    setError(undefined);
    onSearch(keyword);
  }

  return (
    <form onSubmit={submit} noValidate className="mb-4 flex items-end gap-2">
      <div className="flex-1">
        <TextField
          label="表示名で検索"
          type="search"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          error={error}
        />
      </div>
      <div className="mb-4">
        <Button type="submit">検索</Button>
      </div>
    </form>
  );
}
