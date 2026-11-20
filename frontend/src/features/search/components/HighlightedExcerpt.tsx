// 抜粋の中の一致を <mark> で強調する。抜粋は文字として描く（HTML・マークダウンとして解釈しない）。
// 一致の規則は、サーバーの抜粋の切り出しと同じ部品（shared/search-text.ts の findSearchMatches）を使う。
import { findSearchMatches } from "../../../../../shared/search-text";

type Part = { text: string; matched: boolean; start: number };

function splitByMatches(text: string, keyword: string): Part[] {
  const parts: Part[] = [];
  let position = 0;
  for (const { start, end } of findSearchMatches(text, keyword)) {
    if (start > position)
      parts.push({
        text: text.slice(position, start),
        matched: false,
        start: position,
      });
    parts.push({ text: text.slice(start, end), matched: true, start });
    position = end;
  }
  if (position < text.length)
    parts.push({ text: text.slice(position), matched: false, start: position });
  return parts;
}

export function HighlightedExcerpt({
  text,
  keyword,
}: {
  text: string;
  keyword: string;
}) {
  return (
    <>
      {splitByMatches(text, keyword).map((part) =>
        part.matched ? (
          <mark key={part.start}>{part.text}</mark>
        ) : (
          <span key={part.start}>{part.text}</span>
        ),
      )}
    </>
  );
}
