// #136 AC-3（C-168(3)）: 検索のキーワードの共通規則（shared/search-rules.ts の searchKeywordSchema）を、実装とは独立した期待値で固定する。
// 期待値は要件（V-34・C-90：検索語は1〜100文字で、1文字の検索も認める）と計画（前後の空白を除いてから数える）の数字をそのまま書く。
// 上限の数（100）は本番の定数から作らない。判定の網羅はこの層で行い、API（EP-7-01 の q）は代表だけを確かめる。
import { describe, expect, it } from "vitest";
import { searchKeywordSchema } from "../../../shared/search-rules";

describe("#136 AC-3（C-168(3)）検索のキーワード（searchKeywordSchema）", () => {
  it.each([
    ["1文字", "a", true],
    ["100文字", "あ".repeat(100), true],
    ["前後に空白のある100文字", `  ${"あ".repeat(100)} `, true],
    ["前後に全角空白のある100文字", `　${"a".repeat(100)}　`, true],
    ["0文字", "", false],
    ["101文字", "あ".repeat(101), false],
    ["前後の空白を除いて101文字", ` ${"a".repeat(101)} `, false],
    ["半角空白だけ", "   ", false],
    ["全角空白だけ", "　　", false],
    ["タブと改行だけ", "\t\n", false],
  ])("#136 C-168(3): %s は受け付ける=%s", (_label, value, accepted) => {
    expect(searchKeywordSchema.safeParse(value).success).toBe(accepted);
  });

  it("#136 C-168(3): 前後の空白を除いた値を返す（間の空白は残す）", () => {
    expect(searchKeywordSchema.parse("  テスト 検索　")).toBe("テスト 検索");
  });

  it.each([
    ["%", "%"],
    ["_", "_"],
    ["\\", "\\"],
    ["' OR 1=1 --", "' OR 1=1 --"],
  ])(
    "#136 C-168(3): 記号（%s）だけの語も、文字として受け付けてそのまま返す（無害化は SQL を組む側で行う）",
    (value, expected) => {
      expect(searchKeywordSchema.parse(value)).toBe(expected);
    },
  );

  it.each([[123], [null], [undefined], [["a"]]])(
    "#136 C-168(3): 文字列でない値 %j は拒否する",
    (value) => {
      expect(searchKeywordSchema.safeParse(value).success).toBe(false);
    },
  );
});
