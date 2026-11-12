// #136 AC-1（1-2 AC-4）: 下部メニューの固定リンク「DM」（/dms）は navigation.ts の1か所で定義する（app-shell の足し方）。
// 既存の navigation.test.ts は変更せず、#136 の確認だけをこのファイルに置く。
// 契約（実装前の仮置き。引き継ぎに明記）：navigation.ts が dmsNavItem（id "dms"・label "DM"・to "/dms"）を公開する。
// DM はログイン後の全員が使える（perm.dm.message.* は固定ロールのすべてが持つ）ため、権限の条件（requires）は付けない。
import { describe, expect, it } from "vitest";
import { dmsNavItem } from "./navigation";

describe("#136 AC-1（1-2 AC-4）dmsNavItem", () => {
  it("#136 AC-1（1-2 AC-4）: 「DM」は /dms へのリンク。権限の条件（requires）は付けない", () => {
    expect(dmsNavItem).toEqual({ id: "dms", label: "DM", to: "/dms" });
    expect(dmsNavItem).not.toHaveProperty("requires");
  });
});
