// #200 AC-2・AC-3（2-3 AC-1・AC-2、2-4 AC-1）: チャンネルの閲覧・参加の判定（純粋関数）の全組み合わせ。
// 前提（実装前。引き継ぎに明記）：
//   canViewChannel(channel: { visibility: "public" | "private"; deletedAt: string | null }, isMember: boolean): boolean
//   canJoinChannel(channel: { visibility: "public" | "private"; deletedAt: string | null }): boolean
// 見える：公開、または参加中の非公開で、アーカイブされていない（deletedAt が null）。参加できる：公開で、アーカイブされていない。
import { describe, expect, it } from "vitest";
import {
  COMPANY_GENERAL_CHANNEL_NAME,
  COMPANY_GENERAL_ROOM_ID,
  canJoinChannel,
  canViewChannel,
} from "./channel-rules";

const ARCHIVED = "2026-11-09T00:00:00.000Z";

describe("#200 AC-3 canViewChannel（全組み合わせ）", () => {
  it.each([
    // [公開か, アーカイブか, 参加中か, 期待]
    ["public", null, false, true],
    ["public", null, true, true],
    ["private", null, true, true],
    ["private", null, false, false],
    ["public", ARCHIVED, false, false],
    ["public", ARCHIVED, true, false],
    ["private", ARCHIVED, true, false],
    ["private", ARCHIVED, false, false],
  ] as const)(
    "#200 AC-3: visibility=%s・deletedAt=%s・参加中=%s → %s",
    (visibility, deletedAt, isMember, expected) => {
      expect(canViewChannel({ visibility, deletedAt }, isMember)).toBe(
        expected,
      );
    },
  );
});

describe("#200 AC-2・AC-3 canJoinChannel（全組み合わせ）", () => {
  it.each([
    ["public", null, true],
    ["private", null, false],
    ["public", ARCHIVED, false],
    ["private", ARCHIVED, false],
  ] as const)(
    "#200 AC-3: visibility=%s・deletedAt=%s → %s",
    (visibility, deletedAt, expected) => {
      expect(canJoinChannel({ visibility, deletedAt })).toBe(expected);
    },
  );
});

describe("#200 AC-1 全社連絡の定数", () => {
  it("#200 AC-1: 名前は「全社連絡」、ルームIDは26文字の固定値", () => {
    expect(COMPANY_GENERAL_CHANNEL_NAME).toBe("全社連絡");
    expect(COMPANY_GENERAL_ROOM_ID).toHaveLength(26);
  });
});
