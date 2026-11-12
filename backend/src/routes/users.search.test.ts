// #136 AC-2（1-2 AC-5・6-1 AC-4）・AC-3（C-168(3)）: 社員一覧（EP-7-01 GET /api/users）の表示名の検索 q を、実際のアプリ入口と隔離 D1 で確かめる。
// 計画 3章5・改訂2 指摘9 の決まり：
//  - q は前後の空白を除いて1〜100文字（V-34・C-90）。空・空白だけ・除いた後で101文字は 422（fields に q）。100文字は 200
//  - users.display_name の部分一致だけ（本名は対象外。C-75）。部署（departmentId）・カーソル・並び（表示名・IDの昇順）と組み合わせられる
//  - `%`・`_`・`\` は特別な意味を持たず、文字として扱う。`'`・`;`・`--`・`OR 1=1` で全件にならず、500 にもならない
//    （実装は LIKE＋ESCAPE ではなく instr(lower(display_name), lower(?)) による部分一致。D1 は LIKE のパターンを 50 バイトまでに制限し、
//     日本語の長い語で "LIKE or GLOB pattern too complex" になるため。「長い日本語の語」のテストがこの制限を検出する）
// 応答の形は既存の EP-7-01 と同じ（users.test.ts）。検索で項目は増えない。
// データは架空（testuser_srch_、テスト〜の表示名、[UNIT_TEST]、@example.com）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupProfileTestData,
  insertProfileUser,
  newProfileContext,
  profileRequest,
  sessionTokenFor,
  type ProfileContext,
} from "../../test/profile-fixtures";
import { insertDepartment } from "../../test/role-fixtures";

type DirectoryItem = {
  id: string;
  displayName: string;
  department: { id: string; name: string };
};
type DirectoryPage = { items: DirectoryItem[]; nextCursor: string | null };

let context: ProfileContext;
let deptS: string;
let deptT: string;
let token: string;
const ids: Record<string, string> = {};

const search = (query: Record<string, string>) =>
  profileRequest(
    context,
    "GET",
    `/api/users?${new URLSearchParams(query).toString()}`,
    {
      token,
    },
  );

async function namesFor(query: Record<string, string>) {
  const response = await search(query);
  expect(response.status).toBe(200);
  const page = (await response.json()) as DirectoryPage;
  return page.items.map((item) => item.displayName);
}

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  context = newProfileContext();
  deptS = await insertDepartment("検索S");
  deptT = await insertDepartment("検索T");
  const people: [string, string, string, string?][] = [
    // [キー, 部署, 表示名, 本名]
    ["alpha", deptS, "テスト検索アルファ", "テスト本名ガンマ"],
    ["beta", deptS, "テスト検索ベータ"],
    ["other", deptS, "テスト別名デルタ"],
    ["alphaT", deptT, "テスト検索アルファ二"],
    ["percent", deptS, "テスト率%表示"],
    ["noPercent", deptS, "テスト率表示"],
    ["under", deptS, "テスト_下線"],
    ["notUnder", deptS, "テストX下線"],
    ["backslash", deptS, "テスト\\円記号"],
    ["slashLess", deptS, "テスト円記号"],
    ["quote", deptS, "テスト'引用"],
  ];
  for (const [key, dept, displayName, legalName] of people)
    ids[key] = await insertProfileUser(
      context,
      `testuser_srch_${key.toLowerCase()}`,
      dept,
      {
        displayName,
        ...(legalName === undefined ? {} : { legalName }),
      },
    );
  ids.viewer = await insertProfileUser(context, "testuser_srch_viewer", deptT, {
    displayName: "テスト閲覧者",
  });
  token = await sessionTokenFor(ids.viewer);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupProfileTestData();
});

