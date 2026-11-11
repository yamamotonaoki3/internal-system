// S-20 社員一覧（部署での絞り込み・プロフィールカード・ステータスの代理設定）。
import { useState } from "react";
import { DepartmentFilter, MembersList } from "../features/members";

export function MembersPage() {
  const [departmentId, setDepartmentId] = useState("");
  return (
    <section className="mx-auto max-w-5xl rounded-lg bg-surface p-4 md:p-6">
      <h1 className="mb-4 text-2xl font-bold">社員一覧</h1>
      <DepartmentFilter value={departmentId} onChange={setDepartmentId} />
      <MembersList departmentId={departmentId} />
    </section>
  );
}
