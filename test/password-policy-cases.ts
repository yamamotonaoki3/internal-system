// #123: 承認済み規則から作った共通の期待値。製品コードからは読み込まない。
export const PASSWORD_IDENTITY = {
  loginId: "testuser_credential_001",
  displayName: "testuser_display",
};
export const PASSWORD_POLICY_CASES = [
  { name: "7文字は短い", password: "Abcd12!", valid: false },
  { name: "8文字を許可", password: "Abcde12!", valid: true },
  { name: "128文字を許可", password: `A1!${"x".repeat(125)}`, valid: true },
  { name: "129文字は長い", password: `A1!${"x".repeat(126)}`, valid: false },
  { name: "大文字が必須", password: "abcdef12!", valid: false },
  { name: "数字が必須", password: "Abcdefgh!", valid: false },
  { name: "ASCII記号が必須", password: "Abcdef123", valid: false },
  { name: "小文字は不要", password: "ZXCVBN12!", valid: true },
  { name: "全角を許可", password: "A1!あいうえお", valid: true },
  { name: "空白を許可してtrimしない", password: " A1!xyz ", valid: true },
  {
    name: "全角記号はASCII記号の代わりにならない",
    password: "Abcdef12！",
    valid: false,
  },
  { name: "改行は禁止", password: "Abcdef12!\n", valid: false },
  { name: "タブは禁止", password: "Abcdef12!\t", valid: false },
  { name: "NULは禁止", password: "Abcdef12!\0", valid: false },
  { name: "DELは禁止", password: "Abcdef12!\u007f", valid: false },
  { name: "C1制御文字は禁止", password: "Abcdef12!\u0085", valid: false },
  { name: "C0制御文字の上端は禁止", password: "Abcdef12!\u001f", valid: false },
  { name: "C1制御文字の上端は禁止", password: "Abcdef12!\u009f", valid: false },
  { name: "C1制御文字の直後は許可", password: "Abcdef12!\u00a0", valid: true },
  {
    name: "社員IDの部分一致は大小を無視",
    password: "!TESTUSER_CREDENTIAL_001A9",
    valid: false,
  },
  {
    name: "社員IDのNFKC一致は禁止",
    password: "A9!ｔｅｓｔｕｓｅｒ＿ｃｒｅｄｅｎｔｉａｌ＿００１",
    valid: false,
  },
  {
    name: "表示名の部分一致は禁止",
    password: "A9!testuser_display",
    valid: false,
  },
  {
    name: "よく使われるpasswordは禁止",
    password: "Password123!",
    valid: false,
  },
  {
    name: "構成規則を満たしても固定一覧とNFKC一致する値は禁止",
    password: "Pａｓｓｗｏｒｄ123!",
    valid: false,
  },
  {
    name: "固定一覧は部分一致ではない",
    password: "Z9!xPassword123!suffix",
    valid: true,
  },
] as const;

// #123 0-3 AC-3: 承認された30〜50件の方針に基づき採用された40件の固定oracle。
// 製品のSetから生成しない。変更時にはポリシーの変更理由とともに見直す。
// 大文字表記でも同じ禁止値であり、以下16件は構成規則だけでは拒否できない。
export const DENIED_PASSWORDS_WITH_VALID_COMPOSITION = [
  "Password123!",
  "Password1!",
  "Passw0rd!",
  "P@ssw0rd",
  "P@ssword1",
  "Qwerty123!",
  "Admin123!",
  "Welcome123!",
  "Letmein123!",
  "Changeme123!",
  "Abc12345!",
  "Abcd1234!",
  "Company123!",
  "Temp1234!",
  "Test1234!",
  "Default123!",
] as const;

// こちら24件は構成規則でも拒否されるが、公開された禁止判定自身の契約も検証する。
export const DENIED_PASSWORDS_WITHOUT_VALID_COMPOSITION = [
  "password",
  "password1",
  "password123",
  "passw0rd",
  "qwerty123",
  "qwertyuiop",
  "admin123",
  "administrator",
  "welcome123",
  "letmein123",
  "abc12345",
  "abcd1234",
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
] as const;

export const PASSWORD_IDENTITY_CASES = [
  {
    name: "3文字の社員IDは対象外",
    identity: { loginId: "abc", displayName: "testuser_other" },
    password: "XXabc12!",
    denied: false,
  },
  {
    name: "4文字の社員IDは対象",
    identity: { loginId: "abcd", displayName: "testuser_other" },
    password: "XXabcd12!",
    denied: true,
  },
  {
    name: "3文字の表示名は対象外",
    identity: { loginId: "testuser_other", displayName: "abc" },
    password: "XXabc12!",
    denied: false,
  },
  {
    name: "4文字の表示名は対象",
    identity: { loginId: "testuser_other", displayName: "abcd" },
    password: "XXabcd12!",
    denied: true,
  },
  {
    name: "社員ID側の全角大文字も正規化する",
    identity: { loginId: "ＡＢＣＤ", displayName: "testuser_other" },
    password: "XXabcd12!",
    denied: true,
  },
  {
    name: "表示名側の全角大文字も正規化する",
    identity: { loginId: "testuser_other", displayName: "ＡＢＣＤ" },
    password: "XXabcd12!",
    denied: true,
  },
  {
    name: "候補の全角大文字を表示名と比較する",
    identity: { loginId: "testuser_other", displayName: "abcd" },
    password: "XXＡＢＣＤ12!",
    denied: true,
  },
  {
    name: "NFKCで4文字になる表示名も対象",
    identity: { loginId: "testuser_other", displayName: "㍿" },
    password: "A99!株式会社",
    denied: true,
  },
] as const;
