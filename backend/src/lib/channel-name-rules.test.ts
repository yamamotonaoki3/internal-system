// #131 AC-4（2-2 AC-4）・AC-13（2-2 AC-13）：チャンネル名・却下理由の共通規則（shared/channel-name-rules.ts）を、実装とは独立した期待値で固定する。
// 期待値は定義から作らず、要件（2-2 AC-4・AC-13、C-117・C-120、利用者決定：整形は全角英数・ハイフン・アンダースコアの半角化と前後の空白除去だけ）の
// 数字と文字をそのまま書く。
// 契約（実装者へ。計画「名前の規則」）：shared/channel-name-rules.ts が公開する
//  - CHANNEL_NAME_MAX_LENGTH = 50、CHANNEL_DESCRIPTION_MAX_LENGTH = 500、REJECT_REASON_MAX_LENGTH = 200
//  - formatChannelName(raw: string): string
//      全角英数字（U+FF10–FF19・FF21–FF3A・FF41–FF5A）→ 半角、全角「－」（U+FF0D）「＿」（U+FF3F）→ 半角、前後の空白（全角空白を含む）を除く。
//      NFKC は行わない（半角カナ・丸数字・全角記号は変えない）。途中の空白は残す
//  - channelRequestNameSchema（Zod）：整形 → 1〜50 文字（UTF-16 単位）→ 文字種。parse の結果は整形後の名前
//      使える文字：ひらがな U+3041–3096、カタカナ U+30A1–30FA、長音符「ー」、漢字（\p{Script=Han}）、「々」「〆」、A-Z a-z 0-9、「-」「_」
//  - rejectReasonSchema（Zod）：前後の空白を除いた後で 1〜200 文字。parse の結果は除いた後の理由
// データは架空のもの。
import { describe, expect, it } from "vitest";
import {
  CHANNEL_DESCRIPTION_MAX_LENGTH,
  CHANNEL_NAME_MAX_LENGTH,
  REJECT_REASON_MAX_LENGTH,
  channelRequestNameSchema,
  formatChannelName,
  rejectReasonSchema,
} from "../../../shared/channel-name-rules";

const ok = (name: string) => channelRequestNameSchema.safeParse(name).success;

describe("#131 AC-13（2-2 AC-13）上限の定数", () => {
  it("#131 AC-13（2-2 AC-13・AC-4）: 名前 50・説明 500・却下理由 200", () => {
    expect(CHANNEL_NAME_MAX_LENGTH).toBe(50);
    expect(CHANNEL_DESCRIPTION_MAX_LENGTH).toBe(500);
    expect(REJECT_REASON_MAX_LENGTH).toBe(200);
  });
});

describe("#131 AC-13（2-2 AC-13・C-121 の確定）formatChannelName", () => {
  it.each([
    ["全角の英大文字", "ＡＢＣＸＹＺ", "ABCXYZ"],
    ["全角の英小文字", "ａｂｃｘｙｚ", "abcxyz"],
    ["全角の数字", "０１２３４５６７８９", "0123456789"],
    ["全角のハイフン", "営業－共有", "営業-共有"],
    ["全角のアンダースコア", "営業＿共有", "営業_共有"],
    ["混在", "ＥＩＧＹＯ－１", "EIGYO-1"],
    ["前後の半角空白", "  営業  ", "営業"],
    ["前後の全角空白", "　営業　", "営業"],
    ["前後の空白と全角", " 　ＵＮＩＴ＿ＴＥＳＴ　 ", "UNIT_TEST"],
  ])("#131 AC-13: %s は半角に整形する（%s → %s）", (_label, raw, expected) => {
    expect(formatChannelName(raw)).toBe(expected);
  });

  it.each([
    ["半角カナ", "ｴｲｷﾞｮｳ"],
    ["丸数字", "営業①"],
    ["全角の感嘆符", "営業！"],
    ["全角のスラッシュ", "営業／共有"],
    ["途中の全角空白", "営業　共有"],
    ["途中の半角空白", "営業 共有"],
    ["ひらがな・カタカナ・漢字", "えいぎょうエイギョウ営業"],
  ])("#131 AC-13: NFKC は行わない。%s は変えない（%s）", (_label, raw) => {
    expect(formatChannelName(raw)).toBe(raw);
  });
});

