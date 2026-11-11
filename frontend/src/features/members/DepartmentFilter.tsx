// 部署での絞り込み。候補は GET /api/users/departments（有効な部署）から作る。
import { useQuery } from "@tanstack/react-query";
import { SelectField } from "../../components/SelectField";
import { fetchDepartments } from "./api/member-api";
import { memberKeys } from "./query-keys";

type DepartmentFilterProps = {
  value: string;
  onChange: (departmentId: string) => void;
};

export function DepartmentFilter({ value, onChange }: DepartmentFilterProps) {
  const departments = useQuery({
    queryKey: memberKeys.departments,
    queryFn: fetchDepartments,
    retry: false,
  });
  return (
    <SelectField
      label="部署"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      error={
        departments.isError ? "部署の候補を取得できませんでした" : undefined
      }
    >
      <option value="">すべての部署</option>
      {(departments.data ?? []).map((department) => (
        <option key={department.id} value={department.id}>
          {department.name}
        </option>
      ))}
    </SelectField>
  );
}
