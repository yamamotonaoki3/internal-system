// S-09 チャンネルを探す（一覧・部署での絞り込み・参加）。チャンネルをアーカイブして移ってきたときは、完了を表示する（#143）。
import { useState } from "react";
import { Link, useLocation } from "react-router";
import { Alert } from "../components/Alert";
import {
  CHANNEL_ARCHIVED_STATE,
  ChannelList,
  DepartmentFilter,
} from "../features/channels";

function cameFromArchive(state: unknown): boolean {
  return (
    typeof state === "object" &&
    state !== null &&
    "channelArchived" in state &&
    state.channelArchived === CHANNEL_ARCHIVED_STATE.channelArchived
  );
}

export function ChannelsPage() {
  const [departmentId, setDepartmentId] = useState("");
  const archived = cameFromArchive(useLocation().state);
  return (
    <section className="mx-auto max-w-3xl rounded-lg bg-surface p-4 md:p-6">
      <h1 className="mb-4 text-2xl font-bold">チャンネルを探す</h1>
      {archived && (
        <Alert tone="info" role="status">
          アーカイブしました
        </Alert>
      )}
      <p className="mb-4">
        <Link
          to="/channel-requests"
          className="font-bold text-primary underline"
        >
          チャンネルを申請
        </Link>
      </p>
      <DepartmentFilter value={departmentId} onChange={setDepartmentId} />
      <ChannelList departmentId={departmentId} />
    </section>
  );
}
