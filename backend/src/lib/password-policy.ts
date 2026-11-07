import {
  isDeniedPassword,
  isPasswordCompositionAllowed,
  type PasswordIdentity,
} from "../../../shared/password-rules";

/** 新しいパスワードにだけ適用する規則。既存パスワードの照合には使わない。 */
export function isPasswordAllowed(
  password: string,
  identity: PasswordIdentity,
): boolean {
  return (
    isPasswordCompositionAllowed(password) &&
    !isDeniedPassword(password, identity)
  );
}
