// メッセージの本文をマークダウンとして整形して出す（ADR-0026）。生の HTML は通さず、描画する要素とリンクを許可リストで限る。
// 利用者由来の className・style は、要素ごとの部品で捨てる（見た目は外枠 .markdown-body の外部の CSS だけで付ける）。
import type { ReactNode } from "react";
import Markdown, { type Components, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ALLOWED_ELEMENTS, isAllowedUrl } from "./markdown-rules";
import { remarkRestrict } from "./remark-restrict";

type Children = { children?: ReactNode };

// 取り消し線は ~~ だけ（~1つ~ は整形しない）
const REMARK_PLUGINS: Options["remarkPlugins"] = [
  [remarkGfm, { singleTilde: false }],
  remarkRestrict,
];

const COMPONENTS: Components = {
  p: ({ children }: Children) => <p>{children}</p>,
  br: () => <br />,
  strong: ({ children }: Children) => <strong>{children}</strong>,
  em: ({ children }: Children) => <em>{children}</em>,
  del: ({ children }: Children) => <del>{children}</del>,
  ul: ({ children }: Children) => <ul>{children}</ul>,
  ol: ({ children, start }: Children & { start?: number }) => (
    <ol start={start}>{children}</ol>
  ),
  li: ({ children }: Children) => <li>{children}</li>,
  blockquote: ({ children }: Children) => <blockquote>{children}</blockquote>,
  code: ({ children }: Children) => <code>{children}</code>,
  pre: ({ children }: Children) => <pre>{children}</pre>,
  a: ({ children, href }: Children & { href?: string }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
};

export function MarkdownBody({ body }: { body: string }) {
  return (
    <div className="markdown-body">
      <Markdown
        remarkPlugins={REMARK_PLUGINS}
        components={COMPONENTS}
        allowedElements={ALLOWED_ELEMENTS}
        unwrapDisallowed
        urlTransform={(url) => (isAllowedUrl(url) ? url : null)}
      >
        {body}
      </Markdown>
    </div>
  );
}
