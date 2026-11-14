// #134 AC-2（1-5 AC-4〜AC-6・U-4・U-5）: 許可しない記法を書いたままの文字（原文）に戻す remark プラグイン（remark-restrict.ts）を、MarkdownBody を通して確かめる。
// 既存の MarkdownBody.test.tsx が見ていない、次の経路を足す（全体のミューテーションで生き残った変異体の検出）：
//   タスクリストの印の書いたままの文字（大文字の [X]・入れ子・本文に [a] を含む・[-] はタスクリストではない・本文のない項目）
//   参照形式のリンクの定義が重なったとき（最初の定義を使う。CommonMark・mdast-util-to-hast と同じ）
//   見出し・区切り線・表・脚注・生の HTML が、ブロックの親（根・引用・リストの項目）の中にあるとき、それぞれ別の段落（行）として出し、隣とつなげない
//   生の HTML のブロックの中の改行は、改行（br）として出す（U-5）。文の中（インライン）の生の HTML は、同じ段落の中に出す
// 期待値は ADR-0026・利用者の決定 U-4・U-5 から書き、本番の定義から作らない。データは架空（example.com・[E2E_TEST]）。
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownBody } from "./MarkdownBody";

function show(body: string) {
  const rendered = render(<MarkdownBody body={body} />);
  const root = rendered.container.firstElementChild;
  if (root === null) throw new Error("何も描画されていません");
  return root;
}

const textOf = (element: Element | null | undefined) =>
  element?.textContent ?? "";
/** 要素の中の段落（p）の文字の並び（前後の空白は除く） */
const paragraphs = (element: Element | null) =>
  [...(element?.querySelectorAll("p") ?? [])].map((p) =>
    (p.textContent ?? "").trim(),
  );

describe("#134 AC-2（1-5 AC-6・U-4）タスクリストの印を、書いたままの文字で出す", () => {
  it("#134 AC-2（1-5 AC-6・U-4）: 大文字の [X] は、小文字に替えずに [X] のまま出し、input を出さない", () => {
    const root = show("- [X] [E2E_TEST]大文字の印の作業");
    expect(root.querySelector("input")).toBeNull();
    expect(textOf(root.querySelector("li")).trim()).toBe(
      "[X] [E2E_TEST]大文字の印の作業",
    );
  });

  it("#134 AC-2（1-5 AC-6・U-4）: 本文に [a] を含む項目でも、印は書いた [ ] のまま出し、本文の [a] を印にしない", () => {
    const root = show("- [ ] 作業[a]メモ");
    expect(root.querySelector("input")).toBeNull();
    expect(textOf(root.querySelector("li")).trim()).toBe("[ ] 作業[a]メモ");
  });

  it("#134 AC-2（1-5 AC-6・U-4）: 入れ子のタスクリストも、親と子のそれぞれの印を書いたままの文字で出す", () => {
    const root = show(
      "- [ ] 親の作業\n  - [x] 子の作業\n  - [X] 2つ目の子の作業",
    );
    expect(root.querySelector("input")).toBeNull();
    const items = [...root.querySelectorAll("li li")].map((li) =>
      textOf(li).trim(),
    );
    expect(items).toEqual(["[x] 子の作業", "[X] 2つ目の子の作業"]);
    const parent = root.querySelector("li");
    expect(textOf(parent)).toMatch(/^\s*\[ \] 親の作業/);
    // 親の印は1つだけ（子の印を親に重ねない）
    expect(textOf(parent).match(/\[ \]/g)).toHaveLength(1);
  });

  it.each([
    ["[-]", "- [-] 保留の作業", "[-] 保留の作業"],
    ["[o]", "- [o] 別の印の作業", "[o] 別の印の作業"],
  ])(
    "#134 AC-2（1-5 AC-6）: %s はタスクリストの印ではないので、そのままの文字の箇条書きで出す",
    (_label, body, expected) => {
      const root = show(body);
      expect(root.querySelector("input")).toBeNull();
      expect(textOf(root.querySelector("li")).trim()).toBe(expected);
    },
  );

  it.each([
    ["[ ]", "- [ ]", "[ ]"],
    ["[x]", "- [x]", "[x]"],
  ])(
    "#134 AC-2（1-5 AC-6・U-4）: 本文のない項目（%s だけ）も、input を出さず、書いたままの文字で出す",
    (_label, body, expected) => {
      const root = show(body);
      expect(root.querySelector("input")).toBeNull();
      expect(textOf(root.querySelector("li")).trim()).toBe(expected);
    },
  );
});

