// #136 AC-1（1-2 AC-2）・AC-3（C-168(2)）: 通信の失敗の判定（isApiError）と、利用者に見せる文（describeError）。データは架空。
import { describe, expect, it } from "vitest";
import { describeError, isApiError } from "./describe-error";

const GENERIC = "エラーが発生しました。時間をおいて、もう一度お試しください";

describe("#136 isApiError", () => {
  it("#136 AC-3（C-168(2)）: status と message を持つオブジェクトは API のエラーと判定する", () => {
    expect(isApiError({ status: 409, message: "[UNIT_TEST]競合" })).toBe(true);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["文字列", "[UNIT_TEST]エラー"],
    ["数値", 404],
    ["真偽値", true],
  ])(
    "#136 AC-3（C-168(2)）: オブジェクトでない値（%s）は API のエラーと判定しない",
    (_name, value) => {
      expect(isApiError(value)).toBe(false);
    },
  );

  it("#136 AC-3（C-168(2)）: status を持たないオブジェクトは API のエラーと判定しない", () => {
    expect(isApiError({ message: "[UNIT_TEST]メッセージだけ" })).toBe(false);
  });

  it("#136 AC-3（C-168(2)）: message を持たないオブジェクトは API のエラーと判定しない", () => {
    expect(isApiError({ status: 500 })).toBe(false);
  });

  it("#136 AC-3（C-168(2)）: 通常の Error は API のエラーと判定しない", () => {
    expect(isApiError(new Error("[UNIT_TEST]通信失敗"))).toBe(false);
  });
});

describe("#136 describeError", () => {
  it("#136 AC-1（1-2 AC-2）: API のエラーは、そのメッセージをそのまま使う", () => {
    expect(
      describeError({ status: 500, message: "[UNIT_TEST]サーバー側の文" }),
    ).toBe("[UNIT_TEST]サーバー側の文");
  });

  it.each([
    ["通常の Error", new Error("[UNIT_TEST]内部の詳細")],
    ["null", null],
    ["文字列", "[UNIT_TEST]文字列"],
    ["status だけのオブジェクト", { status: 500 }],
  ])(
    "#136 AC-1（1-2 AC-2）: API のエラーでない値（%s）は、内部の詳細を出さず一般的な文にする",
    (_name, value) => {
      expect(describeError(value)).toBe(GENERIC);
    },
  );
});
