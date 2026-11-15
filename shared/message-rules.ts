import { z } from "zod";
import { ULID_PATTERN } from "./ulid-rules";

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

/** 指名範囲は本文のUTF-16半開区間。通常の@文字列は指名にしない。 */
export const mentionSchema = z
  .object({
    userId: z.string().regex(ULID_PATTERN),
    start: z.number().int().min(0),
    end: z.number().int().min(1),
  })
  .strict();

export type Mention = z.infer<typeof mentionSchema>;

export const messageContentSchema = z
  .object({
    body: messageBodySchema,
    mentions: z.array(mentionSchema).optional(),
  })
  .strict()
  .superRefine(({ body, mentions = [] }, ctx) => {
    let previousEnd = 0;
    for (const [index, mention] of mentions.entries()) {
      const { start, end } = mention;
      const left = body.charCodeAt(start - 1);
      const first = body.charCodeAt(start);
      const last = body.charCodeAt(end - 1);
      const right = body.charCodeAt(end);
      const cutsSurrogate =
        (left >= 0xd800 &&
          left <= 0xdbff &&
          first >= 0xdc00 &&
          first <= 0xdfff) ||
        (last >= 0xd800 &&
          last <= 0xdbff &&
          right >= 0xdc00 &&
          right <= 0xdfff);
      if (
        start < previousEnd ||
        end <= start ||
        end > body.length ||
        body[start] !== "@" ||
        cutsSurrogate
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["mentions", index],
          message: "指名の範囲が不正です",
        });
      }
      previousEnd = end;
    }
  });

export type MessageContent = z.infer<typeof messageContentSchema>;

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

/**
 * スレッドに返信できない理由（#137。EP-1-07 の replyBlockedReason）。サーバーの応答と画面の案内が同じ値を参照する定義元。
 * 複数に当たるときの優先順は、この並び（削除された親 → 未参加 → 部署が無効 → DM の相手が無効）。
 */
export const REPLY_BLOCKED_REASONS = {
  deletedParent: "deleted_parent",
  notJoined: "not_joined",
  readOnly: "read_only",
  partnerInactive: "partner_inactive",
} as const;

export type ReplyBlockedReason =
  (typeof REPLY_BLOCKED_REASONS)[keyof typeof REPLY_BLOCKED_REASONS];
