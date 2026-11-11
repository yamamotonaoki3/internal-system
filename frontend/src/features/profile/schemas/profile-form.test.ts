// #130 AC-1（0-4 AC-3・AC-4・AC-9）：S-19 の入力チェック（schemas/profile-form.ts）の境界値・エラーの文言・対象の欄。
// 期待値は仕様（表示名 1〜30文字・一言 0〜100文字・制御文字は不可・在席は戻り予定を持たない）の数値と、画面に出す文言から直接書く。
import { describe, expect, it } from "vitest";
import { displayNameFormSchema, statusFormSchema } from "./profile-form";

type Issue = { path: PropertyKey[]; message: string };
function issuesOf(result: {
  success: boolean;
  error?: { issues: Issue[] };
}): { path: string; message: string }[] {
  if (result.success) return [];
  return (result.error?.issues ?? []).map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

const status = (overrides: Record<string, unknown> = {}) => ({
  status: "away",
  returnAt: "",
  statusMessage: "",
  ...overrides,
});

describe("#130 AC-1（0-4 AC-9）表示名のフォーム", () => {
  it("#130 AC-1（0-4 AC-9）: 1文字・30文字は可（前後の空白は除く）", () => {
    expect(displayNameFormSchema.safeParse({ displayName: "あ" }).success).toBe(
      true,
    );
    expect(
      displayNameFormSchema.parse({ displayName: ` ${"あ".repeat(30)} ` }),
    ).toEqual({ displayName: "あ".repeat(30) });
  });

  it("#130 AC-1（0-4 AC-9）: 空（空白だけ）は「表示名を入力してください」", () => {
    for (const value of ["", "   "])
      expect(
        issuesOf(displayNameFormSchema.safeParse({ displayName: value })),
      ).toEqual([{ path: "displayName", message: "表示名を入力してください" }]);
  });

  it("#130 AC-1（0-4 AC-9）: 31文字は「表示名は30文字以内で入力してください」", () => {
    expect(
      issuesOf(
        displayNameFormSchema.safeParse({ displayName: "あ".repeat(31) }),
      ),
    ).toEqual([
      { path: "displayName", message: "表示名は30文字以内で入力してください" },
    ]);
  });

  it("#130 AC-1（0-4 AC-9）: 制御文字は「改行などの制御文字は使えません」", () => {
    expect(
      issuesOf(
        displayNameFormSchema.safeParse({ displayName: "テスト\n改名" }),
      ),
    ).toEqual([
      { path: "displayName", message: "改行などの制御文字は使えません" },
    ]);
  });
});

describe("#130 AC-1（0-4 AC-3・AC-4）ステータスのフォーム", () => {
  it("#130 AC-1（0-4 AC-3）: 一言は100文字まで可（前後の空白は除く）", () => {
    expect(
      statusFormSchema.parse(status({ statusMessage: ` ${"あ".repeat(100)} ` }))
        .statusMessage,
    ).toBe("あ".repeat(100));
  });

  it("#130 AC-1（0-4 AC-3）: 一言の101文字は「一言メッセージは100文字以内で入力してください」", () => {
    expect(
      issuesOf(
        statusFormSchema.safeParse(status({ statusMessage: "あ".repeat(101) })),
      ),
    ).toEqual([
      {
        path: "statusMessage",
        message: "一言メッセージは100文字以内で入力してください",
      },
    ]);
  });

  it("#130 AC-1（0-4 AC-3）: 一言の改行は「改行などの制御文字は使えません」", () => {
    expect(
      issuesOf(statusFormSchema.safeParse(status({ statusMessage: "一\n二" }))),
    ).toEqual([
      { path: "statusMessage", message: "改行などの制御文字は使えません" },
    ]);
  });

  it("#130 AC-1（0-4 AC-4・P-3）: 在席に戻り予定を付けると、戻り予定の欄に「在席のときは戻り予定を指定できません」", () => {
    expect(
      issuesOf(
        statusFormSchema.safeParse(
          status({ status: "available", returnAt: "2099-01-02T15:30" }),
        ),
      ),
    ).toEqual([
      { path: "returnAt", message: "在席のときは戻り予定を指定できません" },
    ]);
  });

  it("#130 AC-1（0-4 AC-4）: 在席で戻り予定なし、在席以外で戻り予定あり・なしは可", () => {
    for (const input of [
      status({ status: "available", returnAt: "" }),
      status({ status: "away", returnAt: "2099-01-02T15:30" }),
      status({ status: "meeting", returnAt: "" }),
    ])
      expect(statusFormSchema.safeParse(input).success).toBe(true);
  });

  it("#130 AC-2（6-1 AC-3）: 5種類以外は不可", () => {
    expect(
      issuesOf(statusFormSchema.safeParse(status({ status: "busy" })))[0]?.path,
    ).toBe("status");
  });
});
