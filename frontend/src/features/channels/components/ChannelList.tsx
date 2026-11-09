// S-09 の一覧。読み込み中・エラー・なし・ありの4つの状態を出し分ける。
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { describeError } from "../describe-error";
import { useChannels } from "../hooks/useChannels";
import { ChannelSummary } from "./ChannelSummary";

export function ChannelList({ departmentId }: { departmentId: string }) {
  const channels = useChannels({ departmentId });

  if (channels.isPending) return <p role="status">読み込み中です</p>;
  if (channels.isError)
    return (
      <Alert tone="error" role="alert">
        {describeError(channels.error)}
      </Alert>
    );

  const items = channels.data.pages.flatMap((page) => page.items);
  if (items.length === 0) return <p>参加できるチャンネルがありません</p>;

  return (
    <>
      <ul className="mb-4">
        {items.map((channel) => (
          <ChannelSummary key={channel.id} channel={channel} />
        ))}
      </ul>
      {channels.hasNextPage && (
        <Button
          variant="secondary"
          disabled={channels.isFetchingNextPage}
          onClick={() => void channels.fetchNextPage()}
        >
          次のページ
        </Button>
      )}
    </>
  );
}
