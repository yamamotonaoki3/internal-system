// チャンネルの機能の公開部分。ほかの層（pages・app-shell）は、ここだけを通して使う。
export { channelKeys } from "./api/query-keys";
export {
  CHANNEL_ARCHIVED_STATE,
  ChannelDetailView,
} from "./components/ChannelDetailView";
export { ChannelList } from "./components/ChannelList";
export { DepartmentFilter } from "./components/DepartmentFilter";
export { JoinedChannelsSection } from "./components/JoinedChannelsSection";
// #143-b の S-39・S-38 が使う管理の部品
export { ChannelArchiveDialog } from "./components/ChannelArchiveDialog";
export { ChannelManageMenu } from "./components/ChannelManageMenu";
export { ChannelRestoreDialog } from "./components/ChannelRestoreDialog";
// #143-b：S-39（チャンネル管理）・S-38（アーカイブ）
export type {
  AdminChannel,
  AdminChannelFilter,
  AdminChannelState,
  ArchivedChannel,
} from "./api/channel-api";
export { AdminChannelTable } from "./components/AdminChannelTable";
export { ArchivedChannelTable } from "./components/ArchivedChannelTable";
export type { ChannelManageAction } from "./components/ChannelManageMenu";
export { describeError, isApiError } from "./describe-error";
export { useAdminChannels } from "./hooks/useAdminChannels";
export { useArchivedChannels } from "./hooks/useArchivedChannels";
