// #138 AC-1（1-7 AC-3・U-5）: describeReaction(reaction) — 読み上げ（aria-label）と title に使う、リアクション1種類の文言を作る純粋な関数。
// 契約（計画「画面」の ReactionChip・reaction-label.ts）：
//   「<表示> <件数>人：<付けた人の表示名を、付けた時刻の順に「、」でつなぐ>」。
//   表示：スタンプは日本語の名前（shared の STAMPS の label）、絵文字はその文字から始まる（その後に名前を足してもよい）。
//   無効な社員（isActive: false）の名前には「（退職者）」を付ける。
//   付けた人は最大50人までしか届かない（count は全数）。count が users の人数より多いときは、末尾に「ほか n 人」（n は差）を付ける。
// 期待する文言は、決定（U-2 のスタンプの名前・U-5）から書く。データは架空。
import { describe, expect, it } from "vitest";
import type { Reaction } from "./api/message-api";
import { describeReaction } from "./reaction-label";

const user = (n: number, isActive = true) => ({
  id: `01JTESTUSER00000000000R${String(n).padStart(3, "0")}`,
  displayName: `テストリアクション${n}`,
  isActive,
});

const stamp = (
  value: string,
  users: ReturnType<typeof user>[],
  count?: number,
) =>
  ({
    kind: "stamp",
    value,
    count: count ?? users.length,
    reactedByMe: false,
    users,
  }) satisfies Reaction;

describe("#138 AC-1（1-7 AC-3・U-5）describeReaction", () => {
  it("#138 AC-1（U-5）: スタンプは「<名前> <件数>人：<付けた人>」。付けた時刻の順に「、」でつなぐ", () => {
    expect(describeReaction(stamp("like", [user(1), user(2), user(3)]))).toBe(
      "いいね 3人：テストリアクション1、テストリアクション2、テストリアクション3",
    );
  });

  it.each([
    ["ok", "了解"],
    ["thanks", "ありがとう"],
    ["good-work", "お疲れさまです"],
    ["checking", "確認します"],
    ["congrats", "おめでとう"],
  ])("#138 AC-1（U-2）: スタンプ %s は名前「%s」で読み上げる", (id, label) => {
    expect(describeReaction(stamp(id, [user(1)]))).toBe(
      `${label} 1人：テストリアクション1`,
    );
  });

  it("#138 AC-1（U-5・U-6）: 退職者（isActive: false）の名前には「（退職者）」を付ける。有効な人には付けない", () => {
    expect(describeReaction(stamp("like", [user(1), user(2, false)]))).toBe(
      "いいね 2人：テストリアクション1、テストリアクション2（退職者）",
    );
  });

  it("#138 AC-1（U-5）: 絵文字は、その文字から始まり、件数と付けた人を含む（退職者の印も）", () => {
    const text = describeReaction({
      kind: "emoji",
      value: "👍",
      count: 2,
      reactedByMe: true,
      users: [user(1), user(2, false)],
    });
    expect(text.startsWith("👍")).toBe(true);
    expect(text).toContain(
      "2人：テストリアクション1、テストリアクション2（退職者）",
    );
  });

  it("#138 AC-1（Q-93・U-5）: 50人を超えたら、末尾に「ほか n 人」を付ける（n は count と表示した人数の差）", () => {
    const fifty = Array.from({ length: 50 }, (_, i) => user(i + 1));
    const text = describeReaction(stamp("like", fifty, 53));
    expect(text.startsWith("いいね 53人：テストリアクション1、")).toBe(true);
    expect(text).toContain("テストリアクション50");
    expect(text).not.toContain("テストリアクション51");
    expect(text.endsWith("ほか 3 人")).toBe(true);
  });

  it("#138 AC-1（Q-93）: count と人数が同じなら「ほか」は付けない", () => {
    expect(describeReaction(stamp("like", [user(1)]))).not.toContain("ほか");
  });

  it("#138 AC-1（Q-93）: ちょうど50人（count も50）なら「ほか」は付けない", () => {
    const fifty = Array.from({ length: 50 }, (_, i) => user(i + 1));
    expect(describeReaction(stamp("like", fifty))).not.toContain("ほか");
  });
});
