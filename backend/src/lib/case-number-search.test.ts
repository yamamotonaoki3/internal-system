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

// 既知の差（統括の決定 2026-11-21。扱いは利用者に確認中）：利用者の決定は半角だけを扱う（ASCII の「-」を除き、ASCII の英字の大小を無視する）。
// 全角のハイフン類（－ ー ―）・全角の英数字（ＱＺＮ・２６１１）は変換しない。いまの決まりとして固定し、決まりが変わったらこの事例を置き換える。
describe("#155 4-2 AC-3 既知の差（利用者に確認中）：全角の文字は変換しない", () => {
  it.each([
    { term: "QZN－2611", key: "QZN－2611" },
    { term: "QZNー2611", key: "QZNー2611" },
    { term: "QZN―2611", key: "QZN―2611" },
    { term: "ＱＺＮ-2611", key: "ＱＺＮ2611" },
    { term: "QZN-２６１１", key: "QZN２６１１" },
  ])(
    "#155 4-2 AC-3 既知の差: 「$term」の全角の文字は残る（「$key」。ASCII の - だけを除く）",
    ({ term, key }) => {
      expect(caseNumberSearchKey(term)).toBe(key);
    },
  );
});
