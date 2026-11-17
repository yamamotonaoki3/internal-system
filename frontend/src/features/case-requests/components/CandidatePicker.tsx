// 追加の候補（5-3 AC-5）。社員一覧の API で探して足し、足した人は外せる。申請者本人と、足した人は検索の結果に出さない。
import { useState } from "react";
import { Button } from "../../../components/Button";
import { TextField } from "../../../components/TextField";
import type { CandidateUser } from "../api/case-request-api";
import { describeError } from "../describe-error";
import { useCandidateSearch } from "../hooks/useCaseRequestChoices";
import { useSettledValue } from "../hooks/useSettledValue";

const SEARCH_DELAY_MS = 300;

type Props = {
  selfId: string | undefined;
  selected: readonly CandidateUser[];
  error?: string;
  onChange: (next: CandidateUser[]) => void;
};

export function CandidatePicker({ selfId, selected, error, onChange }: Props) {
  const [q, setQ] = useState("");
  const settled = useSettledValue(q.trim(), SEARCH_DELAY_MS);
  const search = useCandidateSearch(settled);
  const chosen = new Set(selected.map((user) => user.id));
  const results = (search.data ?? []).filter(
    (user) => user.id !== selfId && !chosen.has(user.id),
  );

  return (
    <fieldset className="mb-4">
      <legend className="mb-1 text-sm font-bold">追加の候補</legend>
      <TextField
        label="候補の検索"
        hint="名前で探して、承認のときに参加させたい人を足せます（任意）"
        autoComplete="off"
        value={q}
        error={error}
        onChange={(event) => setQ(event.target.value)}
      />
      {search.isError && (
        <p className="mb-2 text-sm text-danger">
          {describeError(search.error)}
        </p>
      )}
      {results.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {results.map((user) => (
            <Button
              key={user.id}
              variant="secondary"
              onClick={() => onChange([...selected, user])}
            >
              {user.displayName}を追加
            </Button>
          ))}
        </div>
      )}
      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {selected.map((user) => (
            <li key={user.id} className="flex items-center gap-2">
              <span>{user.displayName}</span>
              <Button
                variant="secondary"
                aria-label={`${user.displayName}を外す`}
                onClick={() =>
                  onChange(selected.filter((other) => other.id !== user.id))
                }
              >
                外す
              </Button>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
