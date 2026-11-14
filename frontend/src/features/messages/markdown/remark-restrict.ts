// 許可しない記法（画像・表・タスクリスト・脚注・生の HTML・許可しない形式のリンク・見出し・区切り線）を、書いたままの文字（原文）に戻す
// remark プラグイン（ADR-0026・利用者の決定 U-4）。あわせて、本文の1回の改行を改行（br）にする（U-5）。
// 構文木の節を、元の文章（file.value）の同じ位置の文字に置き換える。react-markdown が HTML の要素にする前に動く。
import { isAllowedUrl } from "./markdown-rules";

// mdast（@types/mdast）の型は、この機能の依存に宣言していないため、使う項目だけを構造で書く
type MdNode = {
  type: string;
  children?: MdNode[];
  value?: string;
  url?: string;
  identifier?: string;
  checked?: boolean | null;
  position?: {
    start: { offset?: number };
    end: { offset?: number };
  };
};

/** 子に入れる節が段落（ブロック）になる親。それ以外の親の中の節は、文の中（インライン）として扱う */
const BLOCK_PARENTS: readonly string[] = ["root", "blockquote", "listItem"];
/** 常にブロックの節で、原文の段落に替えるもの */
const BLOCK_TO_ORIGINAL: readonly string[] = [
  "heading",
  "thematicBreak",
  "table",
  "footnoteDefinition",
];
/** 常にインラインの節で、原文の文字に替えるもの */
const INLINE_TO_ORIGINAL: readonly string[] = [
  "image",
  "imageReference",
  "footnoteReference",
];
const TASK_MARKER = /\[[ xX]\]/;

/** 文字列を、改行ごとに分けた text と break の並びにする */
function textWithBreaks(value: string): MdNode[] {
  return value.split(/\r?\n/).flatMap((line, index): MdNode[] => {
    const text: MdNode[] = line === "" ? [] : [{ type: "text", value: line }];
    return index === 0 ? text : [{ type: "break" }, ...text];
  });
}

/** 節の下の text の文字を、順につなげる */
function textOf(node: MdNode): string {
  return (node.value ?? "") + (node.children ?? []).map(textOf).join("");
}

function collectDefinitions(
  node: MdNode,
  definitions: Map<string, MdNode>,
): Map<string, MdNode> {
  // 同じ識別子が複数あるときは、最初のものを使う（mdast-util-to-hast と同じ）
  if (
    node.type === "definition" &&
    node.identifier !== undefined &&
    node.url !== undefined &&
    !definitions.has(node.identifier)
  )
    definitions.set(node.identifier, node);
  for (const child of node.children ?? [])
    collectDefinitions(child, definitions);
  return definitions;
}

export function remarkRestrict() {
  return (tree: MdNode, file: { value: unknown }): void => {
    if (typeof file.value !== "string")
      throw new Error("本文が文字列ではないため、マークダウンを処理できません");
    const source = file.value;
    const definitions = collectDefinitions(tree, new Map());
    // 許可した URL のリンクになった参照の識別子。定義の行は、これに当たるものだけを隠す
    const linked = new Set<string>();

    function original(node: MdNode): string {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      // 通常は位置がある。位置のない節（将来のライブラリの版で、変換が作る節など）は、子の文字を書かれた文字として使い、失敗にしない
      if (start === undefined || end === undefined) return textOf(node);
      return source.slice(start, end);
    }

    function asText(node: MdNode, parentType: string): MdNode[] {
      const text = textWithBreaks(original(node));
      return BLOCK_PARENTS.includes(parentType)
        ? [{ type: "paragraph", children: text }]
        : text;
    }

    // 原文に戻すインラインの節：画像・脚注の参照、許可しない URL のリンク
    function isForbiddenInline(node: MdNode): boolean {
      if (INLINE_TO_ORIGINAL.includes(node.type)) return true;
      if (node.type === "link") return !isAllowedUrl(node.url ?? "");
      if (node.type !== "linkReference") return false;
      const url = definitions.get(node.identifier ?? "")?.url;
      // 定義がない参照は、mdast-util-to-hast が原文の形に戻す
      if (url === undefined) return false;
      if (isAllowedUrl(url)) {
        linked.add(node.identifier ?? "");
        return false;
      }
      return true;
    }

    function restrict(node: MdNode, parentType: string): MdNode[] {
      if (BLOCK_TO_ORIGINAL.includes(node.type) || node.type === "html")
        return asText(node, parentType);
      if (isForbiddenInline(node)) return textWithBreaks(original(node));
      if (node.type === "text") return textWithBreaks(node.value ?? "");
      if (node.type === "listItem" && typeof node.checked === "boolean")
        restoreTaskMarker(node);
      if (node.children)
        node.children = node.children.flatMap((child) =>
          restrict(child, node.type),
        );
      return [node];
    }

    // タスクリストの項目は、チェックボックスにせず、[ ]・[x] を本文の先頭の文字に戻す
    function restoreTaskMarker(item: MdNode): void {
      const marker =
        TASK_MARKER.exec(original(item))?.[0] ?? (item.checked ? "[x]" : "[ ]");
      item.checked = null;
      const markerText: MdNode = { type: "text", value: `${marker} ` };
      const first = item.children?.[0];
      if (first?.type === "paragraph")
        first.children = [markerText, ...(first.children ?? [])];
      else
        item.children = [
          { type: "paragraph", children: [markerText] },
          ...(item.children ?? []),
        ];
    }

    // 定義の行は、許可した URL のリンクになった参照に使われた最初の定義だけを隠す（書式の標準どおり）。
    // それ以外（使われていない・許可しない URL・画像の参照だけ・同じ名前の2つ目以降）は、書いたままの文字で出す
    function revealUnusedDefinitions(node: MdNode): void {
      if (!node.children) return;
      node.children = node.children.flatMap((child) => {
        if (child.type !== "definition") {
          revealUnusedDefinitions(child);
          return [child];
        }
        const id = child.identifier ?? "";
        const hidden =
          definitions.get(id) === child &&
          linked.has(id) &&
          isAllowedUrl(child.url ?? "");
        return hidden ? [child] : asText(child, node.type);
      });
    }

    tree.children = (tree.children ?? []).flatMap((child) =>
      restrict(child, tree.type),
    );
    revealUnusedDefinitions(tree);
  };
}
