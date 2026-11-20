// 担当部署（複数）のチェックの欄。申請の画面（S-18）と、案件の内容の編集（S-17。#150 の 150-C）が使う。
import type { Choice } from "../api/case-request-api";

export function DepartmentCheckboxes({
  departments,
  value,
  error,
  onChange,
}: {
  /** 読み込み中は undefined */
  departments: Choice[] | undefined;
  value: string[];
  error: string | undefined;
  onChange: (next: string[]) => void;
}) {
  return (
    <fieldset className="mb-4" aria-invalid={error ? true : undefined}>
      <legend className="mb-1 text-sm font-bold">担当部署</legend>
      {departments === undefined && <p>部署の候補を準備しています</p>}
      {departments?.map((department) => (
        <label key={department.id} className="mr-4 inline-flex gap-1">
          <input
            type="checkbox"
            checked={value.includes(department.id)}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...value, department.id]
                  : value.filter((id) => id !== department.id),
              )
            }
          />
          {department.name}
        </label>
      ))}
      {error && <p className="mt-1 text-sm text-danger">{error}</p>}
    </fieldset>
  );
}