describe("#134 AC-2（1-5 AC-4）参照形式のリンクの定義", () => {
  it("#134 AC-2（1-5 AC-4）: 同じ名前の定義が2つあるときは最初の定義を使う（最初が https なら、後の javascript: に替えずにリンクにする）", () => {
    const root = show(
      "[例][r]\n\n[r]: https://example.com/first\n[r]: javascript:alert(1)",
    );
    const anchors = root.querySelectorAll("a");
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.getAttribute("href")).toBe("https://example.com/first");
    expect(anchors[0]?.textContent).toBe("例");
  });

  it("#134 AC-2（1-5 AC-4・U-4）: 同じ名前の定義が2つあり、最初が javascript: なら、後の https で上書きせず、リンクにせずに書いたままの文字で出す", () => {
    const root = show(
      "[押す][r]\n\n[r]: javascript:alert(1)\n[r]: https://example.com/second",
    );
    expect(root.querySelectorAll("a")).toHaveLength(0);
    expect(root.querySelectorAll("[href]")).toHaveLength(0);
    expect(textOf(root)).toContain("[押す][r]");
  });

  it("#134 AC-2（1-5 AC-4）: 名前の大文字・小文字が違う参照も同じ定義として扱い、https の定義ならリンクにする", () => {
    const root = show("[例][REF]\n\n[ref]: https://example.com/page");
    const anchors = root.querySelectorAll("a");
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.getAttribute("href")).toBe("https://example.com/page");
  });
});

describe("#134 AC-2（U-4・U-5）原文に戻すブロックの記法は、それぞれ別の段落で出し、隣の行とつなげない", () => {
  it("#134 AC-2（U-4）: 根に続けて書いた見出し2つは、# を含めて別々の段落で出す", () => {
    const root = show("# 見出し1\n# 見出し2");
    expect(root.querySelector("h1, h2")).toBeNull();
    expect(paragraphs(root)).toEqual(["# 見出し1", "# 見出し2"]);
  });

  it("#134 AC-2（U-4）: 引用の中に続けて書いた見出し2つも、引用の中の別々の段落で出す", () => {
    const root = show("> # 見出し1\n> # 見出し2");
    expect(root.querySelector("h1, h2")).toBeNull();
    const quote = root.querySelector("blockquote");
    expect(quote).not.toBeNull();
    expect(paragraphs(quote)).toEqual(["# 見出し1", "# 見出し2"]);
  });

  it("#134 AC-2（U-4）: 空行で区切った箇条書きの項目の中の見出し2つも、項目の中の別々の段落で出す", () => {
    const root = show("- # 見出しA\n  # 見出しB\n\n- 次の項目");
    expect(root.querySelector("h1, h2")).toBeNull();
    const first = root.querySelector("li");
    expect(paragraphs(first)).toEqual(["# 見出しA", "# 見出しB"]);
  });

  it("#134 AC-2（U-4）: 箇条書きの項目の中の区切り線は、hr を出さず、項目の中の段落で --- を出す", () => {
    const root = show("- 項目の本文\n\n  ---\n\n- 次の項目");
    expect(root.querySelector("hr")).toBeNull();
    expect(paragraphs(root.querySelector("li"))).toEqual(["項目の本文", "---"]);
  });

  it("#134 AC-2（1-5 AC-6・U-4）: 引用の中の表は、table を出さず、引用の中の段落で各行を書いたままの文字で出す", () => {
    const root = show("> | a | b |\n> | --- | --- |\n> | 1 | 2 |");
    expect(root.querySelector("table, tr, td, th")).toBeNull();
    const quote = root.querySelector("blockquote");
    const lines = paragraphs(quote);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("| a | b |");
    expect(lines[0]).toContain("| 1 | 2 |");
    // 表の行の区切りは、改行（br）として出す（U-5）
    expect(quote?.querySelectorAll("p br").length).toBeGreaterThanOrEqual(2);
  });

  it("#134 AC-2（1-5 AC-6・U-4）: 引用の中の脚注は、sup・section を出さず、参照と定義を引用の中の別々の段落で出す", () => {
    const root = show("> 本文[^1]\n>\n> [^1]: 注記の本文");
    expect(root.querySelector("sup, section, a")).toBeNull();
    const quote = root.querySelector("blockquote");
    expect(paragraphs(quote)).toEqual(["本文[^1]", "[^1]: 注記の本文"]);
  });

  it("#134 AC-2（U-4・U-5）: 生の HTML のブロックは、1つの段落で書いたままの文字で出し、中の改行を改行（br）にする", () => {
    const root = show("<div>\n[E2E_TEST]一行目\n</div>");
    expect(root.querySelector("div")).toBeNull();
    const lines = root.querySelectorAll("p");
    expect(lines).toHaveLength(1);
    expect(lines[0]?.querySelectorAll("br")).toHaveLength(2);
    // br の後ろに入る改行の文字は、表示に影響しないので除いて比べる
    expect(textOf(lines[0]).replace(/\n/g, "")).toBe(
      "<div>[E2E_TEST]一行目</div>",
    );
  });

  it("#134 AC-2（U-4）: 引用の中の生の HTML のブロックも、引用の中の段落で書いたままの文字で出す", () => {
    const root = show("> <div>引用の中</div>");
    expect(root.querySelector("blockquote div")).toBeNull();
    expect(paragraphs(root.querySelector("blockquote"))).toEqual([
      "<div>引用の中</div>",
    ]);
  });

  it("#134 AC-2（U-4）: 文の中に書いた生の HTML は、前後の文と同じ1つの段落の中に書いたままの文字で出す", () => {
    const root = show("前の文<b>太字ではない</b>後の文");
    expect(root.querySelector("b")).toBeNull();
    expect(paragraphs(root)).toEqual(["前の文<b>太字ではない</b>後の文"]);
  });
});

