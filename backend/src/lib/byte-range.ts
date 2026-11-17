// Range の解釈（RFC 9110 14.2）。正しい単一の範囲だけを返し、それ以外（別の単位・書式の誤り・複数の範囲・満たせない範囲）は
// null にして、呼び出し側が Range を無視して 200 で全体を返す（416 は返さない。計画「Range の応答」）。

const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/;

/** end を含む範囲。終わりがサイズを超えたらサイズ-1に丸める */
export function parseByteRange(
  header: string | null | undefined,
  size: number,
): { start: number; end: number } | null {
  if (header === null || header === undefined || size <= 0) return null;
  const match = SINGLE_RANGE.exec(header);
  if (match === null) return null;
  const [, first = "", last = ""] = match;
  if (first === "") {
    if (last === "") return null;
    const suffix = Number(last);
    if (suffix === 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(first);
  if (start >= size) return null;
  if (last === "") return { start, end: size - 1 };
  const end = Number(last);
  if (end < start) return null;
  return { start, end: Math.min(end, size - 1) };
}
