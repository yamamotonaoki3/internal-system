// #146（146-A）計画 A-7：サイドバーの固定リンクを navigation.ts の primaryNavItems の1か所に足す。
// #147（147-A）で、146-A の仮の入口「案件の申請」（/case-requests）を、案件一覧（S-16）の「案件」（/cases）に置き換えた（既定の方針9）。
// 案件の一覧はログイン後の全員が見られ（perm.case.summary.view は全員が持つ）、申請は S-16 の「案件の作成を申請」から行うため、権限の条件は付けない。
import { describe, expect, it } from "vitest";
import { primaryNavItems } from "./navigation";

describe("#146 計画 A-7・#147 147-A primaryNavItems", () => {
  it("#147 5-1 AC-4・AC-5（既定の方針9）: 「案件」（/cases）がちょうど1つあり、権限の条件（requires）は付けない", () => {
    const items = primaryNavItems.filter((i) => i.to === "/cases");
    expect(items).toHaveLength(1);
    expect(items[0]?.label).toBe("案件");
    expect(items[0]).not.toHaveProperty("requires");
  });

  it("#147（既定の方針9）: 仮の入口「案件の申請」（/case-requests）はメニューから外れている", () => {
    expect(primaryNavItems.filter((i) => i.to === "/case-requests")).toEqual(
      [],
    );
    expect(primaryNavItems.filter((i) => i.label === "案件の申請")).toEqual([]);
  });

  it("#146: ホーム（/）は先頭のまま、id は重複しない", () => {
    expect(primaryNavItems[0]?.to).toBe("/");
    const ids = primaryNavItems.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
