// #134 AC-2（1-5 AC-1・AC-2・AC-4〜AC-7）: メッセージの本文のマークダウンの表示（features/messages/markdown/MarkdownBody.tsx）。
// 契約（実装前の仮置き。計画 plan-134 の「9. マークダウンの描画」・改訂1 の軽微3・ADR-0026・利用者の決定 U-4〜U-6）：
//   export function MarkdownBody({ body }: { body: string })：同期で描画する（動的読み込みは呼び出し側の MessageBody が行う）。
//   根の要素は、固定のクラス markdown-body を持つ外枠。その中の要素には class 属性を付けない（利用者由来の className は捨てる）。
//   描画する要素は p・br・strong・em・del・ul・ol・li・blockquote・code・pre・a だけ。
//   1回の改行は改行（br）として出す（U-5）。記法のない本文は文字を失わない。
//   リンクは target="_blank"・rel に noopener と noreferrer。http:・https:・mailto: の絶対 URL だけをリンクにする。本文中の URL・www.・メールアドレスは記法なしでリンクにする。
//   画像・表・タスクリスト・脚注・生の HTML・許可しない形式のリンク・見出し・区切り線は、書いたままの文字（原文）で出す（U-4）。
//   取り消し線は ~~ だけ。~1つ~ は取り消し線にしない。@名前 は文字のまま（ボタン・リンクを付けない。U-6）。
// 期待値は要件・ADR から書き、本番の定義（ALLOWED_ELEMENTS 等）から作らない。データは架空（example.com・testuser_）。
import { render } from "@testing-library/react";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MarkdownBody } from "./MarkdownBody";

function show(body: string) {
  const rendered = render(<MarkdownBody body={body} />);
  const root = rendered.container.firstElementChild;
  if (root === null) throw new Error("何も描画されていません");
  return { root, unmount: rendered.unmount };
}

/** 外枠の中の文字（br は文字を持たないため、行どうしはつながる） */
const textOf = (root: Element) => root.textContent ?? "";

function expectLink(anchor: Element | null, href: RegExp) {
  expect(anchor).not.toBeNull();
  expect(anchor?.getAttribute("href")).toMatch(href);
  expect(anchor?.getAttribute("target")).toBe("_blank");
  const rel = (anchor?.getAttribute("rel") ?? "").split(/\s+/);
  expect(rel).toContain("noopener");
  expect(rel).toContain("noreferrer");
}

describe("#134 AC-2 外枠（改訂1 の軽微3・ADR-0015）", () => {
  it("#134 AC-2: 根の要素は固定のクラス markdown-body を持つ外枠で、中の要素には class 属性がない", () => {
    const { root } = show(
      "[E2E_TEST]**太字**\n\n- 一つ目\n\n```js\nconst a = 1;\n```",
    );
    expect(root.classList.contains("markdown-body")).toBe(true);
    expect(root.querySelector("strong")).not.toBeNull();
    expect(root.querySelector("pre code")).not.toBeNull();
    expect(root.querySelectorAll("[class]")).toHaveLength(0);
  });

  it("#134 AC-2: 中のどの要素にも style 属性がない（本番の CSP は style-src 'self'）", () => {
    const { root } = show(
      "[E2E_TEST]**太字** *斜体* ~~取り消し~~ `コード`\n\n> 引用\n\n1. 番号",
    );
    expect(root.hasAttribute("style")).toBe(false);
    expect(root.querySelectorAll("[style]")).toHaveLength(0);
  });
});

