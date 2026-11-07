import { describe, expect, it } from "vitest";
import { setupFormSchema } from "./setup-form";

// 架空の形式確認用。実際の設定値ではなく、共有定数からも生成しない。
const TOKEN = `testonly_${"A".repeat(34)}`;
const INPUT = {
  setupToken: TOKEN,
  companyName: "[UNIT_TEST]会社",
  departmentName: "[UNIT_TEST]部署",
  loginId: "testuser_181",
  legalName: "testuser_181",
  email: "testuser_181@example.com",
  extension: "",
  jobTitle: "",
  emailConfirmed: true,
};

describe("#181 AC-2/4 初回セットアップ画面の独立した入力契約", () => {
  it.each([
    ["companyName", 100, "会社名は100文字以内で入力してください"],
    ["departmentName", 50, "部署名は50文字以内で入力してください"],
    ["legalName", 30, "本名は30文字以内で入力してください"],
    ["jobTitle", 30, "役職は30文字以内で入力してください"],
  ] as const)(
    "#181 AC-2: %s はtrim後の上限%i文字を許可し超過を欄に示す",
    (field, maximum, message) => {
      const value = "あ".repeat(maximum);
      expect(
        setupFormSchema.parse({ ...INPUT, [field]: `　${value} ` })[field],
      ).toBe(value);
      const rejected = setupFormSchema.safeParse({
        ...INPUT,
        [field]: `${value}あ`,
      });
      expect(rejected.success).toBe(false);
      expect(
        rejected.error?.issues.map(({ path, message }) => ({ path, message })),
      ).toEqual([{ path: [field], message }]);
    },
  );

  it.each(["companyName", "departmentName", "legalName"] as const)(
    "#181 AC-2: 必須の%sは1文字を許可する",
    (field) => {
      expect(
        setupFormSchema.safeParse({ ...INPUT, [field]: "あ" }).success,
      ).toBe(true);
    },
  );

  it.each(["t_1", `testuser_${"a".repeat(23)}`, "testuser_A0.z-9"])(
    "#181 AC-2: 社員IDの3/32文字と許可記号をtrim後に受け付ける (%s)",
    (loginId) => {
      expect(
        setupFormSchema.parse({ ...INPUT, loginId: `　${loginId} ` }).loginId,
      ).toBe(loginId);
    },
  );

  it.each([
    "ab",
    `testuser_${"a".repeat(24)}`,
    `testuser_${"a".repeat(55)}`,
    "testuser 181",
    "testuser+181",
    "テストユーザー",
    "testuser_181\nnext",
  ])("#181 AC-2/3: 新規社員IDの長さ・文字種違反を拒否する (%#)", (loginId) => {
    const result = setupFormSchema.safeParse({ ...INPUT, loginId });
    expect(result.success).toBe(false);
    expect(
      result.error?.issues.map(({ path, message }) => ({ path, message })),
    ).toEqual([
      {
        path: ["loginId"],
        message:
          "社員IDは半角英数字と「.」「_」「-」の3〜32文字で入力してください",
      },
    ]);
  });

  it("#181 AC-2: メールはtrim後254文字を許可し255文字を拒否する", () => {
    const email = `${"a".repeat(242)}@example.com`;
    expect(
      setupFormSchema.parse({ ...INPUT, email: ` ${email}　` }).email,
    ).toBe(email);
    const result = setupFormSchema.safeParse({ ...INPUT, email: `a${email}` });
    expect(
      result.error?.issues.map(({ path, message }) => ({ path, message })),
    ).toEqual([
      {
        path: ["email"],
        message: "メールアドレスは254文字以内で入力してください",
      },
    ]);
  });

  it("#181 AC-2: 長さ内でもメール形式が不正ならメール欄に示す", () => {
    const result = setupFormSchema.safeParse({ ...INPUT, email: "invalid" });
    expect(
      result.error?.issues.map(({ path, message }) => ({ path, message })),
    ).toEqual([
      { path: ["email"], message: "メールアドレスの形式で入力してください" },
    ]);
  });

  it.each(["", "0", "090-000000"])(
    "#181 AC-2: 内線の空文字・1文字・10文字をtrim後に受け付ける (%#)",
    (extension) => {
      expect(
        setupFormSchema.parse({ ...INPUT, extension: ` ${extension}　` })
          .extension,
      ).toBe(extension);
    },
  );

  it.each(["0".repeat(11), "12a4", "１２３", "12 34"])(
    "#181 AC-2: 内線の上限と半角数字・ハイフンを守る (%s)",
    (extension) => {
      const result = setupFormSchema.safeParse({ ...INPUT, extension });
      expect(
        result.error?.issues.map(({ path, message }) => ({ path, message })),
      ).toEqual([
        {
          path: ["extension"],
          message: "内線番号は半角数字とハイフンの10文字以内です",
        },
      ]);
    },
  );

  it("#181 AC-2: 画面の任意欄は空白を空文字にし、省略とは区別する", () => {
    expect(
      setupFormSchema.parse({ ...INPUT, extension: "　 ", jobTitle: "　 " }),
    ).toEqual(INPUT);
    const result = setupFormSchema.safeParse({
      ...INPUT,
      extension: undefined,
      jobTitle: undefined,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map(({ path }) => path)).toEqual([
      ["extension"],
      ["jobTitle"],
    ]);
  });

  it("#181 AC-2: トークンは前後空白を除いた43文字の英数・_-を使う", () => {
    const setupToken = `Az09_-${"a".repeat(37)}`;
    expect(
      setupFormSchema.parse({ ...INPUT, setupToken: `　${setupToken} \n` })
        .setupToken,
    ).toBe(setupToken);
  });

  it.each([
    TOKEN.slice(0, 42),
    `${TOKEN}A`,
    `+${TOKEN.slice(1)}`,
    `/${TOKEN.slice(1)}`,
    `=${TOKEN.slice(1)}`,
    `あ${TOKEN.slice(1)}`,
    `${TOKEN.slice(0, 20)} ${TOKEN.slice(21)}`,
  ])("#181 AC-2: トークンの長さ・文字種を検査する (%#)", (setupToken) => {
    const result = setupFormSchema.safeParse({ ...INPUT, setupToken });
    expect(result.success).toBe(false);
    expect(
      result.error?.issues.map(({ path, message }) => ({ path, message })),
    ).toEqual([
      {
        path: ["setupToken"],
        message: "トークンは43文字の英数字・「_」・「-」です",
      },
    ]);
  });

  it("#181 AC-2: 空欄と未確認のエラーを既存の欄順・文言で返す", () => {
    const result = setupFormSchema.safeParse({
      setupToken: "　 ",
      companyName: "　 ",
      departmentName: "　 ",
      loginId: "　 ",
      legalName: "　 ",
      email: "　 ",
      extension: "　 ",
      jobTitle: "　 ",
      emailConfirmed: false,
    });
    expect(result.success).toBe(false);
    expect(
      result.error?.issues.map(({ path, message }) => ({ path, message })),
    ).toEqual([
      {
        path: ["setupToken"],
        message: "トークンは43文字の英数字・「_」・「-」です",
      },
      { path: ["companyName"], message: "会社名を入力してください" },
      { path: ["departmentName"], message: "部署名を入力してください" },
      {
        path: ["loginId"],
        message:
          "社員IDは半角英数字と「.」「_」「-」の3〜32文字で入力してください",
      },
      { path: ["legalName"], message: "本名を入力してください" },
      { path: ["email"], message: "メールアドレスを入力してください" },
      {
        path: ["emailConfirmed"],
        message: "メールアドレスが会社発行の自分のものか、確認してください",
      },
    ]);
  });
});
