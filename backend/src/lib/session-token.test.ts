// #120 0-2 AC-1・AC-2：セッションのトークン（ADR-0003・0008）。トークンは乱数、DB には SHA-256 の16進だけを保存する。
import { describe, expect, it } from "vitest";
import { generateSessionToken, hashSessionToken } from "./session-token";

describe("セッションのトークン", () => {
  it("#120 0-2 AC-1: 32バイトの乱数の base64url（43文字）で、毎回違う値になる", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const token = generateSessionToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      seen.add(token);
    }
    expect(seen.size).toBe(200);
  });

  it("#120 0-2 AC-1: 保存用の値は SHA-256 の16進（小文字64文字）。既知の値と一致する（FIPS 180-2 の例 'abc'）", async () => {
    expect(await hashSessionToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("#120 0-2 AC-1: 保存用の値は、トークンそのものを含まない", async () => {
    const token = generateSessionToken();
    const hashed = await hashSessionToken(token);
    expect(hashed).toMatch(/^[0-9a-f]{64}$/);
    expect(hashed).not.toContain(token);
  });
});
