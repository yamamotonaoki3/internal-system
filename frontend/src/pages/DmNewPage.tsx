// DM の相手の選択（/dms/new）。
import { DmPartnerPicker } from "../features/dms";

export function DmNewPage() {
  return (
    <section className="mx-auto max-w-3xl rounded-lg bg-surface p-4 md:p-6">
      <h1 className="mb-4 text-2xl font-bold">新しいDM</h1>
      <DmPartnerPicker />
    </section>
  );
}
