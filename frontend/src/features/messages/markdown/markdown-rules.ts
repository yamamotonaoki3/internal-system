// マークダウンの許可リスト（ADR-0026）。描画してよい要素と、リンクとして扱ってよい URL を、ここの1か所で決める。

/** 描画してよい要素。これ以外は、react-markdown が中身の文字だけを残す */
export const ALLOWED_ELEMENTS: readonly string[] = [
  "p",
  "br",
  "strong",
  "em",
  "del",
  "ul",
  "ol",
  "li",
  "blockquote",
  "code",
  "pre",
  "a",
];

const ALLOWED_PROTOCOLS: readonly string[] = ["http:", "https:", "mailto:"];

/**
 * リンクにしてよい URL か。絶対 URL として解釈でき、スキームが http・https・mailto のものだけ true。
 * 文字列の前置きではなく、ブラウザと同じ解釈の結果で判定する（大文字・空白・制御文字を混ぜた形に備える）
 */
export function isAllowedUrl(url: string): boolean {
  return URL.canParse(url) && ALLOWED_PROTOCOLS.includes(new URL(url).protocol);
}
