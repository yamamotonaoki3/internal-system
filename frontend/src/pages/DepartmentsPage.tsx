import { DepartmentsManager } from "../features/departments/DepartmentsManager";

export function DepartmentsPage() {
  return (
    <section className="mx-auto max-w-5xl">
      <h1 className="mb-4 text-2xl font-bold">部署管理</h1>
      <DepartmentsManager />
    </section>
  );
}
