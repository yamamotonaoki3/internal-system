import { z } from "zod";
import {
  isDeniedPassword,
  isPasswordCompositionAllowed,
  type PasswordIdentity,
} from "../../../../../shared/password-rules";

export type { PasswordIdentity } from "../../../../../shared/password-rules";

export function createPasswordChangeSchema(identity: PasswordIdentity) {
  return z
    .object({
      currentPassword: z
        .string()
        .min(1, "現在のパスワードを入力してください")
        .max(1024),
      newPassword: z.string(),
      confirmation: z.string().min(1, "確認用のパスワードを入力してください"),
    })
    .superRefine((values, context) => {
      const password = values.newPassword;
      if (!isPasswordCompositionAllowed(password)) {
        context.addIssue({
          code: "custom",
          path: ["newPassword"],
          message: "パスワードの条件を確認してください",
        });
      }
      if (password !== values.confirmation) {
        context.addIssue({
          code: "custom",
          path: ["confirmation"],
          message: "新しいパスワードが一致しません",
        });
      }
      if (password === values.currentPassword) {
        context.addIssue({
          code: "custom",
          path: ["newPassword"],
          message: "現在とは異なるパスワードを入力してください",
        });
      }
      if (isDeniedPassword(password, identity)) {
        context.addIssue({
          code: "custom",
          path: ["newPassword"],
          message: "このパスワードは使えません",
        });
      }
    });
}

export type PasswordChangeFormValues = z.infer<
  ReturnType<typeof createPasswordChangeSchema>
>;
