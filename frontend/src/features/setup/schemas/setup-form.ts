// S-34 の入力チェック。長さ・文字種はバックエンドの検査にそろえる（サーバー側でも検査する）。
import { z } from "zod";

// 本名は表示名にも使う（D-7）。表示名の入力欄は置かない
export const setupFormSchema = z.object({
  setupToken: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{43}$/, "トークンは43文字の英数字・「_」・「-」です"),
  companyName: z
    .string()
    .trim()
    .min(1, "会社名を入力してください")
    .max(100, "会社名は100文字以内で入力してください"),
  departmentName: z
    .string()
    .trim()
    .min(1, "部署名を入力してください")
    .max(50, "部署名は50文字以内で入力してください"),
  loginId: z
    .string()
    .trim()
    .regex(
      /^[A-Za-z0-9._-]{3,32}$/,
      "社員IDは半角英数字と「.」「_」「-」の3〜32文字で入力してください",
    ),
  legalName: z
    .string()
    .trim()
    .min(1, "本名を入力してください")
    .max(30, "本名は30文字以内で入力してください"),
  email: z
    .string()
    .trim()
    .min(1, "メールアドレスを入力してください")
    .max(254, "メールアドレスは254文字以内で入力してください")
    .pipe(z.email("メールアドレスの形式で入力してください")),
  extension: z
    .string()
    .trim()
    .regex(/^([0-9-]{1,10})?$/, "内線番号は半角数字とハイフンの10文字以内です"),
  jobTitle: z.string().trim().max(30, "役職は30文字以内で入力してください"),
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
