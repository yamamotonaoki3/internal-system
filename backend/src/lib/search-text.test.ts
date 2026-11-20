// #155（155-A）U-2：検索の索引に入れる本文から、マークダウンの記号を除く部品（shared/search-text.ts）と、一致の位置の部品。
// 置き場所：vitest の対象は backend/**/*.test.ts と frontend/** だけのため、shared/ のテストをここに置く（計画 6章・0.3 軽4）。
// 期待は、要件（4-1 AC-3・C-152(3)「マークダウンの記号を除いた本文」）、ADR-0026 の許可リスト（強調・斜体・取り消し線・コード・コードブロック・
// 引用・箇条書き・番号つきリスト・リンク）、利用者の決定 D-2 の細部（`_` は残す。リンクは表示の文字と URL の両方を残す）から決める。
// 見出し（`#`）は許可リストにない（描画では記号を除いた文字だけが残る）ため、索引でも記号を除いた文字にする（統括への確認の事項）。
//
// 契約（実装前の仮置き。実装の担当へ）：
//   shared/search-text.ts
//     toSearchText(body: string): string … 記号を除いた本文。決定的（同じ入力から必ず同じ出力）
//     findSearchMatches(text: string, term: string): { start: number; end: number }[]
//       … text の中で term に一致する位置（UTF-16 の添字。end は含まない）。左から重ならずに数える。英字（ASCII）の大文字・小文字は区別しない。
//          空の語は [] を返す。サロゲートペアを途中で切らない。
// データは架空（[UNIT_TEST]・example.com）。
import { describe, expect, it } from "vitest";
import { findSearchMatches, toSearchText } from "../../../shared/search-text";

describe("#155 AC-3 U-2 toSearchText：書式の記号を除く", () => {
  it("#155 AC-3 U-2: 記号のない本文は、そのまま返す", () => {
    expect(toSearchText("[UNIT_TEST]見積書を送付します")).toBe(
      "[UNIT_TEST]見積書を送付します",
    );
  });

  it("#155 AC-3 U-2: 太字の ** を除き、記号をまたいだ語がつながる（申**請**手続 → 申請手続）", () => {
    expect(toSearchText("申**請**手続")).toBe("申請手続");
  });

  it("#155 AC-3 U-2: 斜体の * を除く", () => {
    expect(toSearchText("これは*重要*です")).toBe("これは重要です");
  });

  it("#155 AC-3 U-2: 取り消し線の ~~ を除く", () => {
    expect(toSearchText("~~旧価格~~新価格")).toBe("旧価格新価格");
  });

  it("#155 AC-3 U-2: インラインのコードの ` を除く", () => {
    expect(toSearchText("設定は`max_size`です")).toBe("設定はmax_sizeです");
  });

  it("#155 AC-3 U-2: コードブロックの囲み（```）を除き、中の文字は残す", () => {
    const text = toSearchText("前の文\n```\nconst total = 1;\n```\n後の文");
    expect(text).not.toContain("```");
    expect(text).toContain("const total = 1;");
    expect(text).toContain("前の文");
    expect(text).toContain("後の文");
  });

  it("#155 AC-3 U-2: 行頭の引用の > を除く", () => {
    const text = toSearchText("> 引用した文\n返事");
    expect(text).not.toContain(">");
    expect(text).toContain("引用した文");
    expect(text).toContain("返事");
  });

  it("#155 AC-3 U-2: 箇条書きの記号（- と *）・番号つきリストの番号を除く", () => {
    const text = toSearchText("- 項目甲\n* 項目乙\n1. 項目丙\n2. 項目丁");
    for (const marker of ["- ", "* ", "1. ", "2. "])
      expect(text).not.toContain(marker);
    for (const item of ["項目甲", "項目乙", "項目丙", "項目丁"])
      expect(text).toContain(item);
  });

  it("#155 AC-3 U-2: 見出しの # を除く（許可リストにない要素。描画でも文字だけが残る）", () => {
    const text = toSearchText("# 議事録\n本文");
    expect(text).not.toContain("#");
    expect(text).toContain("議事録");
  });

  it("#155 AC-3 U-2 D-2: リンクは、表示の文字と URL の両方を残し、括弧を除く", () => {
    const text = toSearchText("[手順書](https://example.com/docs/a)を見て");
    expect(text).toContain("手順書");
    expect(text).toContain("https://example.com/docs/a");
    expect(text).not.toContain("[");
    expect(text).not.toContain("](");
    expect(text).toContain("を見て");
  });

  it("#155 AC-3 U-2 D-2: _ は残す（識別子 user_id・file_name_v2 を壊さない）", () => {
    expect(toSearchText("user_id と file_name_v2")).toBe(
      "user_id と file_name_v2",
    );
    expect(toSearchText("__init__")).toBe("__init__");
  });

  it("#155 AC-3 U-2: エスケープの \\ を除き、後ろの文字は残す", () => {
    expect(toSearchText("単価\\*2")).toBe("単価*2");
  });

  it("#155 AC-3 U-2: 決定的（同じ本文から必ず同じ結果）", () => {
    const body = "**太字**と[リンク](https://example.com)と`code`";
    expect(toSearchText(body)).toBe(toSearchText(body));
  });
});

describe("#155 AC-3 U-2 findSearchMatches：一致の位置", () => {
  it("#155 AC-3 U-2: 一致の位置を UTF-16 の添字で返す（end は含まない）", () => {
    expect(findSearchMatches("見積書を見積書で", "見積書")).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
    ]);
  });

  it("#155 AC-3 U-2: 英字の大文字・小文字を区別しない", () => {
    expect(findSearchMatches("Invoice INVOICE invoice", "inVOice")).toEqual([
      { start: 0, end: 7 },
      { start: 8, end: 15 },
      { start: 16, end: 23 },
    ]);
  });

  it("#155 AC-3 U-2: 一致しなければ空、空の語も空", () => {
    expect(findSearchMatches("見積書", "請求書")).toEqual([]);
    expect(findSearchMatches("見積書", "")).toEqual([]);
  });

  it("#155 AC-3 U-2: サロゲートペアの文字（𠮷）を1文字として扱い、途中で切らない", () => {
    expect(findSearchMatches("a𠮷b𠮷", "𠮷")).toEqual([
      { start: 1, end: 3 },
      { start: 4, end: 6 },
    ]);
  });

  it("#155 AC-3 U-2: 記号を除いた文の上で探すと、記号をまたぐ一致が見つかる（申**請**手続）", () => {
    expect(findSearchMatches(toSearchText("申**請**手続"), "申請手続")).toEqual(
      [{ start: 0, end: 4 }],
    );
  });

  it("#155 AC-3 U-2: 重ならないように左から数える", () => {
    expect(findSearchMatches("ああああ", "ああ")).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });
});
