// 検索の索引に入れる本文と、一致の位置の規則（#155・C-152(3)・ADR-0026）。
// 索引・抜粋・画面の強調が同じ規則で同じ文を見るよう、ここの1か所で決める。

// エスケープ（\ の後ろの記号）。split の区切りにし、捕まえた記号は文字として残す
const ESCAPED = /\\([!-/:-@[-`{-~])/;
const CODE_FENCE = /^\s*(`{3,}|~{3,})/;
// 行頭の書式（引用の >・見出しの #・箇条書きの記号・番号）。引用の中の箇条書きのように重なるので、繰り返し除く
const LINE_PREFIX = /^\s*(?:>\s?|#{1,6}(?:\s+|$)|[-*+]\s+|\d+[.)]\s+)/;
const LINK = /\[([^\]\n]*)\]\(([^)\s]*)\)/g;
const STRIKE = /~~(.+?)~~/g;
// 組になった * だけを除く（5*3 のような1つだけの * は残す）。_ は識別子（file_name）を壊すので扱わない（D-2）
const EMPHASIS = /(\*{1,3})(?=[^\s*])(.*?[^\s*])\1/g;

function stripLinePrefix(line: string): string {
  let current = line;
  for (;;) {
    const next = current.replace(LINE_PREFIX, "");
    if (next === current) return current;
    current = next;
  }
}

function stripEmphasis(text: string): string {
  let current = text;
  for (;;) {
    const next = current.replace(EMPHASIS, "$2");
    if (next === current) return current;
    current = next;
  }
}

function stripMarks(text: string): string {
  return stripEmphasis(
    text.replace(LINK, "$1 $2").replace(/`+/g, "").replace(STRIKE, "$1"),
  );
}

// エスケープした記号は除去の対象にしない：エスケープで区切った文字の部分だけから記号を除き、区切りの記号はそのまま戻す
function stripInline(line: string): string {
  return line
    .split(ESCAPED)
    .map((part, index) => (index % 2 === 0 ? stripMarks(part) : part))
    .join("");
}

/** 検索の索引に入れる本文。許可リスト（ADR-0026）の書式の記号を除き、文字は残す。同じ本文から必ず同じ結果を返す */
export function toSearchText(body: string): string {
  let inCodeBlock = false;
  return body
    .split("\n")
    .map((line) => {
      if (CODE_FENCE.test(line)) {
        inCodeBlock = !inCodeBlock;
        return line.replace(CODE_FENCE, "");
      }
      if (inCodeBlock) return line;
      return stripInline(stripLinePrefix(line));
    })
    .join("\n");
}

// 英字（ASCII）だけ小文字にする。長さが変わらないので、添字がそのまま元の文に使える
const foldAscii = (text: string) =>
  text.replace(/[A-Z]/g, (char) => char.toLowerCase());

/** text の中で term に一致する位置（UTF-16 の添字。end は含まない）。左から重ならずに数え、英字の大小文字は区別しない */
export function findSearchMatches(
  text: string,
  term: string,
): { start: number; end: number }[] {
  if (term.length === 0) return [];
  const haystack = foldAscii(text);
  const needle = foldAscii(term);
  const matches: { start: number; end: number }[] = [];
  let from = haystack.indexOf(needle);
  while (from !== -1) {
    matches.push({ start: from, end: from + needle.length });
    from = haystack.indexOf(needle, from + needle.length);
  }
  return matches;
}
