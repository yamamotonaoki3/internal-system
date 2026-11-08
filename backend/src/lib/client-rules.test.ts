// #192 AC-2・AC-5: 正本の入力境界を実装とは独立した期待値で固定する。
import { describe, expect, it } from "vitest";
import {
  clientCodeSchema,
  clientNameKey,
  clientNameSchema,
  clientSearchSchema,
} from "../../../shared/client-rules";

describe("#192 取引先の共通入力規則", () => {
  it("#192 AC-2（5-7 AC-2）: 英大文字3文字のコードだけを許可する", () => {
    expect(clientCodeSchema.safeParse("ABC").success).toBe(true);
    for (const code of ["AB", "ABCD", "AbC", "abc", "AB1", "ＡＢＣ", ""]) {
      expect(clientCodeSchema.safeParse(code).success, code).toBe(false);
    }
  });

  it("#192 AC-2（5-7 AC-6）: 名前は前後空白を除去して1〜50文字を許可する", () => {
    expect(clientNameSchema.parse(" A ")).toBe("A");
    expect(clientNameSchema.safeParse("A".repeat(50)).success).toBe(true);
    for (const name of ["", "   ", "A".repeat(51), `  ${"A".repeat(51)}  `]) {
      expect(clientNameSchema.safeParse(name).success).toBe(false);
    }
  });

  it("#192 AC-2（5-7 AC-7）: 比較キーは前後空白と英字の大小文字を区別しない", () => {
    expect(clientNameKey("  Sample  ")).toBe("sample");
    expect(clientNameKey("sample")).toBe("sample");
    expect(clientNameKey("  別の取引先  ")).toBe("別の取引先");
  });

  it("#192 AC-5（5-7 AC-11）: 空の検索語は無検索、1〜100文字は許可し101文字は拒否する", () => {
    expect(clientSearchSchema.parse("")).toBe("");
    expect(clientSearchSchema.parse("   ")).toBe("");
    expect(clientSearchSchema.parse(" a ")).toBe("a");
    expect(clientSearchSchema.safeParse("A".repeat(100)).success).toBe(true);
    expect(clientSearchSchema.safeParse("A".repeat(101)).success).toBe(false);
  });
});
