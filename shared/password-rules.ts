export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
const PASSWORD_IDENTITY_MIN_LENGTH = 4;

/** 固定一覧は正規化した値の完全一致だけで判定する。 */
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

export type PasswordIdentity = { loginId: string; displayName: string };

export function isPasswordCompositionAllowed(password: string): boolean {
  if (
    password.length < PASSWORD_MIN_LENGTH ||
    password.length > PASSWORD_MAX_LENGTH
  )
    return false;
  if (!/[A-Z]/.test(password) || !/[0-9]/.test(password)) return false;
  if (!/[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]/.test(password)) return false;
  if (
    Array.from(password).some((character) => {
      const code = character.codePointAt(0);
      return code !== undefined && (code < 32 || (code >= 127 && code <= 159));
    })
  )
    return false;
  return true;
}

export function isDeniedPassword(
  password: string,
  identity: PasswordIdentity,
): boolean {
  const normalized = password.normalize("NFKC").toLowerCase();
  if (DENIED_PASSWORDS.has(normalized)) return true;
  return [identity.loginId, identity.displayName].some((value) => {
    const part = value.normalize("NFKC").toLowerCase();
    return (
      part.length >= PASSWORD_IDENTITY_MIN_LENGTH && normalized.includes(part)
    );
  });
}
