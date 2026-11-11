// #130 AC-3（7-3 AC-1）: サイドバーの固定リンク「社員一覧」（/members）は navigation.ts の primaryNavItems の1か所だけに足す（app-shell の足し方）。
// 社員一覧はログイン後の全員が見られる（perm.employee.view は全員が持つ）ため、権限の条件は付けない。
import { describe, expect, it } from "vitest";
import { primaryNavItems } from "./navigation";

describe("#130 AC-3（7-3 AC-1）primaryNavItems", () => {
  it("#130 AC-3（7-3 AC-1）: 「社員一覧」（/members）がちょうど1つある。権限の条件（requires）は付けない", () => {
    const items = primaryNavItems.filter((i) => i.to === "/members");
    expect(items).toHaveLength(1);
    expect(items[0]?.label).toBe("社員一覧");
    expect(items[0]).not.toHaveProperty("requires");
  });

  it("#130 AC-3（7-3 AC-1）: ホーム（/）は先頭のまま、id は重複しない", () => {
    expect(primaryNavItems[0]?.to).toBe("/");
    const ids = primaryNavItems.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
