// #155（155-C）EP-4-02 GET /api/search/cases（結合テスト。実際のアプリ入口 → Route → Service → Repository → 隔離 D1）。計画 7章 A-1・R-3b（API の応答）。
// 期待は、計画 5章（クエリ q〔shared/search-rules.ts の searchKeywordSchema。前後の空白を除く・1〜100文字（UTF-16）・NUL は 422〕・limit〔1〜100、既定 20〕・cursor〔不正は 422〕。
//   応答 { items: [{ id, caseNumber, title, status, client{ id, name, isActive }, departments[{ id, name, isActive }], dueDate, progress, isParticipant, matchedIn }],
//   nextCursor }。総件数は返さない）、4章（見える範囲は全案件。参加していない人に、説明・参加者・参加者数・管理の資格・納期の変更の可否・部屋の ID・
//   最終更新・版を返さない）、R1-5（件名の一致は searchMethodOf・toFtsPhrase。二重引用符・FTS の演算子・途中の空白を含む語も、文字として一致）、
//   R1-7（無効な利用者は 401）、security（検索語をログに出さない・攻撃を狙った入力で 500 にならない）から決める。
// 403（perm.case.summary.view が無い）は、固定ロールがすべて持つため search.service.cases.test.ts で確かめる。
// データは架空（testuser_casereq_・[UNIT_TEST]）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import { editPath } from "../../test/case-edit-fixtures";
import {
  cleanupCaseTestData,
  joinedAt,
  seedCase,
  type SeededCase,
} from "../../test/case-fixtures";
import {
  setUserActive,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import {
  cleanupCaseTitleIndex,
  runCaseTitleIndexStatements,
} from "../../test/search-case-fixtures";
import { cleanupSearchIndex } from "../../test/search-fixtures";

const DESCRIPTION = "[UNIT_TEST]155C参加者だけの説明の本文";
/** 記号・FTS の演算子・途中の空白を含む件名（この案件だけが持つ） */
const SYMBOL_TITLE = `[UNIT_TEST]155C記号 100%_x 'q'; --c "d" OR 1=1 a*b NEAR AND z`;

let w: CaseWorld;
let joined: SeededCase;
let other: SeededCase;
let closed: SeededCase;
let symbol: SeededCase;
let consoleError: ReturnType<typeof vi.spyOn>;
let logLines: string[] = [];

type Item = Record<string, unknown> & { id: string };
type Page = { items: Item[]; nextCursor: string | null };

const searchPath = (query: Record<string, string>) =>
  `/api/search/cases?${new URLSearchParams(query).toString()}`;

function get(query: Record<string, string>, token: string | null) {
  return apiRequest("GET", searchPath(query), { token });
}

async function ok(query: Record<string, string>, token = w.memberS1.token) {
  const response = await get(query, token);
  expect(response.status, JSON.stringify(query)).toBe(200);
  return (await response.json()) as Page;
}

const idsOf = async (q: string, token = w.memberS1.token) =>
  (await ok({ q }, token)).items.map((i) => i.id);

async function expect422(query: Record<string, string>, field: string) {
  const response = await get(query, w.memberS1.token);
  expect(response.status, JSON.stringify(query)).toBe(422);
  const body = (await response.json()) as { code: string; fields: string[] };
  expect(body.code).toBe("VALIDATION_ERROR");
  expect(body.fields, JSON.stringify(query)).toContain(field);
}

beforeEach(async () => {
  logLines = [];
  const record = (...args: unknown[]) => {
    logLines.push(
      args
        .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
        .join(" "),
    );
  };
  vi.spyOn(console, "log").mockImplementation(record);
  vi.spyOn(console, "info").mockImplementation(record);
  vi.spyOn(console, "warn").mockImplementation(record);
  consoleError = vi.spyOn(console, "error").mockImplementation(record);
  w = await setupCaseWorld();
  joined = await seedCase({
    n: 1981,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]155C若草会館の案件",
    description: DESCRIPTION,
    dueDate: "2026-12-24",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    members: [{ userId: w.memberS1.id, joinedAt: joinedAt(1) }],
  });
  other = await seedCase({
    n: 1982,
    clientId: w.clientB.id,
    code: "QZB",
    title: "[UNIT_TEST]155C若草会館の別件",
    description: DESCRIPTION,
    createdBy: w.memberS2.id,
    departmentIds: [w.deptS.id],
    members: [{ userId: w.memberS2.id, joinedAt: joinedAt(1) }],
  });
  closed = await seedCase({
    n: 1983,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]155C若草会館の終了分",
    description: DESCRIPTION,
    status: "closed",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    members: [{ userId: w.memberS1.id, joinedAt: joinedAt(1) }],
  });
  symbol = await seedCase({
    n: 1984,
    clientId: w.clientA.id,
    code: "QZA",
    title: SYMBOL_TITLE,
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
  });
  for (const seeded of [joined, other, closed, symbol])
    await runCaseTitleIndexStatements(seeded.id);
});

