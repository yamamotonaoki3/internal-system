// チャンネルの詳細（S-05 の入口。メッセージは #201 で足す）。
import { useParams } from "react-router";
import { ChannelDetailView } from "../features/channels";
import { NotFoundPage } from "./NotFoundPage";

export function ChannelDetailPage() {
  const { channelId } = useParams();
  if (channelId === undefined) return <NotFoundPage />;
  return <ChannelDetailView channelId={channelId} />;
}
