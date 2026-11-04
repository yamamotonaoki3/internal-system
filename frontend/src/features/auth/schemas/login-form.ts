// S-02 の入力チェック。形式の細かい検査はサーバーに任せ、ここでは空でないことだけ確かめる
// （形式の違いを画面で示すと、存在する社員IDの手がかりになる）。
import { z } from "zod";

export const loginFormSchema = z.object({
  loginId: z.string().trim().min(1, "ユーザーIDを入力してください"),
  password: z.string().min(1, "パスワードを入力してください"),
});

export type LoginFormValues = z.output<typeof loginFormSchema>;
export type LoginFieldName = keyof LoginFormValues;

export const loginFieldNames = Object.keys(
  loginFormSchema.shape,
) as LoginFieldName[];
