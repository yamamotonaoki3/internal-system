// #146（146-A）計画 A-7：サイドバーの固定リンク「案件の申請」（/case-requests）を navigation.ts の primaryNavItems の1か所に足す。
// 案件の作成の申請はメンバー全員ができる（R-60。perm.case.request.create は全員が持つ）ため、権限の条件は付けない。
// S-16（案件一覧）は #147 で作るため、これは仮の入口。
import { describe, expect, it } from "vitest";
import { primaryNavItems } from "./navigation";

describe("#146 計画 A-7 primaryNavItems", () => {
  it("#146 5-3 AC-1（R-60）: 「案件の申請」（/case-requests）がちょうど1つあり、権限の条件（requires）は付けない", () => {
    const items = primaryNavItems.filter((i) => i.to === "/case-requests");
    expect(items).toHaveLength(1);
    expect(items[0]?.label).toBe("案件の申請");
    expect(items[0]).not.toHaveProperty("requires");
  });

  it("#146: ホーム（/）は先頭のまま、id は重複しない", () => {
    expect(primaryNavItems[0]?.to).toBe("/");
    const ids = primaryNavItems.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
