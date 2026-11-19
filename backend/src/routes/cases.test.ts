// #147（147-A）5-1 AC-2・AC-4・AC-12・AC-14・AC-17・AC-19・AC-21（Q6）、C-142(1)、レビュー2回目：案件の一覧（EP-5-06）・概要（EP-5-07）・
// 詳細（EP-5-08）を、実際のアプリ入口（index.ts の app）と隔離 D1 で確かめる。
// この層で確かめるもの（計画 147-A のテストケース）：状態コードと判定の順・応答の形（キーの完全一致）・非参加者に中身を出さないこと・
//   管理の資格のある人への参加者数・外された後と無効化の後の詳細・納期の形・無効の取引先と部署・退職者の行・no-store。
// SQL の範囲・カーソル・行ごとの participantCount の網羅は DB のテスト（db/case.repository.db.test.ts）で確かめ、ここでは重ねない。
// 判定の順（計画 147-A）：
//   一覧：認証（401）→ authorize(perm.case.summary.view, company)（403）→ クエリの形（422）
//   概要：認証 → authorize(perm.case.summary.view) → 案件がない（404「案件が見つかりません」。logger.audit）
//   詳細：認証 → 案件がない（404）→ 有効な参加者でない（403「参加者だけが見られます（非公開）」。logger.audit）→ authorize(perm.case.view, company)
//   パスの caseId が ULID の形でなければ 422 VALIDATION_ERROR（先例：添付の ID）。
// 契約（実装前の仮置き。実装の担当へ）：
//   GET /api/cases?scope=joined|all&status=active|closed&limit&cursor → 200 { items: 一覧の項目[], nextCursor }。scope・status は必須（既定なし）
//     一覧の項目のキーは、ちょうど id・caseNumber・title・status・client{id,name,isActive}・departments[{id,name,isActive}]・dueDate・
//     isParticipant・canManage・participantCount（参加者か管理の資格のある人だけ数、ほかは null）
//   GET /api/cases/:caseId → 200 一覧の項目と同じキー
//   GET /api/cases/:caseId/detail → 200 一覧の項目のキー ＋ description・channelId・createdBy・participants
//     participants[] のキーは、ちょうど userId・displayName・departmentName・isActive・isCreator。並びは参加した日時の順（同じなら userId の順）
//   エラーは { code, message }。403 は code: FORBIDDEN、404 は code: NOT_FOUND。全応答に Cache-Control: no-store
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import {
  CASES_BASE,
  CASE_MESSAGES,
  MISSING_CASE_ID,
  addCaseMember,
  cleanupCaseTestData,
  joinedAt,
  removeCaseMember,
  seedCase,
  setDisplayName,
  type SeededCase,
} from "../../test/case-fixtures";
import {
  setClientActive,
  setDepartmentActive,
  setUserActive,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";

type ErrorBody = { code: string; message: string; fields?: string[] };
type Summary = {
  id: string;
  caseNumber: string;
  title: string;
  status: string;
  client: { id: string; name: string; isActive: boolean };
  departments: { id: string; name: string; isActive: boolean }[];
  dueDate: string | null;
  isParticipant: boolean;
  canManage: boolean;
  participantCount: number | null;
};
type Participant = {
  userId: string;
  displayName: string;
  departmentName: string | null;
  isActive: boolean;
  isCreator: boolean;
};
type Detail = Summary & {
  description: string;
  channelId: string;
  createdBy: unknown;
  participants: Participant[];
};
type Page = { items: Summary[]; nextCursor: string | null };

const SUMMARY_KEYS = [
  "canEditDueDate",
  "canManage",
  "caseNumber",
  // #148（148-C）：案件の部屋の ID（有効な参加者だけ値。ほかは null）
  "channelId",
  "client",
  "departments",
  "dueDate",
  "id",
  "isParticipant",
  // #148（148-C）：最終更新（有効な参加者だけ値。ほかは null）
  "lastActivityAt",
  "participantCount",
  // #149（149-A）：TODO の進捗（R-78。全員に返す）
  "progress",
  "status",
  "title",
];
// #148（148-C）：channelId は概要の項目にも入ったため、重ねない
const DETAIL_KEYS = [
  ...new Set([
    ...SUMMARY_KEYS,
    "channelId",
    "createdBy",
    "description",
    "participants",
  ]),
].sort();
const PARTICIPANT_KEYS = [
  "autoRole",
  "departmentName",
  "displayName",
  "isActive",
  "isCreator",
  "removable",
  "userId",
];

const SECRET_DESCRIPTION = "[UNIT_TEST]147A参加者だけの説明";
const NAME_S1 = "テスト作成者147A";
const NAME_D1 = "テスト参加者147A";
const NAME_RETIRED = "テスト退職者147A";

let w: CaseWorld;
let logLines: string[];
/** 1：memberS1（作成者）・memberD1・inactive（退職者）。deptS 担当・取引先 A・納期あり・説明あり */
let main: SeededCase;
/** 2：memberD1 だけ。deptD 担当・取引先 B・納期なし */
let other: SeededCase;

const get = (path: string, token: string | null) =>
  apiRequest("GET", path, { token });
const listOf = (token: string, query: string) =>
  get(`${CASES_BASE}?${query}`, token);
const summaryOf = (id: string, token: string | null) =>
  get(`${CASES_BASE}/${id}`, token);
const detailOf = (id: string, token: string | null) =>
  get(`${CASES_BASE}/${id}/detail`, token);

/** logger.audit の failure の行（先例：case-requests.decide.test.ts） */
const failureAudits = () => logLines.filter((line) => line.includes("failure"));

beforeEach(async () => {
  logLines = [];
  const capture = (...args: unknown[]) => {
    logLines.push(args.map(String).join(" "));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
  w = await setupCaseWorld();
  await setDisplayName(w.memberS1.id, NAME_S1);
  await setDisplayName(w.memberD1.id, NAME_D1);
  await setDisplayName(w.inactive.id, NAME_RETIRED);
  main = await seedCase({
    n: 1,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]147A参加者の案件",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    description: SECRET_DESCRIPTION,
    dueDate: "2026-12-01",
    members: [
      { userId: w.memberS1.id, joinedAt: joinedAt(1) },
      { userId: w.memberD1.id, joinedAt: joinedAt(2) },
      { userId: w.inactive.id, joinedAt: joinedAt(3) },
    ],
  });
  other = await seedCase({
    n: 2,
    clientId: w.clientB.id,
    code: "QZB",
    title: "[UNIT_TEST]147A他部署の案件",
    createdBy: w.memberD1.id,
    departmentIds: [w.deptD.id],
    members: [{ userId: w.memberD1.id, joinedAt: joinedAt(1) }],
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupCaseTestData();
});

describe("#147 147-A 共通：認証・入力の形・no-store", () => {
  it.each([
    ["一覧", () => `${CASES_BASE}?scope=joined&status=active`],
    ["概要", () => `${CASES_BASE}/${MISSING_CASE_ID}`],
    ["詳細", () => `${CASES_BASE}/${MISSING_CASE_ID}/detail`],
  ])(
    "#147 判定の順: 未認証の%sは 401 UNAUTHENTICATED",
    async (_label, path) => {
      const res = await get(path(), null);
      expect(res.status).toBe(401);
      expect(((await res.json()) as ErrorBody).code).toBe("UNAUTHENTICATED");
    },
  );

  it.each([
    "status=active",
    "scope=joined",
    "scope=mine&status=active",
    "scope=joined&status=archived",
    "scope=joined&status=active&limit=0",
    "scope=joined&status=active&limit=101",
    "scope=joined&status=active&cursor=broken",
    "scope=joined&status=active&unknown=1",
  ])(
    "#147 5-1 AC-4・AC-12: 一覧のクエリ %s は 422 VALIDATION_ERROR（scope・status は必須で既定なし）",
    async (query) => {
      const res = await listOf(w.memberS1.token, query);
      expect(res.status).toBe(422);
      expect(((await res.json()) as ErrorBody).code).toBe("VALIDATION_ERROR");
    },
  );

  it.each([
    ["概要", (token: string) => summaryOf("not-a-ulid", token)],
    ["詳細", (token: string) => detailOf("not-a-ulid", token)],
  ])(
    "#147: %sの案件の ID が ULID の形でなければ 422 VALIDATION_ERROR",
    async (_label, call) => {
      const res = await call(w.memberS1.token);
      expect(res.status).toBe(422);
      expect(((await res.json()) as ErrorBody).code).toBe("VALIDATION_ERROR");
    },
  );

  it("#147 backend-hono: 一覧・概要・詳細の成功と 403・404 の応答に Cache-Control: no-store を付ける", async () => {
    const responses = [
      await listOf(w.memberS1.token, "scope=joined&status=active"),
      await summaryOf(main.id, w.memberS2.token),
      await detailOf(main.id, w.memberS1.token),
      await detailOf(main.id, w.memberS2.token),
      await summaryOf(MISSING_CASE_ID, w.memberS1.token),
    ];
    expect(responses.map((res) => res.status)).toEqual([
      200, 200, 200, 403, 404,
    ]);
    for (const res of responses)
      expect(res.headers.get("Cache-Control") ?? "").toContain("no-store");
  });
});

describe("#147 5-1 AC-4 一覧（EP-5-06）", () => {
  it("#147 5-1 AC-4: joined は参加している案件だけで、項目のキーは決めたものだけ（説明・参加者を持たない。チャンネルの ID は #148 148-C で参加者だけに返す）", async () => {
    const res = await listOf(w.memberS1.token, "scope=joined&status=active");
    expect(res.status).toBe(200);
    const page = (await res.json()) as Page;
    expect(page.items.map((item) => item.id)).toEqual([main.id]);
    expect(page.nextCursor).toBeNull();
    const item = page.items[0];
    expect(Object.keys(item ?? {}).sort()).toEqual(SUMMARY_KEYS);
    expect(item).toMatchObject({
      isParticipant: true,
      participantCount: 3,
      caseNumber: main.caseNumber,
    });
  });

  it("#147 5-1 AC-2・AC-4: all の一般の非参加者の行は概要だけで、参加者数は null。説明・チャンネルの ID・参加者の名前は本文のどこにもない", async () => {
    const res = await listOf(w.memberS2.token, "scope=all&status=active");
    expect(res.status).toBe(200);
    const text = await res.text();
    const page = JSON.parse(text) as Page;
    expect(page.items.map((item) => item.id).sort()).toEqual(
      [main.id, other.id].sort(),
    );
    for (const item of page.items) {
      expect(Object.keys(item).sort()).toEqual(SUMMARY_KEYS);
      expect(item.isParticipant).toBe(false);
      expect(item.canManage).toBe(false);
      expect(item.participantCount).toBeNull();
    }
    for (const secret of [
      SECRET_DESCRIPTION,
      main.roomId,
      other.roomId,
      NAME_S1,
      NAME_D1,
      NAME_RETIRED,
    ])
      expect(text).not.toContain(secret);
  });

  it("#147 5-1 AC-21・AC-2（Q6）: 自動参加が未適用の案件でも、担当部署のオーナーと全体管理者は all に参加者数が入り canManage が true。他部署の案件は null", async () => {
    const owner = (await (
      await listOf(w.ownerS.token, "scope=all&status=active")
    ).json()) as Page;
    const ownMain = owner.items.find((item) => item.id === main.id);
    const ownOther = owner.items.find((item) => item.id === other.id);
    expect(ownMain).toMatchObject({
      isParticipant: false,
      canManage: true,
      participantCount: 3,
    });
    expect(ownOther).toMatchObject({
      isParticipant: false,
      canManage: false,
      participantCount: null,
    });

    const admin = (await (
      await listOf(w.admin.token, "scope=all&status=active")
    ).json()) as Page;
    expect(admin.items.length).toBe(2);
    for (const item of admin.items) {
      expect(item.isParticipant).toBe(false);
      expect(item.canManage).toBe(true);
      expect(item.participantCount).not.toBeNull();
    }
  });
});

describe("#147 5-1 AC-2・AC-21 概要（EP-5-07）", () => {
  it("#147 5-1 AC-2: 一般の非参加者は概要を 200 で見られ、キーは一覧の項目と同じで、参加者数は null。説明・チャンネルの ID はない", async () => {
    const res = await summaryOf(main.id, w.memberS2.token);
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as Summary;
    expect(Object.keys(body).sort()).toEqual(SUMMARY_KEYS);
    expect(body).toMatchObject({
      id: main.id,
      caseNumber: main.caseNumber,
      title: main.title,
      status: "active",
      dueDate: "2026-12-01",
      isParticipant: false,
      canManage: false,
      participantCount: null,
    });
    expect(text).not.toContain(SECRET_DESCRIPTION);
    expect(text).not.toContain(main.roomId);
  });

  it.each([
    ["担当部署のオーナー", "ownerS"],
    ["全体管理者", "admin"],
  ] as const)(
    "#147 5-1 AC-21（Q6）: 参加していない%sの概要には参加者数が入り、canManage が true",
    async (_label, key) => {
      const res = await summaryOf(main.id, w[key].token);
      expect(res.status).toBe(200);
      expect((await res.json()) as Summary).toMatchObject({
        isParticipant: false,
        canManage: true,
        participantCount: 3,
      });
    },
  );

  it("#147 5-1 AC-21: 他部署のオーナー（担当部署のどれのオーナーでもない）の概要は、参加者数が null で canManage が false", async () => {
    const res = await summaryOf(main.id, w.ownerD.token);
    expect((await res.json()) as Summary).toMatchObject({
      canManage: false,
      participantCount: null,
    });
  });

  it("#147 判定の順: 存在しない案件の概要は 404 NOT_FOUND「案件が見つかりません」で、logger.audit に残す", async () => {
    const res = await summaryOf(MISSING_CASE_ID, w.memberS1.token);
    expect(res.status).toBe(404);
    expect((await res.json()) as ErrorBody).toMatchObject({
      code: "NOT_FOUND",
      message: CASE_MESSAGES.notFound,
    });
    expect(failureAudits().length).toBeGreaterThanOrEqual(1);
  });

  it("#147 5-1 AC-17・AC-19: 納期は YYYY-MM-DD、なければ null。取引先・担当部署が無効なら isActive: false で名前はそのまま", async () => {
    const withDue = (await (
      await summaryOf(main.id, w.memberS2.token)
    ).json()) as Summary;
    expect(withDue.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(withDue.dueDate).toBe("2026-12-01");
    await setClientActive(w.clientB.id, false);
    await setDepartmentActive(w.deptD.id, false);
    const off = (await (
      await summaryOf(other.id, w.memberS2.token)
    ).json()) as Summary;
    expect(off.dueDate).toBeNull();
    expect(off.client).toEqual({
      id: w.clientB.id,
      name: w.clientB.name,
      isActive: false,
    });
    expect(off.departments).toEqual([
      { id: w.deptD.id, name: w.deptD.name, isActive: false },
    ]);
  });
});

describe("#147 5-1 AC-2・AC-14 詳細（EP-5-08）", () => {
  it("#147 5-1 AC-2・C-142(1): 参加者は詳細を 200 で見られ、説明・チャンネルの ID・参加者（参加した順。退職者は isActive: false で残る）を返す", async () => {
    const res = await detailOf(main.id, w.memberS1.token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Detail;
    expect(Object.keys(body).sort()).toEqual(DETAIL_KEYS);
    expect(body).toMatchObject({
      id: main.id,
      description: SECRET_DESCRIPTION,
      channelId: main.roomId,
      isParticipant: true,
      participantCount: 3,
      dueDate: "2026-12-01",
    });
    expect(body.participants.length).toBe(3);
    for (const p of body.participants)
      expect(Object.keys(p).sort()).toEqual(PARTICIPANT_KEYS);
    expect(body.participants).toEqual([
      {
        userId: w.memberS1.id,
        displayName: NAME_S1,
        departmentName: w.deptS.name,
        isActive: true,
        isCreator: true,
        // 自動参加でなく、有効な参加者が2人いるので、どの人も外せる（Q1・Q2）
        autoRole: null,
        removable: true,
      },
      {
        userId: w.memberD1.id,
        displayName: NAME_D1,
        departmentName: w.deptD.name,
        isActive: true,
        isCreator: false,
        // 自動参加でなく、有効な参加者が2人いるので、どの人も外せる（Q1・Q2）
        autoRole: null,
        removable: true,
      },
      {
        userId: w.inactive.id,
        displayName: NAME_RETIRED,
        departmentName: w.deptS.name,
        isActive: false,
        isCreator: false,
        // 自動参加でなく、有効な参加者が2人いるので、どの人も外せる（Q1・Q2）
        autoRole: null,
        removable: true,
      },
    ]);
  });

  it("#147 個人情報: 詳細の本文に、本名・メールアドレスが入らない", async () => {
    const text = await (await detailOf(main.id, w.memberS1.token)).text();
    expect(text).toContain(NAME_S1);
    expect(text).not.toContain("@example.com");
    expect(text).not.toMatch(/legalName|email/i);
  });

  it("#147 5-1 AC-14: 一般の非参加者の詳細は 403 FORBIDDEN「参加者だけが見られます（非公開）」で、説明・チャンネルの ID・参加者がない。logger.audit に残す", async () => {
    const res = await detailOf(main.id, w.memberS2.token);
    expect(res.status).toBe(403);
    const text = await res.text();
    expect(JSON.parse(text) as ErrorBody).toMatchObject({
      code: "FORBIDDEN",
      message: CASE_MESSAGES.participantsOnly,
    });
    for (const secret of [SECRET_DESCRIPTION, main.roomId, NAME_S1, NAME_D1])
      expect(text).not.toContain(secret);
    expect(failureAudits().length).toBeGreaterThanOrEqual(1);
  });

  it.each([
    ["担当部署のオーナー", "ownerS"],
    ["全体管理者", "admin"],
  ] as const)(
    "#147 5-1 AC-2・AC-21: 参加していない%sでも、詳細は 403 で説明・参加者がない（自動参加が未適用の案件）",
    async (_label, key) => {
      const res = await detailOf(main.id, w[key].token);
      expect(res.status).toBe(403);
      const text = await res.text();
      expect(text).not.toContain(SECRET_DESCRIPTION);
      expect(text).not.toContain(NAME_S1);
    },
  );

  it("#147 5-1 AC-2: 全体管理者でも、参加していれば詳細を 200 で見られる", async () => {
    await addCaseMember(main.roomId, w.admin.id);
    const res = await detailOf(main.id, w.admin.token);
    expect(res.status).toBe(200);
    expect(((await res.json()) as Detail).description).toBe(SECRET_DESCRIPTION);
  });

  it("#147 判定の順: 存在しない案件の詳細は、参加者でない人にも 404 NOT_FOUND「案件が見つかりません」（403 より先）", async () => {
    const res = await detailOf(MISSING_CASE_ID, w.memberS2.token);
    expect(res.status).toBe(404);
    expect((await res.json()) as ErrorBody).toMatchObject({
      code: "NOT_FOUND",
      message: CASE_MESSAGES.notFound,
    });
  });

  it("#147 5-1 AC-14: 外された人が、外された後に詳細を取ると 403 になり、説明が出ない", async () => {
    expect((await detailOf(other.id, w.memberD1.token)).status).toBe(200);
    await removeCaseMember(other.roomId, w.memberD1.id);
    const res = await detailOf(other.id, w.memberD1.token);
    expect(res.status).toBe(403);
    expect(((await res.json()) as ErrorBody).message).toBe(
      CASE_MESSAGES.participantsOnly,
    );
  });

  it("#147 有効な参加者（レビュー2回目）: 認証の後に操作者を無効にする（参加の行は残す）と、一覧の joined に出ず、詳細は説明・参加者を返さない（403、またはセッションの失効で 401）", async () => {
    // 認証済みのセッションで、無効化の前は見られること（空振りしないこと）
    expect((await detailOf(main.id, w.memberS1.token)).status).toBe(200);
    await setUserActive(w.memberS1.id, false);

    const list = await listOf(w.memberS1.token, "scope=joined&status=active");
    expect([200, 401]).toContain(list.status);
    if (list.status === 200)
      expect(((await list.json()) as Page).items).toEqual([]);

    const detail = await detailOf(main.id, w.memberS1.token);
    expect([401, 403]).toContain(detail.status);
    const text = await detail.text();
    expect(text).not.toContain(SECRET_DESCRIPTION);
    expect(text).not.toContain(NAME_D1);
  });
});
