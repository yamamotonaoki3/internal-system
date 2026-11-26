// #298 AC-5・AC-6（ADR-0035・docs/design/auth-session.md の「409 を受けたとき」）：
// isSessionUserMismatchError は「409 かつコードが SESSION_USER_MISMATCH」のときだけ真。資格の確かめ（useCaseAccessLoss）が、
// 取り直しの失敗（形の決まらない値）に対して使うので、ApiError の形でない値でも例外を出さず偽を返す（isConflictError のテストと同じ観点）。
// 期待の値（ステータス・コード）は、本番の定義から取り込まず、ここにリテラルで書く。データはすべて架空（[UNIT_TEST]）。
import { describe, expect, it } from "vitest";
import { isSessionUserMismatchError } from "./api-client";

const apiError = (status: number, code: string) => ({
  status,
  code,
  message: "[UNIT_TEST_298]食い違い",
});

describe("#298 AC-5・AC-6 isSessionUserMismatchError", () => {
  it("#298 AC-6: 409 かつ SESSION_USER_MISMATCH は真", () => {
    expect(
      isSessionUserMismatchError(apiError(409, "SESSION_USER_MISMATCH")),
    ).toBe(true);
  });

  it("#298 AC-5: 409 かつ CONFLICT は偽（競合は食い違いではない）", () => {
    expect(isSessionUserMismatchError(apiError(409, "CONFLICT"))).toBe(false);
  });

  it.each([400, 401, 403, 404, 500, 0])(
    "#298 AC-6: コードが SESSION_USER_MISMATCH でも、ステータスが %s なら偽（ステータスは 409 だけ）",
    (status) => {
      expect(
        isSessionUserMismatchError(apiError(status, "SESSION_USER_MISMATCH")),
      ).toBe(false);
    },
  );

  it("#298 AC-6: 409 でステータスの項目がない・コードの項目がない値は偽", () => {
    expect(isSessionUserMismatchError({ code: "SESSION_USER_MISMATCH" })).toBe(
      false,
    );
    expect(
      isSessionUserMismatchError({ status: 409, message: "[UNIT_TEST_298]" }),
    ).toBe(false);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["文字列", "SESSION_USER_MISMATCH"],
    ["数値", 409],
  ])(
    "#298 AC-6: ApiError の形でない値（%s）は、例外を出さずに偽",
    (_label, value) => {
      expect(isSessionUserMismatchError(value)).toBe(false);
    },
  );
});
