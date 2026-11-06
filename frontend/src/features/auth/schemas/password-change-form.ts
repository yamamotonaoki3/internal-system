import { z } from "zod";

export type PasswordIdentity = { loginId: string; displayName: string };

// バックエンドの固定一覧と同じ値を使う。判定は正規化後の完全一致だけ。
const DENIED_PASSWORDS = new Set([
  "password",
  "password1",
  "password123",
  "password123!",
  "password1!",
  "passw0rd",
  "passw0rd!",
  "p@ssw0rd",
  "p@ssword1",
  "qwerty123",
  "qwerty123!",
  "qwertyuiop",
  "admin123",
  "admin123!",
  "administrator",
  "welcome123",
  "welcome123!",
  "letmein123",
  "letmein123!",
  "changeme123!",
  "abc12345",
  "abc12345!",
  "abcd1234",
  "abcd1234!",
  "12345678",
  "123456789",
  "1234567890",
  "123456789!",
  "11111111",
  "00000000",
  "iloveyou",
  "sunshine1",
  "monkey123",
  "dragon123",
  "football1",
  "baseball1",
  "company123!",
  "temp1234!",
  "test1234!",
  "default123!",
]);

function normalized(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

export function createPasswordChangeSchema(identity: PasswordIdentity) {
  const loginId = normalized(identity.loginId);
  const displayName = normalized(identity.displayName);
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
      if (
        password.length < 8 ||
        password.length > 128 ||
        !/[A-Z]/.test(password) ||
        !/[0-9]/.test(password) ||
        !/[!-/:-@\[-`{-~]/.test(password) ||
        /[\u0000-\u001f\u007f-\u009f]/u.test(password)
      ) {
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
      const candidate = normalized(password);
      if (
        DENIED_PASSWORDS.has(candidate) ||
        (loginId.length >= 4 && candidate.includes(loginId)) ||
        (displayName.length >= 4 && candidate.includes(displayName))
      ) {
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
