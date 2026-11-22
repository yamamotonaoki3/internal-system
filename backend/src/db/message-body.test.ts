// #270（270-B）計画 2.1：本文の保存の表し方（backend/src/db/message-body.ts）の純粋関数を、決定の値から独立に確かめる（単体）。
// 根拠：利用者の決定1（本文なしは半角の空白1文字の目印を保存）・#201 U-2（空白・改行だけは空と同じ）・計画 2.1
//   toStoredBody(body)：本文が空白だけなら目印、それ以外は送られたまま（前後の空白は削らない）
//   fromStoredBody(stored)：目印と完全に等しいときだけ空文字、それ以外はそのまま
// 目印の期待はリテラル（STORED_EMPTY_BODY = " "）で書き、本番の定数から作らない。
// 契約（実装前の仮置き。実装の担当へ）：backend/src/db/message-body.ts が toStoredBody・fromStoredBody を export する。
import { describe, expect, it } from "vitest";
import { STORED_EMPTY_BODY } from "../../test/attachment-only-fixtures";
import { fromStoredBody, toStoredBody } from "./message-body";

describe("#270 計画 2.1 toStoredBody（API の本文 → DB の本文）", () => {
  it.each([
    ["空文字", ""],
    ["半角の空白1文字", " "],
    ["半角の空白2文字", "  "],
    ["全角の空白だけ", "　　"],
    ["改行とタブだけ", "\n\t\r\n"],
    ["空白と改行の混在", " \n　\t "],
  ])(
    "#270 AC-1（決定1・U-2）: %s は、目印（半角の空白1文字）になる",
    (_label, body) => {
      expect(toStoredBody(body)).toBe(STORED_EMPTY_BODY);
    },
  );

  it.each([
    ["ふつうの本文", "[UNIT_TEST]こんにちは"],
    ["前後に空白のある本文", "  [UNIT_TEST]前後に空白  "],
    ["前に半角の空白1文字の本文", " a"],
    ["後ろに改行の本文", "a\n"],
    ["1文字", "a"],
  ])(
    "#270 AC-1（#201 の決まりのまま）: %s は、送られたまま（削らない）",
    (_label, body) => {
      expect(toStoredBody(body)).toBe(body);
    },
  );
});

describe("#270 計画 2.1 fromStoredBody（DB の本文 → API の本文）", () => {
  it("#270 AC-4（決定1）: 目印（半角の空白1文字）だけは、空文字になる", () => {
    expect(fromStoredBody(STORED_EMPTY_BODY)).toBe("");
  });

  it.each([
    ["半角の空白2文字", "  "],
    ["全角の空白1文字", "　"],
    ["前に半角の空白のある本文", " a"],
    ["後ろに半角の空白のある本文", "a "],
    ["ふつうの本文", "[UNIT_TEST]こんにちは"],
  ])(
    "#270 AC-4: %s は、目印と完全に等しくないので、そのまま返す",
    (_label, stored) => {
      expect(fromStoredBody(stored)).toBe(stored);
    },
  );

  it.each([
    ["空文字", ""],
    ["半角の空白3文字", "   "],
    ["改行だけ", "\n"],
    ["全角の空白", "　"],
  ])(
    "#270 AC-4: 空白だけの入力（%s）は、保存して読み出すと空文字になる（往復）",
    (_label, body) => {
      expect(fromStoredBody(toStoredBody(body))).toBe("");
    },
  );

  it("#270 AC-4: ふつうの本文は、保存して読み出しても変わらない（往復）", () => {
    const body = "  [UNIT_TEST]前後に空白\n";
    expect(fromStoredBody(toStoredBody(body))).toBe(body);
  });
});
