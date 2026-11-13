// #237 AC-1・AC-4（C-169 (2)）：未読を数える下限（この ID より大きいメッセージだけを数える）を作る純粋関数 unreadLowerBound。
// 規則（計画 改訂1・改訂2 B・改訂4-2）：
//   下限 = 既読位置（なければ空文字）と、参加の時刻（joinedAt）の ULID の時刻部分（10文字）の、文字列として大きい方。
//   DM（joinedAt が null）は既読位置だけ。参加の時刻が読めない・ULID の時刻の範囲（0〜2^48−1）の外なら、参加の下限を付けない（すべて数える側に倒す）。
//   10文字の時刻部分は、同じ時刻の26文字のどの ID よりも小さいため、参加と同じミリ秒の投稿は数える側に入る。
// 期待値は Crockford Base32 の規則から手で書いた文字列（本番の関数から作らない）。
// 契約（実装者へ）：backend/src/lib/unread-bound.ts が
//   unreadLowerBound(input: { lastReadMessageId: string | null; joinedAt: string | null }): string を公開する。
import { describe, expect, it } from "vitest";
import { createUlidFactory } from "./ulid";
import { unreadLowerBound } from "./unread-bound";

const JOINED_AT = "2026-11-13T00:00:00.000Z";
/** JOINED_AT の時刻部分（1_794_528_000_000 ミリ秒） */
const JOINED_PREFIX = "01M7938E00";
/** 参加より前（2026-11-09）の既読位置 */
const READ_BEFORE_JOIN = "01M6YSNJ00ABCDEFGHJKMNPQRS";
/** 参加より後（2026-11-13T00:00:00.001Z）の既読位置 */
const READ_AFTER_JOIN = "01M7938E01ABCDEFGHJKMNPQRS";

const idAt = (ms: number) => createUlidFactory({ now: () => ms })();

describe("#237 AC-1（C-169 (2)）チャンネル：既読位置と参加の時刻の大きい方", () => {
  it("#237 AC-1: 既読位置がなければ、参加の時刻の時刻部分が下限", () => {
    expect(
      unreadLowerBound({ lastReadMessageId: null, joinedAt: JOINED_AT }),
    ).toBe(JOINED_PREFIX);
  });

  it("#237 AC-1: 既読位置が参加より前（抜けて入り直した）なら、最後に参加した時刻が下限", () => {
    expect(
      unreadLowerBound({
        lastReadMessageId: READ_BEFORE_JOIN,
        joinedAt: JOINED_AT,
      }),
    ).toBe(JOINED_PREFIX);
  });

  it("#237 AC-1: 既読位置が参加より後なら、既読位置が下限", () => {
    expect(
      unreadLowerBound({
        lastReadMessageId: READ_AFTER_JOIN,
        joinedAt: JOINED_AT,
      }),
    ).toBe(READ_AFTER_JOIN);
  });

  it("#237 AC-1: 参加と同じミリ秒に作られた ID は下限より大きく（数える）、1ミリ秒前の ID は下限以下（数えない）", () => {
    const joinedMs = Date.parse(JOINED_AT);
    const bound = unreadLowerBound({
      lastReadMessageId: null,
      joinedAt: JOINED_AT,
    });
    expect(idAt(joinedMs) > bound).toBe(true);
    expect(idAt(joinedMs - 1) > bound).toBe(false);
  });
});

describe("#237 AC-1（C-169 (2)）DM：参加の時刻を持たない", () => {
  it("#237 AC-1: 既読位置がなければ空文字（すべてのメッセージを数える）", () => {
    expect(unreadLowerBound({ lastReadMessageId: null, joinedAt: null })).toBe(
      "",
    );
  });

  it("#237 AC-1: 既読位置があれば、それが下限", () => {
    expect(
      unreadLowerBound({ lastReadMessageId: READ_BEFORE_JOIN, joinedAt: null }),
    ).toBe(READ_BEFORE_JOIN);
  });
});

describe("#237 AC-1 参加の時刻が使えないときは、参加の下限を付けない（未読を隠さない側に倒す）", () => {
  it.each([
    ["日時として読めない", "not-a-date"],
    ["空文字", ""],
    ["負の時刻（1970年より前）", "1969-12-31T23:59:59.999Z"],
    [
      "ULID の時刻の上限（2^48−1）を1ミリ秒超える",
      "+010889-08-02T05:31:50.656Z",
    ],
  ])("#237 AC-1: %s（%s）なら、既読位置だけが下限", (_label, joinedAt) => {
    expect(unreadLowerBound({ lastReadMessageId: null, joinedAt })).toBe("");
    expect(
      unreadLowerBound({ lastReadMessageId: READ_BEFORE_JOIN, joinedAt }),
    ).toBe(READ_BEFORE_JOIN);
  });

  it.each([
    ["時刻 0（範囲の下端）", "1970-01-01T00:00:00.000Z", "0000000000"],
    ["時刻 2^48−1（範囲の上端）", "+010889-08-02T05:31:50.655Z", "7ZZZZZZZZZ"],
  ])(
    "#237 AC-1: %s は範囲内なので、参加の下限を付ける",
    (_label, joinedAt, prefix) => {
      expect(unreadLowerBound({ lastReadMessageId: null, joinedAt })).toBe(
        prefix,
      );
    },
  );
});
