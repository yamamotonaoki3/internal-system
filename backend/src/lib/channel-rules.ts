// チャンネルの閲覧・参加の判定と、全社連絡の固定値。画面にもDBにも依存しない純粋な定義。
// 全社連絡のルームIDは migration 0011（手作成）の固定値と一致させる（テストで突き合わせる）。

/** 全社連絡の名前（0011 の値と同じ） */
export const COMPANY_GENERAL_CHANNEL_NAME = "全社連絡";

/** 全社連絡のルームID（ULID の形式を保つ固定値。0011 と同じ） */
export const COMPANY_GENERAL_ROOM_ID = "0CMPNYGNRA0000000000000000";

/** EP-2-06 が参加者に返す、参加者の先頭の件数 */
export const MEMBERS_PREVIEW_LIMIT = 20;

export type ChannelVisibility = "public" | "private";

type ChannelState = { visibility: ChannelVisibility; deletedAt: string | null };

/** 見てよい：アーカイブされていない、公開または参加中の非公開 */
export function canViewChannel(
  channel: ChannelState,
  isMember: boolean,
): boolean {
  if (channel.deletedAt !== null) return false;
  return channel.visibility === "public" || isMember;
}

/** 自分で参加してよい：アーカイブされていない公開チャンネル */
export function canJoinChannel(channel: ChannelState): boolean {
  return channel.deletedAt === null && channel.visibility === "public";
}
