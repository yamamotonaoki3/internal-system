// #137 AC-1（1-4 AC-4）: サイドバーの固定リンク「スレッド」（/threads）は navigation.ts の primaryNavItems の1か所だけに足す（app-shell の足し方）。
// スレッド一覧はログイン後の全員が使える（perm.notification.own は全員が持つ。表示の制御に権限の条件は付けない）。
// 既存の navigation*.test.ts は変更せず、#137 の確認だけをこのファイルに置く。
import { describe, expect, it } from "vitest";
import { primaryNavItems } from "./navigation";

describe("#137 AC-1（1-4 AC-4）primaryNavItems", () => {
  it("#137 AC-1（1-4 AC-4）: 「スレッド」（/threads）がちょうど1つある。権限の条件（requires）は付けない", () => {
    const items = primaryNavItems.filter((i) => i.to === "/threads");
    expect(items).toHaveLength(1);
    expect(items[0]?.label).toBe("スレッド");
    expect(items[0]).not.toHaveProperty("requires");
  });

  it("#137 AC-1（1-4 AC-4）: ホーム（/）は先頭のまま、id は重複しない", () => {
    expect(primaryNavItems[0]?.to).toBe("/");
    const ids = primaryNavItems.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
