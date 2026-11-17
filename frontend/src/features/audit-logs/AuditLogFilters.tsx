// 監査ログの絞り込みのフォーム（S-25）。入力ごとには検索せず、「絞り込む」を押したときだけ検索する（取得のたびに閲覧の記録が残るため）。
// 操作した人・対象は、一覧の行の「この人で絞り込む」「この対象で絞り込む」で指定し、ここに「操作した人：○○」の形で出して外せるようにする。
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { SelectField } from "../../components/SelectField";
import { TextField } from "../../components/TextField";
import { ACTION_LABELS } from "./action-labels";

export type FilterDraft = {
  from: string;
  to: string;
  action: string;
  result: "" | "success" | "failure";
  actor: { id: string; name: string } | null;
  target: { type: string; id: string; name: string } | null;
};

export const EMPTY_DRAFT: FilterDraft = {
  from: "",
  to: "",
  action: "",
  result: "",
  actor: null,
  target: null,
};

function toResult(value: string): FilterDraft["result"] {
  if (value === "success" || value === "failure") return value;
  return "";
}

type FieldErrors = Partial<Record<"from" | "to" | "action" | "result", string>>;

type Props = {
  draft: FilterDraft;
  onChange: (draft: FilterDraft) => void;
  onSubmit: () => void;
  /** 取得中は「絞り込む」を押せなくする */
  searching: boolean;
  /** 開始日が終了日より後のとき（検索しない） */
  rangeError: string | null;
  /** サーバーが 422 で返した入力欄ごとの誤り */
  fieldErrors: FieldErrors;
};

export function AuditLogFilters({
  draft,
  onChange,
  onSubmit,
  searching,
  rangeError,
  fieldErrors,
}: Props) {
  return (
    <form
      noValidate
      aria-label="絞り込み"
      className="mb-6"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="grid gap-x-4 md:grid-cols-2">
        <TextField
          label="開始日"
          type="date"
          value={draft.from}
          error={fieldErrors.from}
          onChange={(event) =>
            onChange({ ...draft, from: event.currentTarget.value })
          }
        />
        <TextField
          label="終了日"
          type="date"
          value={draft.to}
          error={rangeError ?? fieldErrors.to}
          onChange={(event) =>
            onChange({ ...draft, to: event.currentTarget.value })
          }
        />
        <SelectField
          label="操作の種類"
          value={draft.action}
          error={fieldErrors.action}
          onChange={(event) =>
            onChange({ ...draft, action: event.currentTarget.value })
          }
        >
          <option value="">すべて</option>
          {[...ACTION_LABELS].map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="結果"
          value={draft.result}
          error={fieldErrors.result}
          onChange={(event) =>
            onChange({ ...draft, result: toResult(event.currentTarget.value) })
          }
        >
          <option value="">すべて</option>
          <option value="success">成功</option>
          <option value="failure">失敗</option>
        </SelectField>
      </div>
      {rangeError !== null && (
        <Alert tone="error" role="alert">
          {rangeError}
        </Alert>
      )}
      {draft.actor !== null && (
        <p className="mb-2 flex items-center gap-2">
          <span>操作した人：{draft.actor.name}</span>
          <Button
            variant="ghost"
            onClick={() => onChange({ ...draft, actor: null })}
          >
            操作した人の絞り込みを外す
          </Button>
        </p>
      )}
      {draft.target !== null && (
        <p className="mb-2 flex items-center gap-2">
          <span>対象：{draft.target.name}</span>
          <Button
            variant="ghost"
            onClick={() => onChange({ ...draft, target: null })}
          >
            対象の絞り込みを外す
          </Button>
        </p>
      )}
      <Button type="submit" disabled={searching}>
        絞り込む
      </Button>
    </form>
  );
}
