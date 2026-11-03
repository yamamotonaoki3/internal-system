// 初回専用の認証（D-6）。入力と設定の値を、どちらも SHA-256 にしてから定数時間で比べる
// （ハッシュにすることで、長さの違いや内容の違いが処理時間に表れない）。
import { timingSafeEqual } from "node:crypto";

async function sha256(text: string): Promise<Buffer> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Buffer.from(digest);
}

export async function verifySetupToken(
  input: string,
  configured: string,
): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(input), sha256(configured)]);
  return timingSafeEqual(a, b);
}
