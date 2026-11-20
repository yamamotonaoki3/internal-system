// 検索語の組み立て（#155・C-152(2)・ADR-0010）。MATCH の句・方式の切り替え・抜粋を、ここの1か所で決める
import { SEARCH_TRIGRAM_MIN_CODE_POINTS } from "../../../shared/search-rules";
import { findSearchMatches } from "../../../shared/search-text";

/** 抜粋の長さ（コードポイント）と、一致の前に残す長さ */
const EXCERPT_CODE_POINTS = 120;
const EXCERPT_LEAD_CODE_POINTS = 40;

/** FTS5 の構文として解釈させないよう、語全体を1つの句にする（中の " は重ねる）。値はバインドで渡す */
export function toFtsPhrase(term: string): string {
  return `"${term.replaceAll('"', '""')}"`;
}

/** 語のコードポイント数で、trigram の MATCH か instr かを決める */
export function searchMethodOf(term: string): "match" | "instr" {
  return [...term].length >= SEARCH_TRIGRAM_MIN_CODE_POINTS ? "match" : "instr";
}

/** 記号を除いた本文から、最初の一致を含む部分を切り出す。コードポイントの単位で切るので、サロゲートペアを切らない */
export function buildExcerpt(text: string, term: string): string {
  const codePoints = [...text];
  if (codePoints.length <= EXCERPT_CODE_POINTS) return text;
  const first = findSearchMatches(text, term)[0];
  const matchAt = first ? [...text.slice(0, first.start)].length : 0;
  const end = Math.min(
    codePoints.length,
    Math.max(matchAt - EXCERPT_LEAD_CODE_POINTS, 0) + EXCERPT_CODE_POINTS,
  );
  return codePoints.slice(Math.max(end - EXCERPT_CODE_POINTS, 0), end).join("");
}
