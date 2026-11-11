// ステータス（5種類）を選ぶラジオ。S-19 と代理設定のダイアログが使う。値は呼び出し側が持つ。
import { useId } from "react";
import {
  USER_STATUS_KINDS,
  type UserStatusKind,
} from "../../../../shared/profile-rules";
import { STATUS_LABELS } from "./status-labels";

type StatusKindRadiosProps = {
  value: UserStatusKind;
  onChange: (kind: UserStatusKind) => void;
  disabled?: boolean;
};

export function StatusKindRadios({
  value,
  onChange,
  disabled,
}: StatusKindRadiosProps) {
  const labelId = useId();
  const name = useId();
  return (
    <div role="radiogroup" aria-labelledby={labelId} className="mb-4">
      <p id={labelId} className="mb-1 text-sm font-bold">
        ステータス
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {USER_STATUS_KINDS.map((kind) => (
          <label
            key={kind}
            className="flex min-h-11 items-center gap-2 md:min-h-10"
          >
            <input
              type="radio"
              name={name}
              value={kind}
              checked={value === kind}
              disabled={disabled}
              onChange={() => onChange(kind)}
              className="size-5"
            />
            {STATUS_LABELS[kind]}
          </label>
        ))}
      </div>
    </div>
  );
}
