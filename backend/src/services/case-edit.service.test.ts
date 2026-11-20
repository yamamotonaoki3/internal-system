// #150（150-C）5-1 AC-20・計画 4.2：案件の再編集の Service（service.edit）を、Repository とロールの割り当てを代役にして確かめる。
// この層で確かめるもの：
//   - 本文の形（計画 4.2 の 6。422）：caseNumber・dueDate・未知の項目は fields に項目名、version と expected の両方・どちらもない、
//     件名は整形の後に 1〜100、説明 2000 まで、部署 0 件・重複、取引先の形、版の形。参加者が expected を送る → 422 fields ["version"]
//   - 判定の順：403（資格なし・非参加の管理者の description／version）は本文の形より先。案件がなければ本文が壊れていても 404。
//     authorize(perm.case.edit) の拒否は 403 で、本文の形より先（計画 4.2 の 4 → 6）
//   - 最初の判定で拒否するときは、書き込みの関数（editCase）を呼ばない（成功する側しか通らないテストにしない）
//   - 変更なし（計画 4.2 の 11）：何も書かず 200 { caseId, titleFormatted }
//   - 前提が崩れたとき（CaseStateChangedError）：読み直して理由に当たればそれを返す。どれにも当たらず、自動参加させる人の集合だけが違えば
//     1回だけやり直す。2回目も崩れたら 409 retry。集合も同じなら元のエラーのまま（成功にしない）
// 本物の D1 での前提・件数の確認は db/case-edit.repository.db.test.ts、同時の操作は services/case-edit.interleave.test.ts で確かめる。
// 契約（実装前の仮置き。計画 150-C 4.2・4.3・4.4。実装の担当へ。テストが決めた形）：
//   createCaseService(repository, roles).edit(actor, caseId, body: unknown): Promise<{ caseId: string; titleFormatted: boolean }>
//     titleFormatted は「送った件名を整形したら、送った文字と違った」とき真（件名を送らないときは偽）
//   repository.findEditFacts(input: { caseId, actorId, clientId?: string, departmentIds?: readonly string[] }): Promise<CaseEditFacts | null>
//   repository.editCase(input: CaseEditWriteInput): Promise<void>（前提が崩れていたら CaseStateChangedError）
// 期待値は計画 150-C 4.2 と要件 5-1 AC-20・C-122(6)（件名の整形）・C-130(1)（0件不可）から決める。データは架空の ID（ULID の形）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CaseStateChangedError,
  type CaseEditFacts,
  type CaseRepository,
} from "../db/case.repository";
import type {
  RoleAssignmentRepository,
  UserWithAssignments,
} from "../db/role-assignment.repository";
import { AppError } from "../lib/app-error";
import { createCaseService } from "./case.service";

const ACTOR = "01JTESTCASE150CSVCACT00001";
const CASE_ID = "01JTESTCASE150CSVCCASE0001";
const CLIENT_A = "01JTESTCASE150CSVCC000000A";
const CLIENT_B = "01JTESTCASE150CSVCC000000B";
const DEPT_S = "01JTESTCASE150CSVCD000000S";
const DEPT_D = "01JTESTCASE150CSVCD000000D";
const OWNER_D = "01JTESTCASE150CSVC0WN0000D";
const OWNER_D2 = "01JTESTCASE150CSVC0WN000D2";
const TITLE = "[UNIT_TEST]150C Service の件名";
const DESCRIPTION = "[UNIT_TEST]150C Service の説明";
const TRACE = "trace-150c-service";

const actor = { userId: ACTOR, traceId: TRACE };

function factsOf(overrides: Partial<CaseEditFacts> = {}): CaseEditFacts {
  return {
    status: "active",
    version: 2,
    title: TITLE,
    description: DESCRIPTION,
    actorIsParticipant: true,
    actorCanManage: false,
    client: { id: CLIENT_A, code: "QZA", name: "[UNIT_TEST]テスト商事A" },
    requestedClient: {
      id: CLIENT_B,
      code: "QZB",
      name: "[UNIT_TEST]テスト商事B",
      isActive: true,
    },
    departmentIds: [DEPT_S],
    requestedDepartments: [
      { id: DEPT_S, isActive: true },
      { id: DEPT_D, isActive: true },
    ],
    joinUserIds: [OWNER_D],
    ...overrides,
  };
}

