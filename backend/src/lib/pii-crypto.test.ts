// #119 AC-1：本名を AES-256-GCM（WebCrypto）で暗号化して保存する（計画 D-5）。形式は "v1:<iv>:<ciphertext>"（base64url）。
// 鍵はテストの中で乱数から作る（実際の値を書かない）。AAD（追加の認証データ）には、行の識別子（利用者のID）を入れる想定。
import { describe, expect, it } from "vitest";
import {
  base64UrlEncode,
  newPiiKey,
  randomBase64Url,
} from "../../test/random-secrets";
import { decryptLegalName, encryptLegalName } from "./pii-crypto";

const LEGAL_NAME = "テスト太郎";
const AAD = "01JTESTUSER000000000000001";
const OTHER_AAD = "01JTESTUSER000000000000002";

function base64UrlDecode(text: string): Uint8Array {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** 暗号文の部分の、指定した位置の1ビットを反転する */
function flipBit(part: string, index = 0): string {
  const bytes = base64UrlDecode(part);
  bytes[index] = (bytes[index] ?? 0) ^ 0x01;
  return base64UrlEncode(bytes);
}

describe("本名の暗号化（encryptLegalName・decryptLegalName）", () => {
  it("#119 AC-1: 暗号化して復号すると元に戻る（日本語・30文字・50文字）", async () => {
    const key = newPiiKey();
    for (const name of [
      LEGAL_NAME,
      "あ".repeat(30),
      "テ".repeat(50),
      "Test Taro",
    ]) {
      const encrypted = await encryptLegalName(name, key, AAD);
      expect(await decryptLegalName(encrypted, key, AAD)).toBe(name);
    }
  });

  it("#119 AC-1: 形式は v1:<iv>:<ciphertext>。IV は12バイトで、暗号文に平文を含まない", async () => {
    const key = newPiiKey();
    const encrypted = await encryptLegalName(LEGAL_NAME, key, AAD);
    expect(encrypted).toMatch(/^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
    const [, iv, body] = encrypted.split(":");
    expect(base64UrlDecode(iv ?? "")).toHaveLength(12);
    // GCM の認証タグ（16バイト）を含むため、暗号文は平文のバイト数より16バイト長い
    expect(base64UrlDecode(body ?? "")).toHaveLength(
      new TextEncoder().encode(LEGAL_NAME).length + 16,
    );
    expect(encrypted).not.toContain(LEGAL_NAME);
  });

  it("#119 AC-1: 同じ本名・同じ鍵でも、IV が毎回違うため暗号文は毎回違う（IV を使い回さない）", async () => {
    const key = newPiiKey();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => encryptLegalName(LEGAL_NAME, key, AAD)),
    );
    expect(new Set(results).size).toBe(20);
    expect(new Set(results.map((r) => r.split(":")[1])).size).toBe(20);
  });

  it("#119 AC-1: 暗号文を1ビットでも改ざんすると、復号は失敗する（元の値や空を返さない）", async () => {
    const key = newPiiKey();
    const [v, iv, body] = (await encryptLegalName(LEGAL_NAME, key, AAD)).split(
      ":",
    );
    await expect(
      decryptLegalName(`${v}:${iv}:${flipBit(body ?? "")}`, key, AAD),
    ).rejects.toThrow();
    // 認証タグ（末尾）の改ざんも検知する
    const tagIndex = base64UrlDecode(body ?? "").length - 1;
    await expect(
      decryptLegalName(`${v}:${iv}:${flipBit(body ?? "", tagIndex)}`, key, AAD),
    ).rejects.toThrow();
  });

  it("#119 AC-1: IV を改ざんすると、復号は失敗する", async () => {
    const key = newPiiKey();
    const [v, iv, body] = (await encryptLegalName(LEGAL_NAME, key, AAD)).split(
      ":",
    );
    await expect(
      decryptLegalName(`${v}:${flipBit(iv ?? "")}:${body}`, key, AAD),
    ).rejects.toThrow();
  });

  it("#119 AC-1: AAD が違う（別の利用者の行へ暗号文を写した）と、復号は失敗する", async () => {
    const key = newPiiKey();
    const encrypted = await encryptLegalName(LEGAL_NAME, key, AAD);
    await expect(decryptLegalName(encrypted, key, OTHER_AAD)).rejects.toThrow();
  });

  it("#119 AC-1: 鍵が違うと、復号は失敗する", async () => {
    const encrypted = await encryptLegalName(LEGAL_NAME, newPiiKey(), AAD);
    await expect(
      decryptLegalName(encrypted, newPiiKey(), AAD),
    ).rejects.toThrow();
  });

  it("#119 AC-1: 知らない版（v2）・壊れた形式は、復号しない", async () => {
    const key = newPiiKey();
    const [, iv, body] = (await encryptLegalName(LEGAL_NAME, key, AAD)).split(
      ":",
    );
    for (const broken of [
      `v2:${iv}:${body}`,
      `v1:${iv}`,
      "",
      LEGAL_NAME,
      `v1::${body}`,
    ]) {
      await expect(decryptLegalName(broken, key, AAD)).rejects.toThrow();
    }
  });

  it("#119 AC-1: 鍵がちょうど32バイトでなければ、暗号化・復号とも失敗する（最終の修正 3：復号時にも確かめる）", async () => {
    const key = newPiiKey();
    const encrypted = await encryptLegalName(LEGAL_NAME, key, AAD);
    for (const badKey of [
      randomBase64Url(16),
      randomBase64Url(31),
      randomBase64Url(33),
      "",
      "!!!!",
    ]) {
      await expect(encryptLegalName(LEGAL_NAME, badKey, AAD)).rejects.toThrow();
      await expect(decryptLegalName(encrypted, badKey, AAD)).rejects.toThrow();
    }
  });
});
