// #199 AC-2: アカウント発行の入力規則（shared/account-rules.ts）の境界値。
// 期待値は定義から作らず、仕様（V-01〜V-06・V-11、0-1 AC-22）の数値を直接書く。
import { describe, expect, it } from "vitest";
import {
  accountDisplayNameSchema,
  accountEmailSchema,
  accountExtensionSchema,
  accountJobTitleSchema,
  accountLegalNameSchema,
  accountLoginIdSchema,
} from "../../../shared/account-rules";

const ok = (
  schema: { safeParse(v: unknown): { success: boolean } },
  v: string,
) => schema.safeParse(v).success;

/** 全体の長さが length 文字のメールアドレス（ローカル部64文字・ラベル63文字以内） */
function emailOfLength(length: number): string {
  const local = "a".repeat(64);
  const fixed = local.length + 1 + 63 + 1 + 63 + 1 + ".com".length;
  return `${local}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(length - fixed)}.com`;
}

describe("#199 アカウントの共通入力規則", () => {
  it("#199 AC-2（V-01・V-02）: ユーザーIDは3〜32文字の英数字と . _ - だけ", () => {
    expect(ok(accountLoginIdSchema, "abc")).toBe(true);
    expect(ok(accountLoginIdSchema, "a".repeat(32))).toBe(true);
    expect(ok(accountLoginIdSchema, "A.b_c-1")).toBe(true);
    for (const id of [
      "ab",
      "a".repeat(33),
      "",
      "test user",
      "test@user",
      "テスト",
      "abc+",
      "abc/",
    ])
      expect(ok(accountLoginIdSchema, id), id).toBe(false);
  });

  it("#199 AC-2（V-05）: 本名は前後空白を除いて1〜50文字、制御文字は拒否", () => {
    expect(ok(accountLegalNameSchema, "テ")).toBe(true);
    expect(ok(accountLegalNameSchema, "テ".repeat(50))).toBe(true);
    expect(accountLegalNameSchema.parse(" テスト太郎 ")).toBe("テスト太郎");
    for (const name of ["", "   ", "テ".repeat(51), "テスト\n太郎", "テスト\t"])
      expect(ok(accountLegalNameSchema, name), JSON.stringify(name)).toBe(
        false,
      );
  });

  it("#199 AC-2（V-03）: 表示名は前後空白を除いて1〜30文字、制御文字は拒否", () => {
    expect(ok(accountDisplayNameSchema, "テ")).toBe(true);
    expect(ok(accountDisplayNameSchema, "テ".repeat(30))).toBe(true);
    for (const name of ["", "  ", "テ".repeat(31), "テスト\u0000"])
      expect(ok(accountDisplayNameSchema, name), JSON.stringify(name)).toBe(
        false,
      );
  });

  it("#199 AC-2（V-06）: メールは254文字以内の標準形式", () => {
    expect(emailOfLength(254)).toHaveLength(254);
    expect(ok(accountEmailSchema, emailOfLength(254))).toBe(true);
    expect(ok(accountEmailSchema, emailOfLength(255))).toBe(false);
    expect(ok(accountEmailSchema, "testuser_001@example.com")).toBe(true);
    for (const email of [
      "",
      "testuser_001",
      "testuser_001@",
      "@example.com",
      "test user@example.com",
    ])
      expect(ok(accountEmailSchema, email), email).toBe(false);
  });

  it("#199 AC-2（V-11）: 内線は数字とハイフンの1〜10文字", () => {
    expect(ok(accountExtensionSchema, "0")).toBe(true);
    expect(ok(accountExtensionSchema, "0".repeat(10))).toBe(true);
    expect(ok(accountExtensionSchema, "12-34")).toBe(true);
    for (const ext of ["", "0".repeat(11), "12a", "内線1", "１２"])
      expect(ok(accountExtensionSchema, ext), ext).toBe(false);
  });

  it("#199 AC-2（V-11）: 役職は前後空白を除いて1〜30文字", () => {
    expect(ok(accountJobTitleSchema, "課")).toBe(true);
    expect(ok(accountJobTitleSchema, "課".repeat(30))).toBe(true);
    for (const title of ["", "  ", "課".repeat(31)])
      expect(ok(accountJobTitleSchema, title), title).toBe(false);
  });
});
