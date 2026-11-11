// #130 AC-1（0-4 AC-1・AC-3）・AC-2（6-1 AC-3）: ステータス・一言メッセージの入力規則（shared/profile-rules.ts）の境界値。
// 期待値は定義から作らず、仕様（0-4 AC-3：一言は100文字まで、6-1 AC-3：5種類、計画 P-17：改行を含む制御文字は不可）の値を直接書く。
// 公開形の仮定（契約）：
//  - USER_STATUS_KINDS：5種類の値の配列（available・away・absent・vacation・meeting）
//  - STATUS_MESSAGE_MAX_LENGTH：100
//  - userStatusKindSchema：5種類だけを通す zod スキーマ
//  - statusMessageSchema：前後の空白を除き、0〜100文字。空（空白だけを含む）は null に変える。制御文字（改行・タブを含む）は不可
import { describe, expect, it } from "vitest";
import {
  STATUS_MESSAGE_MAX_LENGTH,
  USER_STATUS_KINDS,
  statusMessageSchema,
  userStatusKindSchema,
} from "../../../shared/profile-rules";

describe("#130 AC-2（6-1 AC-3）ステータスの種類", () => {
  it("#130 AC-2（6-1 AC-3）: 種類はちょうど5つ（在席・外出・欠席・休暇・会議中）", () => {
    expect([...USER_STATUS_KINDS].sort()).toEqual(
      ["absent", "available", "away", "meeting", "vacation"].sort(),
    );
  });

  it.each(["available", "away", "absent", "vacation", "meeting"])(
    "#130 AC-2（6-1 AC-3）: %s は通る",
    (kind) => {
      expect(userStatusKindSchema.safeParse(kind).success).toBe(true);
    },
  );

  it.each(["", "busy", "Available", " away", "offline", 1, null])(
    "#130 AC-2（6-1 AC-3）: 5種類以外（%s）は通らない",
    (kind) => {
      expect(userStatusKindSchema.safeParse(kind).success).toBe(false);
    },
  );
});

describe("#130 AC-1（0-4 AC-1・AC-3）一言メッセージ", () => {
  it("#130 AC-1（0-4 AC-3）: 上限は100文字", () => {
    expect(STATUS_MESSAGE_MAX_LENGTH).toBe(100);
  });

  it("#130 AC-1（0-4 AC-3）: 100文字は可、101文字は不可", () => {
    expect(statusMessageSchema.safeParse("あ".repeat(100))).toEqual({
      success: true,
      data: "あ".repeat(100),
    });
    expect(statusMessageSchema.safeParse("あ".repeat(101)).success).toBe(false);
  });

  it("#130 AC-1（0-4 AC-3）: 前後の空白を除いてから数える（除いた後100文字なら可）", () => {
    const result = statusMessageSchema.safeParse(`  ${"a".repeat(100)}  `);
    expect(result).toEqual({ success: true, data: "a".repeat(100) });
  });

  it.each(["", "   ", "　"])(
    "#130 AC-1（0-4 AC-3）: 空（%j）は null として保存する",
    (value) => {
      expect(statusMessageSchema.safeParse(value)).toEqual({
        success: true,
        data: null,
      });
    },
  );

  it.each([
    "一行目\n二行目",
    "タブ\tあり",
    "末尾の改行\n",
    "NUL\u0000",
    "DEL\u007f",
  ])(
    "#130 AC-1（0-4 AC-3・P-17）: 制御文字・改行を含む値（%j）は不可",
    (value) => {
      expect(statusMessageSchema.safeParse(value).success).toBe(false);
    },
  );

  it("#130 AC-1（0-4 AC-3）: script タグを含む文字列も、文字として受け付ける（表示側でエスケープする）", () => {
    expect(statusMessageSchema.safeParse("<script>alert(1)</script>")).toEqual({
      success: true,
      data: "<script>alert(1)</script>",
    });
  });

  it("#130 AC-1（0-4 AC-3）: 文字列以外は不可", () => {
    for (const value of [1, true, {}, []])
      expect(statusMessageSchema.safeParse(value).success).toBe(false);
  });
});
