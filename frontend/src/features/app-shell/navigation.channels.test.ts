// #200 AC-4: サイドバーの固定リンク「チャンネルを探す」（/channels）は navigation.ts の primaryNavItems の1か所だけに足す（app-shell の足し方）。
// 既存の navigation.test.ts は変更せず、#200 の確認だけをこのファイルに置く。
import { describe, expect, it } from "vitest";
import { primaryNavItems } from "./navigation";

describe("#200 AC-4 primaryNavItems", () => {
  it("#200 AC-4: 「チャンネルを探す」（/channels）がある。権限の条件（requires）は付けない（ログイン後の全員）", () => {
    const item = primaryNavItems.find((i) => i.to === "/channels");
    expect(item?.label).toBe("チャンネルを探す");
    expect(item).not.toHaveProperty("requires");
  });

  it("#200 AC-4: ホーム（/）は残り、先頭にある。id は重複しない", () => {
    expect(primaryNavItems[0]?.to).toBe("/");
    const ids = primaryNavItems.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