const managerFacts = (overrides: Partial<CaseEditFacts> = {}) =>
  factsOf({ actorIsParticipant: false, actorCanManage: true, ...overrides });

const expected = () => ({
  title: TITLE,
  clientId: CLIENT_A,
  departmentIds: [DEPT_S],
});

let current: () => CaseEditFacts | null;
let repository: {
  findEditFacts: ReturnType<typeof vi.fn>;
  editCase: ReturnType<typeof vi.fn>;
};
let roles: {
  findByUserId: ReturnType<
    typeof vi.fn<(userId: string) => Promise<UserWithAssignments | null>>
  >;
};
let logLines: string[];

function service() {
  return createCaseService(
    repository as unknown as CaseRepository,
    roles as unknown as RoleAssignmentRepository,
  );
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("拒否されませんでした");
}

type AuditLine = {
  body: string;
  attributes: { log_type?: string; reason?: string; target?: string };
};
const audits = (): AuditLine[] =>
  logLines
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as AuditLine)
    .filter((line) => line.attributes.log_type === "audit");

beforeEach(() => {
  current = () => factsOf();
  repository = {
    findEditFacts: vi.fn(async () => current()),
    editCase: vi.fn(async () => {}),
  };
  roles = {
    findByUserId: vi.fn(async () => ({
      user: { isActive: true },
      assignments: [],
    })),
  };
  logLines = [];
  const capture = (...args: unknown[]) => {
    logLines.push(args.map(String).join(" "));
  };
  for (const method of ["log", "warn", "error"] as const)
    vi.spyOn(console, method).mockImplementation(capture);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("#150 150-C 計画 4.2 の 6：本文の形（422）。書き込みは呼ばない", () => {
  type Shape = { name: string; body: unknown; fields: string[] };
  const SHAPES: Shape[] = [
    {
      name: "案件番号 caseNumber を送る（案件番号は変えない：5-1 AC-20）",
      body: { version: 2, caseNumber: "QZA-261117-0099" },
      fields: ["caseNumber"],
    },
    {
      name: "納期 dueDate を送る（納期は既存の API：Q2＝A）",
      body: { version: 2, dueDate: "2026-12-24" },
      fields: ["dueDate"],
    },
    {
      name: "未知の項目を送る（strict）",
      body: { version: 2, status: "closed" },
      fields: ["status"],
    },
    {
      name: "version と expected の両方",
      body: { version: 2, expected: expected(), title: "[UNIT_TEST]150C新" },
      fields: ["version"],
    },
    {
      name: "version も expected もない",
      body: { title: "[UNIT_TEST]150C新" },
      fields: ["version"],
    },
    {
      name: "version が 0（1以上）",
      body: { version: 0, title: "[UNIT_TEST]150C新" },
      fields: ["version"],
    },
    {
      name: "version が整数でない",
      body: { version: 1.5, title: "[UNIT_TEST]150C新" },
      fields: ["version"],
    },
    {
      name: "件名が空白だけ（整形すると 0 文字）",
      body: { version: 2, title: "　 　" },
      fields: ["title"],
    },
    {
      name: "件名が整形の後に 101 文字",
      body: { version: 2, title: `${"あ".repeat(100)}い` },
      fields: ["title"],
    },
    {
      name: "説明が 2001 文字",
      body: { version: 2, description: "説".repeat(2001) },
      fields: ["description"],
    },
    {
      name: "担当部署が 0 件（C-130(1)）",
      body: { version: 2, departmentIds: [] },
      fields: ["departmentIds"],
    },
    {
      name: "担当部署の重複",
      body: { version: 2, departmentIds: [DEPT_S, DEPT_S] },
      fields: ["departmentIds"],
    },
    {
      name: "担当部署の要素が ULID でない",
      body: { version: 2, departmentIds: ["not-a-ulid"] },
      fields: ["departmentIds"],
    },
    {
      name: "取引先が ULID でない",
      body: { version: 2, clientId: "client-b" },
      fields: ["clientId"],
    },
  ];

  it.each(SHAPES)(
    "#150 4.2: $name → 422 VALIDATION_ERROR fields $fields で、editCase を呼ばない",
    async ({ body, fields }) => {
      const error = await rejectionOf(service().edit(actor, CASE_ID, body));
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code: "VALIDATION_ERROR" });
      expect((error as AppError).details.fields).toEqual(
        expect.arrayContaining(fields),
      );
      expect(repository.editCase).not.toHaveBeenCalled();
    },
  );

  it("#150 4.2・境界値: 件名がちょうど 100 文字・説明がちょうど 2000 文字は通る", async () => {
    const result = await service().edit(actor, CASE_ID, {
      version: 2,
      title: "件".repeat(100),
      description: "説".repeat(2000),
    });
    expect(result).toEqual({ caseId: CASE_ID, titleFormatted: false });
    expect(repository.editCase).toHaveBeenCalledTimes(1);
  });

  it('#150 4.2・Q3＝C: 有効な参加者が expected を送る → 422 fields ["version"]（説明の衝突を版で見るため）。editCase を呼ばない', async () => {
    const error = await rejectionOf(
      service().edit(actor, CASE_ID, {
        expected: expected(),
        title: "[UNIT_TEST]150C新しい件名",
      }),
    );
    expect(error).toMatchObject({ code: "VALIDATION_ERROR" });
    expect((error as AppError).details.fields).toEqual(["version"]);
    expect(repository.editCase).not.toHaveBeenCalled();
  });
});

