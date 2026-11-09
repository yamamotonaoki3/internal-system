// #201 AC-3: ulidAfter(previous, now)。部屋の最大IDより必ず大きいULIDを作り直す関数（取りこぼし防止の核）。
// 別のWorkerが遅れた時計で作ったIDが、すでにある最大のIDより小さくても、作り直したIDは必ず大きい。
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createUlidFactory, isUlid, ulidAfter } from "./ulid";

// ULID 仕様書の例：時刻部 01ARZ3NDEK = 1469918176385 ミリ秒
const SPEC_TIME = 1_469_918_176_385;
const SPEC_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

describe("#201 AC-3 ulidAfter", () => {
  it.each([
    ["時計が前のIDより遅れている", SPEC_TIME - 60_000],
    ["同じミリ秒", SPEC_TIME],
    ["時計が進んでいる", SPEC_TIME + 60_000],
  ])("#201 AC-3: %s ときも、前のIDより大きいULIDを返す", (_label, now) => {
    const next = ulidAfter(SPEC_ID, now);
    expect(isUlid(next)).toBe(true);
    expect(next > SPEC_ID).toBe(true);
  });

  it("#201 AC-3: 作り直しを重ねても、厳密に昇順で重複しない", () => {
    let current = SPEC_ID;
    const seen = new Set<string>([current]);
    for (let i = 0; i < 200; i += 1) {
      const next = ulidAfter(current, SPEC_TIME - 1000);
      expect(next > current).toBe(true);
      seen.add(next);
      current = next;
    }
    expect(seen.size).toBe(201);
  });

  it("#201 AC-3: どんな前のIDと時計でも、前のIDより大きい（性質）", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4_000_000_000_000 }),
        fc.integer({ min: 0, max: 4_000_000_000_000 }),
        (previousTime, now) => {
          const previous = createUlidFactory({ now: () => previousTime })();
          expect(ulidAfter(previous, now) > previous).toBe(true);
        },
      ),
    );
  });

  it("#201 AC-3: 乱数部が最大で、足せない（桁あふれする）ときは Error を投げる", () => {
    const maxRandom = `${SPEC_ID.slice(0, 10)}ZZZZZZZZZZZZZZZZ`;
    expect(() => ulidAfter(maxRandom, SPEC_TIME - 1)).toThrow(Error);
  });
});
