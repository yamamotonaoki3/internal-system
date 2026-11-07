import { describe, expect, it } from "vitest";
import {
  DENIED_PASSWORDS_WITH_VALID_COMPOSITION,
  DENIED_PASSWORDS_WITHOUT_VALID_COMPOSITION,
  PASSWORD_IDENTITY,
  PASSWORD_IDENTITY_CASES,
} from "../../../test/password-policy-cases";
import { isDeniedPassword } from "./password-denylist";

describe("#123 0-3 AC-3 禁止パスワードの採用ポリシー", () => {
  it.each([
    ...DENIED_PASSWORDS_WITH_VALID_COMPOSITION,
    ...DENIED_PASSWORDS_WITHOUT_VALID_COMPOSITION,
  ])("#123 0-3 AC-3: 採用した禁止値 %s を拒否する", (password) => {
    expect(isDeniedPassword(password, PASSWORD_IDENTITY)).toBe(true);
  });

  it.each(PASSWORD_IDENTITY_CASES)(
    "#123 0-3 AC-3: $name",
    ({ identity, password, denied }) => {
      expect(isDeniedPassword(password, identity)).toBe(denied);
    },
  );

  it.each(["Z9!xPassword123!suffix", " Password123!", "Password123! "])(
    "#123 0-3 AC-3/10: 固定値の一部分や前後空白を同一視しない (%s)",
    (password) => {
      expect(isDeniedPassword(password, PASSWORD_IDENTITY)).toBe(false);
    },
  );
});
