import type { Mention } from "../../../../../shared/message-rules";

type Node = {
  type: string;
  value?: string;
  children?: Node[];
  position?: { start: { offset?: number }; end: { offset?: number } };
  data?: { hName: string; hProperties: { className: string } };
};

const FORBIDDEN = new Set([
  "link",
  "linkReference",
  "code",
  "inlineCode",
  "html",
  "image",
  "imageReference",
  "mention",
]);

function offsets(node: Node): { start: number; end: number } | null {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined ? null : { start, end };
}

function textPart(body: string, start: number, end: number): Node[] {
  return start === end
    ? []
    : [
        {
          type: "text",
          value: body.slice(start, end),
          position: { start: { offset: start }, end: { offset: end } },
        },
      ];
}

function containsForbidden(node: Node): boolean {
  return (
    FORBIDDEN.has(node.type) ||
    (node.children?.some(containsForbidden) ?? false)
  );
}

function canCut(node: Node, body: string, start: number, end: number): boolean {
  return node.type === "text" && node.value === body.slice(start, end);
}

function replaceRange(
  children: Node[],
  body: string,
  mention: Mention,
): Node[] {
  const first = children.findIndex((child) => {
    const span = offsets(child);
    return (
      span !== null && span.end > mention.start && span.start < mention.end
    );
  });
  if (first < 0) return children;
  let last = first;
  while (last + 1 < children.length) {
    const span = offsets(children[last + 1]!);
    if (span === null || span.start >= mention.end) break;
    last += 1;
  }
  const left = children[first]!;
  const right = children[last]!;
  const leftSpan = offsets(left);
  const rightSpan = offsets(right);
  if (
    leftSpan === null ||
    rightSpan === null ||
    mention.start < leftSpan.start ||
    mention.end > rightSpan.end
  )
    return children;
  const selected = children.slice(first, last + 1);
  if (selected.some(containsForbidden)) return children;
  if (
    leftSpan.start < mention.start &&
    !canCut(left, body, leftSpan.start, leftSpan.end)
  )
    return children;
  if (
    rightSpan.end > mention.end &&
    !canCut(right, body, rightSpan.start, rightSpan.end)
  )
    return children;
  const highlighted: Node = {
    type: "mention",
    data: { hName: "span", hProperties: { className: "mention" } },
    children: [{ type: "text", value: body.slice(mention.start, mention.end) }],
  };
  return [
    ...children.slice(0, first),
    ...textPart(body, leftSpan.start, mention.start),
    highlighted,
    ...textPart(body, mention.end, rightSpan.end),
    ...children.slice(last + 1),
  ];
}

/** 原文の範囲に重なる通常テキスト・Markdown記号をまとめる。リンクやコードの中は装飾しない。 */
export function remarkMentions(options: {
  body: string;
  mentions: readonly Mention[];
}) {
  return (tree: Node): void => {
    const { body, mentions } = options;
    function visit(node: Node): void {
      if (FORBIDDEN.has(node.type) || !node.children) return;
      for (const mention of [...mentions].sort((a, b) => b.start - a.start)) {
        if (mention.end <= mention.start || body[mention.start] !== "@")
          continue;
        node.children = replaceRange(node.children, body, mention);
      }
      for (const child of node.children) visit(child);
    }
    visit(tree);
  };
}
