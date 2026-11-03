// #119 AC-1・AC-4：初期パスワードの生成と、パスワードのハッシュ（ADR-0007。scrypt N=2^16, r=8, p=2、PHC形式）。
// workerd で scrypt が動くかの確認は scrypt-runtime.test.ts（./password の実装がなくても単独で動くように分けた）。
import { describe, expect, it } from "vitest";
import {
  generateInitialPassword,
  hashPassword,
  verifyPassword,
} from "./password";

// テスト専用の固定値（実アカウントの認証情報ではない）
const TEST_PASSWORD = "TestPass123!";

// 紛らわしい文字（計画 C-40）：0/O/o、1/l/I
const CONFUSING = /[0Oo1lI]/;

describe("初期パスワードの生成（generateInitialPassword）", () => {
  it("#119 AC-1: 1000回生成して、すべて16文字・大文字・小文字・数字・記号を各1文字以上含み、紛らわしい文字を含まない", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      const p = generateInitialPassword();
      expect(p).toHaveLength(16);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[0-9]/);
      expect(p).toMatch(/[^A-Za-z0-9]/);
      expect(p).not.toMatch(CONFUSING);
      // 空白・制御文字は含めない（伝達時の誤りを防ぐ）
      expect(p).not.toMatch(/[\s\u0000-\u001f\u007f]/);
      seen.add(p);
    }
    // 乱数で作るため、1000回で重複しない
    expect(seen.size).toBe(1000);
  });

  it("#119 AC-1: 使われる文字に偏りがない（各文字種の中の文字が複数回現れる）", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 1000; i += 1) {
      for (const c of generateInitialPassword())
        counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    // 16,000文字で、使われる文字の種類が十分に多い（固定の文字列や狭い文字集合でない）
    expect(counts.size).toBeGreaterThanOrEqual(50);
  });
});

describe("パスワードのハッシュ（hashPassword・verifyPassword）", () => {
  it("#119 AC-1: PHC形式（$scrypt$ln=16,r=8,p=2$<salt>$<hash>）で、平文を含まない", async () => {
    const hash = await hashPassword(TEST_PASSWORD);
    expect(hash).toMatch(
      /^\$scrypt\$ln=16,r=8,p=2\$[A-Za-z0-9+/]+={0,2}\$[A-Za-z0-9+/]+={0,2}$/,
    );
    expect(hash).not.toContain(TEST_PASSWORD);
  });

  it("#119 AC-1: 同じパスワードでも、ソルトが毎回違うため、ハッシュは毎回違う", async () => {
    const a = await hashPassword(TEST_PASSWORD);
    const b = await hashPassword(TEST_PASSWORD);
    expect(a).not.toBe(b);
  });

  it("#119 AC-1: 正しいパスワードは true、違うパスワードは false", async () => {
    const hash = await hashPassword(TEST_PASSWORD);
    expect(await verifyPassword(TEST_PASSWORD, hash)).toBe(true);
    expect(await verifyPassword("TestPass123?", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("#119 AC-1: 形式が壊れたハッシュ・別方式のハッシュは、true にしない（成功扱いにしない）", async () => {
    for (const broken of [
      "",
      "plain-text",
      "$scrypt$ln=16,r=8,p=2$$",
      "$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA",
    ]) {
      const result = await verifyPassword(TEST_PASSWORD, broken).catch(
        () => "rejected" as const,
      );
      expect(result === false || result === "rejected").toBe(true);
    }
  });
});
