// #138 AC-1（1-7 AC-2・AC-4）: リアクションの共通規則（shared/reaction-rules.ts）を、実装とは独立した期待値で固定する。
// 期待値は決定（U-2：文字のスタンプ6つ、U-3：固定の絵文字の一覧だけ受け付ける・肌の色は持たない、U-4：合わせて20種類まで、U-5：付けた人は1種類あたり最大50人）の
// 数字・文字をそのまま書く。本番の一覧から期待値を作らない（誤った定義を検出できる状態を保つ）。
// 置き場所は shared/message-rules.ts のテスト（backend/src/lib/message-rules.test.ts）と同じ。vitest.config.ts の backend の include で実行される。
//
// 実装が前提とする約束（計画「shared/reaction-rules.ts」）：
//   REACTION_KINDS = ["emoji", "stamp"] as const ／ MAX_REACTION_TYPES = 20 ／ MAX_REACTION_USERS_SHOWN = 50
//   STAMPS: readonly { id: string; label: string }[]（画面の順）
//   EMOJI_CATEGORIES: readonly { id: string; label: string; emojis: readonly { char: string; name: string }[] }[]
//   isValidReaction(kind, value): boolean（一覧に完全一致するものだけ true。正規化はしない）
import { describe, expect, it } from "vitest";
import {
  EMOJI_CATEGORIES,
  MAX_REACTION_TYPES,
  MAX_REACTION_USERS_SHOWN,
  REACTION_KINDS,
  STAMPS,
  isValidReaction,
} from "../../../shared/reaction-rules";

describe("#138 AC-1 定数（U-4・U-5）", () => {
  it("#138 AC-1（1-7 AC-4）: 種類は emoji と stamp の2つ", () => {
    expect([...REACTION_KINDS]).toEqual(["emoji", "stamp"]);
  });

  it("#138 AC-1（1-7 AC-4・U-4）: 1つの投稿に付けられる種類の上限は20", () => {
    expect(MAX_REACTION_TYPES).toBe(20);
  });

  it("#138 AC-1（1-7 AC-3・U-5）: 付けた人を示す人数は1種類あたり最大50人", () => {
    expect(MAX_REACTION_USERS_SHOWN).toBe(50);
  });
});

describe("#138 AC-1（1-7 AC-2・U-2）スタンプの一覧", () => {
  it("#138 AC-1（1-7 AC-2）: スタンプは6つで、id と日本語の名前・並びが決定どおり", () => {
    expect(
      STAMPS.map((stamp) => ({ id: stamp.id, label: stamp.label })),
    ).toEqual([
      { id: "like", label: "いいね" },
      { id: "ok", label: "了解" },
      { id: "thanks", label: "ありがとう" },
      { id: "good-work", label: "お疲れさまです" },
      { id: "checking", label: "確認します" },
      { id: "congrats", label: "おめでとう" },
    ]);
  });
});

