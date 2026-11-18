// チャンネルの詳細（S-05）。名前・説明・公開範囲・メッセージ・参加者を出す。参加中で読み取り専用でなければ、招待（S-12）を開ける。
// 管理できる人には、ヘッダーの「⋯」から名前・説明の編集とアーカイブを出す（#143）。アーカイブしたら、チャンネルの一覧へ移る。
// 案件専用チャンネル（#148）は、案件の画面（S-17）へ置き換えて移る（?thread= は引き継ぐ）。通知・スレッドの一覧・未読のリンクなど、
// /channels/<部屋> を作るどの入口からでも案件の画面で開くため。案件の ID は応答の値で受け取り、features/cases を参照しない。
import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";
import { Alert } from "../../../components/Alert";
import { Button } from "../../../components/Button";
import { useSession } from "../../auth";
import { StartDmButton } from "../../dms";
import { RoomMessages } from "../../messages";
import { ThreadLayout, useThreadParam } from "../../threads";
import { useMarkRoomRead } from "../../unread";
import type { ChannelDetail } from "../api/channel-api";
import { describeError, isApiError } from "../describe-error";
import { useChannelDetail } from "../hooks/useChannelDetail";
import { useJoinChannel } from "../hooks/useJoinChannel";
import { ChannelInviteDialog } from "./ChannelInviteDialog";
import { ChannelManageMenu } from "./ChannelManageMenu";

/** アーカイブの後に移る一覧へ渡す、完了の表示の印（pages/ChannelsPage.tsx が読む） */
export const CHANNEL_ARCHIVED_STATE = { channelArchived: true } as const;

export function ChannelDetailView({ channelId }: { channelId: string }) {
  const channel = useChannelDetail(channelId);
  const join = useJoinChannel();
  const session = useSession();
  const selfId = session.data?.user.id;
  const read = useMarkRoomRead(channelId);
  const thread = useThreadParam();
  const navigate = useNavigate();
  const location = useLocation();

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
  if (data.caseId !== null)
    return <Navigate replace to={`/cases/${data.caseId}${location.search}`} />;
  return (
    <ThreadLayout roomId={data.roomId}>
      <section className="mx-auto w-full min-w-0 max-w-3xl flex-1 rounded-lg bg-surface p-4 md:p-6">
        <div className="mb-2 flex items-start justify-between gap-2">
          <h1 className="text-2xl font-bold">{data.name}</h1>
          <ChannelManageMenu
            channel={data}
            onArchived={() =>
              void navigate("/channels", { state: CHANNEL_ARCHIVED_STATE })
            }
          />
        </div>
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
          // 自分の投稿の編集・削除は、投稿の権限（お知らせ専用など）とは別。参加中で、読み取り専用でなければ出す
          canModifyOwn={data.joined && !data.readOnly}
          // 参加中のときだけ既読にする（公開チャンネルを未参加で読んでいるだけでは、未読の対象ではない）
          onLatestMessageIdChange={data.joined ? read.markRead : undefined}
          onOpenThread={thread.open}
        />
        {read.error !== null && (
          <Alert tone="error" role="alert">
            既読の状態を更新できませんでした。{describeError(read.error)}
          </Alert>
        )}
        {data.joined && <ChannelMembers channel={data} selfId={selfId} />}
      </section>
    </ThreadLayout>
  );
}

/** 参加者の一覧と、招待（S-12）の入口。参加中のときだけ出す */
function ChannelMembers({
  channel,
  selfId,
}: {
  channel: ChannelDetail;
  selfId: string | undefined;
}) {
  const [inviting, setInviting] = useState(false);
  return (
    <div>
      <h2 className="mb-2 font-bold">参加者（{channel.memberCount}人）</h2>
      <ul>
        {channel.members?.map((member) => (
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
      {/* 表示の制御だけ。招待してよいかはサーバーが判定する */}
      {!channel.readOnly && (
        <Button variant="secondary" onClick={() => setInviting(true)}>
          招待
        </Button>
      )}
      {inviting && (
        <ChannelInviteDialog
          channelId={channel.id}
          channelName={channel.name}
          onClose={() => setInviting(false)}
        />
      )}
    </div>
  );
}
