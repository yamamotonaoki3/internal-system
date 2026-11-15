// #201 AC-2・AC-5: メッセージの共通規則（shared/message-rules.ts）を、実装とは独立した期待値で固定する。
// 期待値は要件（1-1 AC-5：本文は1〜4,000文字、2-3 AC-4：お知らせ専用への投稿制限、仮定U-14：全社連絡に制限なし、U-2：空白だけは空として拒否）の数字をそのまま書く。
// 判定の網羅はこの層で行い、上位（API・画面）は代表だけを確かめる。
import { describe, expect, it } from "vitest";
import {
  canPostToChannel,
  messageBodySchema,
  messageContentSchema,
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

// #139 AC-1：指名の範囲の規則（UTF-16の半開区間 [start, end)）。サーバーの入口と画面が同じ定義を参照する。
// 期待値は設計書（docs/design/mentions.md）の「開始・終了はUTF-16単位の半開区間で、重なり、本文外、@以外から始まる範囲、サロゲートペアの分割を拒否する」から決める。
describe("#139 AC-1 指名の範囲の規則（messageContentSchema）", () => {
  const USER_ID = "01JZ0000000000000000000001";
  const check = (body: string, ranges: [number, number][]) =>
    messageContentSchema.safeParse({
      body,
      mentions: ranges.map(([start, end]) => ({
        userId: USER_ID,
        start,
        end,
      })),
    });

  it.each([
    ["指名なし（省略）", "@a", undefined],
    ["指名0件", "@a", []],
  ])("#139 AC-1: %s は受け付ける", (_label, body, mentions) => {
    expect(messageContentSchema.safeParse({ body, mentions }).success).toBe(
      true,
    );
  });

  it("#139 AC-1: 本文の終わりちょうどまでの範囲は受け付ける", () => {
    expect(check("x @ab", [[2, 5]]).success).toBe(true);
  });

  it("#139 AC-1: 隣り合う（前の end と次の start が同じ）範囲は重ならず受け付ける", () => {
    expect(
      check("@a@b", [
        [0, 2],
        [2, 4],
      ]).success,
    ).toBe(true);
  });

  it.each([
    ["空の範囲（start と end が同じ）", "@@a", [[1, 1]]],
    ["end が start より小さい", "@@a", [[2, 1]]],
    ["本文より1つ長い end", "@a", [[0, 3]]],
    ["開始が@でない", "ab@", [[0, 1]]],
    ["開始が@の直後の文字", "@ab", [[1, 3]]],
    [
      "前の範囲と1文字重なる",
      "@a@c",
      [
        [0, 3],
        [2, 4],
      ],
    ],
    ["右端がサロゲートペアの途中（高位の後ろで切れる）", "@😀", [[0, 2]]],
  ] as [string, string, [number, number][]][])(
    "#139 AC-1: %s は、その指名の位置（path）つきで拒否する",
    (_label, body, ranges) => {
      const result = check(body, ranges);
      expect(result.success).toBe(false);
      if (result.success) return;
      const issue = result.error.issues.find(
        (entry) => entry.path[0] === "mentions",
      );
      expect(issue?.path.slice(0, 2)).toEqual([
        "mentions",
        ranges.length === 2 ? 1 : 0,
      ]);
      expect(issue?.message).toBeTruthy();
    },
  );

  it("#139 AC-1: 右端がサロゲートペアの後ろちょうどなら受け付ける", () => {
    expect(check("@😀", [[0, 3]]).success).toBe(true);
    expect(check("@😀 あ", [[0, 3]]).success).toBe(true);
  });

  it("#139 AC-1: 2番目の範囲が不正なら、path の添字は1になる（先頭の有効な範囲は指摘しない）", () => {
    const result = check("@a ab", [
      [0, 2],
      [3, 5],
    ]);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path.join("."))).toEqual([
      "mentions.1",
    ]);
  });

  it.each([
    ["ULIDでない社員ID", "not-a-ulid", 0, 2],
    ["負の開始", USER_ID, -1, 2],
    ["整数でない開始", USER_ID, 0.5, 2],
    ["end が0", USER_ID, 0, 0],
  ])("#139 AC-1: %s は拒否する", (_label, userId, start, end) => {
    expect(
      messageContentSchema.safeParse({
        body: "@a",
        mentions: [{ userId, start, end }],
      }).success,
    ).toBe(false);
  });
});

