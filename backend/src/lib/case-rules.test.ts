// #146（146-A）5-3 AC-12・AC-13、5-1 AC-17・C-141(2)：案件の件名・説明・納期の規則の定義元（shared/case-rules.ts）。
// 期待値は要件（5-3 AC-12・AC-13、C-121・C-144 の案）と計画 A-2 から決め、本番の定数（CASE_TITLE_MAX_LENGTH 等）から作らない。
// 契約（実装前の仮置き。計画 A-2）：
//   formatCaseTitle(value: string): string
//     1 全角の英数字を半角 2 ハイフン類（U+2010〜2015・U+2212・U+FF0D・U+FE63）を「-」3 連続する空白（全角空白を含む）を半角の空白1つ 4 前後の空白を除く。
//     長音符「ー」・波ダッシュ「〜」・かなは変えない。
//   caseTitleSchema（zod）：整形後に UTF-16 の単位で 1〜100 文字
//   caseDescriptionSchema（zod）：2000 文字まで
//   jstDateOf(now: Date): { date: "YYYY-MM-DD"; year: number; yymmdd: string }（UTC＋9時間）
//   caseDueDateSchema（zod）：YYYY-MM-DD の形で、実在する日付（「今日以降」はサーバーが jstDateOf で判定する）
import { describe, expect, it } from "vitest";
import {
  caseDescriptionSchema,
  caseDueDateSchema,
  caseTitleSchema,
  formatCaseTitle,
  jstDateOf,
} from "../../../shared/case-rules";

describe("#146 5-3 AC-13 件名の整形（formatCaseTitle）", () => {
  it.each([
    ["全角の英数字を半角にする", "ＡＢＣ１２３ｘｙｚ", "ABC123xyz"],
    ["連続する空白を1つにする", "案件A   打ち合わせ", "案件A 打ち合わせ"],
    [
      "全角空白も半角の空白1つにする",
      "案件A　　　打ち合わせ",
      "案件A 打ち合わせ",
    ],
    ["全角空白1つも半角の空白にする", "案件A　打ち合わせ", "案件A 打ち合わせ"],
    ["前後の空白（全角を含む）を除く", "　 案件A \t", "案件A"],
    ["U+2010 のハイフンを - にする", "A‐B", "A-B"],
    ["U+2011 を - にする", "A‑B", "A-B"],
    ["U+2012 を - にする", "A‒B", "A-B"],
    ["U+2013 を - にする", "A–B", "A-B"],
    ["U+2014 を - にする", "A—B", "A-B"],
    ["U+2015 を - にする", "A―B", "A-B"],
    ["マイナス記号 U+2212 を - にする", "A−B", "A-B"],
    ["全角ハイフン U+FF0D を - にする", "A－B", "A-B"],
    ["小さいハイフン U+FE63 を - にする", "A﹣B", "A-B"],
  ])("#146 AC-13: %s", (_label, input, expected) => {
    expect(formatCaseTitle(input)).toBe(expected);
  });

  it.each([
    ["長音符「ー」", "サーバー保守"],
    ["波ダッシュ「〜」", "10月〜12月"],
    ["ひらがな", "かな"],
    ["半角カナ（日本語の文字の変換は未決定のため変えない）", "ｶﾅ"],
    ["半角の - はそのまま", "A-B"],
  ])("#146 AC-13: %s は変えない", (_label, input) => {
    expect(formatCaseTitle(input)).toBe(input);
  });

  it("#146 AC-13: 複数の整形を同時に行う", () => {
    expect(formatCaseTitle("　ＡＢＣ−１  システム　更新 ")).toBe(
      "ABC-1 システム 更新",
    );
  });
});

describe("#146 5-3 AC-12 件名・説明の長さ", () => {
  const ok = (value: string) => caseTitleSchema.safeParse(value).success;

  it("#146 AC-12: 整形後に1文字は可、空・空白だけは不可", () => {
    expect(ok("a")).toBe(true);
    expect(ok("")).toBe(false);
    expect(ok("   ")).toBe(false);
    expect(ok("　　")).toBe(false);
  });

  it("#146 AC-12: 100文字は可、101文字は不可", () => {
    expect(ok("あ".repeat(100))).toBe(true);
    expect(ok("あ".repeat(101))).toBe(false);
  });

  it("#146 AC-12・AC-13: 長さは整形後で数える（前後の空白・連続する空白を除いた後が100文字なら可）", () => {
    expect(ok(`  ${"a".repeat(100)}  `)).toBe(true);
    expect(ok(`${"a".repeat(49)}    ${"b".repeat(50)}`)).toBe(true);
    expect(ok(`${"a".repeat(50)} ${"b".repeat(50)}`)).toBe(false);
  });

  it("#146 AC-12: サロゲートペアは UTF-16 の単位で数える（2単位×50 は可、さらに1文字で不可）", () => {
    expect(ok("𠮷".repeat(50))).toBe(true);
    expect(ok(`${"𠮷".repeat(50)}a`)).toBe(false);
  });

  it("#146 AC-12: 説明は2000文字まで可、2001文字は不可。空は可", () => {
    const desc = (value: string) =>
      caseDescriptionSchema.safeParse(value).success;
    expect(desc("")).toBe(true);
    expect(desc("あ".repeat(2000))).toBe(true);
    expect(desc("あ".repeat(2001))).toBe(false);
  });
});

describe("#146 5-1 AC-17・C-141(2) 日本時間の日付（jstDateOf）", () => {
  it("#146 5-1 AC-17: UTC 14:59:59.999 はその日、15:00 で翌日になる", () => {
    expect(jstDateOf(new Date("2026-11-16T14:59:59.999Z")).date).toBe(
      "2026-11-16",
    );
    expect(jstDateOf(new Date("2026-11-16T15:00:00.000Z")).date).toBe(
      "2026-11-17",
    );
  });

  it("#146 5-1 AC-17: UTC 12/31 15:00 で年が変わる（年・YYMMDD も変わる）", () => {
    expect(jstDateOf(new Date("2026-12-31T14:59:59.999Z"))).toEqual({
      date: "2026-12-31",
      year: 2026,
      yymmdd: "261231",
    });
    expect(jstDateOf(new Date("2026-12-31T15:00:00.000Z"))).toEqual({
      date: "2027-01-01",
      year: 2027,
      yymmdd: "270101",
    });
  });
});

describe("#146 5-1 AC-17 納期の形（caseDueDateSchema）", () => {
  const ok = (value: string) => caseDueDateSchema.safeParse(value).success;

  it.each(["2026-11-17", "2028-02-29", "2026-12-31"])(
    "#146 5-1 AC-17: %s は可",
    (value) => {
      expect(ok(value)).toBe(true);
    },
  );

  it.each([
    ["実在しない日（2月30日）", "2026-02-30"],
    ["うるう年でない2月29日", "2027-02-29"],
    ["13月", "2026-13-01"],
    ["桁が足りない", "2026-2-3"],
    ["区切りが違う", "2026/11/17"],
    ["時刻つき", "2026-11-17T00:00:00Z"],
    ["空", ""],
  ])("#146 5-1 AC-17: %s は不可", (_label, value) => {
    expect(ok(value)).toBe(false);
  });
});
