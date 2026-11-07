// S-34 の入力チェック。長さ・文字種はバックエンドの検査にそろえる（サーバー側でも検査する）。
import { z } from "zod";
import {
  BASE64URL_32_BYTE_LENGTH,
  BASE64URL_32_BYTE_PATTERN,
  SETUP_COMPANY_NAME_MAX_LENGTH,
  SETUP_DEPARTMENT_NAME_MAX_LENGTH,
  SETUP_EMAIL_MAX_LENGTH,
  SETUP_EXTENSION_MAX_LENGTH,
  SETUP_EXTENSION_PATTERN,
  SETUP_JOB_TITLE_MAX_LENGTH,
  SETUP_LEGAL_NAME_MAX_LENGTH,
  SETUP_LOGIN_ID_MAX_LENGTH,
  SETUP_LOGIN_ID_MIN_LENGTH,
  SETUP_LOGIN_ID_PATTERN,
} from "../../../../../shared/setup-rules";

// 本名は表示名にも使う（D-7）。表示名の入力欄は置かない
export const setupFormSchema = z.object({
  setupToken: z
    .string()
    .trim()
    .regex(
      BASE64URL_32_BYTE_PATTERN,
      `トークンは${BASE64URL_32_BYTE_LENGTH}文字の英数字・「_」・「-」です`,
    ),
  companyName: z
    .string()
    .trim()
    .min(1, "会社名を入力してください")
    .max(
      SETUP_COMPANY_NAME_MAX_LENGTH,
      `会社名は${SETUP_COMPANY_NAME_MAX_LENGTH}文字以内で入力してください`,
    ),
  departmentName: z
    .string()
    .trim()
    .min(1, "部署名を入力してください")
    .max(
      SETUP_DEPARTMENT_NAME_MAX_LENGTH,
      `部署名は${SETUP_DEPARTMENT_NAME_MAX_LENGTH}文字以内で入力してください`,
    ),
  loginId: z
    .string()
    .trim()
    .regex(
      SETUP_LOGIN_ID_PATTERN,
      `社員IDは半角英数字と「.」「_」「-」の${SETUP_LOGIN_ID_MIN_LENGTH}〜${SETUP_LOGIN_ID_MAX_LENGTH}文字で入力してください`,
    ),
  legalName: z
    .string()
    .trim()
    .min(1, "本名を入力してください")
    .max(
      SETUP_LEGAL_NAME_MAX_LENGTH,
      `本名は${SETUP_LEGAL_NAME_MAX_LENGTH}文字以内で入力してください`,
    ),
  email: z
    .string()
    .trim()
    .min(1, "メールアドレスを入力してください")
    .max(
      SETUP_EMAIL_MAX_LENGTH,
      `メールアドレスは${SETUP_EMAIL_MAX_LENGTH}文字以内で入力してください`,
    )
    .pipe(z.email("メールアドレスの形式で入力してください")),
  extension: z
    .string()
    .trim()
    .regex(
      SETUP_EXTENSION_PATTERN,
      `内線番号は半角数字とハイフンの${SETUP_EXTENSION_MAX_LENGTH}文字以内です`,
    ),
  jobTitle: z
    .string()
    .trim()
    .max(
      SETUP_JOB_TITLE_MAX_LENGTH,
      `役職は${SETUP_JOB_TITLE_MAX_LENGTH}文字以内で入力してください`,
    ),
  // チェックの初期値は false。true のときだけ通す
  emailConfirmed: z.boolean().pipe(
    z.literal(true, {
      error: "メールアドレスが会社発行の自分のものか、確認してください",
    }),
  ),
});

export type SetupFormInput = z.input<typeof setupFormSchema>;
export type SetupFormValues = z.output<typeof setupFormSchema>;

export type SetupFieldName = keyof SetupFormInput;

export const setupFieldNames = Object.keys(
  setupFormSchema.shape,
) as SetupFieldName[];
