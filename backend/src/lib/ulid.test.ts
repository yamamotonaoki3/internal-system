// #118 AC-1：ULIDが単調に増加する（同じミリ秒内に複数生成しても順序が逆転しない）。
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createUlidFactory, isUlid, newUlid } from "./ulid";

const CROCKFORD = /^[0-9A-HJKMNP-TV-Z]{26}$/;

// 乱数を固定して、桁上がり・あふれを再現する
const fixedRandom = (byte: number) => (length: number) =>
  new Uint8Array(length).fill(byte);

describe("ULID", () => {
  it("#118 AC-1: 固定時刻で1万件生成しても、厳密に昇順で重複しない", () => {
    const next = createUlidFactory({ now: () => 1_700_000_000_000 });
    const ids = Array.from({ length: 10_000 }, () => next());
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]! > ids[i - 1]!, `index ${i}`).toBe(true);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("#118 AC-1: 時計が戻っても、順序は逆転しない", () => {
    const times = [1_700_000_000_500, 1_700_000_000_400, 1_700_000_000_100];
    let i = 0;
    const next = createUlidFactory({
      now: () => times[Math.min(i++, times.length - 1)]!,
    });
    const a = next();
    const b = next();
    const c = next();
    expect(b > a).toBe(true);
    expect(c > b).toBe(true);
  });

  it("#118 AC-1: 時刻が進めば、後の方が大きい", () => {
    let t = 1_700_000_000_000;
    const next = createUlidFactory({ now: () => t });
    const a = next();
    t += 1;
    const b = next();
    expect(b > a).toBe(true);
  });

  it("#118 AC-1: 乱数部の下位が繰り上がる位置でも、昇順を保つ", () => {
    const next = createUlidFactory({
      now: () => 1_700_000_000_000,
      random: fixedRandom(0xfe),
    });
    const a = next();
    const b = next();
    const c = next();
    expect(b > a).toBe(true);
    expect(c > b).toBe(true);
  });

  it("#118 AC-1: 乱数部が最大値であふれる場合は、Errorを投げる（逆転した値を返さない）", () => {
    const next = createUlidFactory({
      now: () => 1_700_000_000_000,
      random: fixedRandom(0xff),
    });
    next();
    expect(() => next()).toThrow(Error);
  });

  it("#118 AC-1: 26文字のCrockford Base32で、時刻部が先頭にある", () => {
    const id = newUlid();
    expect(id).toMatch(CROCKFORD);
    expect(isUlid(id)).toBe(true);
    expect("01234567".includes(id[0]!)).toBe(true);
  });

  it("#118 AC-1: newUlid が続けて返す値も昇順", () => {
    const ids = Array.from({ length: 1000 }, () => newUlid());
    for (let i = 1; i < ids.length; i++)
      expect(ids[i]! > ids[i - 1]!).toBe(true);
  });

  it("#118 AC-1: isUlid は不正な形式を拒否する", () => {
    for (const v of [
      "",
      "01ARZ3NDEKTSV4RRFFQ69G5FA",
      "01ARZ3NDEKTSV4RRFFQ69G5FAVV",
      "01ARZ3NDEKTSV4RRFFQ69G5FAI",
      "01arz3ndektsv4rrffq69g5fav",
      "81ARZ3NDEKTSV4RRFFQ69G5FAV",
      null,
      undefined,
      123,
    ]) {
      expect(isUlid(v), String(v)).toBe(false);
    }
  });

  it("#118 AC-1: 任意の文字列に対して isUlid は例外を投げず、真なら形式を満たす", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        if (isUlid(s)) expect(s).toMatch(CROCKFORD);
      }),
    );
  });

  it("#118 AC-1: 任意の時刻で生成した値は isUlid を満たす", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 48 - 1 }), (t) => {
        const next = createUlidFactory({ now: () => t });
        expect(isUlid(next())).toBe(true);
      }),
    );
  });
});
