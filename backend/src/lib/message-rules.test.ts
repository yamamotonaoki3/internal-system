// #201 AC-2・AC-5: メッセージの共通規則（shared/message-rules.ts）を、実装とは独立した期待値で固定する。
// 期待値は要件（1-1 AC-5：本文は1〜4,000文字、2-3 AC-4：お知らせ専用への投稿制限、仮定U-14：全社連絡に制限なし、U-2：空白だけは空として拒否）の数字をそのまま書く。
// 判定の網羅はこの層で行い、上位（API・画面）は代表だけを確かめる。
import { describe, expect, it } from "vitest";
import {
  canPostToChannel,
  messageBodySchema,
} from "../../../shared/message-rules";

describe("#201 AC-2 本文の規則（messageBodySchema）", () => {
  it.each([
    ["1文字", "a", true],
    ["4,000文字", "a".repeat(4000), true],
    ["0文字", "", false],
    ["4,001文字", "a".repeat(4001), false],
    ["空白だけ", "   ", false],
    ["改行と空白だけ", " \n\t ", false],
    ["全角空白だけ", "　　", false],
    // UTF-16 の単位で数える（「𠮷」は2単位）
    ["サロゲートペアで4,000単位", "𠮷".repeat(2000), true],
    ["サロゲートペアで4,002単位", "𠮷".repeat(2001), false],
  ])("#201 AC-2: %s は受け付ける=%s", (_label, body, accepted) => {
    expect(messageBodySchema.safeParse(body).success).toBe(accepted);
  });

  it("#201 AC-2: 前後の空白・改行は削らず、送られたままの値を返す", () => {
    const body = "  [UNIT_TEST]こんにちは\n";
    expect(messageBodySchema.parse(body)).toBe(body);
  });

  it.each([[123], [null], [undefined], [["a"]]])(
    "#201 AC-2: 文字列でない値 %j は拒否する",
    (value) => {
      expect(messageBodySchema.safeParse(value).success).toBe(false);
    },
  );
});

describe("#201 AC-1・AC-5 投稿できるか（canPostToChannel）", () => {
  it.each(["normal", "department", "company_general", "case"] as const)(
    "#201 AC-1: purpose=%s は、参加者なら権限によらず投稿でき、未参加なら投稿できない",
    (purpose) => {
      for (const canPostAnnouncement of [true, false]) {
        expect(
          canPostToChannel({ purpose, isMember: true, canPostAnnouncement }),
        ).toBe(true);
        expect(
          canPostToChannel({ purpose, isMember: false, canPostAnnouncement }),
        ).toBe(false);
      }
    },
  );

  it.each([
    [true, true, true],
    [true, false, false],
    [false, true, false],
    [false, false, false],
  ])(
    "#201 AC-5: お知らせ専用は、参加者=%s・投稿の権限=%s のとき投稿できる=%s",
    (isMember, canPostAnnouncement, expected) => {
      expect(
        canPostToChannel({
          purpose: "announcement",
          isMember,
          canPostAnnouncement,
        }),
      ).toBe(expected);
    },
  );
});
