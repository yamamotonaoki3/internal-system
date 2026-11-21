// #155（155-C）F-3：検索の結果を1ページ目から順に取る部品（fetchSearchPages）。メッセージ・案件の区画で共通。
// 期待は計画 5章（取り消した取得は、残りのページを取りにいかない。カーソルは直前のページから作る。続きが無ければ止める）から決める。
// 1ページの取得の関数は、本物の約束（{ items, nextCursor }）と同じ形を返す偽物にする（取り消しの合図を見ない取得でも止まることを確かめる）。
import { describe, expect, it } from "vitest";
import { fetchSearchPages } from "./fetch-search-pages";

type Page = { items: string[]; nextCursor: string | null };

function pagesOf(pages: Page[]) {
  const cursors: (string | undefined)[] = [];
  const byCursor = new Map<string | undefined, Page>();
  let cursor: string | undefined;
  for (const page of pages) {
    byCursor.set(cursor, page);
    cursor = page.nextCursor ?? undefined;
  }
  return {
    cursors,
    fetchPage: async (c: string | undefined) => {
      cursors.push(c);
      const page = byCursor.get(c);
      if (page === undefined) throw new Error("ないページ");
      return page;
    },
  };
}

const THREE = [
  { items: ["a"], nextCursor: "P1" },
  { items: ["b"], nextCursor: "P2" },
  { items: ["c"], nextCursor: null },
];

describe("#155 4-2 AC-1 F-3 fetchSearchPages", () => {
  it("#155 F-3: pageCount ページまで、直前のページのカーソルで順に取り、続きが無ければ止める", async () => {
    const { cursors, fetchPage } = pagesOf(THREE);
    expect(
      await fetchSearchPages(fetchPage, 5, new AbortController().signal),
    ).toEqual({ items: ["a", "b", "c"], hasMore: false });
    expect(cursors).toEqual([undefined, "P1", "P2"]);
  });

  it("#155 F-3: 1ページ目を取った後に取り消されたら、残りのページを取りにいかず、失敗として返す（取得の関数が取り消しの合図を見なくても）", async () => {
    const controller = new AbortController();
    const cursors: (string | undefined)[] = [];
    const fetchPage = async (c: string | undefined) => {
      cursors.push(c);
      // 1ページ目の応答が届く前に、取り消される
      controller.abort();
      return { items: [String(c)], nextCursor: `${String(c)}-next` };
    };
    await expect(
      fetchSearchPages(fetchPage, 3, controller.signal),
    ).rejects.toBeDefined();
    expect(cursors).toEqual([undefined]);
  });

  it("#155 F-3: 始める前に取り消されていたら、1ページも取りにいかない", async () => {
    const controller = new AbortController();
    controller.abort();
    const { cursors, fetchPage } = pagesOf(THREE);
    await expect(
      fetchSearchPages(fetchPage, 2, controller.signal),
    ).rejects.toBeDefined();
    expect(cursors).toEqual([]);
  });
});