afterEach(async () => {
  vi.restoreAllMocks();
  try {
    await cleanupSearchIndex();
  } finally {
    await cleanupCaseTestData();
    await cleanupCaseTitleIndex();
  }
});

describe("#155 4-1 AC-3 155-C A-1 認証と入力の検証", () => {
  it("#155 A-1: ログインしていなければ 401 UNAUTHENTICATED", async () => {
    const response = await get({ q: "若草会館" }, null);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("#155 A-1 R1-7: 無効な利用者（セッションの後に無効化が確定した）は 401 で、結果を返さない", async () => {
    // 先に「ある」を確かめる
    expect(await idsOf("若草会館", w.memberD1.token)).toHaveLength(3);
    await setUserActive(w.memberD1.id, false);
    const response = await get({ q: "若草会館" }, w.memberD1.token);
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain(joined.id);
  });

  it("#155 4-1 AC-3 A-1: q の欠落・空・空白だけ（全角を含む）は 422（fields に q）", async () => {
    await expect422({}, "q");
    await expect422({ q: "" }, "q");
    await expect422({ q: "   " }, "q");
    await expect422({ q: "　　" }, "q");
  });

  it("#155 4-1 AC-3 A-1 R1-5: 100文字（前後の空白つきを含む）・𠮷×50（100単位）は 200", async () => {
    await ok({ q: "あ".repeat(100) });
    await ok({ q: ` ${"あ".repeat(100)} ` });
    await ok({ q: "𠮷".repeat(50) });
  });

  it("#155 4-1 AC-3 A-1 R1-5: 101文字・𠮷×51（102単位）は 422（fields に q）", async () => {
    await expect422({ q: "あ".repeat(101) }, "q");
    await expect422({ q: "𠮷".repeat(51) }, "q");
  });

  it("#155 4-1 AC-3 A-1 R1-5: NUL を含む q（前・中・後ろ、3文字以上・1〜2文字）は 422（fields に q）", async () => {
    for (const q of [
      "\u0000若草会館",
      "若草\u0000会館",
      "若草会館\u0000",
      "a\u0000",
      "\u0000",
    ])
      await expect422({ q }, "q");
  });

  it("#155 A-1: limit は1〜100（既定 20）。0・101・数でない値は 422", async () => {
    await ok({ q: "若草会館", limit: "1" });
    await ok({ q: "若草会館", limit: "100" });
    await expect422({ q: "若草会館", limit: "0" }, "limit");
    await expect422({ q: "若草会館", limit: "101" }, "limit");
    await expect422({ q: "若草会館", limit: "abc" }, "limit");
  });

  it("#155 A-1: 壊れた cursor は 422", async () => {
    await expect422({ q: "若草会館", cursor: "@@@" }, "cursor");
    await expect422({ q: "若草会館", cursor: "eyJ2IjoxfQ" }, "cursor");
  });
});

describe("#155 4-1 AC-3 155-C A-1 攻撃を狙った入力・FTS の構文の文字（R1-5）", () => {
  it.each([
    "100%_x",
    "'q';",
    "--c",
    '"d"',
    "OR 1=1",
    "a*b",
    "NEAR AND",
    "%_",
    "; --c",
  ])(
    "#155 A-1: 語「%s」は 500 にならず、文字として件名に一致する（その案件だけ）",
    async (q) => {
      const page = await ok({ q });
      expect(page.items.map((i) => i.id)).toEqual([symbol.id]);
      expect(page.items[0]?.matchedIn).toEqual(["title"]);
    },
  );

  it.each(["OR", "AND", "NEAR", "*", '"', "'", ";", "\\", "a OR b", "x AND"])(
    "#155 A-1: FTS の演算子・記号だけの語「%s」でも 500 にならない（200）",
    async (q) => {
      const response = await get({ q }, w.memberS1.token);
      expect({ q, status: response.status }).toEqual({ q, status: 200 });
    },
  );
});

describe("#155 4-2 AC-1 155-C 応答の形と、再編集の反映", () => {
  it("#155 4-2 AC-2: 応答は items と nextCursor だけ（総件数を持たない）。行の項目は検索の結果の項目だけ", async () => {
    const page = await ok({ q: "若草会館" });
    expect(Object.keys(page).sort()).toEqual(["items", "nextCursor"]);
    expect(page.nextCursor).toBeNull();
    for (const item of page.items)
      expect(Object.keys(item).sort()).toEqual(
        [
          "caseNumber",
          "client",
          "departments",
          "dueDate",
          "id",
          "isParticipant",
          "matchedIn",
          "progress",
          "status",
          "title",
        ].sort(),
      );
    expect(page.items.map((i) => i.id)).toEqual([
      closed.id,
      other.id,
      joined.id,
    ]);
    expect(page.items.find((i) => i.id === joined.id)).toEqual({
      id: joined.id,
      caseNumber: joined.caseNumber,
      title: "[UNIT_TEST]155C若草会館の案件",
      status: "active",
      client: { id: w.clientA.id, name: w.clientA.name, isActive: true },
      departments: [{ id: w.deptS.id, name: w.deptS.name, isActive: true }],
      dueDate: "2026-12-24",
      progress: null,
      isParticipant: true,
      matchedIn: ["title"],
    });
  });

  it("#155 4-2 AC-3: 案件番号（ハイフンなし・小文字・前後の空白）と取引先名でも、API から引ける", async () => {
    const bare = joined.caseNumber.replaceAll("-", "").slice(0, 7);
    const page = await ok({ q: `  ${bare.toLowerCase()}  ` });
    expect(page.items.map((i) => i.id)).toContain(joined.id);
    expect(page.items.find((i) => i.id === joined.id)?.matchedIn).toEqual([
      "caseNumber",
    ]);
    const byClient = await ok({ q: "テスト商事b" });
    expect(byClient.items.map((i) => i.id)).toEqual([other.id]);
    expect(byClient.items[0]?.matchedIn).toEqual(["client"]);
  });

  it("#155 4-2 AC-3: 全角で打った案件番号（全角の英数字・全角のハイフン・長音符）でも、API から引ける（利用者の決定 2026-11-21）", async () => {
    const full = joined.caseNumber
      .slice(0, 8)
      .replace(/[A-Z0-9]/g, (c) =>
        String.fromCharCode(c.charCodeAt(0) + 0xfee0),
      );
    for (const q of [
      full.replace("-", "\uFF0D"),
      full.replace("-", "\u30FC"),
    ]) {
      const page = await ok({ q });
      expect(page.items.map((i) => i.id)).toContain(joined.id);
      expect(page.items.find((i) => i.id === joined.id)?.matchedIn).toEqual([
        "caseNumber",
      ]);
    }
  });

  it("#155 4-1 AC-3 A-1: limit=1 で、nextCursor を付けると次のページ（ID の降順で前のページより古い案件）が返り、重複・欠落なく終わる", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let round = 0; round < 5; round += 1) {
      const query: Record<string, string> =
        cursor === null
          ? { q: "若草会館", limit: "1" }
          : { q: "若草会館", limit: "1", cursor };
      const page = await ok(query);
      expect(page.items).toHaveLength(1);
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
      if (cursor === null) break;
    }
    expect(seen).toEqual([closed.id, other.id, joined.id]);
    expect(cursor).toBeNull();
  });

  it("#155 4-2 AC-1 I-1: 再編集（EP-5-20）で件名を変えると、再読み込みなしの次の検索で、新しい件名で出て、古い件名では出ない", async () => {
    expect(await idsOf("若草会館の案件")).toEqual([joined.id]);
    const edited = await apiRequest("PATCH", editPath(joined.id), {
      token: w.memberS1.token,
      body: { version: 1, title: "[UNIT_TEST]155C山吹会館の案件" },
    });
    expect(edited.status).toBe(200);
    expect(await idsOf("山吹会館")).toEqual([joined.id]);
    expect(await idsOf("若草会館の案件")).toEqual([]);
  });
});

