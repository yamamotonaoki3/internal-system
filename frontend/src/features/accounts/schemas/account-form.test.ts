// #199 AC-2・AC-3・AC-4: S-23 の入力チェック（account-form.ts）の境界値と、利用者に見せる案内の文言。
// 期待値は定義から作らず、仕様（V-01〜V-06・V-11・V-12、0-1 AC-3、0-4 AC-11（初期表示名は本名と同じ値。docs/requirements/00-foundation.md 104行、api-draft.md V-05））の数値と画面の文言を直接書く。データは架空。
import { describe, expect, it } from "vitest";
import { accountFormSchema, initialDisplayName } from "./account-form";

const valid = {
  loginId: "testuser_001",
  legalName: "テスト太郎",
  displayName: "テスト表示",
  email: "testuser_001@example.com",
  departmentId: "01JTESTDEPT000000000000001",
  extension: "",
  jobTitle: "",
  emailConfirmed: true,
};

function parse(overrides: Record<string, unknown>) {
  return accountFormSchema.safeParse({ ...valid, ...overrides });
}

/** その項目のエラーの文言（なければ undefined） */
function messageOf(overrides: Record<string, unknown>, field: string) {
  const result = parse(overrides);
  if (result.success) return undefined;
  return result.error.issues.find((issue) => issue.path[0] === field)?.message;
}

describe("#199 アカウント登録の入力チェック（S-23）", () => {
  it("#199 AC-2: 正しい入力は通り、前後の空白を除いた値になる", () => {
    const result = parse({
      loginId: " testuser_001 ",
      legalName: " テスト太郎 ",
      displayName: " テスト表示 ",
      email: " testuser_001@example.com ",
      extension: " 0000 ",
      jobTitle: " 課長 ",
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      ...valid,
      extension: "0000",
      jobTitle: "課長",
    });
  });

  it("#199 AC-2（V-01・V-02）: 社員IDは3〜32文字の英数字と . _ - だけ", () => {
    const message =
      "社員IDは半角英数字と「.」「_」「-」の3〜32文字で入力してください";
    expect(parse({ loginId: "abc" }).success).toBe(true);
    expect(parse({ loginId: "a".repeat(32) }).success).toBe(true);
    expect(parse({ loginId: "A.b_c-1" }).success).toBe(true);
    for (const loginId of ["ab", "a".repeat(33), "", "test@user", "テスト"])
      expect(messageOf({ loginId }, "loginId"), loginId).toBe(message);
  });

  it("#199 AC-2（V-05）: 本名は前後の空白を除いて1〜50文字", () => {
    expect(parse({ legalName: "テ" }).success).toBe(true);
    expect(parse({ legalName: "テ".repeat(50) }).success).toBe(true);
    expect(parse({ legalName: ` ${"テ".repeat(50)} ` }).success).toBe(true);
    expect(messageOf({ legalName: "" }, "legalName")).toBe(
      "本名を入力してください",
    );
    expect(messageOf({ legalName: "   " }, "legalName")).toBe(
      "本名を入力してください",
    );
    expect(messageOf({ legalName: "テ".repeat(51) }, "legalName")).toBe(
      "本名は50文字以内で入力してください",
    );
  });

  it("#199 AC-2（V-03）: 表示名は前後の空白を除いて1〜30文字", () => {
    expect(parse({ displayName: "テ".repeat(30) }).success).toBe(true);
    expect(parse({ displayName: ` ${"テ".repeat(30)} ` }).success).toBe(true);
    expect(messageOf({ displayName: " " }, "displayName")).toBe(
      "表示名を入力してください",
    );
    expect(messageOf({ displayName: "テ".repeat(31) }, "displayName")).toBe(
      "表示名は30文字以内で入力してください",
    );
  });

  it("#199 AC-2: 本名・表示名・役職の制御文字（末尾のタブを含む）は拒否する", () => {
    const message = "改行などの制御文字は使えません";
    expect(messageOf({ legalName: "テスト\n太郎" }, "legalName")).toBe(message);
    expect(messageOf({ legalName: "テスト太郎\t" }, "legalName")).toBe(message);
    expect(messageOf({ displayName: "テスト\u0000" }, "displayName")).toBe(
      message,
    );
    expect(messageOf({ jobTitle: "課長\t" }, "jobTitle")).toBe(message);
  });

  it("#199 AC-2（V-06）: メールは必須・254文字以内・標準の形式", () => {
    const local = "a".repeat(64);
    const at254 = `${local}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(57)}.com`;
    expect(at254).toHaveLength(254);
    expect(parse({ email: at254 }).success).toBe(true);
    expect(messageOf({ email: `${at254.slice(0, -4)}d.com` }, "email")).toBe(
      "メールアドレスは254文字以内で入力してください",
    );
    expect(messageOf({ email: "" }, "email")).toBe(
      "メールアドレスを入力してください",
    );
    expect(messageOf({ email: "  " }, "email")).toBe(
      "メールアドレスを入力してください",
    );
    for (const email of ["testuser_001", "testuser_001@", "@example.com"])
      expect(messageOf({ email }, "email"), email).toBe(
        "メールアドレスの形式で入力してください",
      );
  });

  it("#199 AC-1・AC-4（V-12）: 所属部署は必須", () => {
    expect(messageOf({ departmentId: "" }, "departmentId")).toBe(
      "所属部署を選んでください",
    );
  });

  it("#199 AC-2（V-10・V-11）: 内線は任意で、入れるなら数字とハイフンの1〜10文字", () => {
    const message = "内線番号は半角数字とハイフンの10文字以内です";
    expect(parse({ extension: "" }).success).toBe(true);
    expect(parse({ extension: "   " }).success).toBe(true);
    expect(parse({ extension: "0".repeat(10) }).success).toBe(true);
    expect(parse({ extension: "12-34" }).success).toBe(true);
    for (const extension of ["0".repeat(11), "12a", "１２"])
      expect(messageOf({ extension }, "extension"), extension).toBe(message);
  });

  it("#199 AC-2（V-10・V-11）: 役職は任意で、前後の空白を除いて30文字まで", () => {
    expect(parse({ jobTitle: "" }).success).toBe(true);
    expect(parse({ jobTitle: "課".repeat(30) }).success).toBe(true);
    expect(parse({ jobTitle: ` ${"課".repeat(30)} ` }).success).toBe(true);
    expect(messageOf({ jobTitle: "課".repeat(31) }, "jobTitle")).toBe(
      "役職は30文字以内で入力してください",
    );
  });

  it("#199 AC-3（0-1 AC-3）: メールの確認のチェックがないと通さない", () => {
    expect(messageOf({ emailConfirmed: false }, "emailConfirmed")).toBe(
      "メールアドレスが会社発行のものか、確認してください",
    );
  });
});

describe("#199 表示名の初期値（initialDisplayName）", () => {
  it("#199 AC-2（0-4 AC-11・A-1）: 本名が30文字までなら同じ値、31文字以上なら空", () => {
    expect(initialDisplayName("テスト太郎")).toBe("テスト太郎");
    expect(initialDisplayName("テ".repeat(30))).toBe("テ".repeat(30));
    expect(initialDisplayName("テ".repeat(31))).toBe("");
  });

  it("#199 AC-2: 前後の空白は除いて数え、除いた値を入れる", () => {
    expect(initialDisplayName("  テスト太郎  ")).toBe("テスト太郎");
    expect(initialDisplayName(` ${"テ".repeat(30)} `)).toBe("テ".repeat(30));
    expect(initialDisplayName("   ")).toBe("");
  });
});
