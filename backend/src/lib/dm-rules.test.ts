// #136 AC-1（1-2 AC-1）: DM の2人の組を一意にするキー（backend/src/lib/dm-rules.ts の directKeyOf）を、手で書いた期待値で固定する。
// 計画 2章の決まり：2人の利用者IDを小さい順に ':' でつなぐ。同じIDどうし（自分自身宛て。C-55）は Error を投げる。
import { describe, expect, it } from "vitest";
import { directKeyOf } from "./dm-rules";

const A = "01JTESTDMUSERA000000000000";
const B = "01JTESTDMUSERB000000000000";

describe("#136 AC-1（1-2 AC-1）2人の組のキー（directKeyOf）", () => {
  it("#136 AC-1: 小さい順に ':' でつなぐ", () => {
    expect(directKeyOf(A, B)).toBe(
      "01JTESTDMUSERA000000000000:01JTESTDMUSERB000000000000",
    );
  });

  it("#136 AC-1: 渡す順を入れ替えても同じキーになる（同じ2人の DM を重ねて作らない）", () => {
    expect(directKeyOf(B, A)).toBe(directKeyOf(A, B));
    expect(directKeyOf(B, A)).toBe(
      "01JTESTDMUSERA000000000000:01JTESTDMUSERB000000000000",
    );
  });

  it("#136 AC-1: 先頭が同じで長さの違うIDも、文字列の小さい順に並べる", () => {
    expect(directKeyOf("01JZZ", "01J")).toBe("01J:01JZZ");
  });

  it("#136 AC-1（C-55）: 同じIDどうしは Error を投げる（自分自身宛ての DM は作らない）", () => {
    expect(() => directKeyOf(A, A)).toThrow(Error);
  });
});
