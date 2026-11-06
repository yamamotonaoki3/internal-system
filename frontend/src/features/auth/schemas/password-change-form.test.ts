import { describe, expect, it } from "vitest";
import {
  DENIED_PASSWORDS_WITH_VALID_COMPOSITION,
  PASSWORD_IDENTITY,
  PASSWORD_IDENTITY_CASES,
  PASSWORD_POLICY_CASES,
} from "../../../../../test/password-policy-cases";
import { createPasswordChangeSchema } from "./password-change-form";

describe("#123 0-3 AC-2/AC-3/AC-10/AC-11 画面のパスワード規則", () => {
  it.each(PASSWORD_POLICY_CASES)(
    "#123 0-3 AC-2/AC-3: $name",
    ({ password, valid }) => {
      const result = createPasswordChangeSchema(PASSWORD_IDENTITY).safeParse({
        currentPassword: "OldExample456!",
        newPassword: password,
        confirmation: password,
      });
      expect(result.success).toBe(valid);
    },
  );

  it("#123 0-3 AC-1: 確認欄の不一致を拒否する", () => {
    const result = createPasswordChangeSchema(PASSWORD_IDENTITY).safeParse({
      currentPassword: "OldExample456!",
      newPassword: "Different456!",
      confirmation: "Different456?",
    });
    expect(result.success).toBe(false);
    expect(
      result.error?.issues.map(({ path, message }) => ({ path, message })),
    ).toEqual([
      {
        path: ["confirmation"],
        message: "新しいパスワードが一致しません",
      },
    ]);
  });

  it("#123 0-3 AC-3: 現在と同じ値への変更を拒否する", () => {
    const result = createPasswordChangeSchema(PASSWORD_IDENTITY).safeParse({
      currentPassword: "Different456!",
      newPassword: "Different456!",
      confirmation: "Different456!",
    });
    expect(result.success).toBe(false);
    expect(
      result.error?.issues.map(({ path, message }) => ({ path, message })),
    ).toEqual([
      {
        path: ["newPassword"],
        message: "現在とは異なるパスワードを入力してください",
      },
    ]);
  });

  it.each(DENIED_PASSWORDS_WITH_VALID_COMPOSITION)(
    "#123 0-3 AC-3: 構成規則を満たす禁止値 %s も理由を明かさず拒否する",
    (password) => {
      const result = createPasswordChangeSchema(PASSWORD_IDENTITY).safeParse({
        currentPassword: "OldExample456!",
        newPassword: password,
        confirmation: password,
      });
      expect(result.success).toBe(false);
      expect(
        result.error?.issues.map(({ path, message }) => ({ path, message })),
      ).toEqual([
        {
          path: ["newPassword"],
          message: "このパスワードは使えません",
        },
      ]);
    },
  );

  it.each(PASSWORD_IDENTITY_CASES)(
    "#123 0-3 AC-3: $name",
    ({ identity, password, denied }) => {
      const result = createPasswordChangeSchema(identity).safeParse({
        currentPassword: "OldExample456!",
        newPassword: password,
        confirmation: password,
      });
      expect(result.success).toBe(!denied);
      if (denied) {
        expect(
          result.error?.issues.map(({ path, message }) => ({ path, message })),
        ).toEqual([
          {
            path: ["newPassword"],
            message: "このパスワードは使えません",
          },
        ]);
      }
    },
  );

  it("#123 0-3 AC-2: 構成規則のエラーを新しいパスワード欄に表示できる", () => {
    const result = createPasswordChangeSchema(PASSWORD_IDENTITY).safeParse({
      currentPassword: "OldExample456!",
      newPassword: "abcdef12!",
      confirmation: "abcdef12!",
    });
    expect(
      result.error?.issues.map(({ path, message }) => ({ path, message })),
    ).toEqual([
      {
        path: ["newPassword"],
        message: "パスワードの条件を確認してください",
      },
    ]);
  });

  it("#123 0-3 AC-1: 現在と確認の必須エラーをそれぞれの欄に表示できる", () => {
    const result = createPasswordChangeSchema(PASSWORD_IDENTITY).safeParse({
      currentPassword: "",
      newPassword: "Different456!",
      confirmation: "",
    });
    expect(
      result.error?.issues.map(({ path, message }) => ({ path, message })),
    ).toEqual(
      expect.arrayContaining([
        {
          path: ["currentPassword"],
          message: "現在のパスワードを入力してください",
        },
        {
          path: ["confirmation"],
          message: "確認用のパスワードを入力してください",
        },
      ]),
    );
  });

  it.each(["x", " ", "legacy", "x".repeat(1024)])(
    "#123 0-3 AC-1/2: 現在のパスワードには新しい構成規則を適用しない (%#)",
    (currentPassword) => {
      const input = {
        currentPassword,
        newPassword: " Different456! ",
        confirmation: " Different456! ",
      };
      expect(
        createPasswordChangeSchema(PASSWORD_IDENTITY).parse(input),
      ).toEqual(input);
    },
  );

  it("#123 0-3 AC-1: 現在の入力の1024文字上限を超えたエラーは現在欄に対応する", () => {
    const result = createPasswordChangeSchema(PASSWORD_IDENTITY).safeParse({
      currentPassword: "x".repeat(1025),
      newPassword: "Different456!",
      confirmation: "Different456!",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map(({ path }) => path)).toEqual([
      ["currentPassword"],
    ]);
  });
});
