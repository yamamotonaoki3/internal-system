// アカウントの個別発行（#199）の入力規則の定義元。バックエンドの検証（routes/accounts.ts）と、
// 画面の入力チェック（features/accounts）が、ここを参照する。サーバー側の検証は省略しない。
// ユーザーID・メール・内線・役職は、初回セットアップ（setup-rules.ts）と同じ値なので、そちらを参照して二重に定義しない。
import { z } from "zod";
import {
  SETUP_EMAIL_MAX_LENGTH,
  SETUP_EXTENSION_MAX_LENGTH,
  SETUP_EXTENSION_PATTERN,
  SETUP_JOB_TITLE_MAX_LENGTH,
  SETUP_LOGIN_ID_PATTERN,
} from "./setup-rules";

// 本名は50文字まで（V-05）。初回セットアップの本名（SETUP_LEGAL_NAME_MAX_LENGTH：30文字）は、
// 表示名にも使う別の規則（D-7）なので、同じ値として扱わない。
export const ACCOUNT_LEGAL_NAME_MAX_LENGTH = 50;
export const ACCOUNT_DISPLAY_NAME_MAX_LENGTH = 30;
export const ACCOUNT_EMAIL_MAX_LENGTH = SETUP_EMAIL_MAX_LENGTH;
export const ACCOUNT_EXTENSION_MAX_LENGTH = SETUP_EXTENSION_MAX_LENGTH;
export const ACCOUNT_JOB_TITLE_MAX_LENGTH = SETUP_JOB_TITLE_MAX_LENGTH;
export const ACCOUNT_LOGIN_ID_PATTERN = SETUP_LOGIN_ID_PATTERN;
export const ACCOUNT_EXTENSION_PATTERN = SETUP_EXTENSION_PATTERN;

// 制御文字（改行・タブ・NUL・DEL など）を含まない。前後の空白を除く前の値で確かめる（末尾のタブを見逃さない）
export const noControlCharacters = (value: string) => !/\p{Cc}/u.test(value);

const text = (max: number) =>
  z.string().refine(noControlCharacters).trim().min(1).max(max);

export const accountLoginIdSchema = z.string().regex(ACCOUNT_LOGIN_ID_PATTERN);
export const accountLegalNameSchema = text(ACCOUNT_LEGAL_NAME_MAX_LENGTH);
export const accountDisplayNameSchema = text(ACCOUNT_DISPLAY_NAME_MAX_LENGTH);
export const accountEmailSchema = z
  .string()
  .max(ACCOUNT_EMAIL_MAX_LENGTH)
  .pipe(z.email());
export const accountExtensionSchema = z
  .string()
  .min(1)
  .max(ACCOUNT_EXTENSION_MAX_LENGTH)
  .regex(ACCOUNT_EXTENSION_PATTERN);
export const accountJobTitleSchema = text(ACCOUNT_JOB_TITLE_MAX_LENGTH);
