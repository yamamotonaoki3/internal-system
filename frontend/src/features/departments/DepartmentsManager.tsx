// 部署の一覧・改名・オーナー変更の入口（S-24）。部署の削除・無効化の操作は置かない（2-1 AC-14）。
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { Alert } from "../../components/Alert";
import { Button } from "../../components/Button";
import { fetchDepartments, type Department } from "./department-api";
import { DepartmentRenameForm } from "./DepartmentRenameForm";
import { OwnerChangeDialog } from "./OwnerChangeDialog";
import { departmentKeys } from "./query-keys";
import { useDepartmentMutations } from "./useDepartmentMutations";

export function DepartmentsManager() {
  const [cursor, setCursor] = useState<string>();
  const [renaming, setRenaming] = useState<Department | null>(null);
  const [changingOwner, setChangingOwner] = useState<Department | null>(null);
  const { rename } = useDepartmentMutations();
  const departments = useQuery({
    queryKey: departmentKeys.list(cursor),
    queryFn: () => fetchDepartments(cursor),
    retry: false,
  });

  return (
    <section className="rounded-lg bg-surface p-4 md:p-6">
      <div className="mb-4">
        <Link
          to="/departments/new"
          className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 font-bold text-on-primary hover:bg-primary-hover md:min-h-10"
        >
          部署を作成
        </Link>
      </div>
      {renaming && (
        <section
          className="mb-6 rounded-md border border-border-strong p-4"
          aria-label="部署名の変更"
        >
          <h2 className="mb-3 text-lg font-bold">部署名の変更</h2>
          <DepartmentRenameForm
            key={renaming.id}
            department={renaming}
            onSave={async (name) => {
              await rename.mutateAsync({ department: renaming, name });
              setRenaming(null);
            }}
            onCancel={() => setRenaming(null)}
          />
        </section>
      )}
      {departments.isPending ? (
        <p role="status">読み込み中です</p>
      ) : departments.isError ? (
        <Alert tone="error" role="alert">
          部署を取得できませんでした。再試行してください。
        </Alert>
      ) : departments.data.items.length === 0 ? (
        <p>部署がありません</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr>
                <th scope="col" className="p-2">
                  部署名
                </th>
                <th scope="col" className="p-2">
                  オーナー
                </th>
                <th scope="col" className="p-2">
                  所属人数
                </th>
                <th scope="col" className="p-2">
                  状態
                </th>
                <th scope="col" className="p-2">
                  操作
                </th>
              </tr>
            </thead>
            <tbody>
              {departments.data.items.map((department) => (
                <tr
                  key={department.id}
                  className="border-t border-border-strong"
                >
                  <td className="p-2">{department.name}</td>
                  <td className="p-2">{department.ownerDisplayName}</td>
                  <td className="p-2">{department.memberCount}</td>
                  <td className="p-2">
                    {department.isActive ? "有効" : "無効"}
                  </td>
                  <td className="p-2">
                    {department.isActive && (
                      <>
                        <Button
                          variant="ghost"
                          onClick={() => setRenaming(department)}
                        >
                          名前を変更
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => setChangingOwner(department)}
                        >
                          オーナーを変更
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {departments.data?.nextCursor && (
        <Button
          variant="secondary"
          onClick={() => setCursor(departments.data.nextCursor ?? undefined)}
        >
          次のページ
        </Button>
      )}
      {changingOwner && (
        <OwnerChangeDialog
          key={changingOwner.id}
          department={changingOwner}
          onClose={() => setChangingOwner(null)}
        />
      )}
    </section>
  );
}
