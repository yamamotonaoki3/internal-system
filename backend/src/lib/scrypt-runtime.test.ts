// #119 AC-1：本番と同じ実行エンジン（workerd）で node:crypto の scrypt が動くかを、最初に確かめる（計画 D-8・ADR-0007）。
// lib/password.ts の実装に依存させない（実装の前に、実行環境の可否だけを判定するため）。
import { scryptSync, timingSafeEqual } from "node:crypto";
import { describe, expect, it } from "vitest";

// テスト専用の固定値（実アカウントの認証情報ではない）
const TEST_PASSWORD = "TestPass123!";

describe("workerd での scrypt の動作の確認（D-8）", () => {
  it("#119 AC-1: node:crypto の scrypt が N=2^16, r=8, p=2 で動く（maxmem を明示）", () => {
    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    const key = scryptSync(TEST_PASSWORD, salt, 32, {
      N: 2 ** 16,
      r: 8,
      p: 2,
      maxmem: 2 ** 16 * 8 * 128 * 2 + 1024 * 1024,
    });
    expect(key.length).toBe(32);
    const again = scryptSync(TEST_PASSWORD, salt, 32, {
      N: 2 ** 16,
      r: 8,
      p: 2,
      maxmem: 2 ** 16 * 8 * 128 * 2 + 1024 * 1024,
    });
    expect(timingSafeEqual(key, again)).toBe(true);
  });
});