describe("#131 AC-13（2-2 AC-13・C-117・C-120）channelRequestNameSchema：文字の種類", () => {
  it.each([
    ["英数字・ハイフン・アンダースコア", "Sales-team_01"],
    ["日本語とハイフン・アンダースコア", "営業_共有-2"],
    ["「々」「〆」「ー」", "々〆ー"],
    ["ひらがなの端（ぁ U+3041・ゖ U+3096）", "ぁゖ"],
    ["カタカナの端（ァ U+30A1・ヺ U+30FA）", "ァヺ"],
    ["漢字（拡張B のサロゲートペアを含む）", "営業𠮷"],
  ])("#131 AC-13: %s は使える", (_label, name) => {
    expect(ok(name)).toBe(true);
  });

  it.each([
    ["途中の半角空白", "営業 共有"],
    ["途中の全角空白", "営業　共有"],
    ["記号「!」", "営業!"],
    ["記号「[」「]」", "[E2E_TEST]営業"],
    ["中黒（U+30FB）", "営業・共有"],
    ["カタカナの範囲外（゠ U+30A0）", "゠営業"],
    ["ひらがなの範囲外（ゟ U+309F）", "営業ゟ"],
    ["繰り返し記号（ヽ U+30FD）", "営業ヽ"],
    ["半角カナ", "ｴｲｷﾞｮｳ"],
    ["制御文字（NUL）", "営業\u0000共有"],
    ["制御文字（タブ）", "営業\t共有"],
    ["制御文字（改行）", "営業\n共有"],
    ["制御文字（DEL）", "営業\u007f"],
    ["絵文字", "営業😀"],
    ["ドット", "sales.team"],
  ])("#131 AC-13: %s は使えない（%s）", (_label, name) => {
    expect(ok(name)).toBe(false);
  });
});

describe("#131 AC-13（2-2 AC-13・C-120、利用者の決定）漢字の範囲：CJK 統合漢字とその拡張だけ", () => {
  // 期待値は Unicode の区画の境界から書く（本番の定義から作らない）。版に依存する未割り当ての区画（拡張 J など）は入れない
  const char = (codePoint: number) => String.fromCodePoint(codePoint);

  it.each<[string, number]>([
    ["CJK 統合漢字の先頭（U+4E00）", 0x4e00],
    ["CJK 統合漢字の末尾（U+9FFF）", 0x9fff],
    ["拡張 A の先頭（U+3400）", 0x3400],
    ["拡張 A の末尾（U+4DBF）", 0x4dbf],
    ["拡張 B の先頭（U+20000）", 0x20000],
    ["拡張 B の末尾（U+2A6DF）", 0x2a6df],
    ["拡張 C の先頭（U+2A700）", 0x2a700],
    ["拡張 G の先頭（U+30000）", 0x30000],
    // 区画の末尾 U+3134F は未割り当て（U+3134B〜U+3134F。Unicode 17.0）のため、割り当て済みの末尾 U+3134A を使う
    ["拡張 G の割り当て済みの末尾（U+3134A）", 0x3134a],
    ["拡張 H の先頭（U+31350）", 0x31350],
    ["互換漢字の区画にある正式な統合漢字「﨑」（U+FA11）", 0xfa11],
    ["互換漢字の区画にある正式な統合漢字（U+FA0E）", 0xfa0e],
  ])(
    "#131 AC-13: %s は 1 文字でも、名前の途中でも使える",
    (_label, codePoint) => {
      expect(ok(char(codePoint))).toBe(true);
      expect(ok(`営業${char(codePoint)}共有`)).toBe(true);
    },
  );

  it("#131 AC-13: 「々」「〆」と通常の漢字の組み合わせは使える", () => {
    expect(ok("営業々〆")).toBe(true);
  });

  it.each<[string, number]>([
    ["CJK 互換漢字（U+FA10）", 0xfa10],
    ["CJK 互換漢字の先頭（U+F900）", 0xf900],
    ["CJK 互換漢字補助の先頭（U+2F800）", 0x2f800],
    ["CJK 互換漢字補助の末尾（U+2FA1F）", 0x2fa1f],
    ["康熙部首の先頭（U+2F00）", 0x2f00],
    ["康熙部首「⼈」（U+2F08）", 0x2f08],
    ["CJK 部首補助の先頭（U+2E80）", 0x2e80],
    ["「〻」（U+303B）", 0x303b],
    ["統合漢字でない文字（拡張 B と C の間の U+2A6E0）", 0x2a6e0],
  ])(
    "#131 AC-13: %s は、1 文字でも名前の途中でも使えない",
    (_label, codePoint) => {
      expect(ok(char(codePoint))).toBe(false);
      expect(ok(`営業${char(codePoint)}共有`)).toBe(false);
    },
  );
});

