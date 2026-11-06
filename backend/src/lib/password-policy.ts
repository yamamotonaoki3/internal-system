import { isDeniedPassword, type PasswordIdentity } from "./password-denylist";

/** 新しいパスワードにだけ適用する規則。既存パスワードの照合には使わない。 */
export function isPasswordAllowed(
  password: string,
  identity: PasswordIdentity,
): boolean {
  if (password.length < 8 || password.length > 128) return false;
  if (!/[A-Z]/.test(password) || !/[0-9]/.test(password)) return false;
  if (!/[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]/.test(password)) return false;
  if (
    Array.from(password).some((character) => {
      const code = character.codePointAt(0);
      return code !== undefined && (code < 32 || (code >= 127 && code <= 159));
    })
  )
    return false;
  return !isDeniedPassword(password, identity);
}
