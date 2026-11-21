// 検索の結果を、1ページ目から pageCount ページまで順に取る（メッセージ・案件の区画で共通）。
// 取得が完了した時点の行は、その時点のサーバーの応答の行だけになる（資格を失った後の行が前のページに残らない）。
// カーソルはその取得の中の直前のページから作るので、前のページから行が消えても重複・欠落が出ない。

export type SearchPages<T> = { items: T[]; hasMore: boolean };

export async function fetchSearchPages<T>(
  fetchPage: (
    cursor: string | undefined,
  ) => Promise<{ items: T[]; nextCursor: string | null }>,
  pageCount: number,
  signal: AbortSignal,
): Promise<SearchPages<T>> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < pageCount; page += 1) {
    // 取り消された取得は、残りのページを取りにいかない
    signal.throwIfAborted();
    const result = await fetchPage(cursor);
    items.push(...result.items);
    if (result.nextCursor === null) return { items, hasMore: false };
    cursor = result.nextCursor;
  }
  return { items, hasMore: true };
}