// 利用者の決定（2026-11-14、Issue #134）：参照形式のリンクの定義の行（[r]: …）は、本文の参照が許可した URL のリンクになったときだけ隠す（書式の標準どおり）。
// どこからも使われていない定義の行と、許可しない URL（javascript:・data:・相対など）の定義の行は、書いたままの文字で出す（U-4：書いた内容を失わない）。
describe("#134 AC-2（1-5 AC-4・U-4）参照形式のリンクの定義の行の表示（2026-11-14 の利用者の決定）", () => {
  /** 外枠の中に、許す要素・属性以外がないか（a は href・target・rel、ol は start だけ） */
  function unsafeParts(root: Element): string[] {
    const allowed = new Set(
      "P BR STRONG EM DEL UL OL LI BLOCKQUOTE CODE PRE A".split(" "),
    );
    const problems: string[] = [];
    for (const element of root.querySelectorAll("*")) {
      if (!allowed.has(element.tagName)) problems.push(element.tagName);
      for (const name of element.getAttributeNames()) {
        const ok =
          element.tagName === "A"
            ? ["href", "target", "rel"].includes(name)
            : element.tagName === "OL" && name === "start";
        if (!ok) problems.push(`${element.tagName}[${name}]`);
      }
      const href = element.getAttribute("href");
      if (href !== null && !/^(https?|mailto):/i.test(href))
        problems.push(`href=${href}`);
    }
    return problems;
  }

  it.each([
    ["完全な参照", "[例][r]\n\n[r]: https://example.com/page"],
    [
      "大文字・小文字の違う参照",
      "[例][REF]\n\n[ref]: https://example.com/page",
    ],
    ["省略した参照（[r][]）", "[例][]\n\n[例]: https://example.com/page"],
    ["短い参照（[r]）", "[例]\n\n[例]: https://example.com/page"],
  ])(
    "#134 AC-2（1-5 AC-4）: https の定義を参照（%s）に使ったときは、リンクにし、定義の行は画面に出さない",
    (_label, body) => {
      const root = show(body);
      const anchors = root.querySelectorAll("a");
      expect(anchors).toHaveLength(1);
      expect(anchors[0]?.getAttribute("href")).toBe("https://example.com/page");
      expect(textOf(root).trim()).toBe("例");
    },
  );

  it("#134 AC-2（U-4）: どの参照にも使われていない https の定義の行は、リンクにせず、書いたままの文字で出す", () => {
    const root = show("[E2E_TEST]本文です\n\n[r]: https://example.com/unused");
    expect(root.querySelectorAll("a")).toHaveLength(0);
    expect(paragraphs(root)).toEqual([
      "[E2E_TEST]本文です",
      "[r]: https://example.com/unused",
    ]);
  });

  it("#134 AC-2（U-4）: 定義の行だけの本文も、書いたままの文字で出す（何も表示しない状態にしない）", () => {
    const root = show("[r]: https://example.com/only");
    expect(root.querySelectorAll("a")).toHaveLength(0);
    expect(textOf(root).trim()).toBe("[r]: https://example.com/only");
  });

  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["大文字の JAVASCRIPT:", "JAVASCRIPT:alert(1)"],
    ["data:", "data:text/html,abc"],
    ["相対パス", "/relative/path"],
  ])(
    "#134 AC-2（1-5 AC-4・U-4）: %s の定義を参照に使ったときは、参照も定義の行も書いたままの文字で出し、リンクにしない",
    (_label, url) => {
      const root = show(`[押す][r]\n\n[r]: ${url}`);
      expect(root.querySelectorAll("a")).toHaveLength(0);
      expect(root.querySelectorAll("[href]")).toHaveLength(0);
      expect(paragraphs(root)).toEqual(["[押す][r]", `[r]: ${url}`]);
    },
  );

  it("#134 AC-2（1-5 AC-4・U-4）: 参照のない javascript: の定義の行も、書いたままの文字で出す", () => {
    const root = show("[E2E_TEST]本文です\n\n[r]: javascript:alert(1)");
    expect(root.querySelectorAll("a, [href]")).toHaveLength(0);
    expect(paragraphs(root)).toEqual([
      "[E2E_TEST]本文です",
      "[r]: javascript:alert(1)",
    ]);
  });

  it("#134 AC-2（1-5 AC-4・U-4）: 同じ名前の https の定義が2つあるときは、使われた最初の定義の行だけを隠し、2つ目は書いたままの文字で出す", () => {
    const root = show(
      "[例][r]\n\n[r]: https://example.com/first\n[r]: https://example.com/second",
    );
    const anchors = root.querySelectorAll("a");
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.getAttribute("href")).toBe("https://example.com/first");
    const text = textOf(root);
    expect(text).not.toContain("https://example.com/first");
    expect(text).toContain("[r]: https://example.com/second");
  });

  it("#134 AC-2（1-5 AC-4・U-4）: 最初が https・2つ目が javascript: のときは、最初の定義でリンクにして隠し、2つ目の行は書いたままの文字で出す", () => {
    const root = show(
      "[例][r]\n\n[r]: https://example.com/first\n[r]: javascript:alert(1)",
    );
    expect(root.querySelectorAll("a")).toHaveLength(1);
    const text = textOf(root);
    expect(text).not.toContain("https://example.com/first");
    expect(text).toContain("[r]: javascript:alert(1)");
  });

  it("#134 AC-2（1-5 AC-4・U-4）: 最初が javascript:・2つ目が https のときは、リンクにせず、参照と2つの定義の行をすべて書いたままの文字で出す", () => {
    const root = show(
      "[押す][r]\n\n[r]: javascript:alert(1)\n[r]: https://example.com/second",
    );
    expect(root.querySelectorAll("a, [href]")).toHaveLength(0);
    const text = textOf(root);
    expect(text).toContain("[押す][r]");
    expect(text).toContain("[r]: javascript:alert(1)");
    expect(text).toContain("[r]: https://example.com/second");
  });

  it.each([
    [
      "使われた https の定義の title に script",
      '[例][r]\n\n[r]: https://example.com/page "<script>alert(1)</script>"',
      true,
    ],
    [
      "使われていない定義の title に script",
      '[E2E_TEST]本文\n\n[r]: https://example.com/page "<script>alert(1)</script>"',
      false,
    ],
    ["javascript: の定義", "[押す][r]\n\n[r]: javascript:alert(1)", false],
    [
      "javascript: の定義の title に img",
      '[押す][r]\n\n[r]: javascript:alert(1) "<img src=x onerror=alert(1)>"',
      false,
    ],
    [
      "定義の URL を <> で囲んだ javascript:",
      "[押す][r]\n\n[r]: <javascript:alert(1)>",
      false,
    ],
  ])(
    "#134 AC-2（1-5 AC-3・AC-4）: 定義の行が XSS の文字列（%s）でも、危険な要素・属性を出さない",
    (_label, body, linked) => {
      const root = show(body);
      expect(unsafeParts(root)).toEqual([]);
      expect(root.querySelector("script, img")).toBeNull();
      expect(root.querySelectorAll("a")).toHaveLength(linked ? 1 : 0);
      // 隠さない定義の行は、title の中の HTML も文字のまま出す
      if (!linked) expect(textOf(root)).toContain("[r]:");
    },
  );
});