describe("#136 AC-2（1-2 AC-5・6-1 AC-4）・C-168(3) 表示名の部分一致", () => {
  it("#136 C-168(3): 表示名の部分一致（先頭・途中・末尾）で絞り込める", async () => {
    expect(await namesFor({ q: "検索", departmentId: deptS })).toEqual([
      "テスト検索アルファ",
      "テスト検索ベータ",
    ]);
    expect(await namesFor({ q: "ベータ", departmentId: deptS })).toEqual([
      "テスト検索ベータ",
    ]);
    expect(await namesFor({ q: "テスト別", departmentId: deptS })).toEqual([
      "テスト別名デルタ",
    ]);
  });

  it("#136 C-168(3): 1文字でも検索できる", async () => {
    // 並びは表示名の昇順（文字コードの順。「別」U+5225 は「検」U+691C より前）
    expect(await namesFor({ q: "タ", departmentId: deptS })).toEqual([
      "テスト別名デルタ",
      "テスト検索ベータ",
    ]);
  });

  it("#136 C-168(3)（C-75）: 本名では見つからない", async () => {
    expect(await namesFor({ q: "ガンマ" })).toEqual([]);
    expect(await namesFor({ q: "テスト本名" })).toEqual([]);
  });

  it("#136 C-168(3): 部署の絞り込みと組み合わせられる（他部署の一致は出ない）", async () => {
    expect(await namesFor({ q: "アルファ", departmentId: deptT })).toEqual([
      "テスト検索アルファ二",
    ]);
    expect(await namesFor({ q: "アルファ" })).toEqual([
      "テスト検索アルファ",
      "テスト検索アルファ二",
    ]);
  });

  it("#136 C-168(3): カーソルと組み合わせても、一致するものだけを重複・欠落なく、表示名・IDの昇順で辿れる", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 5; i += 1) {
      const query: Record<string, string> = { q: "検索", limit: "1" };
      if (cursor !== null) query.cursor = cursor;
      const response = await search(query);
      expect(response.status).toBe(200);
      const page = (await response.json()) as DirectoryPage;
      seen.push(...page.items.map((item) => item.displayName));
      cursor = page.nextCursor;
      if (cursor === null) break;
    }
    expect(seen).toEqual([
      "テスト検索アルファ",
      "テスト検索アルファ二",
      "テスト検索ベータ",
    ]);
    expect(cursor).toBeNull();
  });

  it("#136 C-168(3): 前後の空白は除いて検索する", async () => {
    expect(await namesFor({ q: "  ベータ　", departmentId: deptS })).toEqual([
      "テスト検索ベータ",
    ]);
  });

  it("#136 C-168(3): 検索しても応答の項目は増えない（本名を含まない）", async () => {
    const response = await search({ q: "アルファ", departmentId: deptS });
    const page = (await response.json()) as DirectoryPage;
    expect(Object.keys(page).sort()).toEqual(["items", "nextCursor"]);
    expect(JSON.stringify(page)).not.toContain("テスト本名");
    expect(JSON.stringify(page)).not.toContain("legalName");
  });
});

