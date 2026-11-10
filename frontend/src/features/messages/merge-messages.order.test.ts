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

  const permutations = (items: number[]): number[][] =>
    items.length <= 1
      ? [items]
      : items.flatMap((item, index) =>
          permutations([
            ...items.slice(0, index),
            ...items.slice(index + 1),
          ]).map((rest) => [item, ...rest]),
        );

  it("#207 AC-1: 4件のすべての並び順（24通り）で、current のみでも半分ずつでも ID昇順になる", () => {
    const all = permutations([1, 2, 3, 4]);
    expect(all).toHaveLength(24);
    for (const order of all) {
      expect(ids(mergeMessages(build(order), []))).toEqual(idsOf([1, 2, 3, 4]));
      expect(
        ids(mergeMessages(build(order.slice(0, 2)), build(order.slice(2)))),
      ).toEqual(idsOf([1, 2, 3, 4]));
    }
  });

  it("#207 AC-1: 30件の固定の順不同でも、ID昇順になる", () => {
    const shuffled = [
      17, 3, 28, 9, 24, 1, 30, 12, 21, 6, 15, 27, 2, 19, 8, 25, 11, 29, 4, 22,
      13, 7, 26, 18, 5, 23, 10, 16, 20, 14,
    ];
    const expected = Array.from({ length: 30 }, (_, i) => i + 1);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(expected);
    const result = mergeMessages(
      build(shuffled.slice(0, 12)),
      build(shuffled.slice(12)),
    );
    expect(ids(result)).toEqual(idsOf(expected));
  });
});
