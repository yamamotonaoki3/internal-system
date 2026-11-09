// 部署での絞り込み。選択肢は、絞り込まない一覧（読み込んだ分）にある部署から作る。
import { SelectField } from "../../../components/SelectField";
import { useChannels } from "../hooks/useChannels";

type DepartmentFilterProps = {
  value: string;
  onChange: (departmentId: string) => void;
};

export function DepartmentFilter({ value, onChange }: DepartmentFilterProps) {
  const all = useChannels({ departmentId: "" });
  const departments = new Map<string, string>();
  for (const page of all.data?.pages ?? [])
    for (const channel of page.items)
      if (channel.departmentId !== null && channel.departmentName !== null)
        departments.set(channel.departmentId, channel.departmentName);
  return (
    <SelectField
      label="部署"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">すべて</option>
      {[...departments].map(([id, name]) => (
        <option key={id} value={id}>
          {name}
        </option>
      ))}
    </SelectField>
  );
}