describe("#134 AC-2（1-5 AC-1）記法のない本文", () => {
  it.each([
    ["日本語の文", "[E2E_TEST]記法のない本文です。よろしくお願いします"],
    ["* が1つ", "[E2E_TEST]価格は 5*3 です"],
    ["_ が単語の中", "[E2E_TEST]file_name_here を見てください"],
    ["# の後に空白がない", "#タグ と C# と F#"],
    ["~ が1つ", "[E2E_TEST]10~20 人"],
    ["記号の混在", "[E2E_TEST]a < b > c & d"],
  ])(
    "#134 AC-2（1-5 AC-1）: %s（%j）は文字を失わずにそのまま出し、整形しない",
    (_label, body) => {
      const { root } = show(body);
      expect(textOf(root)).toBe(body);
      expect(root.querySelector("strong, em, del, h1, h2, h3, a")).toBeNull();
    },
  );

  it("#134 AC-2（1-5 AC-1・U-5）: 1回の改行は改行（br）として出し、各行の文字を順に残す", () => {
    const { root } = show("[E2E_TEST]一行目\n二行目\n三行目");
    expect(root.querySelectorAll("p")).toHaveLength(1);
    expect(root.querySelectorAll("br")).toHaveLength(2);
    expect(textOf(root).replace(/\n/g, "")).toBe(
      "[E2E_TEST]一行目二行目三行目",
    );
  });

  it("#134 AC-2（1-5 AC-1）: 空行で区切った本文は、段落に分けて文字を失わない", () => {
    const { root } = show("[E2E_TEST]段落1\n\n段落2");
    const paragraphs = [...root.querySelectorAll("p")].map(
      (p) => p.textContent,
    );
    expect(paragraphs).toEqual(["[E2E_TEST]段落1", "段落2"]);
  });

  it("#134 AC-2（1-5 AC-1）: 記法の文字を含まない1行の本文は、どんな組み合わせでも文字を失わない（fast-check）", () => {
    const word = fc
      .array(
        fc.constantFrom(
          "a",
          "Z",
          "0",
          "9",
          "あ",
          "ア",
          "漢",
          "字",
          "、",
          "。",
          "テ",
          "ス",
          "ト",
        ),
        { minLength: 1, maxLength: 6 },
      )
      .map((chars) => chars.join(""));
    fc.assert(
      fc.property(fc.array(word, { minLength: 1, maxLength: 6 }), (words) => {
        const body = words.join(" ");
        const { root, unmount } = show(body);
        try {
          return textOf(root) === body;
        } finally {
          unmount();
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe("#134 AC-2（1-5 AC-2）整形する記法", () => {
  it.each([
    ["太字", "**太字の文字**", "strong", "太字の文字"],
    ["斜体（*）", "*斜体の文字*", "em", "斜体の文字"],
    ["斜体（_）", "_斜体の文字_", "em", "斜体の文字"],
    ["取り消し線", "~~取り消しの文字~~", "del", "取り消しの文字"],
    ["インラインコード", "`const a = 1`", "code", "const a = 1"],
    ["引用", "> 引用の文字", "blockquote", "引用の文字"],
  ])(
    "#134 AC-2（1-5 AC-2）: %s は %s として出す",
    (_label, body, selector, text) => {
      const { root } = show(body);
      const element = root.querySelector(selector);
      expect(element).not.toBeNull();
      expect(element?.textContent?.trim()).toBe(text);
      // 記号は表示に残さない
      expect(textOf(root)).not.toMatch(/\*\*|~~|`|^>/);
    },
  );

  it("#134 AC-2（1-5 AC-2）: 箇条書きは ul と li で出す", () => {
    const { root } = show("- 一つ目\n- 二つ目");
    const items = [...root.querySelectorAll("ul > li")].map((li) =>
      li.textContent?.trim(),
    );
    expect(items).toEqual(["一つ目", "二つ目"]);
  });

  it("#134 AC-2（1-5 AC-2）: 番号付きの箇条書きは ol と li で出す", () => {
    const { root } = show("1. 最初\n2. 次");
    const items = [...root.querySelectorAll("ol > li")].map((li) =>
      li.textContent?.trim(),
    );
    expect(items).toEqual(["最初", "次"]);
  });

  it("#134 AC-2（1-5 AC-2）: コードブロックは pre の中の code で出し、中の改行と記号をそのまま残す", () => {
    const { root } = show("```\nconst a = 1;\n**太字ではない**\n```");
    const code = root.querySelector("pre > code");
    expect(code).not.toBeNull();
    expect(code?.textContent).toContain("const a = 1;\n**太字ではない**");
    expect(root.querySelector("pre strong")).toBeNull();
    expect(root.querySelector("pre br")).toBeNull();
  });

  it("#134 AC-2（1-5 AC-2・AC-3）: コードの中の HTML は文字として出す", () => {
    const { root } = show("`<b>太字ではない</b>`");
    expect(root.querySelector("b")).toBeNull();
    expect(root.querySelector("code")?.textContent).toBe("<b>太字ではない</b>");
  });

  it("#134 AC-2（1-5 AC-2）: 記法つきのリンクは a で出す", () => {
    const { root } = show("[例のサイト](https://example.com)");
    const anchor = root.querySelector("a");
    expectLink(anchor, /^https:\/\/example\.com\/?$/);
    expect(anchor?.textContent).toBe("例のサイト");
  });

  it("#134 AC-2（1-5 AC-2）: 複数の記法を組み合わせても、それぞれ整形する", () => {
    const { root } = show(
      "[E2E_TEST]**太字** と *斜体* と ~~取り消し~~ と `コード`",
    );
    expect(root.querySelector("strong")?.textContent).toBe("太字");
    expect(root.querySelector("em")?.textContent).toBe("斜体");
    expect(root.querySelector("del")?.textContent).toBe("取り消し");
    expect(root.querySelector("code")?.textContent).toBe("コード");
  });
});

describe("#134 AC-2（1-5 AC-4）リンク", () => {
  it.each([
    [
      "記法つき",
      "[例](https://example.com/page)",
      /^https:\/\/example\.com\/page$/,
    ],
    [
      "本文中の https の URL",
      "見てください https://example.com/page",
      /^https:\/\/example\.com\/page$/,
    ],
    [
      "本文中の http の URL",
      "http://example.com/page を参照",
      /^http:\/\/example\.com\/page$/,
    ],
    [
      "www. で始まる",
      "www.example.com を参照",
      /^https?:\/\/www\.example\.com\/?$/,
    ],
    ["メールアドレス", "test@example.com に連絡", /^mailto:test@example\.com$/],
    [
      "<> の自動リンク",
      "<https://example.com/page>",
      /^https:\/\/example\.com\/page$/,
    ],
    [
      "mailto の記法",
      "[メール](mailto:test@example.com)",
      /^mailto:test@example\.com$/,
    ],
    [
      "参照形式",
      "[例][r]\n\n[r]: https://example.com/page",
      /^https:\/\/example\.com\/page$/,
    ],
  ])(
    "#134 AC-2（1-5 AC-4）: %s はリンクにし、別のタブで開き rel に noopener・noreferrer を付ける",
    (_label, body, href) => {
      const { root } = show(body);
      const anchors = root.querySelectorAll("a");
      expect(anchors).toHaveLength(1);
      expectLink(anchors[0] ?? null, href);
    },
  );

  it.each([
    ["javascript:", "[押す](javascript:alert(1))"],
    ["大文字の JAVASCRIPT:", "[押す](JAVASCRIPT:alert(1))"],
    ["前後に空白", "[押す]( javascript:alert(1) )"],
    ["文字参照で隠した javascript:", "[押す](&#106;avascript:alert(1))"],
    ["文字参照のタブを挟んだ javascript:", "[押す](java&#x09;script:alert(1))"],
    ["参照形式の javascript:", "[押す][r]\n\n[r]: javascript:alert(1)"],
    ["data:", "[押す](data:text/html,abc)"],
    ["vbscript:", "[押す](vbscript:msgbox(1))"],
    ["相対パス", "[押す](/relative/path)"],
    ["// で始まる", "[押す](//example.com)"],
    ["スキームなしのドメイン", "[押す](example.com)"],
    ["ページ内の #", "[押す](#top)"],
  ])(
    "#134 AC-2（1-5 AC-4）: %s のリンクはリンクにせず、リンクの文字を失わない",
    (_label, body) => {
      const { root } = show(body);
      expect(root.querySelectorAll("a")).toHaveLength(0);
      expect(root.querySelectorAll("[href]")).toHaveLength(0);
      expect(textOf(root)).toContain("押す");
    },
  );

  it("#134 AC-2（1-5 AC-4・U-4）: 許可しない形式のリンクは、書いたままの文字（原文）で出す", () => {
    const { root } = show("[E2E_TEST][押す](javascript:alert(1))");
    expect(root.querySelector("a")).toBeNull();
    expect(textOf(root)).toContain("[押す](javascript:alert(1))");
  });

  it("#134 AC-2（1-5 AC-4）: <javascript:…> の自動リンクはリンクにしない", () => {
    const { root } = show("<javascript:alert(1)>");
    expect(root.querySelectorAll("a")).toHaveLength(0);
    expect(root.querySelectorAll("[href]")).toHaveLength(0);
    expect(textOf(root)).toContain("javascript:alert(1)");
  });
});

describe("#134 AC-2（1-5 AC-5）画像", () => {
  it.each([
    [
      "インライン",
      "![代替の文字](https://example.com/a.png)",
      "![代替の文字](https://example.com/a.png)",
    ],
    [
      "参照形式",
      "![代替の文字][r]\n\n[r]: https://example.com/a.png",
      "![代替の文字][r]",
    ],
    [
      "javascript: の画像",
      "![x](javascript:alert(1))",
      "![x](javascript:alert(1))",
    ],
  ])(
    "#134 AC-2（1-5 AC-5・U-4）: 画像の記法（%s）は img を出さず、書いたままの文字で出す",
    (_label, body, original) => {
      const { root } = show(body);
      expect(root.querySelector("img")).toBeNull();
      expect(textOf(root)).toContain(original);
    },
  );
});

describe("#134 AC-2（1-5 AC-6）整形しない記法", () => {
  it("#134 AC-2（1-5 AC-6）: ~1つ~ は取り消し線にせず、~~2つ~~ は取り消し線にする", () => {
    const { root } = show("[E2E_TEST]~1つ~ と ~~2つ~~");
    const dels = root.querySelectorAll("del");
    expect(dels).toHaveLength(1);
    expect(dels[0]?.textContent).toBe("2つ");
    expect(textOf(root)).toContain("~1つ~");
  });

  it("#134 AC-2（1-5 AC-6・U-4）: 表は table を出さず、各行を書いたままの文字で出す", () => {
    const { root } = show("| a | b |\n| --- | --- |\n| 1 | 2 |");
    expect(root.querySelector("table, thead, tbody, tr, th, td")).toBeNull();
    const text = textOf(root);
    expect(text).toContain("| a | b |");
    expect(text).toContain("| --- | --- |");
    expect(text).toContain("| 1 | 2 |");
  });

  it("#134 AC-2（1-5 AC-6・U-4）: 表の列の寄せ（:---:）でも table・style 属性を出さない", () => {
    const { root } = show("| a | b |\n| :---: | ---: |\n| 1 | 2 |");
    expect(root.querySelector("table, td, th")).toBeNull();
    expect(root.querySelectorAll("[style], [align]")).toHaveLength(0);
    expect(textOf(root)).toContain("| :---: | ---: |");
  });

  it("#134 AC-2（1-5 AC-6・U-4）: タスクリストは input を出さず、[ ]・[x] を文字で出す", () => {
    const { root } = show("- [ ] 未完了の作業\n- [x] 完了の作業");
    expect(root.querySelector("input")).toBeNull();
    const text = textOf(root);
    expect(text).toContain("[ ] 未完了の作業");
    expect(text).toContain("[x] 完了の作業");
  });

  it("#134 AC-2（1-5 AC-6・U-4）: 脚注は sup・section・リンクを出さず、書いたままの文字で出す", () => {
    const { root } = show("本文[^1]\n\n[^1]: 注記の本文");
    expect(root.querySelector("sup, section, a")).toBeNull();
    const text = textOf(root);
    expect(text).toContain("本文[^1]");
    expect(text).toContain("[^1]: 注記の本文");
  });

  it.each([
    ["# 見出し1", "# 見出し1"],
    ["### 見出し3", "### 見出し3"],
    ["###### 見出し6", "###### 見出し6"],
  ])(
    "#134 AC-2（U-4）: 見出し（%s）は h1〜h6 を出さず、# を含めて書いたままの文字で出す",
    (body, original) => {
      const { root } = show(body);
      expect(root.querySelector("h1, h2, h3, h4, h5, h6")).toBeNull();
      expect(textOf(root)).toContain(original);
    },
  );

  it("#134 AC-2（U-4）: 下線形式の見出し（=== の行）も h1・h2 を出さず、=== を文字で出す", () => {
    const { root } = show("見出しの文字\n===");
    expect(root.querySelector("h1, h2")).toBeNull();
    const text = textOf(root);
    expect(text).toContain("見出しの文字");
    expect(text).toContain("===");
  });

  it.each([
    ["---", "前の段落\n\n---\n\n後の段落"],
    ["***", "前の段落\n\n***\n\n後の段落"],
  ])(
    "#134 AC-2（U-4）: 区切り線（%s）は hr を出さず、書いたままの文字で出す",
    (mark, body) => {
      const { root } = show(body);
      expect(root.querySelector("hr")).toBeNull();
      const text = textOf(root);
      expect(text).toContain("前の段落");
      expect(text).toContain(mark);
      expect(text).toContain("後の段落");
    },
  );

  it("#134 AC-2（U-4）: 生の HTML は HTML として解釈せず、書いたままの文字で出す", () => {
    const { root } = show("[E2E_TEST]<b>太字ではない</b>");
    expect(root.querySelector("b")).toBeNull();
    expect(textOf(root)).toContain("<b>太字ではない</b>");
  });
});

describe("#134 AC-2（1-5 AC-7・U-6）メンション", () => {
  it("#134 AC-2（1-5 AC-7・U-6）: @名前 は文字のまま出し、ボタン・リンクを付けない", () => {
    const { root } = show("@testuser_001 さん、確認をお願いします");
    expect(root.querySelector("a, button")).toBeNull();
    expect(textOf(root)).toBe("@testuser_001 さん、確認をお願いします");
  });
});
