// #134 AC-2（1-5 AC-3・AC-4・AC-8）: 本文に HTML・スクリプト・危険なリンクを書いても、実行される要素・属性を出さない（MarkdownBody）。
// 契約（実装前の仮置き。計画 plan-134 の「9. マークダウンの描画」・ADR-0026）：
//   MarkdownBody は、外枠（class="markdown-body"）の中に p・br・strong・em・del・ul・ol・li・blockquote・code・pre・a だけを出す。
//   a の属性は href・target・rel だけ。ol は番号の始まり（start）を持ってよい。ほかの要素は属性を持たない（class・style・on* を出さない）。
//   a の href は、http:・https:・mailto: の絶対 URL だけ。生の HTML は文字として出す（U-4）。dangerouslySetInnerHTML を使わない。
// 期待値（許す要素・属性の一覧）は、ADR-0026 から独立に書く（本番の定義から作らない）。データは架空（example.com）。
import { render } from "@testing-library/react";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MarkdownBody } from "./MarkdownBody";

const SAFE_TAGS = new Set([
  "P",
  "BR",
  "STRONG",
  "EM",
  "DEL",
  "UL",
  "OL",
  "LI",
  "BLOCKQUOTE",
  "CODE",
  "PRE",
  "A",
]);
const ANCHOR_ATTRIBUTES = new Set(["href", "target", "rel"]);
const SAFE_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/** 外枠そのものの問題（固定のクラス・style 属性・on* 属性） */
function rootProblems(root: Element): string[] {
  const problems: string[] = [];
  if (!root.classList.contains("markdown-body"))
    problems.push("外枠が markdown-body ではない");
  if (root.hasAttribute("style")) problems.push("外枠に style 属性");
  for (const attribute of root.getAttributeNames())
    if (attribute.startsWith("on")) problems.push(`外枠に ${attribute}`);
  return problems;
}

/** 要素の名前と属性が許可リストの中か（a は href・target・rel、ol は start だけ。ほかは属性なし） */
function elementProblems(element: Element): string[] {
  const problems: string[] = [];
  if (!SAFE_TAGS.has(element.tagName))
    problems.push(`許さない要素 ${element.tagName}`);
  for (const name of element.getAttributeNames()) {
    const allowed =
      element.tagName === "A"
        ? ANCHOR_ATTRIBUTES.has(name)
        : element.tagName === "OL" && name === "start";
    if (!allowed) problems.push(`${element.tagName} の属性 ${name}`);
  }
  return problems;
}

/** href が、許可したスキームの絶対 URL か */
function hrefProblems(href: string): string[] {
  let scheme: string;
  try {
    scheme = new URL(href).protocol;
  } catch {
    return [`絶対 URL でない href ${JSON.stringify(href)}`];
  }
  return SAFE_SCHEMES.has(scheme) ? [] : [`許さないスキーム ${scheme}`];
}

/** リンクの href・target・rel */
function anchorProblems(anchor: Element): string[] {
  const problems = hrefProblems(anchor.getAttribute("href") ?? "");
  if (anchor.getAttribute("target") !== "_blank")
    problems.push("target が _blank でない");
  const rel = (anchor.getAttribute("rel") ?? "").split(/\s+/);
  if (!rel.includes("noopener") || !rel.includes("noreferrer"))
    problems.push("rel に noopener・noreferrer がない");
  return problems;
}

/** 外枠の中に、許す要素・属性・URL 以外が無いかを調べ、問題の一覧を返す（空なら安全） */
function findProblems(root: Element): string[] {
  const problems = rootProblems(root);
  for (const element of root.querySelectorAll("*")) {
    problems.push(...elementProblems(element));
    if (element.tagName === "A") problems.push(...anchorProblems(element));
  }
  return problems;
}

function show(body: string) {
  const rendered = render(<MarkdownBody body={body} />);
  const root = rendered.container.firstElementChild;
  if (root === null) throw new Error("何も描画されていません");
  return { root, unmount: rendered.unmount };
}

const PAYLOADS = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  '<iframe src="https://example.com"></iframe>',
  "<style>body{display:none}</style>",
  "<svg onload=alert(1)>",
  "<svg><script>alert(1)</script></svg>",
  '<a href="javascript:alert(1)">押す</a>',
  '<div style="color:red" onclick="alert(1)">押す</div>',
  '<details open ontoggle="alert(1)">x</details>',
  "<math><mtext><img src=x onerror=alert(1)></mtext></math>",
  '<object data="javascript:alert(1)"></object>',
  '<embed src="javascript:alert(1)">',
  '<form action="javascript:alert(1)"><button>送る</button></form>',
  '<input autofocus onfocus="alert(1)">',
  '<base href="javascript:alert(1)//">',
  '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
  '<link rel="stylesheet" href="https://example.com/a.css">',
  "<!-- コメント --><script>alert(1)</script>",
];

