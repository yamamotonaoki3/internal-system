// #155（155-A）U-1：検索語の組み立て（backend/src/lib/search-query.ts）。
// 期待は、計画 4.4（句として引用・"" の重ね・3文字以上はコードポイントで数えて MATCH、未満は instr）、T-0 の結果（句の引用で構文の文字が無害になる）、
// 利用者の決定 D-3（1〜2文字は instr）・D-6（空白を含む語は1つの句）から決める。境目の 3 は、本番の定数から作らず仕様の数字で持つ。
//
// 契約（実装前の仮置き。実装の担当へ）：
//   backend/src/lib/search-query.ts
//     toFtsPhrase(term: string): string … 語全体を " で囲み、中の " を "" にした1つの句（バインドで渡す値）
//     searchMethodOf(term: string): "match" | "instr" … コードポイント数が 3 以上なら "match"、未満なら "instr"
//     buildExcerpt(text: string, term: string): string … text（記号を除いた本文）の中から、最初の一致を含む連続した部分を切り出す。
//       text が短ければ全体。長ければ text より短い部分。サロゲートペアを途中で切らない。一致がなければ先頭の部分。
//   shared/search-rules.ts
//     SEARCH_TRIGRAM_MIN_CODE_POINTS = 3
// データは架空（[UNIT_TEST]）。
import { describe, expect, it } from "vitest";
import { SEARCH_TRIGRAM_MIN_CODE_POINTS } from "../../../shared/search-rules";
import { findSearchMatches } from "../../../shared/search-text";
import { buildExcerpt, searchMethodOf, toFtsPhrase } from "./search-query";

const hasLoneSurrogate = (text: string) =>
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(
    text,
  );

describe("#155 AC-3 U-1 toFtsPhrase：句として引用する", () => {
  it('#155 AC-3 U-1: 語全体を " で囲む', () => {
    expect(toFtsPhrase("見積書")).toBe('"見積書"');
  });

  it('#155 AC-3 U-1: 中の " は "" に重ねる', () => {
    expect(toFtsPhrase('say "hi"')).toBe('"say ""hi"""');
  });

  it("#155 AC-3 U-1 D-6: 空白・構文の語（AND・OR・NOT・NEAR・*・^・:・かっこ）を含んでも、1つの句のまま", () => {
    expect(toFtsPhrase("this AND that")).toBe('"this AND that"');
    expect(toFtsPhrase("a* ^b :c (d) NEAR e OR f NOT g")).toBe(
      '"a* ^b :c (d) NEAR e OR f NOT g"',
    );
  });
});

describe("#155 AC-3 U-1 searchMethodOf：MATCH と instr の切り替え（コードポイントで数える）", () => {
  it("#155 AC-3 U-1: 境目の定数は 3（仕様の数字）", () => {
    expect(SEARCH_TRIGRAM_MIN_CODE_POINTS).toBe(3);
  });

  it("#155 AC-3 U-1 D-3: 1文字・2文字は instr、3文字は match", () => {
    expect(searchMethodOf("見")).toBe("instr");
    expect(searchMethodOf("見積")).toBe("instr");
    expect(searchMethodOf("見積書")).toBe("match");
    expect(searchMethodOf("ab")).toBe("instr");
    expect(searchMethodOf("abc")).toBe("match");
  });

  it("#155 AC-3 U-1: サロゲートペアは1文字と数える（UTF-16 では 4 単位の 𠮷𠮷 は 2 文字で instr、𠮷𠮷𠮷 は match）", () => {
    expect("𠮷𠮷".length).toBe(4);
    expect(searchMethodOf("𠮷𠮷")).toBe("instr");
    expect(searchMethodOf("𠮷𠮷𠮷")).toBe("match");
  });

  it("#155 AC-3 U-1: 結合文字は正規化せず、コードポイントのまま数える（か＋濁点の結合文字は 2 で instr）", () => {
    expect(searchMethodOf("が")).toBe("instr");
    expect(searchMethodOf("がか")).toBe("match");
  });
});

