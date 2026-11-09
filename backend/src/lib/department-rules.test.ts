// #196 AC-1・AC-3: 部署名・説明・自動専用チャンネル名の共通規則（shared/department-rules.ts）を、実装とは独立した期待値で固定する。
// 期待値は定義から作らず、要件（2-1 AC-12・7-1 の2026-11-08承認・S-10）の数字をそのまま書く。
import { describe, expect, it } from "vitest";
import {
  ANNOUNCEMENT_SUFFIX,
  DEPARTMENT_ANNOUNCEMENT_NAME_MAX,
  announcementChannelName,
  channelNameKey,
  departmentDescriptionSchema,
  departmentNameKey,
  departmentNameSchema,
} from "../../../shared/department-rules";

describe("#196 部署の共通入力規則", () => {
  it("#196 AC-1（2-1 AC-12）: 部署名は前後空白を除去して1〜50文字を許可する", () => {
    expect(departmentNameSchema.parse(" 営業 ")).toBe("営業");
    expect(departmentNameSchema.safeParse("A").success).toBe(true);
    expect(departmentNameSchema.safeParse("A".repeat(50)).success).toBe(true);
    expect(departmentNameSchema.parse(`  ${"A".repeat(50)}  `)).toBe(
      "A".repeat(50),
    );
    for (const name of ["", "   ", "　", "A".repeat(51), ` ${"A".repeat(51)} `])
      expect(departmentNameSchema.safeParse(name).success, name).toBe(false);
  });

  it("#196 AC-1（S-10）: 部署名は UTF-16 の単位で数える（サロゲートペアは2文字）", () => {
    // 「𠮷」は UTF-16 で2単位。25個で50単位、26個で52単位
    expect(departmentNameSchema.safeParse("𠮷".repeat(25)).success).toBe(true);
    expect(departmentNameSchema.safeParse("𠮷".repeat(26)).success).toBe(false);
  });

  it("#196 AC-1（S-10）: 制御文字を含む部署名は拒否し、それ以外の文字は制限しない", () => {
    for (const name of [
      "営業\u0000部",
      "営業\u0007部",
      "営業\u001f部",
      "営業\u007f部",
    ])
      expect(departmentNameSchema.safeParse(name).success, name).toBe(false);
    for (const name of [
      "営業部",
      "Sales-1",
      "営業（東京）",
      "R&D_チーム",
      "営業 第一",
    ])
      expect(departmentNameSchema.safeParse(name).success, name).toBe(true);
  });

  it("#196 AC-1（2-1 AC-12）: 説明は空と500文字までを許可し、501文字は拒否する", () => {
    expect(departmentDescriptionSchema.safeParse("").success).toBe(true);
    expect(
      departmentDescriptionSchema.safeParse("あ".repeat(500)).success,
    ).toBe(true);
    expect(
      departmentDescriptionSchema.safeParse("あ".repeat(501)).success,
    ).toBe(false);
  });

  it("#196 AC-1（2-1 AC-12）: 部署名の比較キーは前後空白と英字の大小文字を区別しない", () => {
    expect(departmentNameKey("  Sales  ")).toBe("sales");
    expect(departmentNameKey("SALES")).toBe("sales");
    expect(departmentNameKey(" 営業部 ")).toBe("営業部");
  });

  it("#196 AC-3（7-1 2026-11-08承認）: チャンネル名の比較キーも前後空白と大小文字を区別しない", () => {
    expect(channelNameKey("  Salesのお知らせ ")).toBe("salesのお知らせ");
    expect(channelNameKey("SALES")).toBe(channelNameKey("sales"));
  });

  it("#196 AC-3（7-1 2026-11-08承認）: お知らせ専用チャンネル名は部署名＋「のお知らせ」", () => {
    expect(ANNOUNCEMENT_SUFFIX).toBe("のお知らせ");
    expect(announcementChannelName("営業")).toBe("営業のお知らせ");
    expect(announcementChannelName("営業のお知らせ")).toBe(
      "営業のお知らせのお知らせ",
    );
  });

  it("#196 AC-3（7-1 2026-11-08承認）: お知らせ名だけ最大55文字。49文字の部署名は54文字、50文字は55文字になる", () => {
    expect(DEPARTMENT_ANNOUNCEMENT_NAME_MAX).toBe(55);
    expect(announcementChannelName("A".repeat(49))).toHaveLength(54);
    expect(announcementChannelName("A".repeat(50))).toHaveLength(55);
    // 切り詰めや連番は付けない
    expect(announcementChannelName("A".repeat(50))).toBe(
      `${"A".repeat(50)}のお知らせ`,
    );
  });
});