describe("#136 C-168(3) q の入力の境界", () => {
  it.each([
    ["空", ""],
    ["空白だけ", "   "],
    ["全角空白だけ", "　　"],
    ["101文字", "あ".repeat(101)],
    ["前後の空白を除いて101文字", ` ${"a".repeat(101)} `],
  ])("#136 C-168(3): q が%sなら 422（fields に q）", async (_label, q) => {
    const response = await search({ q });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { code: string; fields: string[] };
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.fields).toContain("q");
  });

  it.each([
    ["100文字", "あ".repeat(100)],
    ["前後に空白のある100文字", `  ${"あ".repeat(100)}  `],
  ])("#136 C-168(3): q が%sなら 200", async (_label, q) => {
    // 表示名を持つ行（beforeEach で入れた社員）がある状態で検索する。D1 の LIKE は行と照合するときにパターンの長さで失敗するため
    expect((await search({ q })).status).toBe(200);
  });

  it("#136 C-168(3)（D1 の制限）: 長い日本語の語（30文字・90バイト）でも 500 にならず、その表示名の行を返す", async () => {
    // 表示名の上限（30文字）いっぱいの日本語の表示名を持つ行を入れ、その全体で検索する。
    // D1 の LIKE はパターンが 50 バイトを超えると "LIKE or GLOB pattern too complex" で失敗するため、LIKE で照合していればここで 500 になる
    const longName = `テスト${"長".repeat(27)}`;
    expect(longName.length).toBe(30);
    await insertProfileUser(context, "testuser_srch_long", deptS, {
      displayName: longName,
    });
    expect(await namesFor({ q: longName })).toEqual([longName]);
    expect(await namesFor({ q: "長".repeat(20), departmentId: deptS })).toEqual(
      [longName],
    );
  });

  it("#136 C-168(3): q を2つ送ると 422（配列は受け付けない）", async () => {
    const response = await profileRequest(
      context,
      "GET",
      "/api/users?q=a&q=b",
      { token },
    );
    expect(response.status).toBe(422);
  });

  it("#136 C-168(3)（認可）: 未認証は q があっても 401", async () => {
    const response = await profileRequest(
      context,
      "GET",
      "/api/users?q=テスト",
      {
        token: null,
      },
    );
    expect(response.status).toBe(401);
  });
});

describe("#136 C-168(3) 記号を文字として扱うことと攻撃的な入力", () => {
  it("#136 C-168(3): % は文字として扱う（% を含む表示名だけが出る）", async () => {
    expect(await namesFor({ q: "%", departmentId: deptS })).toEqual([
      "テスト率%表示",
    ]);
    expect(await namesFor({ q: "率%", departmentId: deptS })).toEqual([
      "テスト率%表示",
    ]);
  });

  it("#136 C-168(3): _ は文字として扱う（任意の1文字に一致しない）", async () => {
    expect(await namesFor({ q: "テスト_下", departmentId: deptS })).toEqual([
      "テスト_下線",
    ]);
    expect(await namesFor({ q: "_", departmentId: deptS })).toEqual([
      "テスト_下線",
    ]);
  });

  it("#136 C-168(3): \\ は文字として扱う（\\ を含む表示名だけが出る。エスケープ文字として働かない）", async () => {
    expect(await namesFor({ q: "\\", departmentId: deptS })).toEqual([
      "テスト\\円記号",
    ]);
    expect(await namesFor({ q: "\\円", departmentId: deptS })).toEqual([
      "テスト\\円記号",
    ]);
    // \% は「\ と %」の2文字。% を含む表示名（テスト率%表示）に、\ がエスケープのように働いて一致することはない
    expect(await namesFor({ q: "\\%", departmentId: deptS })).toEqual([]);
  });

  it("#136 C-168(3): ' を含む語は、その文字として検索でき、500 にならない", async () => {
    expect(await namesFor({ q: "'", departmentId: deptS })).toEqual([
      "テスト'引用",
    ]);
  });

  it.each([
    ["' OR 1=1 --"],
    ["' OR '1'='1"],
    [";"],
    ["--"],
    ["'; DROP TABLE users; --"],
    ['" OR ""="'],
  ])(
    "#136 C-168(3): q=%j は 200 で、全件にならない（一致する表示名がないので0件）",
    async (q) => {
      const response = await search({ q });
      expect(response.status).toBe(200);
      const page = (await response.json()) as DirectoryPage;
      expect(page.items).toEqual([]);
      expect(page.nextCursor).toBeNull();
    },
  );

  it("#136 C-168(3): 攻撃的な入力の後も、社員の表は残っていて、通常の検索ができる", async () => {
    await search({ q: "'; DROP TABLE users; --" });
    expect(await namesFor({ q: "ベータ", departmentId: deptS })).toEqual([
      "テスト検索ベータ",
    ]);
  });
});
