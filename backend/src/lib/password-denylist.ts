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

export function isDeniedPassword(
  password: string,
  identity: PasswordIdentity,
): boolean {
  const normalized = password.normalize("NFKC").toLowerCase();
  if (DENIED_PASSWORDS.has(normalized)) return true;
  return [identity.loginId, identity.displayName].some((value) => {
    const part = value.normalize("NFKC").toLowerCase();
    return part.length >= 4 && normalized.includes(part);
  });
}
