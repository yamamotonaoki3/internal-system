// テストの中で使う SETUP_TOKEN・PII_ENCRYPTION_KEY を、その場で乱数から作る（実際の値をファイルに書かないため）。
// 形式は本番と同じ：32バイトの乱数の base64url（パディングなし。ちょうど43文字）。

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function randomBase64Url(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** 43文字の base64url の乱数（SETUP_TOKEN と同じ形式） */
export const newSetupToken = () => randomBase64Url(32);
/** 32バイトの鍵の base64url（PII_ENCRYPTION_KEY と同じ形式） */
export const newPiiKey = () => randomBase64Url(32);
