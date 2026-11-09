import { z } from "zod";
import { SETUP_DEPARTMENT_NAME_MAX_LENGTH } from "./setup-rules";

/** 部署の説明の最大文字数（2-1 AC-12） */
export const DEPARTMENT_DESCRIPTION_MAX_LENGTH = 500;
/** お知らせ専用チャンネル名に付ける接尾辞（7-1 2026-11-08承認） */
export const ANNOUNCEMENT_SUFFIX = "のお知らせ";
/** お知らせ専用チャンネル名の最大文字数。部署名の上限＋接尾辞の長さ */
export const DEPARTMENT_ANNOUNCEMENT_NAME_MAX =
  SETUP_DEPARTMENT_NAME_MAX_LENGTH + ANNOUNCEMENT_SUFFIX.length;

function hasNoControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return false;
  }
  return true;
}

// 文字数は UTF-16 の単位で数える（S-10）。使える文字は制限せず、制御文字だけ拒否する
export const departmentNameSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => value.length <= SETUP_DEPARTMENT_NAME_MAX_LENGTH)
  .refine(hasNoControlCharacter);
export const departmentDescriptionSchema = z
  .string()
  .refine((value) => value.length <= DEPARTMENT_DESCRIPTION_MAX_LENGTH);

/** 部署名の重複判定に使う比較キー（前後の空白を除き、英字を小文字にする） */
export function departmentNameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** チャンネル名の重複判定に使う比較キー。部署名と同じ規則 */
export function channelNameKey(name: string): string {
  return name.trim().toLowerCase();
}

export function announcementChannelName(departmentName: string): string {
  return `${departmentName}${ANNOUNCEMENT_SUFFIX}`;
}
