// S-15 の検索の条件（語と、折りたたんだ絞り込み〔期間〕）。部屋の絞り込みは URL の roomId を引き継ぐ（選ぶ部品は作らない）。
import { useState } from "react";
import { TextField } from "../../../components/TextField";
import type { MessageSearchConditions } from "../api/query-keys";
import { SearchKeywordForm } from "./SearchKeywordForm";

export function SearchConditionsForm({
  conditions,
  onSearch,
}: {
  conditions: Partial<MessageSearchConditions>;
  onSearch: (conditions: MessageSearchConditions) => void;
}) {
  const [from, setFrom] = useState(conditions.from ?? "");
  const [to, setTo] = useState(conditions.to ?? "");
  return (
    <SearchKeywordForm
      label="検索の条件"
      initialKeyword={conditions.q ?? ""}
      onSearch={(q) =>
        onSearch({
          q,
          ...(conditions.roomId === undefined
            ? {}
            : { roomId: conditions.roomId }),
          ...(from === "" ? {} : { from }),
          ...(to === "" ? {} : { to }),
        })
      }
    >
      <details className="mb-4">
        <summary className="cursor-pointer">絞り込み</summary>
        <div className="mt-2 flex flex-wrap gap-4">
          <TextField
            label="開始日"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
          <TextField
            label="終了日"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
      </details>
    </SearchKeywordForm>
  );
}
