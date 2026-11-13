// #237 AC-1・AC-4（C-169 (2)：既読位置がない部屋は、参加した後のメッセージだけ数える）：
// 参加の時刻をメッセージIDの範囲の下限にするため、ULID の時刻部分（先頭10文字）だけを作る ulidTimePrefix を ulid.ts から公開する。
// 符号化の定義は ulid.ts の1か所（encodeTime）。別の実装を作らない（計画 改訂2 B）。
// 期待値は、①Crockford Base32 の規則から手で書いた文字列と、②createUlidFactory({ now }) で作ったIDの先頭10文字（同じ時刻のIDとの一致）の両方で確かめる。
// 契約（実装者へ）：ulid.ts が ulidTimePrefix(ms: number): string（10文字）を公開する。0〜2^48−1 の整数を受け取る。
import { describe, expect, it } from "vitest";
import { createUlidFactory, ulidTimePrefix } from "./ulid";

const MAX_TIME = 2 ** 48 - 1;
const idAt = (ms: number) => createUlidFactory({ now: () => ms })();

describe("#237 AC-1・AC-4 ulidTimePrefix（ULID の時刻部分）", () => {
  it.each([
    [0, "0000000000"],
    [1, "0000000001"],
    [31, "000000000Z"],
    [32, "0000000010"],
    [1023, "00000000ZZ"],
    [1024, "0000000100"],
    [Date.parse("2026-11-12T23:59:59.999Z"), "01M7938DZZ"],
    [Date.parse("2026-11-13T00:00:00.000Z"), "01M7938E00"],
    [Date.parse("2026-11-13T00:00:00.001Z"), "01M7938E01"],
    [MAX_TIME, "7ZZZZZZZZZ"],
  ])(
    "#237 AC-1: %i ミリ秒の時刻部分は %s（Crockford Base32 の10桁）",
    (ms, expected) => {
      expect(ulidTimePrefix(ms)).toBe(expected);
    },
  );

  it.each([0, 31, 32, 1023, 1024, 1_794_528_000_000, Date.now(), MAX_TIME])(
    "#237 AC-1: %i ミリ秒で作った ULID の先頭10文字と一致する",
    (ms) => {
      expect(ulidTimePrefix(ms)).toBe(idAt(ms).slice(0, 10));
    },
  );

  it("#237 AC-1: 時刻部分の10文字は、同じ時刻のどの ULID よりも小さく、1ミリ秒前の ULID よりも大きい（同じミリ秒の投稿は下限より後になる）", () => {
    const t = Date.parse("2026-11-13T00:00:00.000Z");
    const prefix = ulidTimePrefix(t);
    for (let i = 0; i < 20; i += 1) {
      expect(idAt(t) > prefix).toBe(true);
      expect(idAt(t - 1) < prefix).toBe(true);
    }
    // 乱数部がすべて 0 の ID（同じ時刻で最小）でも、時刻部分の10文字より大きい
    const smallest = createUlidFactory({
      now: () => t,
      random: (n) => new Uint8Array(n),
    })();
    expect(smallest > prefix).toBe(true);
  });
});
