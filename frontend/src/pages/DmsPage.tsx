// DM の一覧（/dms）。
import { DmList } from "../features/dms";

export function DmsPage() {
  return (
    <section className="mx-auto max-w-3xl rounded-lg bg-surface p-4 md:p-6">
      <h1 className="mb-4 text-2xl font-bold">ダイレクトメッセージ</h1>
      <DmList />
    </section>
  );
}