describe("#150 150-C 計画 4.2：判定の順（403・404 は本文の形より先）", () => {
  it("#150 4.2 の 3・security: 参加者でも管理の資格もない人は、本文が壊れていても 403「案件を編集できるのは…」。logger.audit に case.edit・案件の ID", async () => {
    current = () =>
      factsOf({ actorIsParticipant: false, actorCanManage: false });
    const error = await rejectionOf(
      service().edit(actor, CASE_ID, { caseNumber: 1, dueDate: [] }),
    );
    expect(error).toMatchObject({
      code: "FORBIDDEN",
      message:
        "案件を編集できるのは、参加者・担当部署のオーナー・全体管理者だけです",
    });
    expect(repository.editCase).not.toHaveBeenCalled();
    expect(audits()).toEqual([
      expect.objectContaining({
        body: "case.edit",
        attributes: expect.objectContaining({ target: CASE_ID }) as unknown,
      }),
    ]);
  });

  it("#150 4.2 の 2: 案件がなければ、本文が壊れていても 404「案件が見つかりません」", async () => {
    current = () => null;
    const error = await rejectionOf(
      service().edit(actor, CASE_ID, { bad: true }),
    );
    expect(error).toMatchObject({
      code: "NOT_FOUND",
      message: "案件が見つかりません",
    });
    expect(repository.editCase).not.toHaveBeenCalled();
  });

  it.each([
    ["description", { description: "説".repeat(5000), expected: 1 }],
    ["version", { version: "x", caseNumber: "QZA" }],
  ])(
    "#150 4.2 の 5・重大4: 非参加の管理者が %s を送ると、本文が壊れていても 403「説明を変更できるのは参加者だけです」（422 より先）",
    async (_label, body) => {
      current = () => managerFacts();
      const error = await rejectionOf(service().edit(actor, CASE_ID, body));
      expect(error).toMatchObject({
        code: "FORBIDDEN",
        message: "説明を変更できるのは参加者だけです",
      });
      expect(JSON.stringify(error)).not.toContain(DESCRIPTION);
      expect(repository.editCase).not.toHaveBeenCalled();
    },
  );

  it("#150 4.2 の 4: authorize(perm.case.edit) が拒否したら 403（本文が壊れていても。422 より先）。拒否の記録に perm.case.edit", async () => {
    roles.findByUserId.mockResolvedValue({
      user: { isActive: false },
      assignments: [],
    });
    const error = await rejectionOf(
      service().edit(actor, CASE_ID, { dueDate: "x" }),
    );
    expect(error).toMatchObject({ code: "FORBIDDEN" });
    expect(audits().map((line) => line.body)).toContain("perm.case.edit");
    expect(repository.editCase).not.toHaveBeenCalled();
  });

  it("#150 4.2 の 7: 終了中は、形の正しい本文で 409 closed。editCase を呼ばない", async () => {
    current = () => factsOf({ status: "closed" });
    const error = await rejectionOf(
      service().edit(actor, CASE_ID, { version: 2, title: "[UNIT_TEST]新" }),
    );
    expect(error).toMatchObject({
      code: "CONFLICT",
      details: { reason: "closed" },
    });
    expect(repository.editCase).not.toHaveBeenCalled();
  });

  it("#150 4.2 の 6 → 7: 終了中でも、本文の形の 422 が 409 closed より先", async () => {
    current = () => factsOf({ status: "closed" });
    const error = await rejectionOf(
      service().edit(actor, CASE_ID, { version: 2, departmentIds: [] }),
    );
    expect(error).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("#150 4.2 の 8: 版が違えば 409 stale。editCase を呼ばない", async () => {
    const error = await rejectionOf(
      service().edit(actor, CASE_ID, { version: 1, title: "[UNIT_TEST]新" }),
    );
    expect(error).toMatchObject({
      code: "CONFLICT",
      details: { reason: "stale" },
    });
    expect(repository.editCase).not.toHaveBeenCalled();
  });
});

describe("#150 150-C 計画 4.2 の 11：変更なし・件名の整形", () => {
  it("#150 4.2 の 11: すべての項目がいまと同じ（件名は整形の後に同じ・部署の並びだけ違う）なら、何も書かず 200 { caseId, titleFormatted: false }", async () => {
    current = () => factsOf({ departmentIds: [DEPT_D, DEPT_S] });
    const result = await service().edit(actor, CASE_ID, {
      version: 2,
      title: TITLE,
      description: DESCRIPTION,
      clientId: CLIENT_A,
      departmentIds: [DEPT_S, DEPT_D],
    });
    expect(result).toEqual({ caseId: CASE_ID, titleFormatted: false });
    expect(repository.editCase).not.toHaveBeenCalled();
  });

  it("#150 4.2 の 11（仮決め）: 変える項目を1つも送らない（版だけ）なら、何も書かず 200", async () => {
    const result = await service().edit(actor, CASE_ID, { version: 2 });
    expect(result).toEqual({ caseId: CASE_ID, titleFormatted: false });
    expect(repository.editCase).not.toHaveBeenCalled();
  });

  it("#150 C-122(6): 全角の英数字・連続する空白は整形して保存し、titleFormatted が真。応答に説明・版を入れない", async () => {
    const result = await service().edit(actor, CASE_ID, {
      version: 2,
      title: "　[UNIT_TEST]ＡＢＣ　　見積　",
    });
    expect(result).toEqual({ caseId: CASE_ID, titleFormatted: true });
    expect(repository.editCase).toHaveBeenCalledTimes(1);
    const input = repository.editCase.mock.calls[0]?.[0] as { title?: string };
    expect(input.title).toBe("[UNIT_TEST]ABC 見積");
  });

  it("#150 C-122(6): 整形しても送った文字と同じなら titleFormatted は偽", async () => {
    const result = await service().edit(actor, CASE_ID, {
      version: 2,
      title: "[UNIT_TEST]150C 新しい件名",
    });
    expect(result).toEqual({ caseId: CASE_ID, titleFormatted: false });
  });
});

describe("#150 150-C 計画 4.2：前提が崩れたとき（CaseStateChangedError）の読み直しと、1回だけのやり直し", () => {
  const body = {
    version: 2,
    departmentIds: [DEPT_S, DEPT_D],
  };

  it("#150 4.2: 読み直すと終了中 → 409 closed（editCase は1回だけ）", async () => {
    repository.editCase.mockImplementationOnce(async () => {
      current = () => factsOf({ status: "closed" });
      throw new CaseStateChangedError();
    });
    const error = await rejectionOf(service().edit(actor, CASE_ID, body));
    expect(error).toMatchObject({ details: { reason: "closed" } });
    expect(repository.editCase).toHaveBeenCalledTimes(1);
  });

  it("#150 4.2: 読み直すと版が進んでいる → 409 stale", async () => {
    repository.editCase.mockImplementationOnce(async () => {
      current = () => factsOf({ version: 3 });
      throw new CaseStateChangedError();
    });
    const error = await rejectionOf(service().edit(actor, CASE_ID, body));
    expect(error).toMatchObject({ details: { reason: "stale" } });
  });

  it("#150 4.2: 読み直すと資格を失っている → 403（状態を漏らさない）", async () => {
    repository.editCase.mockImplementationOnce(async () => {
      current = () =>
        factsOf({ actorIsParticipant: false, actorCanManage: false });
      throw new CaseStateChangedError();
    });
    const error = await rejectionOf(service().edit(actor, CASE_ID, body));
    expect(error).toMatchObject({ code: "FORBIDDEN" });
  });

  it("#150 4.2・重大2: 読み直すと、自動参加させる人の集合だけが違う → 新しい集合で1回だけやり直して成功する", async () => {
    repository.editCase.mockImplementationOnce(async () => {
      current = () => factsOf({ joinUserIds: [OWNER_D2] });
      throw new CaseStateChangedError();
    });
    const result = await service().edit(actor, CASE_ID, body);
    expect(result).toEqual({ caseId: CASE_ID, titleFormatted: false });
    expect(repository.editCase).toHaveBeenCalledTimes(2);
    const second = repository.editCase.mock.calls[1]?.[0] as {
      joinUserIds: string[];
    };
    expect(second.joinUserIds).toEqual([OWNER_D2]);
  });

  it("#150 4.2・重大2: 2回続けて自動参加させる人の集合が変わる → 409 retry（3回目は送らない）", async () => {
    let n = 0;
    repository.editCase.mockImplementation(async () => {
      n += 1;
      current = () =>
        factsOf({ joinUserIds: [`01JTESTCASE150CSVC0WN000${n}X`] });
      throw new CaseStateChangedError();
    });
    const error = await rejectionOf(service().edit(actor, CASE_ID, body));
    expect(error).toMatchObject({
      code: "CONFLICT",
      details: { reason: "retry" },
    });
    expect(repository.editCase).toHaveBeenCalledTimes(2);
  });

  it("#150 4.2・error-api: 読み直してもどの理由にも当たらず、集合も同じ → 成功にせず、元の CaseStateChangedError のまま", async () => {
    repository.editCase.mockRejectedValue(new CaseStateChangedError());
    const error = await rejectionOf(service().edit(actor, CASE_ID, body));
    expect(error).toBeInstanceOf(CaseStateChangedError);
    expect(repository.editCase).toHaveBeenCalledTimes(1);
  });

  it("#150 error-api: 未知のエラーは読み直さず、そのまま伝える", async () => {
    const unknown = new Error("D1_ERROR: 未知の失敗");
    let readsAtWrite = -1;
    repository.editCase.mockImplementation(async () => {
      readsAtWrite = repository.findEditFacts.mock.calls.length;
      throw unknown;
    });
    const error = await rejectionOf(service().edit(actor, CASE_ID, body));
    expect(error).toBe(unknown);
    expect(readsAtWrite).toBeGreaterThan(0);
    expect(repository.findEditFacts.mock.calls.length).toBe(readsAtWrite);
    expect(repository.editCase).toHaveBeenCalledTimes(1);
  });

  it("#150 Q3＝C: expected の方式で、読み直すと件名が変わっている → 409 stale", async () => {
    current = () => managerFacts();
    repository.editCase.mockImplementationOnce(async () => {
      current = () => managerFacts({ title: "[UNIT_TEST]150C別の人の件名" });
      throw new CaseStateChangedError();
    });
    const error = await rejectionOf(
      service().edit(actor, CASE_ID, {
        expected: expected(),
        title: "[UNIT_TEST]150C新しい件名",
      }),
    );
    expect(error).toMatchObject({ details: { reason: "stale" } });
  });
});

// ---- ミューテーション診断（PR #325）で検出できなかった判定を確かめる ----

/** 実際の Repository と同じく、いまと同じ取引先を求めたら、求めた取引先はいまの取引先（計画 4.3） */
const sameClientRequested = (overrides: Partial<CaseEditFacts> = {}) =>
  factsOf({
    requestedClient: {
      id: CLIENT_A,
      code: "QZA",
      name: "[UNIT_TEST]テスト商事A",
      isActive: true,
    },
    ...overrides,
  });

describe("#150 150-C 計画 4.2 の 11：いまと同じ値は、変える項目にしない", () => {
  it("#150 4.2 の 11: 本文が { version, clientId: いまの取引先 } だけなら、editCase を呼ばず 200（版は進まない）", async () => {
    current = () => sameClientRequested();
    const result = await service().edit(actor, CASE_ID, {
      version: 2,
      clientId: CLIENT_A,
    });
    expect(result).toEqual({ caseId: CASE_ID, titleFormatted: false });
    expect(repository.editCase).not.toHaveBeenCalled();
  });

  it("#150 4.2 の 11: 同じ件名・同じ説明・いまの取引先・並びだけ違う同じ担当部署を送っても、editCase を呼ばず 200", async () => {
    current = () => sameClientRequested({ departmentIds: [DEPT_D, DEPT_S] });
    const result = await service().edit(actor, CASE_ID, {
      version: 2,
      title: TITLE,
      description: DESCRIPTION,
      clientId: CLIENT_A,
      departmentIds: [DEPT_S, DEPT_D],
    });
    expect(result).toEqual({ caseId: CASE_ID, titleFormatted: false });
    expect(repository.editCase).not.toHaveBeenCalled();
  });

  it("#150 4.2: いまの取引先と件名を送ると、書き込みには件名だけを渡す（取引先を変える項目にしない）", async () => {
    current = () => sameClientRequested();
    await service().edit(actor, CASE_ID, {
      version: 2,
      title: "[UNIT_TEST]150C件名だけ変わる",
      clientId: CLIENT_A,
    });
    expect(repository.editCase).toHaveBeenCalledTimes(1);
    const input = repository.editCase.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(input.title).toBe("[UNIT_TEST]150C件名だけ変わる");
    expect("client" in input).toBe(false);
  });
});

describe("#150 150-C 拒否の記録（logger.audit。計画 4.2・security）", () => {
  type AuditAttributes = AuditLine["attributes"] & { result?: string };
  const denyCases = [
    {
      name: "参加者でも管理の資格もない人",
      facts: () =>
        factsOf({ actorIsParticipant: false, actorCanManage: false }),
      body: { version: 2, description: "[UNIT_TEST]150C送った説明" },
      reason: "cannot_edit",
    },
    {
      name: "参加していない管理者が説明を送る",
      facts: () => managerFacts(),
      body: {
        expected: expected(),
        description: "[UNIT_TEST]150C送った説明",
      },
      reason: "description_participants_only",
    },
    {
      name: "参加していない管理者が版を送る",
      facts: () => managerFacts(),
      body: { version: 2, title: "[UNIT_TEST]150C送った件名" },
      reason: "description_participants_only",
    },
  ];

  it.each(denyCases)(
    "#150 4.2・security: $name → 403 で、logger.audit に case.edit・案件の ID・failure・理由 $reason を1件だけ残し、本文・説明・件名を入れない",
    async ({ facts, body, reason }) => {
      current = facts;
      const error = await rejectionOf(service().edit(actor, CASE_ID, body));
      expect(error).toMatchObject({ code: "FORBIDDEN" });
      expect(repository.editCase).not.toHaveBeenCalled();
      const lines = audits();
      expect(lines).toHaveLength(1);
      expect(lines[0]?.body).toBe("case.edit");
      expect(lines[0]?.attributes as AuditAttributes).toMatchObject({
        target: CASE_ID,
        result: "failure",
        reason,
      });
      const text = logLines.join("\n");
      expect(text).not.toContain("150C送った");
      expect(text).not.toContain(DESCRIPTION);
      expect(text).not.toContain(TITLE);
    },
  );
});
