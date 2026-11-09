// #201 AC-3・AC-4: mergeMessages(current, incoming)。既存の一覧と新着を、IDで重複を除いて、ID昇順に並べる純粋関数。
// 自分の投稿の後の取り直しと定期の取り直しが重なっても、同じメッセージが2回出ない／順序が崩れないことの土台。
import { describe, expect, it } from "vitest";
import { message } from "../../test/message-handlers";
import { mergeMessages } from "./merge-messages";

const ids = (list: { id: string }[]) => list.map((m) => m.id);

describe("#201 AC-4 mergeMessages", () => {
  it.each([
    ["両方が空", [], [], []],
    ["新着がない", [1, 2], [], [1, 2]],
    ["既存がなく新着だけ", [], [1, 2], [1, 2]],
    ["新着が全部重複", [1, 2, 3], [2, 3], [1, 2, 3]],
    ["一部が重複", [1, 2], [2, 3, 4], [1, 2, 3, 4]],
    ["新着の中の重複", [1], [2, 2, 3], [1, 2, 3]],
    ["新着が順序どおりでない", [1], [4, 2, 3], [1, 2, 3, 4]],
    ["新着の方が古いID", [3, 4], [1, 2], [1, 2, 3, 4]],
  ])(
    "#201 AC-4: %s のとき、重複なくID昇順になる",
    (_l, current, incoming, expected) => {
      const result = mergeMessages(
        current.map((n) => message(n)),
        incoming.map((n) => message(n)),
      );
      expect(ids(result)).toEqual(expected.map((n) => message(n).id));
    },
  );

  it("#201 AC-4: 引数の配列を書き換えない", () => {
    const current = [message(2), message(1)];
    const snapshot = ids(current);
    mergeMessages(current, [message(3)]);
    expect(ids(current)).toEqual(snapshot);
  });
});