describe("#155 AC-3 U-1 buildExcerpt：抜粋の切り出し", () => {
  it("#155 AC-3 U-1: 短い本文は、全体を返す", () => {
    expect(buildExcerpt("[UNIT_TEST]見積書を送付します", "見積書")).toBe(
      "[UNIT_TEST]見積書を送付します",
    );
  });

  it("#155 AC-3 U-1: 長い本文では、一致を含む、本文より短い連続した部分を返す（後ろの一致）", () => {
    const text = `${"あ".repeat(500)}見積書${"い".repeat(500)}`;
    const excerpt = buildExcerpt(text, "見積書");
    expect(excerpt).toContain("見積書");
    expect(excerpt.length).toBeLessThan(text.length);
    expect(text).toContain(excerpt);
  });

  it("#155 AC-3 U-1: 長い本文の先頭の一致・末尾の一致も、抜粋に入る", () => {
    const head = `見積書${"あ".repeat(800)}`;
    const tail = `${"あ".repeat(800)}見積書`;
    expect(buildExcerpt(head, "見積書")).toContain("見積書");
    expect(buildExcerpt(tail, "見積書")).toContain("見積書");
    expect(head).toContain(buildExcerpt(head, "見積書"));
    expect(tail).toContain(buildExcerpt(tail, "見積書"));
  });

  it("#155 AC-3 U-1: 英字の大文字・小文字が違っても、一致の場所で切り出す", () => {
    const text = `${"x".repeat(800)}INVOICE${"y".repeat(800)}`;
    expect(buildExcerpt(text, "invoice")).toContain("INVOICE");
  });

  it("#155 AC-3 U-1: サロゲートペアを途中で切らない（どこで切っても孤立した代理の単位を残さない）", () => {
    const text = `${"𠮷".repeat(400)}見積書${"𠮷".repeat(400)}`;
    const excerpt = buildExcerpt(text, "見積書");
    expect(excerpt).toContain("見積書");
    expect(hasLoneSurrogate(excerpt)).toBe(false);
    for (let pad = 0; pad < 4; pad += 1) {
      const shifted = `${"a".repeat(pad)}${text}`;
      expect(hasLoneSurrogate(buildExcerpt(shifted, "見積書"))).toBe(false);
    }
  });
});

describe("#155 AC-3 U-1 buildExcerpt：長い語（コードレビュー1回目の軽微）", () => {
  // 抜粋の上限（120 コードポイント）は変えない。語が 81〜100 コードポイントでも、一致の全体が抜粋に入り、強調の範囲が取れること
  const lengths = [80, 81, 100];
  const placements = {
    途中: (term: string) => `${"あ".repeat(500)}${term}${"い".repeat(500)}`,
    先頭: (term: string) => `${term}${"い".repeat(500)}`,
    末尾: (term: string) => `${"あ".repeat(500)}${term}`,
  } as const;
  for (const length of lengths)
    for (const [where, make] of Object.entries(placements))
      it(`#155 AC-3 U-1: ${String(length)} コードポイントの語が本文の${where}にあるとき、抜粋は一致の全体を含み、120 コードポイント以内`, () => {
        const term = "ほ".repeat(length);
        const text = make(term);
        const excerpt = buildExcerpt(text, term);
        expect(excerpt).toContain(term);
        expect([...excerpt].length).toBeLessThanOrEqual(120);
        expect(text).toContain(excerpt);
        expect(findSearchMatches(excerpt, term).length).toBeGreaterThanOrEqual(
          1,
        );
      });
});

describe("#155 AC-3 U-1 toFtsPhrase：NUL（コードレビュー1回目の軽微）", () => {
  it("#155 AC-3 U-1: NUL を含む語は句にしない（呼び出し側の誤りとして投げる。API は 422 で先に拒否する）", () => {
    for (const term of ["\u0000abc", "ab\u0000c", "abc\u0000"])
      expect(() => toFtsPhrase(term)).toThrow();
  });
});