// #139 AC-1：サロゲートペアの境界。高位は U+D800〜U+DBFF、低位は U+DC00〜U+DFFF（UTF-16の定義）。
// 範囲の右端がペアの間（高位の直後に低位）に来る入力だけを拒否し、その外側のすぐ隣の値は受け付ける。
describe("#139 AC-1 指名の範囲の右端とサロゲートペアの境界", () => {
  const USER_ID = "01JZ0000000000000000000001";
  // 本文は「@」＋ last ＋ right。範囲は「@＋last」（end=2）で、right の直前で切る。
  const cutAt = (last: string, right: string) =>
    messageContentSchema.safeParse({
      body: `@${last}${right}`,
      mentions: [{ userId: USER_ID, start: 0, end: 2 }],
    });
  const HIGH_MIN = "\uD800";
  const HIGH_MAX = "\uDBFF";
  const LOW_MIN = "\uDC00";
  const LOW_MAX = "\uDFFF";

  it.each([
    ["高位の下限＋低位の下限", HIGH_MIN, LOW_MIN],
    ["高位の下限＋低位の上限", HIGH_MIN, LOW_MAX],
    ["高位の上限＋低位の下限", HIGH_MAX, LOW_MIN],
    ["高位の上限＋低位の上限", HIGH_MAX, LOW_MAX],
    ["高位の中間＋低位の中間", "\uD83D", "\uDE00"],
  ])(
    "#139 AC-1: 右端がペアの間（%s）で切れる範囲は拒否する",
    (_l, last, right) => {
      const result = cutAt(last, right);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues.map((issue) => issue.path)).toEqual([
        ["mentions", 0],
      ]);
    },
  );

  it.each([
    ["直前が高位の範囲のすぐ下（U+D7FF）、直後が低位", "\uD7FF", LOW_MIN],
    ["直前が低位の下限（高位の範囲のすぐ上）、直後が低位", LOW_MIN, LOW_MIN],
    [
      "直前が高位の下限、直後が低位の範囲のすぐ下（U+DBFF）",
      HIGH_MIN,
      HIGH_MAX,
    ],
    [
      "直前が高位の上限、直後が低位の範囲のすぐ上（U+E000）",
      HIGH_MAX,
      "\uE000",
    ],
    ["直前が普通の文字、直後が低位", "a", LOW_MIN],
    [
      "直前が高位、直後が普通の文字（孤立した高位はペアを分けない）",
      HIGH_MIN,
      "a",
    ],
    ["直前が高位、直後が本文の終わり", HIGH_MAX, ""],
  ])("#139 AC-1: %s は途中で切れていないので受け付ける", (_l, last, right) => {
    expect(cutAt(last, right).success).toBe(true);
  });

  it("#139 AC-1: 範囲の左端の直前が高位でも、先頭が@の範囲は受け付ける", () => {
    expect(
      messageContentSchema.safeParse({
        body: "\uD83D@a",
        mentions: [{ userId: USER_ID, start: 1, end: 3 }],
      }).success,
    ).toBe(true);
  });

  it("#139 AC-1: 不正な範囲の issue は、custom・path・空でない文言を持つ", () => {
    const result = messageContentSchema.safeParse({
      body: "ab",
      mentions: [{ userId: USER_ID, start: 0, end: 1 }],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toHaveLength(1);
    expect(result.error.issues[0]).toMatchObject({
      code: "custom",
      path: ["mentions", 0],
    });
    expect(result.error.issues[0]?.message.length).toBeGreaterThan(0);
  });
});