describe("#138 AC-1（U-3）絵文字の一覧", () => {
  it("#138 AC-1（U-3）: 分類は空でなく、どの絵文字にも日本語の名前（読み上げ・title 用）がある", () => {
    expect(EMOJI_CATEGORIES.length).toBeGreaterThan(0);
    for (const category of EMOJI_CATEGORIES) {
      expect(category.id.length, category.id).toBeGreaterThan(0);
      expect(category.label.length, category.id).toBeGreaterThan(0);
      expect(category.emojis.length, category.id).toBeGreaterThan(0);
      for (const emoji of category.emojis)
        expect(
          emoji.name.length,
          `${category.id}:${emoji.char}`,
        ).toBeGreaterThan(0);
    }
  });

  it("#138 AC-1（U-3）: 約80個（60〜100個）で、同じ絵文字は2回入らない", () => {
    const all = EMOJI_CATEGORIES.flatMap((category) =>
      category.emojis.map((emoji) => emoji.char),
    );
    expect(all.length).toBeGreaterThanOrEqual(60);
    expect(all.length).toBeLessThanOrEqual(100);
    expect(new Set(all).size).toBe(all.length);
  });

  it("#138 AC-1（U-3）: 肌の色の修飾（U+1F3FB〜U+1F3FF）を含む絵文字を一覧に持たない", () => {
    for (const category of EMOJI_CATEGORIES)
      for (const emoji of category.emojis)
        expect(emoji.char, emoji.char).not.toMatch(/[\u{1F3FB}-\u{1F3FF}]/u);
  });

  it("#138 AC-1（計画 値の長さ）: 一覧の絵文字は、どれも UTF-16 の単位で16以下（value の上限16に収まる）", () => {
    for (const category of EMOJI_CATEGORIES)
      for (const emoji of category.emojis)
        expect(emoji.char.length, emoji.char).toBeLessThanOrEqual(16);
  });

  it("#138 AC-1（U-3）: 一覧のすべての絵文字を、emoji として受け付ける", () => {
    for (const category of EMOJI_CATEGORIES)
      for (const emoji of category.emojis)
        expect(isValidReaction("emoji", emoji.char), emoji.char).toBe(true);
  });
});

describe("#138 AC-1（1-7 AC-1・AC-2）値の検査（isValidReaction）", () => {
  it.each([
    ["emoji", "👍"],
    ["emoji", "🎉"],
    // 異体字セレクタ（U+FE0F）付き。一覧の文字列そのものを値にする
    ["emoji", "❤️"],
    ["stamp", "like"],
    ["stamp", "ok"],
    ["stamp", "thanks"],
    ["stamp", "good-work"],
    ["stamp", "checking"],
    ["stamp", "congrats"],
  ] as const)("#138 AC-1: 一覧にある %s の %s は受け付ける", (kind, value) => {
    expect(isValidReaction(kind, value)).toBe(true);
  });

  it.each([
    ["肌の色つき", "emoji", "👍🏻"],
    ["一覧にない絵文字", "emoji", "🐱"],
    ["空の絵文字", "emoji", ""],
    ["前に空白のある絵文字", "emoji", " 👍"],
    ["後ろに空白のある絵文字", "emoji", "👍 "],
    ["異体字セレクタのない ❤（正規化しない）", "emoji", "❤"],
    ["絵文字を2つつないだもの", "emoji", "👍👍"],
    ["絵文字でない文字", "emoji", "a"],
    ["一覧にないスタンプの id", "stamp", "stamp-unknown"],
    ["空のスタンプ", "stamp", ""],
    ["後ろに空白のあるスタンプ id", "stamp", "like "],
    ["大文字のスタンプ id", "stamp", "Like"],
    ["スタンプの日本語の名前（id ではない）", "stamp", "いいね"],
    ["65文字のスタンプ id", "stamp", "a".repeat(65)],
    ["17文字（上限16を超える）の絵文字の値", "emoji", "a".repeat(17)],
  ] as const)("#138 AC-1: %s は拒否する", (_label, kind, value) => {
    expect(isValidReaction(kind, value)).toBe(false);
  });

  it("#138 AC-1: kind の取り違えは拒否する（絵文字を stamp に・スタンプの id を emoji に）", () => {
    expect(isValidReaction("stamp", "👍")).toBe(false);
    expect(isValidReaction("emoji", "like")).toBe(false);
  });

  it("#138 AC-1: 知らない kind は、値が一覧にあっても拒否する", () => {
    expect(isValidReaction("sticker" as never, "like")).toBe(false);
    expect(isValidReaction("" as never, "👍")).toBe(false);
  });

  it("#138 AC-1: 一覧の継承されたプロパティ名（constructor・__proto__・toString）は拒否する", () => {
    for (const value of [
      "constructor",
      "__proto__",
      "toString",
      "hasOwnProperty",
    ]) {
      expect(isValidReaction("stamp", value), value).toBe(false);
      expect(isValidReaction("emoji", value), value).toBe(false);
    }
  });
});
