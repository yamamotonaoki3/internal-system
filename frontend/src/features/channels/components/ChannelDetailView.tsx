// チャンネルの詳細（S-05）。名前・説明・公開範囲・メッセージ・参加者を出す。
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { useSession } from "../../auth";
import { StartDmButton } from "../../dms";
import { RoomMessages } from "../../messages";
import { useMarkRoomRead } from "../../unread";
import { describeError, isApiError } from "../describe-error";
import { useChannelDetail } from "../hooks/useChannelDetail";
import { useJoinChannel } from "../hooks/useJoinChannel";

export function ChannelDetailView({ channelId }: { channelId: string }) {
  const channel = useChannelDetail(channelId);
  const join = useJoinChannel();
  const session = useSession();
  const selfId = session.data?.user.id;
  const read = useMarkRoomRead(channelId);

  if (channel.isPending) return <p role="status">読み込み中です</p>;
  if (channel.isError) {
    // 非公開で未参加・アーカイブ済み・存在しないものは、区別せず 404 になる
    if (isApiError(channel.error) && channel.error.status === 404)
      return <p>チャンネルが見つかりません</p>;
    return (
      <Alert tone="error" role="alert">
        {describeError(channel.error)}
      </Alert>
    );
  }

  const data = channel.data;
  return (
    <section className="mx-auto max-w-3xl rounded-lg bg-surface p-4 md:p-6">
      <h1 className="mb-2 text-2xl font-bold">{data.name}</h1>
      <p className="mb-4 text-sm text-text-muted">
        {data.visibility === "private"
          ? "非公開のチャンネル"
          : "公開チャンネル"}
      </p>
      {data.description !== "" && <p className="mb-4">{data.description}</p>}
      {!data.joined && (
        <div className="mb-4">
          <Button
            disabled={join.isPending}
            onClick={() => join.mutate(data.id)}
          >
            参加する
          </Button>
          {join.isError && (
            <div className="mt-2">
              <Alert tone="error" role="alert">
                {describeError(join.error)}
              </Alert>
            </div>
          )}
        </div>
      )}
      <RoomMessages
        roomId={data.roomId}
        canPost={data.canPost}
        joined={data.joined}
        // 参加中のときだけ既読にする（公開チャンネルを未参加で読んでいるだけでは、未読の対象ではない）
        onLatestMessageIdChange={data.joined ? read.markRead : undefined}
      />
      {read.error !== null && (
        <Alert tone="error" role="alert">
          既読の状態を更新できませんでした。{describeError(read.error)}
        </Alert>
      )}
      {data.joined && (
        <div>
          <h2 className="mb-2 font-bold">参加者（{data.memberCount}人）</h2>
          <ul>
            {data.members?.map((member) => (
              <li key={member.id}>
                {member.displayName}
                {selfId !== undefined && member.id !== selfId && (
                  <StartDmButton
                    partnerUserId={member.id}
                    partnerDisplayName={member.displayName}
                  />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