describe("#155 4-2 AC-1・AC-2 155-C R-3b 見える範囲（API の応答の生の JSON）", () => {
  const ACTORS = [
    { name: "参加者（memberS1）", token: () => w.memberS1.token },
    {
      name: "参加していない担当部署のオーナー（ownerS）",
      token: () => w.ownerS.token,
    },
    { name: "参加していない全体管理者（admin）", token: () => w.admin.token },
    {
      name: "参加していない一般の社員（memberD1）",
      token: () => w.memberD1.token,
    },
  ];

  it("#155 4-2 AC-1 R-3b: 4者の結果の案件の集合（進行中と終了を含む）と並びは完全に一致する", async () => {
    for (const actor of ACTORS)
      expect({
        actor: actor.name,
        ids: await idsOf("若草会館", actor.token()),
      }).toEqual({ actor: actor.name, ids: [closed.id, other.id, joined.id] });
  });

  const FORBIDDEN = [
    "participantCount",
    "canManage",
    "canEditDueDate",
    "channelId",
    "lastActivityAt",
    "description",
    "participants",
    "version",
  ];

  for (const actor of ACTORS)
    it.each(FORBIDDEN)(
      `#155 4-2 AC-2 R-3b: ${actor.name} への応答の行に、項目 %s が無い（生の JSON）`,
      async (field) => {
        const response = await get({ q: "若草会館" }, actor.token());
        expect(response.status).toBe(200);
        const raw = (await response.json()) as { items: unknown[] };
        expect(raw.items).toHaveLength(3);
        for (const item of raw.items)
          expect(
            Object.prototype.hasOwnProperty.call(item as object, field),
          ).toBe(false);
      },
    );

  it.each(ACTORS)(
    "#155 4-2 AC-2 R-3b: $name への応答の本文に、説明の本文・部屋の ID が含まれない",
    async ({ token }) => {
      const text = await (await get({ q: "若草会館" }, token())).text();
      expect(text).toContain(joined.id);
      expect(text).not.toContain(DESCRIPTION);
      for (const seeded of [joined, other, closed])
        expect(text).not.toContain(seeded.roomId);
    },
  );
});

