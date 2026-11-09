// S-09 チャンネルを探す（一覧・部署での絞り込み・参加）。
import { useState } from "react";
import { ChannelList, DepartmentFilter } from "../features/channels";

export function ChannelsPage() {
  const [departmentId, setDepartmentId] = useState("");
  return (
    <section className="mx-auto max-w-3xl rounded-lg bg-surface p-4 md:p-6">
      <h1 className="mb-4 text-2xl font-bold">チャンネルを探す</h1>
      <DepartmentFilter value={departmentId} onChange={setDepartmentId} />
      <ChannelList departmentId={departmentId} />
    </section>
  );
}
