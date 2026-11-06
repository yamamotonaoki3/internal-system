import { describe, expect, it } from "vitest";
import {
  DENIED_PASSWORDS_WITH_VALID_COMPOSITION,
  PASSWORD_IDENTITY,
  PASSWORD_POLICY_CASES,
} from "../../../test/password-policy-cases";
import { isPasswordAllowed } from "./password-policy";
import { isDeniedPassword } from "./password-denylist";

describe("#123 0-3 AC-2/3/10 新passwordの規則", () => {
  it.each(DENIED_PASSWORDS_WITH_VALID_COMPOSITION)(
    "#123 0-3 AC-3: 構成規則を満たしても採用禁止値 %s は拒否する",
    (password) => {
      expect(isPasswordAllowed(password, PASSWORD_IDENTITY)).toBe(false);
    },
  );
  it.each(PASSWORD_POLICY_CASES)(
    "#123 0-3 AC-2/3: $name",
    ({ password, valid }) => {
      expect(isPasswordAllowed(password, PASSWORD_IDENTITY)).toBe(valid);
    },
  );
  it("#123 0-3 AC-3: 3文字の社員ID/表示名は部分一致の対象外、4文字は対象", () => {
    expect(
      isDeniedPassword("XXabc12!", { loginId: "abc", displayName: "xyz" }),
    ).toBe(false);
    expect(
      isDeniedPassword("XXabcd12!", { loginId: "abcd", displayName: "xyz" }),
    ).toBe(true);
    expect(
      isDeniedPassword("XXabcd12!", { loginId: "xyz", displayName: "abcd" }),
    ).toBe(true);
  });
  it("#123 0-3 AC-3: 禁止判定はNFKCと小文字化を両側へ適用する", () => {
    expect(
      isDeniedPassword("A1!employee", {
        loginId: "ＥＭＰＬＯＹＥＥ",
        displayName: "xyz",
      }),
    ).toBe(true);
    expect(
      isDeniedPassword("ＰＡＳＳＷＯＲＤ１２３！", {
        loginId: "xyz",
        displayName: "abc",
      }),
    ).toBe(true);
  });
});
