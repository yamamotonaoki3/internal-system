// S-19 の入力チェック。長さ・文字種は shared/account-rules.ts・shared/profile-rules.ts の定義にそろえる（サーバー側でも検査する）。
import { z } from "zod";
import {
  ACCOUNT_DISPLAY_NAME_MAX_LENGTH,
  noControlCharacters,
} from "../../../../../shared/account-rules";
import {
  STATUS_MESSAGE_MAX_LENGTH,
  userStatusKindSchema,
} from "../../../../../shared/profile-rules";

const NO_CONTROL_MESSAGE = "改行などの制御文字は使えません";

export const displayNameFormSchema = z.object({
  displayName: z
    .string()
    .refine(noControlCharacters, NO_CONTROL_MESSAGE)
    .trim()
    .min(1, "表示名を入力してください")
    .max(
      ACCOUNT_DISPLAY_NAME_MAX_LENGTH,
      `表示名は${ACCOUNT_DISPLAY_NAME_MAX_LENGTH}文字以内で入力してください`,
    ),
});

export const statusFormSchema = z
  .object({
    status: userStatusKindSchema,
    // datetime-local の値。空なら戻り予定なし
    returnAt: z.string(),
    statusMessage: z
      .string()
      .refine(noControlCharacters, NO_CONTROL_MESSAGE)
      .trim()
      .max(
        STATUS_MESSAGE_MAX_LENGTH,
        `一言メッセージは${STATUS_MESSAGE_MAX_LENGTH}文字以内で入力してください`,
      ),
  })
  .refine((form) => form.status !== "available" || form.returnAt === "", {
    path: ["returnAt"],
    message: "在席のときは戻り予定を指定できません",
  });

export type DisplayNameFormInput = z.input<typeof displayNameFormSchema>;
export type DisplayNameFormValues = z.output<typeof displayNameFormSchema>;
export type StatusFormInput = z.input<typeof statusFormSchema>;
export type StatusFormValues = z.output<typeof statusFormSchema>;

export const displayNameFieldNames = ["displayName"] as const;
export const statusFieldNames = [
  "status",
  "returnAt",
  "statusMessage",
] as const;
