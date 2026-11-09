// #201 AC-4: mergeMessages の並べ替え。入力が逆順・順不同でも、結果はID昇順になることを、戻り値の順序・件数で確かめる。
import { describe, expect, it } from "vitest";
import { message } from "../../test/message-handlers";
import { mergeMessages } from "./merge-messages";

const ids = (list: { id: string }[]) => list.map((m) => m.id);
const idsOf = (nums: number[]) => nums.map((n) => message(n).id);
const build = (nums: number[]) => nums.map((n) => message(n));

describe("#201 AC-4 mergeMessages 並べ替え", () => {
  it.each([
    ["既存が逆順", [3, 2, 1], [], [1, 2, 3]],
    ["新着が逆順", [], [3, 2, 1], [1, 2, 3]],
    ["既存・新着とも逆順", [6, 5, 4], [3, 2, 1], [1, 2, 3, 4, 5, 6]],
    ["既存・新着とも順不同", [5, 1, 4], [6, 2, 3], [1, 2, 3, 4, 5, 6]],
    ["2件が逆順", [2, 1], [], [1, 2]],
    ["既存と新着が交互に入り混じる", [1, 3, 5], [6, 4, 2], [1, 2, 3, 4, 5, 6]],
  ])(
    "#201 AC-4: %s のとき、ID昇順になる",
    (_l, current, incoming, expected) => {
      const result = mergeMessages(build(current), build(incoming));
      expect(ids(result)).toEqual(idsOf(expected));
    },
  );

  it("#201 AC-4: 新着の途中に既存と重複するIDがあっても、1件にまとまりID昇順になる", () => {
    const result = mergeMessages(build([4, 2]), build([5, 2, 3, 4, 1]));
    expect(result).toHaveLength(5);
    expect(ids(result)).toEqual(idsOf([1, 2, 3, 4, 5]));
  });

  it("#201 AC-4: 同じIDだけの入力は1件になる", () => {
    const result = mergeMessages(build([2, 2]), build([2]));
    expect(ids(result)).toEqual(idsOf([2]));
  });

  it("#201 AC-4: 逆順の入力を渡しても、入力の配列の順序・件数は変わらない", () => {
    const current = build([3, 1]);
    const incoming = build([4, 2, 3]);
    const currentSnapshot = ids(current);
    const incomingSnapshot = ids(incoming);
    const result = mergeMessages(current, incoming);
    expect(ids(result)).toEqual(idsOf([1, 2, 3, 4]));
    expect(ids(current)).toEqual(currentSnapshot);
    expect(ids(incoming)).toEqual(incomingSnapshot);
    expect(result).not.toBe(current);
  });
});
