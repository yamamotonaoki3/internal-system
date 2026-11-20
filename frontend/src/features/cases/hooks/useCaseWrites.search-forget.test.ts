// #155（155-A）F-8・計画 4.5「資格の喪失」：閲覧の資格を失った案件の中身の片付け（forgetCaseContent。useCaseAccessLoss と本人の退出
// 〔forgetCaseAfterLeave〕の両方から呼ばれる）が、その利用者の検索の結果（['search', 利用者の ID, ...] の前方一致）も取り除くこと。
// ほかの利用者の検索の結果は残す。既存の取り除き（詳細・TODO・添付）は変えない。
// 検索の結果には、どの案件の部屋の抜粋が入っているかをキーから決められないため、その利用者の検索の結果を全部取り除く（計画 4.5）。
// キーは期待の独立のため、配列で直接書く。
// 注意：#328（#323）が forgetCaseContent・useCaseAccessLoss の方式を変える予定。このテストは、いまの main の形（forgetCaseContent の公開）に合わせている。
// データは架空（testuser_ の ID の形の固定値）。
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { forgetCaseAfterLeave, forgetCaseContent } from "./useCaseWrites";

const USER = "01JTESTUSER155F8000000000U1";
const OTHER_USER = "01JTESTUSER155F8000000000U2";
const CASE = "01JTESTCASE155F80000000001";

const PAGE = { pages: [{ items: [], nextCursor: null }], pageParams: [null] };

function clientWith(keys: readonly (readonly unknown[])[]) {
  const client = new QueryClient();
  for (const key of keys) client.setQueryData([...key], PAGE);
  return client;
}

const has = (client: QueryClient, key: readonly unknown[]) =>
  client.getQueryCache().find({ queryKey: [...key], exact: true }) !==
  undefined;

const MINE_1 = ["search", USER, "messages", { q: "見積書" }] as const;
const MINE_2 = [
  "search",
  USER,
  "messages",
  { q: "請求", roomId: "R1" },
] as const;
const OTHERS = ["search", OTHER_USER, "messages", { q: "見積書" }] as const;

describe("#155 AC-4 F-8 forgetCaseContent と検索の結果", () => {
  it("#155 AC-4 F-8: その利用者の検索の結果を、条件に関わらず取り除き、ほかの利用者のものは残す", async () => {
    const client = clientWith([MINE_1, MINE_2, OTHERS]);
    await forgetCaseContent(client, USER, CASE);
    expect(has(client, MINE_1)).toBe(false);
    expect(has(client, MINE_2)).toBe(false);
    expect(has(client, OTHERS)).toBe(true);
  });

  it("#155 AC-4 F-8: 本人の退出の後片付け（forgetCaseAfterLeave）でも、その利用者の検索の結果を取り除く", async () => {
    const client = clientWith([MINE_1, OTHERS]);
    await forgetCaseAfterLeave(client, USER, CASE);
    expect(has(client, MINE_1)).toBe(false);
    expect(has(client, OTHERS)).toBe(true);
  });

  it("#155 AC-4 F-8: 取得中の検索は取り消され、後から届いた結果がキャッシュに戻らない", async () => {
    const client = new QueryClient();
    let resolve!: (value: typeof PAGE) => void;
    const pending = client.fetchQuery({
      queryKey: [...MINE_1],
      queryFn: () =>
        new Promise<typeof PAGE>((r) => {
          resolve = r;
        }),
    });
    await forgetCaseContent(client, USER, CASE);
    resolve(PAGE);
    await pending.catch(() => undefined);
    expect(client.getQueryData([...MINE_1])).toBeUndefined();
  });

  it("#155 AC-4 F-8（退行の確認）: 既存の取り除き（詳細・TODO・添付）は変わらず、概要は残す", async () => {
    const client = clientWith([
      ["cases", "detail", USER, CASE],
      ["cases", "todos", USER, CASE],
      ["cases", "attachments", USER, CASE],
      ["cases", "summary", USER, CASE],
      MINE_1,
    ]);
    await forgetCaseContent(client, USER, CASE);
    expect(has(client, ["cases", "detail", USER, CASE])).toBe(false);
    expect(has(client, ["cases", "todos", USER, CASE])).toBe(false);
    expect(has(client, ["cases", "attachments", USER, CASE])).toBe(false);
    expect(has(client, ["cases", "summary", USER, CASE])).toBe(true);
  });
});
