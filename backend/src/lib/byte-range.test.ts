// #140 AC-1（1-6 AC-7）: 動画のシーク再生のための Range の解釈（backend/src/lib/byte-range.ts）を、全事例で確かめる。
// 計画「Range の応答」（RFC 9110 14.2）：正しい単一の範囲（a-b・a-・-n）だけを範囲として返し、終わりがサイズを超えたらサイズ-1に丸める。
//   bytes= 以外の単位・書式の誤り・複数の範囲・満たせない範囲は null（Range を無視して 200 で全体を返す）。416 は返さない。
// route では 206 と Content-Range・無効な Range の 200 を各1件だけ確かめる（#271）。
//
// 実装が前提とする約束（このテストが固定する）：
//   parseByteRange(header: string | null | undefined, size: number): { start: number; end: number } | null（end を含む）
import { describe, expect, it } from "vitest";
import { parseByteRange } from "./byte-range";

const SIZE = 1000;

describe("#140 AC-1（1-6 AC-7）正しい単一の範囲", () => {
  it.each([
    ["bytes=0-99", { start: 0, end: 99 }],
    ["bytes=0-0", { start: 0, end: 0 }],
    ["bytes=999-999", { start: 999, end: 999 }],
    ["bytes=100-", { start: 100, end: 999 }],
    ["bytes=999-", { start: 999, end: 999 }],
    ["bytes=-100", { start: 900, end: 999 }],
    ["bytes=-1", { start: 999, end: 999 }],
    ["bytes=-1000", { start: 0, end: 999 }],
    ["bytes=-5000", { start: 0, end: 999 }],
    ["bytes=0-999", { start: 0, end: 999 }],
    ["bytes=0-1000", { start: 0, end: 999 }],
    ["bytes=500-99999999", { start: 500, end: 999 }],
  ])("#140 AC-1（1-6 AC-7）: %s（サイズ1000）は %o", (header, expected) => {
    expect(parseByteRange(header, SIZE)).toEqual(expected);
  });
});

describe("#140 AC-1（1-6 AC-7）無視する（null）", () => {
  it.each([
    ["Range がない（null）", null],
    ["Range がない（undefined）", undefined],
    ["空", ""],
    ["bytes 以外の単位", "items=0-99"],
    ["等号がない", "bytes0-99"],
    ["数字でない", "bytes=a-b"],
    ["両方が空", "bytes=-"],
    ["始まりが終わりより後", "bytes=500-100"],
    ["負の値", "bytes=-5-10"],
    ["小数", "bytes=0.5-10"],
    ["複数の範囲", "bytes=0-1,5-6"],
    ["始まりがサイズ以上", "bytes=1000-"],
    ["始まりがサイズより大きい", "bytes=1500-2000"],
    ["末尾の長さが0", "bytes=-0"],
  ])("#140 AC-1（1-6 AC-7）: %s は null", (_label, header) => {
    expect(parseByteRange(header, SIZE)).toBeNull();
  });

  it("#140 AC-1（1-6 AC-7）: サイズ0のときは、どの範囲も null", () => {
    expect(parseByteRange("bytes=0-0", 0)).toBeNull();
    expect(parseByteRange("bytes=-1", 0)).toBeNull();
  });
});