describe("#155 155-C A-1 応答の見出し・制御文字（security・155-A と同じ決まり）", () => {
  it("#155 A-1 security: 認証が必要な API の応答に Cache-Control: no-store が付く", async () => {
    const response = await get({ q: "若草会館" }, w.memberS1.token);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control") ?? "").toContain("no-store");
  });

  it("#155 A-1: NUL 以外の制御文字（改行・タブ・U+0001・U+007F）を含む q は 500 にならない（いまの動きは 200）", async () => {
    for (const q of [
      "若草\n会館",
      "若草\t会館",
      "若草\u0001会館",
      "若草\u007f会館",
      "\u0001a",
    ]) {
      const response = await get({ q }, w.memberS1.token);
      expect({ q, status: response.status }).toEqual({ q, status: 200 });
    }
  });
});

describe("#155 155-C A-1 検索語をログに出さない・console.error を出さない", () => {
  it("#155 A-1: 成功・422 のどちらでも、検索語がログ（console）に出ない", async () => {
    const term = "秘匿案件語ゼータ";
    logLines = [];
    await ok({ q: term });
    await expect422({ q: `${term}${"あ".repeat(100)}` }, "q");
    await ok({ q: term, limit: "5" });
    const joinedLog = logLines.join("\n");
    expect(joinedLog).not.toContain(term);
    expect(joinedLog).not.toContain(encodeURIComponent(term));
  });

  it("#155 A-1: 成功の検索（件名・番号・取引先名・記号の語）で console.error が出ない", async () => {
    consoleError.mockClear();
    await ok({ q: "若草会館" });
    await ok({ q: "QZA2611" });
    await ok({ q: "テスト商事" });
    await ok({ q: "OR 1=1" });
    expect(consoleError).not.toHaveBeenCalled();
  });
});