describe("#134 AC-2（1-5 AC-3・AC-8）HTML・スクリプトを書いても実行されない", () => {
  it.each(PAYLOADS)(
    "#134 AC-2（1-5 AC-3）: %s は危険な要素・属性を出さず、書いたままの文字で出す（U-4）",
    (payload) => {
      const { root } = show(`[E2E_TEST]${payload}`);
      expect(findProblems(root)).toEqual([]);
      expect(
        root.querySelector(
          "script, img, iframe, style, svg, object, embed, form, input, base, meta, link, details, math, div, span",
        ),
      ).toBeNull();
      expect(root.textContent).toContain(payload);
    },
  );

  it.each(PAYLOADS)(
    "#134 AC-2（1-5 AC-3）: 段落の途中に書いた %s も、危険な要素・属性を出さない",
    (payload) => {
      const { root } = show(`前の文 ${payload} 後の文`);
      expect(findProblems(root)).toEqual([]);
      expect(root.textContent).toContain(payload);
    },
  );

  it.each([
    "[押す](javascript:alert(1))",
    '[押す](javascript:alert(1) "題")',
    "[押す](JaVaScRiPt:alert(1))",
    "[押す](&#x6A;avascript:alert(1))",
    "[押す](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
    "[押す](vbscript:msgbox(1))",
    "[押す][r]\n\n[r]: javascript:alert(1)",
    "<javascript:alert(1)>",
    "![x](javascript:alert(1))",
    "[![x](https://example.com/a.png)](javascript:alert(1))",
    "**[押す](javascript:alert(1))**",
    "> [押す](javascript:alert(1))",
    "- [押す](javascript:alert(1))",
  ])(
    "#134 AC-2（1-5 AC-4）: 危険なリンク %j を、リンク・画像にしない",
    (body) => {
      const { root } = show(body);
      expect(findProblems(root)).toEqual([]);
      expect(root.querySelector("a, img")).toBeNull();
    },
  );

  it("#134 AC-2（1-5 AC-3）: 属性の付いた記法（{.class}・{style=…}）を書いても、class・style 属性を出さない", () => {
    const { root } = show(
      '**太字**{.danger style="color:red"}\n\n```js {style="color:red"}\nconst a = 1;\n```',
    );
    expect(findProblems(root)).toEqual([]);
  });
});

describe("#134 AC-2（1-5 AC-3・AC-4・AC-8）ランダムな本文（fast-check）", () => {
  // マークダウン・HTML・URL の断片を並べ、記法の組み合わせの漏れを探す
  const fragment = fc.constantFrom(
    "<",
    ">",
    "</",
    "/>",
    "script",
    "img",
    "svg",
    "iframe",
    "style",
    " src=x",
    " onerror=alert(1)",
    " onload=alert(1)",
    ' style="color:red"',
    ' class="x"',
    "javascript:",
    "JaVaScRiPt:",
    "&#106;",
    "&#x3A;",
    "data:text/html,",
    "vbscript:",
    "https://example.com",
    "http://example.com/a?b=c",
    "www.example.com",
    "test@example.com",
    "mailto:test@example.com",
    "//example.com",
    "[",
    "]",
    "(",
    ")",
    "![",
    "](",
    "[^1]",
    "[^1]: ",
    "*",
    "**",
    "_",
    "~",
    "~~",
    "`",
    "```",
    "#",
    "# ",
    "-",
    "- ",
    "1. ",
    "> ",
    "|",
    "| --- |",
    "[ ] ",
    "[x] ",
    "---",
    "===",
    "\n",
    "\n\n",
    " ",
    "\t",
    '"',
    "'",
    "=",
    "{",
    "}",
    "あ",
    "[E2E_TEST]",
  );

  it("#134 AC-2（1-5 AC-3・AC-4）: どんな組み合わせでも、許す要素・属性以外を出さず、すべてのリンクは許可したスキームで別のタブ・noopener・noreferrer", () => {
    fc.assert(
      fc.property(
        fc.array(fragment, { minLength: 1, maxLength: 30 }),
        (parts) => {
          const { root, unmount } = show(parts.join(""));
          try {
            const problems = findProblems(root);
            if (problems.length > 0)
              throw new Error(
                `${JSON.stringify(parts.join(""))}: ${problems.join(", ")}`,
              );
            return true;
          } finally {
            unmount();
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("#134 AC-2（1-5 AC-3）: どんな文字列（Unicode を含む）でも、描画が例外を投げず、許す要素・属性以外を出さない", () => {
    fc.assert(
      fc.property(fc.string({ unit: "grapheme", maxLength: 200 }), (body) => {
        const { root, unmount } = show(body);
        try {
          return findProblems(root).length === 0;
        } finally {
          unmount();
        }
      }),
      { numRuns: 200 },
    );
  });
});