describe("#131 AC-13（2-2 AC-13）channelRequestNameSchema：長さと整形", () => {
  it("#131 AC-13: 整形後 1 文字と 50 文字は使える", () => {
    expect(ok("a")).toBe(true);
    expect(ok("a".repeat(50))).toBe(true);
  });

  it.each([
    ["空", ""],
    ["半角空白だけ", "   "],
    ["全角空白だけ", "　　"],
    ["51 文字", "a".repeat(51)],
  ])("#131 AC-13: %s は使えない", (_label, name) => {
    expect(ok(name)).toBe(false);
  });

  it("#131 AC-13: 前後に空白を付けた 50 文字は、空白を除いて通る", () => {
    expect(channelRequestNameSchema.parse(`  ${"a".repeat(50)}　`)).toBe(
      "a".repeat(50),
    );
  });

  it("#131 AC-13: 全角英数字 50 文字は、半角にした 50 文字として通る", () => {
    expect(channelRequestNameSchema.parse("Ａ".repeat(50))).toBe(
      "A".repeat(50),
    );
    expect(ok("Ａ".repeat(51))).toBe(false);
  });

  it("#131 AC-13: 長さは UTF-16 の単位で数える（𠮷 は 2 単位。25 個は可、26 個は不可）", () => {
    expect(ok("𠮷".repeat(25))).toBe(true);
    expect(ok("𠮷".repeat(26))).toBe(false);
  });

  it("#131 AC-13: parse の結果は整形後の名前（ＥＩＧＹＯ－１ → EIGYO-1）", () => {
    expect(channelRequestNameSchema.parse("ＥＩＧＹＯ－１")).toBe("EIGYO-1");
    expect(channelRequestNameSchema.parse(" 営業＿共有 ")).toBe("営業_共有");
  });

  it("#131 AC-13: 文字列でない値は使えない", () => {
    for (const value of [null, undefined, 1, {}, []])
      expect(channelRequestNameSchema.safeParse(value).success).toBe(false);
  });
});

describe("#131 AC-4（2-2 AC-4・C-54・V-27・V-28）rejectReasonSchema", () => {
  it.each([
    ["空", ""],
    ["半角空白だけ", "   "],
    ["全角空白だけ", "　　"],
    ["改行だけ", "\n\n"],
    ["201 文字", "あ".repeat(201)],
    ["前後に空白を付けた 201 文字", ` ${"あ".repeat(201)} `],
  ])("#131 AC-4: %s の理由は却下できない", (_label, reason) => {
    expect(rejectReasonSchema.safeParse(reason).success).toBe(false);
  });

  it("#131 AC-4: 前後の空白を除いた後の 1 文字と 200 文字は使える", () => {
    expect(rejectReasonSchema.parse("あ")).toBe("あ");
    expect(rejectReasonSchema.parse("あ".repeat(200))).toBe("あ".repeat(200));
  });

  it("#131 AC-4: 前後の空白を除いて保存する（除いた後が 200 文字なら通る）", () => {
    expect(rejectReasonSchema.parse(`  ${"あ".repeat(200)}　`)).toBe(
      "あ".repeat(200),
    );
    expect(rejectReasonSchema.parse(" 名前が重複しています ")).toBe(
      "名前が重複しています",
    );
  });

  it("#131 AC-6（2-2 AC-6）: スクリプトの文字列も、理由としてはそのまま受け取る（表示側で実行させない）", () => {
    expect(rejectReasonSchema.parse("<script>alert(1)</script>")).toBe(
      "<script>alert(1)</script>",
    );
  });
});
