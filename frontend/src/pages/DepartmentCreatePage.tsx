import { DepartmentCreateForm } from "../features/departments/DepartmentCreateForm";

export function DepartmentCreatePage() {
  return (
    <section className="mx-auto max-w-xl rounded-lg bg-surface p-4 md:p-6">
      <h1 className="mb-4 text-2xl font-bold">部署作成</h1>
      <DepartmentCreateForm />
    </section>
  );
}
