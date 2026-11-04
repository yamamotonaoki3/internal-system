// セッションのトークン（ADR-0003・0008）。トークンは32バイトの乱数の base64url（43文字）で、Cookie にだけ入れる。
// DB（sessions.id）には SHA-256 の16進だけを保存する（DB が漏れても、トークンを復元できない）。

export function generateSessionToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
    "base64url",
  );
}

/** 保存用の値（SHA-256 の16進。小文字64文字） */
export async function hashSessionToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Buffer.from(digest).toString("hex");
}
