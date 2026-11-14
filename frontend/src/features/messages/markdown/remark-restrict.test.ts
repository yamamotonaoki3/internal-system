// #134 AC-2（1-5 AC-4・AC-6・U-4・U-5）: remark プラグイン remarkRestrict を、構文木（mdast）を直接渡して確かめる。
// マークダウンの文から作った木では起きない形（位置情報のない節点・位置の片方だけ・最初の子が段落でないタスクリストの項目・
// 文字列でない本文）を、守りの経路として確かめる。文から作れる形は MarkdownBody.restrict.test.tsx・MarkdownBody.test.tsx で確かめる。
// 契約（ADR-0026・利用者の決定 U-4・U-5・計画 plan-134 の「9. マークダウンの描画」）：
//   remarkRestrict() が返す関数は (tree, file) を受け取り、tree をその場で書き換える。file.value は元の本文（文字列）。
//   文字列でない本文は処理せず、エラーにする（黙って何も変えずに通さない）。
//   原文に戻す節点は、元の本文の同じ位置の文字にする。位置が分からない節点は、その下の文字（子の text）を順につないだものにする（本文の別の部分を出さない）。
//   出す文字は mdast の text、改行は break。ブロックの親（根・引用・リストの項目）の中では段落（paragraph）に包む。
//   タスクリストの項目は checked を null にし（チェックボックスにしない）、印（[ ]・[x]）と空白1つを最初の段落の先頭の text にする。
//   印の文字が原文から分からないときは、checked の真偽から [x]・[ ] にする。最初の子が段落でない・子がない項目は、印だけの段落を先頭に足す。
// 期待値は契約から書き、本番の定義から作らない。データは架空（example.com・[E2E_TEST]）。
import { describe, expect, it } from "vitest";
import { remarkRestrict } from "./remark-restrict";

type Node = {
  type: string;
  children?: Node[];
  value?: string;
  url?: string;
  identifier?: string;
  checked?: boolean | null;
  position?: { start: { offset?: number }; end: { offset?: number } };
};

/** 位置（元の本文の文字の範囲） */
const at = (start: number, end: number) => ({
  start: { offset: start },
  end: { offset: end },
});

function run(tree: Node, value: unknown): Node {
  remarkRestrict()(tree, { value });
  return tree;
}

/** 比べやすい形（種類・文字・タスクの印・子）にする。位置は比べない */
type Shape = {
  type: string;
  value?: string;
  checked?: boolean | null;
  children?: Shape[];
};
function shape(node: Node): Shape {
  const result: Shape = { type: node.type };
  if (node.value !== undefined) result.value = node.value;
  if (node.type === "listItem") result.checked = node.checked;
  if (node.children !== undefined) result.children = node.children.map(shape);
  return result;
}

const text = (value: string): Shape => ({ type: "text", value });
const paragraph = (...children: Shape[]): Shape => ({
  type: "paragraph",
  children,
});

/** 段落1つの根。段落の子に、位置のない link を入れる */
function rootWithLink(link: Node): Node {
  return {
    type: "root",
    children: [
      {
        type: "paragraph",
        children: [
          { type: "text", value: "前の文 " },
          link,
          { type: "text", value: " 後の文" },
        ],
      },
    ],
  };
}

/** 位置のない、許可しない URL のリンク。子の文字は「押」と強調の「す」 */
const forbiddenLink = (position?: Node["position"]): Node => ({
  type: "link",
  url: "javascript:alert(1)",
  ...(position === undefined ? {} : { position }),
  children: [
    { type: "text", value: "押" },
    { type: "emphasis", children: [{ type: "text", value: "す" }] },
  ],
});

// 位置のない節点で、本文の別の部分を出していないかを見分けるための、元の本文
const SOURCE = "[E2E_TEST]全体の本文";

describe("#134 AC-2 文字列でない本文", () => {
  it.each([
    ["数値", 123],
    ["バイト列", new TextEncoder().encode("[E2E_TEST]本文")],
    ["undefined", undefined],
    ["null", null],
  ])(
    "#134 AC-2: 本文が文字列でない（%s）ときは、処理せずにエラーにする（空の木でも黙って通さない）",
    (_label, value) => {
      expect(() => run({ type: "root", children: [] }, value)).toThrow(Error);
    },
  );

  it("#134 AC-2: 本文が文字列なら、空の木でもエラーにしない", () => {
    expect(shape(run({ type: "root", children: [] }, ""))).toEqual({
      type: "root",
      children: [],
    });
  });
});

describe("#134 AC-2（1-5 AC-4・U-4）位置情報のない節点を原文に戻すとき", () => {
  it("#134 AC-2（1-5 AC-4・U-4）: 位置のない、許可しない URL のリンクは、本文の別の部分ではなく、その下の文字を順につないだ text にする", () => {
    const tree = run(rootWithLink(forbiddenLink()), SOURCE);
    expect(shape(tree)).toEqual({
      type: "root",
      children: [paragraph(text("前の文 "), text("押す"), text(" 後の文"))],
    });
  });

  it.each([
    ["始まりだけ", { start: { offset: 0 }, end: {} }],
    ["終わりだけ", { start: {}, end: { offset: 5 } }],
  ])(
    "#134 AC-2（1-5 AC-4・U-4）: 位置の%sが分かるリンクも、本文を切り出さず、その下の文字を順につないだ text にする",
    (_label, position) => {
      const tree = run(rootWithLink(forbiddenLink(position)), SOURCE);
      expect(shape(tree)).toEqual({
        type: "root",
        children: [paragraph(text("前の文 "), text("押す"), text(" 後の文"))],
      });
    },
  );

  it("#134 AC-2（1-5 AC-4・U-4）: 位置の分かる、許可しない URL のリンクは、元の本文のその範囲の文字にする", () => {
    const source = "[押す](javascript:alert(1))";
    const tree = run(
      {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [{ ...forbiddenLink(at(0, source.length)) }],
          },
        ],
      },
      source,
    );
    expect(shape(tree)).toEqual({
      type: "root",
      children: [paragraph(text(source))],
    });
  });
});

