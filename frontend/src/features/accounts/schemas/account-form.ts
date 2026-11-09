// S-23 の入力チェック。長さ・文字種は shared/account-rules.ts の定義にそろえる（サーバー側でも検査する）。
import { z } from "zod";
import {
  ACCOUNT_DISPLAY_NAME_MAX_LENGTH,
  ACCOUNT_EMAIL_MAX_LENGTH,
  ACCOUNT_EXTENSION_MAX_LENGTH,
  ACCOUNT_EXTENSION_PATTERN,
  ACCOUNT_JOB_TITLE_MAX_LENGTH,
  ACCOUNT_LEGAL_NAME_MAX_LENGTH,
  ACCOUNT_LOGIN_ID_PATTERN,
  noControlCharacters,
} from "../../../../../shared/account-rules";
import {
  SETUP_LOGIN_ID_MAX_LENGTH,
  SETUP_LOGIN_ID_MIN_LENGTH,
} from "../../../../../shared/setup-rules";

const NO_CONTROL_MESSAGE = "改行などの制御文字は使えません";

const text = (label: string, max: number) =>
  z
    .string()
    .refine(noControlCharacters, NO_CONTROL_MESSAGE)
    .trim()
    .min(1, `${label}を入力してください`)
    .max(max, `${label}は${max}文字以内で入力してください`);

export const accountFormSchema = z.object({
  loginId: z
    .string()
    .trim()
    .regex(
      ACCOUNT_LOGIN_ID_PATTERN,
      `社員IDは半角英数字と「.」「_」「-」の${SETUP_LOGIN_ID_MIN_LENGTH}〜${SETUP_LOGIN_ID_MAX_LENGTH}文字で入力してください`,
    ),
  legalName: text("本名", ACCOUNT_LEGAL_NAME_MAX_LENGTH),
  displayName: text("表示名", ACCOUNT_DISPLAY_NAME_MAX_LENGTH),
  email: z
    .string()
    .trim()
    .min(1, "メールアドレスを入力してください")
    .max(
      ACCOUNT_EMAIL_MAX_LENGTH,
      `メールアドレスは${ACCOUNT_EMAIL_MAX_LENGTH}文字以内で入力してください`,
    )
    .pipe(z.email("メールアドレスの形式で入力してください")),
  departmentId: z.string().min(1, "所属部署を選んでください"),
  extension: z
    .string()
    .trim()
    .regex(
      ACCOUNT_EXTENSION_PATTERN,
      `内線番号は半角数字とハイフンの${ACCOUNT_EXTENSION_MAX_LENGTH}文字以内です`,
    ),
  jobTitle: z
    .string()
    .refine(noControlCharacters, NO_CONTROL_MESSAGE)
    .trim()
    .max(
      ACCOUNT_JOB_TITLE_MAX_LENGTH,
      `役職は${ACCOUNT_JOB_TITLE_MAX_LENGTH}文字以内で入力してください`,
    ),
  // チェックの初期値は false。true のときだけ通す
  emailConfirmed: z.boolean().pipe(
    z.literal(true, {
      error: "メールアドレスが会社発行のものか、確認してください",
    }),
  ),
});

export type AccountFormInput = z.input<typeof accountFormSchema>;
export type AccountFormValues = z.output<typeof accountFormSchema>;
export type AccountFieldName = keyof AccountFormInput;

export const accountFieldNames = Object.keys(
  accountFormSchema.shape,
) as AccountFieldName[];

/** 本名を入力したときの表示名の初期値。本名が表示名の上限を超えるときは空にする（0-4 AC-11。初期表示名は本名と同じ値） */
export function initialDisplayName(legalName: string): string {
  const trimmed = legalName.trim();
  return trimmed.length <= ACCOUNT_DISPLAY_NAME_MAX_LENGTH ? trimmed : "";
}
