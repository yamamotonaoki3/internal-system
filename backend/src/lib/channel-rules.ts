// チャンネルの閲覧・参加の判定と、全社連絡の固定値。画面にもDBにも依存しない純粋な定義。
// 全社連絡のルームIDは migration 0011（手作成）の固定値と一致させる（テストで突き合わせる）。
import type { ChannelPurpose } from "../../../shared/message-rules";
import type { Scope } from "./authorization";

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

export type ChannelInviteDecision =
  | "allowed"
  | "not_found"
  | "not_member"
  | "case_channel"
  | "department_inactive";

/**
 * 招待してよいか（#135）。先に当たった理由を返す。順：閲覧可否（not_found）→ 招待の権限（not_member）→ チャンネルの状態。
 * 再認証は Service が not_member と case_channel の間で判定する。
 */
export function canInviteToChannel(
  channel: ChannelState & {
    purpose: ChannelPurpose;
    departmentIsActive: boolean;
  },
  inviterIsMember: boolean,
): ChannelInviteDecision {
  if (!canViewChannel(channel, inviterIsMember)) return "not_found";
  if (!inviterIsMember) return "not_member";
  if (channel.purpose === "case") return "case_channel";
  if (!channel.departmentIsActive) return "department_inactive";
  return "allowed";
}

export type ChannelManageActions = {
  rename: boolean;
  editDescription: boolean;
  archive: boolean;
  restore: boolean;
};

/**
 * 種類と状態から「種類として」できる管理の操作（#143。権限は別に判定する）。
 * 名前の変更・アーカイブ・復元は通常のチャンネルだけ（D-2）。部署の専用・お知らせ専用・全社連絡は説明の変更だけ。
 * 案件専用は案件と連動するため、どれもできない。アーカイブ済みは復元だけ（通常のチャンネル以外がアーカイブ済みの行は異常なので何もさせない）
 */
export function channelManageActions(channel: {
  purpose: ChannelPurpose;
  deletedAt: string | null;
}): ChannelManageActions {
  const normal = channel.purpose === "normal";
  if (channel.deletedAt !== null)
    return {
      rename: false,
      editDescription: false,
      archive: false,
      restore: normal,
    };
  return {
    rename: normal,
    editDescription: channel.purpose !== "case",
    archive: normal,
    restore: false,
  };
}

/** 管理の権限の範囲（#143）：チャンネルの部署があれば部署の範囲、なければ（会社直属）会社の範囲 */
export function channelScopeOf(channel: {
  departmentId: string | null;
}): Scope {
  return channel.departmentId === null
    ? { type: "company" }
    : { type: "department", departmentId: channel.departmentId };
}
