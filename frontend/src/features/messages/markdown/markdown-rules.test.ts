// #134 AC-2（1-5 AC-3・AC-4・AC-8）: マークダウンの許可リスト（features/messages/markdown/markdown-rules.ts）。
// 契約（実装前の仮置き。計画 plan-134 の「9. マークダウンの描画」・ADR-0026）：
//   ALLOWED_ELEMENTS：描画してよい要素の名前（小文字）の読み取り専用の配列。p・br・strong・em・del・ul・ol・li・blockquote・code・pre・a の12個だけ
//   isAllowedUrl(url: string): boolean：new URL() で絶対 URL として解釈でき、スキームが http:・https:・mailto: のものだけ true。
//     相対 URL・// で始まるもの・javascript:・data:・vbscript: などは false。大文字・空白・制御文字を混ぜた形も、解釈した後のスキームで判定する
// 期待値は本番の定義から作らず、ADR-0026 の一覧をここに独立に書く。データは架空（example.com）。
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ALLOWED_ELEMENTS, isAllowedUrl } from "./markdown-rules";

describe("#134 AC-2（1-5 AC-3・AC-8）描画してよい要素", () => {
  it("#134 AC-2（1-5 AC-3）: 許す要素は p・br・strong・em・del・ul・ol・li・blockquote・code・pre・a の12個だけ（ADR-0026）", () => {
    expect([...ALLOWED_ELEMENTS].sort()).toEqual(
      [
        "a",
        "blockquote",
        "br",
        "code",
        "del",
        "em",
        "li",
        "ol",
        "p",
        "pre",
        "strong",
        "ul",
      ].sort(),
    );
  });

  it.each([
    "script",
    "img",
    "iframe",
    "style",
    "svg",
    "table",
    "input",
    "sup",
    "section",
    "h1",
    "h6",
    "hr",
    "div",
    "span",
  ])("#134 AC-2（1-5 AC-3・AC-5・AC-6）: %s は許す要素に含まない", (name) => {
    expect(ALLOWED_ELEMENTS).not.toContain(name);
  });
});

describe("#134 AC-2（1-5 AC-4）リンクとして扱う URL", () => {
  it.each([
    "https://example.com",
    "https://example.com/path?q=1#top",
    "http://example.com",
    "http://www.example.com/",
    "mailto:test@example.com",
    "HTTPS://EXAMPLE.COM",
    "Mailto:test@example.com",
  ])("#134 AC-2（1-5 AC-4）: %s は通す", (url) => {
    expect(isAllowedUrl(url)).toBe(true);
  });

  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["大文字の JAVASCRIPT:", "JAVASCRIPT:alert(1)"],
    ["大文字小文字の混在", "JaVaScRiPt:alert(1)"],
    ["前に空白", " javascript:alert(1)"],
    ["前に制御文字", "\u0001javascript:alert(1)"],
    ["途中にタブ", "java\tscript:alert(1)"],
    ["途中に改行", "java\nscript:alert(1)"],
    ["文字参照のまま（解釈前）", "javascript&#58;alert(1)"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
    ["data: の画像", "data:image/png;base64,AAAA"],
    ["vbscript:", "vbscript:msgbox(1)"],
    ["file:", "file:///C:/test.txt"],
    ["ftp:", "ftp://example.com/a.txt"],
    ["相対パス", "/relative/path"],
    ["相対（名前だけ）", "relative"],
    ["相対（./）", "./a"],
    ["// で始まる", "//example.com"],
    ["スキームなしのドメイン", "example.com"],
    ["空", ""],
    ["空白だけ", "   "],
  ])("#134 AC-2（1-5 AC-4）: %s（%j）は通さない", (_label, url) => {
    expect(isAllowedUrl(url)).toBe(false);
  });

  it("#134 AC-2（1-5 AC-4）: どんな文字列でも例外を投げず、true を返すのは http:・https:・mailto: として解釈できるものだけ（fast-check）", () => {
    const pieces = fc.constantFrom(
      "javascript:",
      "JAVASCRIPT:",
      "data:",
      "vbscript:",
      "http:",
      "https:",
      "mailto:",
      "//",
      "/",
      ":",
      " ",
      "\t",
      "\n",
      "\u0000",
      "&#58;",
      "%3A",
      "example.com",
      "alert(1)",
      "a",
      "@",
    );
    fc.assert(
      fc.property(
        fc.array(pieces, { maxLength: 8 }).map((p) => p.join("")),
        (url) => {
          const result = isAllowedUrl(url);
          if (!result) return true;
          // true なら、ブラウザと同じ解釈で、許可したスキームの絶対 URL である
          const parsed = new URL(url);
          return ["http:", "https:", "mailto:"].includes(parsed.protocol);
        },
      ),
      { numRuns: 500 },
    );
  });
});
