// 一覧の1行：チャンネル名（詳細へのリンク）、部署、非公開の印、参加済みの表示、参加ボタン。
import { Link } from "react-router";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import type { ChannelItem } from "../api/channel-api";
import { describeError } from "../describe-error";
import { useJoinChannel } from "../hooks/useJoinChannel";

export function ChannelSummary({ channel }: { channel: ChannelItem }) {
  const join = useJoinChannel();
  // 参加に成功したら、一覧の取り直しを待たずに参加済みとして見せる
  const joined = channel.joined || join.isSuccess;
  return (
    <li className="border-t border-border-strong p-3">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          to={`/channels/${channel.id}`}
          className="font-bold text-primary underline"
        >
          {channel.name}
        </Link>
        {channel.visibility === "private" && (
          <span role="img" aria-label="非公開" title="非公開">
            🔒
          </span>
        )}
        {channel.departmentName !== null && (
          <span className="text-sm text-text-muted">
            {channel.departmentName}
          </span>
        )}
        {joined ? (
          <span className="ml-auto text-sm">参加済み</span>
        ) : (
          <span className="ml-auto">
            <Button
              variant="secondary"
              disabled={join.isPending}
              aria-label={`${channel.name}に参加する`}
              onClick={() => join.mutate(channel.id)}
            >
              参加する
            </Button>
          </span>
        )}
      </div>
      {join.isError && (
        <div className="mt-2">
          <Alert tone="error" role="alert">
            {describeError(join.error)}
          </Alert>
        </div>
      )}
    </li>
  );
}