describe("#134 AC-2（U-4・U-5）原文に戻すブロックの節点", () => {
  it("#134 AC-2（U-4・U-5）: 根の中の生の HTML のブロックは、段落に包み、各行の text と改行（break）にする", () => {
    const source = "<div>\n一行目\n</div>";
    const tree = run(
      {
        type: "root",
        children: [
          { type: "html", value: source, position: at(0, source.length) },
        ],
      },
      source,
    );
    expect(shape(tree)).toEqual({
      type: "root",
      children: [
        paragraph(
          text("<div>"),
          { type: "break" },
          text("一行目"),
          { type: "break" },
          text("</div>"),
        ),
      ],
    });
  });

  it("#134 AC-2（U-4）: 段落の中（インライン）の生の HTML は、段落に包まずに text にする", () => {
    const source = "前<b>後";
    const tree = run(
      {
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [
              { type: "text", value: "前" },
              { type: "html", value: "<b>", position: at(1, 4) },
              { type: "text", value: "後" },
            ],
          },
        ],
      },
      source,
    );
    expect(shape(tree)).toEqual({
      type: "root",
      children: [paragraph(text("前"), text("<b>"), text("後"))],
    });
  });
});

describe("#134 AC-2（1-5 AC-6・U-4）タスクリストの項目の印", () => {
  const item = (overrides: Partial<Node>): Node => ({
    type: "listItem",
    ...overrides,
  });
  const list = (...children: Node[]): Node => ({ type: "list", children });
  const root = (...children: Node[]): Node => ({ type: "root", children });

  it.each([
    [true, "[x] "],
    [false, "[ ] "],
  ])(
    "#134 AC-2（1-5 AC-6・U-4）: 原文から印が分からない（位置がない）項目は、checked=%s から印 %j を最初の段落の先頭に足し、checked を null にする",
    (checked, marker) => {
      const tree = run(
        root(
          list(
            item({
              checked,
              children: [
                {
                  type: "paragraph",
                  children: [{ type: "text", value: "作業" }],
                },
              ],
            }),
          ),
        ),
        SOURCE,
      );
      expect(shape(tree)).toEqual({
        type: "root",
        children: [
          {
            type: "list",
            children: [
              {
                type: "listItem",
                checked: null,
                children: [paragraph(text(marker), text("作業"))],
              },
            ],
          },
        ],
      });
    },
  );

  it("#134 AC-2（1-5 AC-6・U-4）: 子のない項目は、印だけの段落を足す", () => {
    const tree = run(
      root(list(item({ checked: false, children: [] }))),
      SOURCE,
    );
    expect(shape(tree)).toEqual({
      type: "root",
      children: [
        {
          type: "list",
          children: [
            {
              type: "listItem",
              checked: null,
              children: [paragraph(text("[ ] "))],
            },
          ],
        },
      ],
    });
  });

  it("#134 AC-2（1-5 AC-6・U-4）: children を持たない項目も、印だけの段落を足す", () => {
    const tree = run(root(list(item({ checked: true }))), SOURCE);
    expect(shape(tree)).toEqual({
      type: "root",
      children: [
        {
          type: "list",
          children: [
            {
              type: "listItem",
              checked: null,
              children: [paragraph(text("[x] "))],
            },
          ],
        },
      ],
    });
  });

  it("#134 AC-2（1-5 AC-6・U-4）: 最初の子が段落でない（入れ子のリスト）項目は、印だけの段落を先頭に足し、元の子を後ろに残す", () => {
    const nested = list(
      item({
        children: [
          {
            type: "paragraph",
            children: [{ type: "text", value: "子の項目" }],
          },
        ],
      }),
    );
    const tree = run(
      root(list(item({ checked: false, children: [nested] }))),
      SOURCE,
    );
    expect(shape(tree)).toEqual({
      type: "root",
      children: [
        {
          type: "list",
          children: [
            {
              type: "listItem",
              checked: null,
              children: [
                paragraph(text("[ ] ")),
                {
                  type: "list",
                  children: [
                    {
                      type: "listItem",
                      checked: undefined,
                      children: [paragraph(text("子の項目"))],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it("#134 AC-2（1-5 AC-6・U-4）: 原文から印が分かる項目は、checked の真偽ではなく、原文の印の文字（大文字の [X]）を使う", () => {
    const source = "- [X] 作業";
    const tree = run(
      root(
        list(
          item({
            checked: true,
            position: at(0, source.length),
            children: [
              {
                type: "paragraph",
                children: [{ type: "text", value: "作業", position: at(6, 8) }],
              },
            ],
          }),
        ),
      ),
      source,
    );
    expect(shape(tree)).toEqual({
      type: "root",
      children: [
        {
          type: "list",
          children: [
            {
              type: "listItem",
              checked: null,
              children: [paragraph(text("[X] "), text("作業"))],
            },
          ],
        },
      ],
    });
  });
});
