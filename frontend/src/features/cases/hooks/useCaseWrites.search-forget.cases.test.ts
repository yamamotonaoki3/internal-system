// #155（155-C）F-3：資格を失った案件の中身の片付け（forgetCaseContent・forgetCaseAfterLeave）が、その利用者の案件の検索の結果
// （['search', 利用者の ID, 'cases', …]）も、メッセージの検索の結果と一緒に取り除くこと。ほかの利用者の結果は残す。
// 期待は、計画 5章（案件の検索のキーは searchKeys.user と同じ先頭。useCaseWrites.ts は変えない）から決める。
// キーは期待の独立のため、配列で直接書く。データは架空（testuser_ の ID の形の固定値）。
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { searchKeys } from "../../search";
import { forgetCaseAfterLeave, forgetCaseContent } from "./useCaseWrites";

const USER = "01JTESTUSER155CF3000000U01";
const OTHER_USER = "01JTESTUSER155CF3000000U02";
const CASE = "01JTESTCASE155CF300000001";

const PAGE = { items: [], hasMore: false };

const MINE_CASES = ["search", USER, "cases", { q: "見積書" }, 1] as const;
const MINE_MESSAGES = ["search", USER, "messages", { q: "見積書" }, 1] as const;
const OTHERS_CASES = [
  "search",
  OTHER_USER,
  "cases",
  { q: "見積書" },
  1,
] as const;

function clientWith(keys: readonly (readonly unknown[])[]) {
  const client = new QueryClient();
  for (const key of keys) client.setQueryData([...key], PAGE);
  return client;
}

const has = (client: QueryClient, key: readonly unknown[]) =>
  client.getQueryCache().find({ queryKey: [...key], exact: true }) !==
  undefined;

describe("#155 4-2 AC-2 F-3 案件の検索のキーと、資格の喪失の後片付け", () => {
  it("#155 F-3: 案件の検索のキーは ['search', 利用者の ID, 'cases', { q }, ページ数] で、利用者の検索の全体のキーの前方一致に入る", () => {
    expect(searchKeys.cases(USER, "見積書", 1)).toEqual([...MINE_CASES]);
    expect(searchKeys.casesAll(USER)).toEqual(["search", USER, "cases"]);
    expect(searchKeys.messagesAll(USER)).toEqual(["search", USER, "messages"]);
    expect(searchKeys.cases(USER, "見積書", 1).slice(0, 2)).toEqual([
      ...searchKeys.user(USER),
    ]);
  });

  it("#155 F-3: forgetCaseContent は、その利用者の案件とメッセージの検索の結果を取り除き、ほかの利用者のものは残す", async () => {
    const client = clientWith([MINE_CASES, MINE_MESSAGES, OTHERS_CASES]);
    await forgetCaseContent(client, USER, CASE);
    expect(has(client, MINE_CASES)).toBe(false);
    expect(has(client, MINE_MESSAGES)).toBe(false);
    expect(has(client, OTHERS_CASES)).toBe(true);
  });

  it("#155 F-3: forgetCaseAfterLeave でも、その利用者の案件の検索の結果を取り除く", async () => {
    const client = clientWith([MINE_CASES, OTHERS_CASES]);
    await forgetCaseAfterLeave(client, USER, CASE);
    expect(has(client, MINE_CASES)).toBe(false);
    expect(has(client, OTHERS_CASES)).toBe(true);
  });
});
