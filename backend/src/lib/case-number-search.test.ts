// #155（155-C）4-2 AC-3：案件番号の検索の正規化（shared/case-rules.ts の caseNumberSearchKey）。
// 期待は、要件 C-117・C-120（番号は前方一致・ハイフンなしも一致・大文字小文字を区別しない）と、
//   利用者の決定（2026-11-21：ハイフンは位置に依らず無視する。空白は語の前後だけを除き、途中の空白は保つ）から決める。
// 契約（実装前の仮置き。実装の担当へ）：shared/case-rules.ts に
//   export function caseNumberSearchKey(term: string): string
//     … 前後の空白（全角を含む）を除き、ASCII のハイフン「-」をすべて除き、英字を大文字にした値。何も残らなければ ""（番号の腕を使わない合図）。
// 全角のハイフン・全角の英数字の扱いは決まっていないため、ここでは確かめない（統括に確かめる事項）。
import { describe, expect, it } from "vitest";
import { caseNumberSearchKey } from "../../../shared/case-rules";

describe("#155 4-2 AC-3 案件番号の検索の正規化（caseNumberSearchKey）", () => {
  it.each([
    { term: "QZA-2611", key: "QZA2611" },
    { term: "QZA2611", key: "QZA2611" },
    { term: "qza-2611", key: "QZA2611" },
    { term: "QZ-A26-11", key: "QZA2611" },
    { term: "QZA-261117-0001", key: "QZA2611170001" },
    { term: "-QZA-", key: "QZA" },
    { term: "  QZA-2611  ", key: "QZA2611" },
    { term: "　QZA-2611　", key: "QZA2611" },
  ])("#155 4-2 AC-3: 「$term」は「$key」", ({ term, key }) => {
    expect(caseNumberSearchKey(term)).toBe(key);
  });

  it("#155 4-2 AC-3: 途中の空白は保つ（途中に空白のある語は番号に一致しない）", () => {
    expect(caseNumberSearchKey("QZA 2611")).toBe("QZA 2611");
    expect(caseNumberSearchKey("qza　2611")).toBe("QZA　2611");
  });

  it.each(["-", "--", " - ", "　-　"])(
    "#155 4-2 AC-3: ハイフンと空白だけの語「%s」は空（番号の腕を使わない）",
    (term) => {
      expect(caseNumberSearchKey(term)).toBe("");
    },
  );

  it("#155 4-2 AC-3: 番号でない語も、同じ規則で変える（日本語はそのまま）", () => {
    expect(caseNumberSearchKey("見積-書")).toBe("見積書");
  });
});

// 利用者の決定（2026-11-21。Issue #155 のコメント）：案件番号を全角で打った場合も、半角と同じに扱う。
// 全角の英数字（Ａ〜Ｚ・ａ〜ｚ・０〜９）を半角に直し、ハイフンにあたる文字（- － ー − ‐ – —）を取り除いてから、大文字に直す。
// （以前は「全角は変換しない」を既知の差として固定していた。この決定で置き換えた）
describe("#155 4-2 AC-3 全角で打った番号も、半角と同じキーになる（利用者の決定 2026-11-21）", () => {
  it.each([
    { name: "全角の英字（大文字）", term: "ＱＺＮ-2611", key: "QZN2611" },
    { name: "全角の英字（小文字）", term: "ｑｚｎ-2611", key: "QZN2611" },
    { name: "全角の数字", term: "QZN-２６１１", key: "QZN2611" },
    { name: "全角の英数字すべて", term: "ＱＺＮ２６１１", key: "QZN2611" },
    { name: "全角のハイフン（U+FF0D）", term: "QZN\uFF0D2611", key: "QZN2611" },
    { name: "長音符（U+30FC）", term: "QZN\u30FC2611", key: "QZN2611" },
    { name: "マイナス記号（U+2212）", term: "QZN\u22122611", key: "QZN2611" },
    { name: "ハイフン（U+2010）", term: "QZN\u20102611", key: "QZN2611" },
    { name: "エンダッシュ（U+2013）", term: "QZN\u20132611", key: "QZN2611" },
    { name: "エムダッシュ（U+2014）", term: "QZN\u20142611", key: "QZN2611" },
    {
      name: "全角と半角・各ハイフンの混在",
      term: "ｑＺ\u30FCN２6\uFF0D1\u22121",
      key: "QZN2611",
    },
    {
      name: "番号の全体を全角で",
      term: "ＱＺＮ－２６１１１７－１７１１",
      key: "QZN2611171711",
    },
    {
      name: "前後の全角の空白と全角の番号",
      term: "　ＱＺＮ－２６１１　",
      key: "QZN2611",
    },
  ])("#155 4-2 AC-3: $name「$term」は「$key」", ({ term, key }) => {
    expect(caseNumberSearchKey(term)).toBe(key);
  });

  it.each(["\uFF0D", "\u30FC\u30FC", "\u2212-\u2010", " \u2013\u2014 "])(
    "#155 4-2 AC-3: ハイフンにあたる文字と空白だけの語「%s」は空（番号の腕を使わない）",
    (term) => {
      expect(caseNumberSearchKey(term)).toBe("");
    },
  );

  it("#155 4-2 AC-3: 途中の全角の空白は保つ（途中に空白のある語は番号に一致しない）", () => {
    expect(caseNumberSearchKey("ＱＺＮ　２６１１")).toBe("QZN　2611");
  });
});
