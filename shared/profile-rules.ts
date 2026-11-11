// プロフィール・ステータス（#130）の入力規則の定義元。バックエンドの検証・DB の CHECK 制約（backend/db/schema.ts）・
// 画面の入力チェック（features/profile）が、ここを参照する。サーバー側の検証は省略しない。
import { z } from "zod";
import { noControlCharacters } from "./account-rules";

// 在席・外出・欠席・休暇・会議中（6-1 AC-3）
export const USER_STATUS_KINDS = [
  "available",
  "away",
  "absent",
  "vacation",
  "meeting",
] as const;
export type UserStatusKind = (typeof USER_STATUS_KINDS)[number];

// 一言メッセージは100文字まで（0-4 AC-3）
export const STATUS_MESSAGE_MAX_LENGTH = 100;

export const userStatusKindSchema = z.enum(USER_STATUS_KINDS);

// 前後の空白を除いて数え、空は null（一言なし）にする。改行を含む制御文字は不可（P-17）
export const statusMessageSchema = z
  .string()
  .refine(noControlCharacters)
  .trim()
  .max(STATUS_MESSAGE_MAX_LENGTH)
  .transform((value) => (value === "" ? null : value));

// 戻り予定は ISO 8601（オフセット付き）。現在より後、かつ現在から1年以内かは、現在時刻が要るため Service が確かめる
export const returnAtSchema = z.iso.datetime({ offset: true });

/** 戻り予定に指定できる最も遅い時刻：現在の暦の1年後（UTC。2/29 は翌年3/1） */
export function latestReturnAt(now: Date): Date {
  const latest = new Date(now.getTime());
  latest.setUTCFullYear(latest.getUTCFullYear() + 1);
  return latest;
}
