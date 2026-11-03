// 本名（個人情報）の暗号化（D-5）。AES-256-GCM（WebCrypto）。保存の形式は "v1:<iv>:<暗号文>"（base64url、パディングなし）。
// 鍵は環境のシークレット（PII_ENCRYPTION_KEY。32バイトの乱数のbase64url）。AAD（追加の認証データ）には行の識別子（利用者のID）を入れ、
// 暗号文を別の行へ写しても復号できないようにする。紛失・ローテーションの扱いはADR-0013。
const VERSION = "v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const BASE64URL = /^[A-Za-z0-9_-]*$/;

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** 形式が正しくない入力（base64url以外の文字、長さの端数）は例外にする */
export function base64UrlDecode(text: string): Uint8Array<ArrayBuffer> {
  if (!BASE64URL.test(text) || text.length % 4 === 1)
    throw new Error("base64url の形式が正しくありません");
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** 鍵として使える形式（base64url、デコード後がちょうど32バイト）か。値は表示しない */
export function isValidPiiKey(keyBase64Url: string): boolean {
  try {
    return base64UrlDecode(keyBase64Url).length === KEY_BYTES;
  } catch {
    // 形式が正しくない鍵は「使えない鍵」という判定結果にする（呼び出し元が設定の不備として扱う）
    return false;
  }
}

async function importKey(keyBase64Url: string): Promise<CryptoKey> {
  const raw = base64UrlDecode(keyBase64Url);
  if (raw.length !== KEY_BYTES)
    throw new Error("暗号鍵はちょうど32バイトでなければなりません");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptLegalName(
  plain: string,
  keyBase64Url: string,
  aad: string,
): Promise<string> {
  const key = await importKey(keyBase64Url);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) },
    key,
    new TextEncoder().encode(plain),
  );
  return `${VERSION}:${base64UrlEncode(iv)}:${base64UrlEncode(new Uint8Array(encrypted))}`;
}

/** 改ざん・鍵や行の違い・知らない版・壊れた形式は、例外にする（元の値や空の値を返さない） */
export async function decryptLegalName(
  stored: string,
  keyBase64Url: string,
  aad: string,
): Promise<string> {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== VERSION)
    throw new Error("暗号文の形式または版が正しくありません");
  const iv = base64UrlDecode(parts[1] ?? "");
  const body = base64UrlDecode(parts[2] ?? "");
  if (iv.length !== IV_BYTES || body.length === 0)
    throw new Error("暗号文の形式が正しくありません");
  const key = await importKey(keyBase64Url);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) },
    key,
    body,
  );
  return new TextDecoder().decode(decrypted);
}
