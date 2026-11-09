// #201 AC-3: ulid.ts の境界（ミューテーションで生き残った分岐を、戻り値・例外の有無で確かめる）。
// 方針：エラー文言は見ない。投げるか・投げないか、戻り値の文字列そのものを確かめる。
import { describe, expect, it } from "vitest";
import { createUlidFactory, isUlid, ulidAfter } from "./ulid";

// SPEC_ID は仕様書の例（形式の確認用）。時刻の比較には、時刻を指定して作ったIDを使う
const SPEC_TIME = 1_469_918_176_385;
const SPEC_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const MAX_TIME = 2 ** 48 - 1;

const idAt = (ms: number, bytes?: Uint8Array) =>
  createUlidFactory({
    now: () => ms,
    ...(bytes === undefined ? {} : { random: () => bytes }),
  })();
const bytesOf = (...values: number[]) => Uint8Array.from(values);
const filled = (value: number) => new Uint8Array(10).fill(value);

describe("#201 AC-3 ulidAfter の時刻の扱い", () => {
  // 時刻が SPEC_TIME ちょうどで、乱数部が 1..10 のID
  const previousId = () =>
    idAt(SPEC_TIME, bytesOf(1, 2, 3, 4, 5, 6, 7, 8, 9, 10));
  const incrementedId = () =>
    idAt(SPEC_TIME, bytesOf(1, 2, 3, 4, 5, 6, 7, 8, 9, 11));

  it("#201 AC-3: 同じミリ秒のときは、時刻部も乱数部も前のIDのまま、乱数部に1だけ足す", () => {
    expect(ulidAfter(previousId(), SPEC_TIME)).toBe(incrementedId());
  });

  it("#201 AC-3: 時計が1ミリ秒遅れているときも、時刻部は前のIDのまま、乱数部に1だけ足す", () => {
    expect(ulidAfter(previousId(), SPEC_TIME - 1)).toBe(incrementedId());
  });

  it("#201 AC-3: 時計が1ミリ秒でも進んでいれば、時刻部は現在の時刻になる", () => {
    const previous = previousId();
    const next = ulidAfter(previous, SPEC_TIME + 1);
    expect(next.slice(0, 10)).toBe(idAt(SPEC_TIME + 1).slice(0, 10));
    expect(next > previous).toBe(true);
  });

  it.each([
    [
      "先頭バイトだけ0（残りは0xff）",
      bytesOf(0, 255, 255, 255, 255, 255, 255, 255, 255, 255),
      bytesOf(1, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    ],
    [
      "末尾バイトだけ0xff",
      bytesOf(0, 0, 0, 0, 0, 0, 0, 0, 0, 255),
      bytesOf(0, 0, 0, 0, 0, 0, 0, 0, 1, 0),
    ],
    [
      "末尾の3バイトが0xff",
      bytesOf(0, 0, 0, 0, 0, 0, 0, 255, 255, 255),
      bytesOf(0, 0, 0, 0, 0, 0, 1, 0, 0, 0),
    ],
  ])(
    "#201 AC-3: 乱数部の繰り上がり（%s）が正しい",
    (_label, previousBytes, expectedBytes) => {
      const previous = idAt(SPEC_TIME, previousBytes);
      expect(ulidAfter(previous, SPEC_TIME)).toBe(
        idAt(SPEC_TIME, expectedBytes),
      );
    },
  );

  it("#201 AC-3: 現在の時刻が0でも作れる（前のIDの時刻より遅れている扱い）", () => {
    expect(ulidAfter(SPEC_ID, 0) > SPEC_ID).toBe(true);
  });

  it("#201 AC-3: 現在の時刻が上限（2^48-1）ちょうどなら作れ、時刻部は上限になる", () => {
    const previous = idAt(SPEC_TIME);
    const next = ulidAfter(previous, MAX_TIME);
    expect(next.slice(0, 10)).toBe("7ZZZZZZZZZ");
    expect(next > previous).toBe(true);
  });

  it.each([
    ["負", -1],
    ["小数", 1.5],
    ["NaN", Number.NaN],
    ["無限大", Number.POSITIVE_INFINITY],
    ["上限を1超える", MAX_TIME + 1],
  ])("#201 AC-3: 現在の時刻が%sのときは Error を投げる", (_label, now) => {
    expect(() => ulidAfter(SPEC_ID, now)).toThrow(Error);
  });

  it.each([
    ["空文字", ""],
    ["短い", SPEC_ID.slice(0, 25)],
    ["長い", `${SPEC_ID}0`],
    ["小文字", SPEC_ID.toLowerCase()],
    ["先頭が8以上（時刻の範囲外）", `8${SPEC_ID.slice(1)}`],
    ["使えない文字 I", `I${SPEC_ID.slice(1)}`],
    ["配列", [SPEC_ID]],
  ])(
    "#201 AC-3: 前のIDが不正（%s）のときは Error を投げる",
    (_label, previous) => {
      expect(() => ulidAfter(previous as unknown as string, SPEC_TIME)).toThrow(
        Error,
      );
    },
  );

  it("#201 AC-3: 乱数部が最大でも、時刻が進んでいれば作り直せる（桁あふれにならない）", () => {
    const previous = idAt(SPEC_TIME, filled(0xff));
    expect(ulidAfter(previous, SPEC_TIME + 5) > previous).toBe(true);
  });
});

describe("#201 AC-3 isUlid", () => {
  it("#201 AC-3: 文字列の形でない値は、文字列にしたら形に合っても false", () => {
    expect(isUlid(SPEC_ID)).toBe(true);
    expect(isUlid([SPEC_ID])).toBe(false);
    expect(isUlid({ toString: () => SPEC_ID })).toBe(false);
  });
});

describe("#201 AC-3 createUlidFactory の境界", () => {
  it("#201 AC-3: 時刻0でも作れる", () => {
    expect(idAt(0, filled(0)).slice(0, 10)).toBe("0000000000");
  });

  it.each([
    ["負", -1],
    ["小数", 0.5],
    ["上限を1超える", MAX_TIME + 1],
  ])("#201 AC-3: 時刻が%sのときは Error を投げる", (_label, now) => {
    expect(() => createUlidFactory({ now: () => now })()).toThrow(Error);
  });

  it("#201 AC-3: 時刻が上限ちょうどなら作れる", () => {
    expect(idAt(MAX_TIME).slice(0, 10)).toBe("7ZZZZZZZZZ");
  });

  it("#201 AC-3: 最初の1回は、時刻1でも渡した乱数をそのまま使う（直前の乱数に足さない）", () => {
    const random = filled(0x55);
    expect(idAt(1, random).slice(10)).toBe(idAt(2, random).slice(10));
  });

  it("#201 AC-3: 乱数が10バイトより長く返ってきても、先頭の10バイトだけを使う", () => {
    const long = Uint8Array.from({ length: 12 }, (_, i) => i + 1);
    expect(idAt(SPEC_TIME, long)).toBe(idAt(SPEC_TIME, long.slice(0, 10)));
  });

  it("#201 AC-3: 乱数部があふれて失敗したあとも状態は壊れず、同じ時刻では失敗し続ける", () => {
    const next = createUlidFactory({
      now: () => SPEC_TIME,
      random: () => filled(0xff),
    });
    expect(next()).toBe(idAt(SPEC_TIME, filled(0xff)));
    expect(() => next()).toThrow(Error);
    expect(() => next()).toThrow(Error);
  });
});
