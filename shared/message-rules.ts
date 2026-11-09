import { z } from "zod";

/** 本文の最大文字数（1-1 AC-5）。UTF-16 の単位で数える（他の入力と同じ） */
export const MESSAGE_BODY_MAX_LENGTH = 4000;

// 空白・改行だけの本文は空として拒否する。保存は送られたまま（前後の空白は削らない）
export const messageBodySchema = z
  .string()
  .refine((value) => value.trim().length > 0, "メッセージを入力してください")
  .refine(
    (value) => value.length <= MESSAGE_BODY_MAX_LENGTH,
    `メッセージは${MESSAGE_BODY_MAX_LENGTH}文字以内で入力してください`,
  );

export type ChannelPurpose =
  "normal" | "department" | "announcement" | "company_general" | "case";

/**
 * チャンネルに投稿できるか。参加者であることが前提で、権限で制限するのはお知らせ専用（announcement）だけ（2-3 AC-4）。
 * 全社連絡（company_general）は、参加者なら誰でも投稿できる。
 */
export function canPostToChannel(input: {
  purpose: ChannelPurpose;
  isMember: boolean;
  canPostAnnouncement: boolean;
}): boolean {
  if (!input.isMember) return false;
  return input.purpose !== "announcement" || input.canPostAnnouncement;
}
