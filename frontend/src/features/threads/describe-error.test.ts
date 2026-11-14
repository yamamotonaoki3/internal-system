// #137 AC-4（1-4 AC-4）: スレッドの通信の失敗（既読の送信・一覧の取得）を、利用者に見せる文にする（describeError）。データは架空。
// API のエラー（status と message を持つオブジェクト）はそのメッセージを使い、それ以外は一般的な文にする（他の機能と同じ。もみ消さず、必ず文を返す）。
import { describe, expect, it } from "vitest";
import { describeError } from "./describe-error";

const GENERIC = "エラーが発生しました。時間をおいて、もう一度お試しください";

describe("#137 AC-4（1-4 AC-4）describeError", () => {
  it("#137 AC-4: API のエラー（status と message を持つ）は、そのメッセージをそのまま使う", () => {
    expect(
      describeError({
        status: 500,
        code: "TEST_ERROR",
        message: "[UNIT_TEST]既読を更新できません",
      }),
    ).toBe("[UNIT_TEST]既読を更新できません");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["文字列", "[UNIT_TEST]エラー"],
    ["数値", 404],
    ["真偽値", true],
  ])(
    "#137 AC-4: オブジェクトでない値（%s）は、一般的な文にする（例外を投げない）",
    (_name, value) => {
      expect(describeError(value)).toBe(GENERIC);
    },
  );

  it("#137 AC-4: status を持たないオブジェクト（通常の Error を含む）は、一般的な文にする", () => {
    expect(describeError({ message: "[UNIT_TEST]メッセージだけ" })).toBe(
      GENERIC,
    );
    expect(describeError(new Error("[UNIT_TEST]通信失敗"))).toBe(GENERIC);
  });

  it("#137 AC-4: message を持たないオブジェクトは、一般的な文にする", () => {
    expect(describeError({ status: 500 })).toBe(GENERIC);
  });
});
