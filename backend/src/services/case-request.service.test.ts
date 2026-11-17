// #146（146-A）5-3 AC-1・AC-6・AC-7・AC-12・AC-13、5-1 AC-17・C-141(2)、Q3：案件の作成申請の Service の判定の順と、専用エラーから AppError への変換。
// Repository・authorizer は代役（vi.fn）にし、判定の順の組み合わせを速く網羅する（計画 A-5。この順を変えない）：
//   申請：(1) authorize(perm.case.request.create、会社の範囲) → (2) 全体管理者でなく所属もなければ 403（logger.audit）
//         → (4) 整形の後の長さ（422 title）・納期が今日（JST）より前なら 422（dueDate）→ (5) 再申請の元（422 resubmitOf）→ (6) batch
//   取り下げ：(1) 本人の申請でなければ 404（logger.audit）→ (2) batch の decided は 409
// 形の検査（3）は route（結合テスト）で確かめる。
// 契約（実装前の仮置き。実装の担当へ）：
//   createCaseRequestService(repository, roles, { now?: () => Date; authorizer?: { authorize(principal, permission, scope) } })
//   service.create(actor: { userId; traceId }, input: { clientId; title; description?; dueDate?; departmentIds; candidateIds?; resubmitOf? })
//     → { …申請の項目, titleFormatted: boolean, hasSimilarTitle: boolean }
//   service.withdraw(actor, requestId) → { requestId, status: "withdrawn" }
//   service.listMine(actor, { limit, cursor? }) → { items, nextCursor }（repository.listMine({ requesterId, limit, cursor })）
//   service.checkSimilarTitle(actor, { clientId, title }) → { hasSimilar, formattedTitle }
//   統括の決定：申請・自分の申請・取り下げ・類似件名の確認のすべてで、最初に perm.case.request.create（R-60）を会社の範囲で1回確かめる
//   Repository の代役が持つメソッド（名前は計画 A-3 に合わせた仮置き）：
//     findUserDepartmentId(userId): string | null
//     findOwnResubmittable({ requestId, requesterId }): boolean（本人の rejected・withdrawn なら true）
//     readSubmittedRecipientCandidates(departmentIds): { ownerIds; adminIds }
//     create(input) → { id }（input は repository.db.test の契約と同じ）
//     hasSimilarTitle({ clientId, title }): boolean
//     findOwnItem({ requestId, requesterId }): 申請の項目（mine と同じ形）| null
//     findOwnForWithdraw({ requestId, requesterId }): { id; status; version } | null
//     withdraw({ requestId, requesterId, version, now, traceId }): void
//   全体管理者かどうかは reviewerFactsOf（roles.findByUserId）で読む。
// データは架空。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogLines } from "../../test/channel-request-fixtures";
import {
  CaseRequestWriteError,
  type CaseRequestRepository,
} from "../db/case-request.repository";
import type {
  RoleAssignmentRepository,
  UserWithAssignments,
} from "../db/role-assignment.repository";
import { AppError } from "../lib/app-error";
import type { Permission } from "../lib/permissions";
import { createCaseRequestService } from "./case-request.service";

const ACTOR = "01JTESTCASEREQSVCUSER0001";
const OWNER = "01JTESTCASEREQSVCUSER0002";
const ADMIN = "01JTESTCASEREQSVCUSER0003";
const DEPT = "01JTESTCASEREQSVCDEPT0001";
const CLIENT = "01JTESTCASEREQSVCCLNT0001";
const REQUEST = "01JTESTCASEREQSVCREQ00001";
const ORIGINAL = "01JTESTCASEREQSVCREQ00002";
/** 日本時間では 2026-11-17 12:00 */
const NOW = new Date("2026-11-17T03:00:00.000Z");

type CreateInput = {
  clientId: string;
  title: string;
  description?: string;
  dueDate?: string;
  departmentIds: string[];
  candidateIds?: string[];
  resubmitOf?: string;
};

type RepositoryCreateInput = {
  requesterId: string;
  clientId: string;
  title: string;
  description: string;
  dueDate: string | null;
  departmentIds: string[];
  candidateIds: string[];
  resubmitOf: string | null;
  recipientIds: string[];
  now: string;
  traceId: string;
};

const ITEM = {
  id: REQUEST,
  title: "[UNIT_TEST]件名",
  description: "",
  dueDate: null,
  client: {
    id: CLIENT,
    code: "QZA",
    name: "[UNIT_TEST]取引先",
    isActive: true,
  },
  departments: [{ id: DEPT, name: "[UNIT_TEST]部署", isActive: true }],
  candidates: [],
  status: "pending",
  rejectReason: null,
  caseId: null,
  resubmittedFrom: null,
  createdAt: NOW.toISOString(),
  decidedAt: null,
};

type OwnRef = { requestId: string; requesterId: string };
type WithdrawInput = OwnRef & { version: number; now: string; traceId: string };

function fakeRepository() {
  return {
    findUserDepartmentId: vi.fn<(userId: string) => Promise<string | null>>(
      async () => DEPT,
    ),
    findOwnResubmittable: vi.fn<(input: OwnRef) => Promise<boolean>>(
      async () => true,
    ),
    readSubmittedRecipientCandidates: vi.fn<
      (
        departmentIds: string[],
      ) => Promise<{ ownerIds: string[]; adminIds: string[] }>
    >(async () => ({ ownerIds: [OWNER], adminIds: [ADMIN] })),
    create: vi.fn<(input: RepositoryCreateInput) => Promise<{ id: string }>>(
      async () => ({ id: REQUEST }),
    ),
    hasSimilarTitle: vi.fn<
      (input: { clientId: string; title: string }) => Promise<boolean>
    >(async () => false),
    findOwnItem: vi.fn<(input: OwnRef) => Promise<typeof ITEM | null>>(
      async () => ITEM,
    ),
    findOwnForWithdraw: vi.fn<
      (
        input: OwnRef,
      ) => Promise<{ id: string; status: string; version: number } | null>
    >(async () => ({ id: REQUEST, status: "pending", version: 3 })),
    listMine: vi.fn<
      (input: {
        requesterId: string;
        limit: number;
        cursor?: string;
      }) => Promise<{ items: (typeof ITEM)[]; nextCursor: string | null }>
    >(async () => ({ items: [ITEM], nextCursor: null })),
    withdraw: vi.fn<(input: WithdrawInput) => Promise<void>>(
      async () => undefined,
    ),
  };
}
type Fake = ReturnType<typeof fakeRepository>;

function rolesOf(isAdmin: boolean): RoleAssignmentRepository {
  const found = {
    user: { isActive: true },
    assignments: isAdmin
      ? [
          {
            id: "01JTESTCASEREQSVCASGN0001",
            userId: ACTOR,
            roleId: "role_global_admin",
            scopeType: "company",
            departmentId: null,
            assignedAt: NOW.toISOString(),
          },
        ]
      : [],
  } as unknown as UserWithAssignments;
  return {
    findByUserId: vi.fn<(userId: string) => Promise<UserWithAssignments>>(
      async () => found,
    ),
  };
}

type AuthorizeCall = { userId: string; permission: Permission; scope: unknown };
function fakeAuthorizer(deny = false) {
  const calls: AuthorizeCall[] = [];
  return {
    calls,
    async authorize(
      principal: { userId: string },
      permission: Permission,
      scope: unknown,
    ) {
      calls.push({ userId: principal.userId, permission, scope });
      if (deny)
        throw new AppError("FORBIDDEN", "この操作を行う権限がありません");
    },
  };
}

let logLines: string[];
beforeEach(() => {
  logLines = [];
  const capture = (...args: unknown[]) => {
    logLines.push(args.map(String).join(" "));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
});
afterEach(() => {
  vi.restoreAllMocks();
});

function serviceOf(
  fake: Fake,
  options: {
    isAdmin?: boolean;
    authorizer?: ReturnType<typeof fakeAuthorizer>;
    now?: Date;
  } = {},
) {
  return createCaseRequestService(
    fake as unknown as CaseRequestRepository,
    rolesOf(options.isAdmin ?? false),
    {
      now: () => options.now ?? NOW,
      authorizer: options.authorizer ?? fakeAuthorizer(),
    } as never,
  );
}

const input = (overrides: Partial<CreateInput> = {}): CreateInput => ({
  clientId: CLIENT,
  title: "[UNIT_TEST]件名",
  departmentIds: [DEPT],
  ...overrides,
});

async function attempt<T>(run: () => Promise<T>) {
  try {
    return { result: await run(), error: undefined };
  } catch (error) {
    return { result: undefined, error };
  }
}

function expectAppError(error: unknown, code: string) {
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

const actor = { userId: ACTOR, traceId: "unit-auth-casereq-svc" };

describe("#146 申請の判定の順（計画 A-5）", () => {
  it('#146 5-3 AC-1（R-60）: perm.case.request.create を、申請者について会社の範囲 { type: "company" } で最初に確かめる', async () => {
    const fake = fakeRepository();
    const authorizer = fakeAuthorizer();
    await serviceOf(fake, { authorizer }).create(actor, input());
    expect(authorizer.calls).toEqual([
      {
        userId: ACTOR,
        permission: "perm.case.request.create",
        scope: { type: "company" },
      },
    ]);
  });

  it("#146 5-3 AC-1（R-60）: 権限で拒否されたら 403 のままで、所属の読み取り・書き込みをしない", async () => {
    const fake = fakeRepository();
    const { error } = await attempt(() =>
      serviceOf(fake, { authorizer: fakeAuthorizer(true) }).create(
        actor,
        input({ dueDate: "2026-11-01" }),
      ),
    );
    expectAppError(error, "FORBIDDEN");
    expect(fake.findUserDepartmentId).not.toHaveBeenCalled();
    expect(fake.create).not.toHaveBeenCalled();
  });

  it("#146 5-3 AC-1: 全体管理者でなく所属もなければ 403「所属部署がないため申請できません」。納期の誤りより先で、監査に記録し、書き込まない", async () => {
    const fake = fakeRepository();
    fake.findUserDepartmentId.mockResolvedValue(null);
    const { error } = await attempt(() =>
      serviceOf(fake).create(actor, input({ dueDate: "2026-11-01" })),
    );
    const appError = expectAppError(error, "FORBIDDEN");
    expect(appError.userMessage).toBe("所属部署がないため申請できません");
    expect(fake.create).not.toHaveBeenCalled();
    const lines = auditLogLines(logLines).filter(
      (line) => line.attributes?.result === "failure",
    );
    expect(lines.map((line) => line.body)).toEqual(["case_request.create"]);
  });

  it("#146 5-3 AC-1: 所属のない全体管理者は申請できる（書き込みに進む）", async () => {
    const fake = fakeRepository();
    fake.findUserDepartmentId.mockResolvedValue(null);
    const { error } = await attempt(() =>
      serviceOf(fake, { isAdmin: true }).create(actor, input()),
    );
    expect(error).toBeUndefined();
    expect(fake.create).toHaveBeenCalledTimes(1);
  });

  it("#146 C-132: 担当部署は所属と違う部署でも、部署の範囲で拒否しない（他部署を含む複数をそのまま渡す）", async () => {
    const fake = fakeRepository();
    const other = "01JTESTCASEREQSVCDEPT0002";
    await serviceOf(fake).create(
      actor,
      input({ departmentIds: [other, DEPT] }),
    );
    expect(fake.create.mock.calls[0]?.[0].departmentIds).toEqual([other, DEPT]);
  });
});

describe("#146 5-3 AC-12・AC-13 件名の整形", () => {
  it("#146 5-3 AC-13: 整形した件名で書き込み、値が変わったら titleFormatted は真", async () => {
    const fake = fakeRepository();
    const { result } = await attempt(() =>
      serviceOf(fake).create(actor, input({ title: "　ＡＢＣ　 保守  " })),
    );
    expect(fake.create.mock.calls[0]?.[0].title).toBe("ABC 保守");
    expect(fake.hasSimilarTitle).toHaveBeenCalledWith({
      clientId: CLIENT,
      title: "ABC 保守",
    });
    expect(result).toMatchObject({ titleFormatted: true });
  });

  it("#146 5-3 AC-13: 整形で値が変わらなければ titleFormatted は偽", async () => {
    const fake = fakeRepository();
    const { result } = await attempt(() =>
      serviceOf(fake).create(actor, input({ title: "ABC 保守" })),
    );
    expect(result).toMatchObject({ titleFormatted: false });
  });

  it("#146 5-3 AC-14: 似た件名があっても書き込み、hasSimilarTitle を真で返す", async () => {
    const fake = fakeRepository();
    fake.hasSimilarTitle.mockResolvedValue(true);
    const { result } = await attempt(() =>
      serviceOf(fake).create(actor, input()),
    );
    expect(fake.create).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ hasSimilarTitle: true });
  });

  it("#146 5-3 AC-12: 整形の後に101文字なら 422（fields: title）で書き込まない", async () => {
    const fake = fakeRepository();
    const { error } = await attempt(() =>
      serviceOf(fake).create(
        actor,
        input({ title: `${"Ａ".repeat(50)} ${"Ｂ".repeat(50)}` }),
      ),
    );
    expect(expectAppError(error, "VALIDATION_ERROR").details).toMatchObject({
      fields: ["title"],
    });
    expect(fake.create).not.toHaveBeenCalled();
  });
});

describe("#146 5-1 AC-17・C-141(2) 納期は今日（日本時間）以降", () => {
  it("#146 5-1 AC-17: 昨日の納期は 422（fields: dueDate）で書き込まない", async () => {
    const fake = fakeRepository();
    const { error } = await attempt(() =>
      serviceOf(fake).create(actor, input({ dueDate: "2026-11-16" })),
    );
    expect(expectAppError(error, "VALIDATION_ERROR").details).toMatchObject({
      fields: ["dueDate"],
    });
    expect(fake.create).not.toHaveBeenCalled();
  });

  it("#146 5-1 AC-17: 今日の納期は可", async () => {
    const fake = fakeRepository();
    await serviceOf(fake).create(actor, input({ dueDate: "2026-11-17" }));
    expect(fake.create.mock.calls[0]?.[0].dueDate).toBe("2026-11-17");
  });

  it("#146 5-1 AC-17: UTC 15:00 を過ぎると「今日」は日本時間の翌日になる（UTC の日付では判定しない）", async () => {
    const fake = fakeRepository();
    const late = new Date("2026-11-16T15:00:00.000Z");
    const { error } = await attempt(() =>
      serviceOf(fake, { now: late }).create(
        actor,
        input({ dueDate: "2026-11-16" }),
      ),
    );
    expectAppError(error, "VALIDATION_ERROR");
    await serviceOf(fake, { now: late }).create(
      actor,
      input({ dueDate: "2026-11-17" }),
    );
    expect(fake.create).toHaveBeenCalledTimes(1);
  });

  it("#146 C-141(2): 再申請でも過去の納期は 422（fields: dueDate）。再申請の元の確認より先", async () => {
    const fake = fakeRepository();
    const { error } = await attempt(() =>
      serviceOf(fake).create(
        actor,
        input({ dueDate: "2026-11-16", resubmitOf: ORIGINAL }),
      ),
    );
    expect(expectAppError(error, "VALIDATION_ERROR").details).toMatchObject({
      fields: ["dueDate"],
    });
    expect(fake.findOwnResubmittable).not.toHaveBeenCalled();
    expect(fake.create).not.toHaveBeenCalled();
  });

  it("#146 5-3 AC-6: 納期なしは null で書き込む", async () => {
    const fake = fakeRepository();
    await serviceOf(fake).create(actor, input());
    expect(fake.create.mock.calls[0]?.[0]).toMatchObject({
      dueDate: null,
      description: "",
      candidateIds: [],
      resubmitOf: null,
    });
  });
});

describe("#146 5-3 AC-6 再申請の元", () => {
  it("#146 5-3 AC-6: 本人の rejected・withdrawn でない元は 422（fields: resubmitOf）で書き込まない", async () => {
    const fake = fakeRepository();
    fake.findOwnResubmittable.mockResolvedValue(false);
    const { error } = await attempt(() =>
      serviceOf(fake).create(actor, input({ resubmitOf: ORIGINAL })),
    );
    expect(expectAppError(error, "VALIDATION_ERROR").details).toMatchObject({
      fields: ["resubmitOf"],
    });
    expect(fake.findOwnResubmittable).toHaveBeenCalledWith({
      requestId: ORIGINAL,
      requesterId: ACTOR,
    });
    expect(fake.create).not.toHaveBeenCalled();
  });

  it("#146 5-3 AC-6: 元が使えれば resubmitOf を付けて書き込む", async () => {
    const fake = fakeRepository();
    await serviceOf(fake).create(actor, input({ resubmitOf: ORIGINAL }));
    expect(fake.create.mock.calls[0]?.[0].resubmitOf).toBe(ORIGINAL);
  });
});

describe("#146 3-4 AC-1・Q3 宛先", () => {
  it("#146 3-4 AC-1（Q3）: 担当部署の有効なオーナーを宛先として書き込みに渡す（全体管理者は渡さない）", async () => {
    const fake = fakeRepository();
    await serviceOf(fake).create(actor, input());
    expect(fake.readSubmittedRecipientCandidates).toHaveBeenCalledWith([DEPT]);
    expect(fake.create.mock.calls[0]?.[0].recipientIds).toEqual([OWNER]);
  });

  it("#146 3-4 AC-1・AC-3（Q3）: オーナーが申請者本人だけなら、全体管理者を宛先にする", async () => {
    const fake = fakeRepository();
    fake.readSubmittedRecipientCandidates.mockResolvedValue({
      ownerIds: [ACTOR],
      adminIds: [ADMIN],
    });
    await serviceOf(fake).create(actor, input());
    expect(fake.create.mock.calls[0]?.[0].recipientIds).toEqual([ADMIN]);
  });
});

describe("#146 書き込みの失敗の変換（計画 A-6・突き合わせの表）", () => {
  it.each([
    ["client_unavailable", "clientId"],
    ["department_unavailable", "departmentIds"],
    ["candidate_unavailable", "candidateIds"],
    ["resubmit_unavailable", "resubmitOf"],
  ] as const)(
    "#146 5-3 AC-1・AC-5・AC-6・AC-11: %s は 422（fields: %s）",
    async (reason, field) => {
      const fake = fakeRepository();
      fake.create.mockRejectedValue(new CaseRequestWriteError(reason));
      const { error } = await attempt(() =>
        serviceOf(fake).create(actor, input()),
      );
      expect(expectAppError(error, "VALIDATION_ERROR").details).toMatchObject({
        fields: [field],
      });
    },
  );

  it("#146 重大1: requester_ineligible は 403「申請できません」で、監査に記録する", async () => {
    const fake = fakeRepository();
    fake.create.mockRejectedValue(
      new CaseRequestWriteError("requester_ineligible"),
    );
    const { error } = await attempt(() =>
      serviceOf(fake).create(actor, input()),
    );
    expect(expectAppError(error, "FORBIDDEN").userMessage).toBe(
      "申請できません",
    );
    const lines = auditLogLines(logLines).filter(
      (line) => line.attributes?.result === "failure",
    );
    expect(lines.map((line) => line.body)).toEqual(["case_request.create"]);
  });

  it("#146 重大2: recipients_changed は 409「審査する人が変わりました。もう一度申請してください」", async () => {
    const fake = fakeRepository();
    fake.create.mockRejectedValue(
      new CaseRequestWriteError("recipients_changed"),
    );
    const { error } = await attempt(() =>
      serviceOf(fake).create(actor, input()),
    );
    expect(expectAppError(error, "CONFLICT").userMessage).toBe(
      "審査する人が変わりました。もう一度申請してください",
    );
  });

  it("#146 計画 A-6: 想定外のエラーは変えずに投げ直す（成功にしない）", async () => {
    const fake = fakeRepository();
    const unknown = new Error("D1_ERROR: unexpected");
    fake.create.mockRejectedValue(unknown);
    const { error } = await attempt(() =>
      serviceOf(fake).create(actor, input()),
    );
    expect(error).toBe(unknown);
  });
});

describe("#146 5-3 AC-7 取り下げの判定の順", () => {
  it("#146 5-3 AC-7: 本人の申請なら、読んだ版で取り下げて { requestId, status: withdrawn } を返す", async () => {
    const fake = fakeRepository();
    const result = await serviceOf(fake).withdraw(actor, REQUEST);
    expect(result).toEqual({ requestId: REQUEST, status: "withdrawn" });
    expect(fake.findOwnForWithdraw).toHaveBeenCalledWith({
      requestId: REQUEST,
      requesterId: ACTOR,
    });
    expect(fake.withdraw.mock.calls[0]?.[0]).toMatchObject({
      requestId: REQUEST,
      requesterId: ACTOR,
      version: 3,
    });
  });

  it("#146 5-3 AC-7: 本人の申請が見つからなければ 404 で、監査に記録し、書き込まない", async () => {
    const fake = fakeRepository();
    fake.findOwnForWithdraw.mockResolvedValue(null);
    const { error } = await attempt(() =>
      serviceOf(fake, { isAdmin: true }).withdraw(actor, REQUEST),
    );
    expectAppError(error, "NOT_FOUND");
    expect(fake.withdraw).not.toHaveBeenCalled();
    const lines = auditLogLines(logLines).filter(
      (line) => line.attributes?.result === "failure",
    );
    expect(lines.map((line) => line.body)).toEqual(["case_request.withdraw"]);
  });

  it("#146 5-3 AC-7: 書き込みが decided なら 409「この申請はすでに処理されています」", async () => {
    const fake = fakeRepository();
    fake.withdraw.mockRejectedValue(new CaseRequestWriteError("decided"));
    const { error } = await attempt(() =>
      serviceOf(fake).withdraw(actor, REQUEST),
    );
    expect(expectAppError(error, "CONFLICT").userMessage).toBe(
      "この申請はすでに処理されています",
    );
  });

  it("#146 5-3 AC-7: 書き込みが not_found（読んだ後に行がなくなった）なら、成功にせず 404", async () => {
    const fake = fakeRepository();
    fake.withdraw.mockRejectedValue(new CaseRequestWriteError("not_found"));
    const { error } = await attempt(() =>
      serviceOf(fake).withdraw(actor, REQUEST),
    );
    expectAppError(error, "NOT_FOUND");
  });
});

describe("#146（統括の決定）自分の申請・取り下げ・類似件名の確認の権限 perm.case.request.create（R-60）", () => {
  type Operation = [
    string,
    (service: ReturnType<typeof serviceOf>) => Promise<unknown>,
    (fake: Fake) => unknown[],
  ];
  const operations: Operation[] = [
    [
      "自分の申請",
      (service) => service.listMine(actor, { limit: 20 }),
      (fake) => fake.listMine.mock.calls,
    ],
    [
      "取り下げ",
      (service) => service.withdraw(actor, REQUEST),
      (fake) => [
        ...fake.findOwnForWithdraw.mock.calls,
        ...fake.withdraw.mock.calls,
      ],
    ],
    [
      "類似件名の確認",
      (service) =>
        service.checkSimilarTitle(actor, {
          clientId: CLIENT,
          title: "[UNIT_TEST]件名",
        }),
      (fake) => fake.hasSimilarTitle.mock.calls,
    ],
  ];

  it.each(operations)(
    '#146 R-60: %s は、最初に perm.case.request.create を { type: "company" } で1回確かめる',
    async (_label, run) => {
      const fake = fakeRepository();
      const authorizer = fakeAuthorizer();
      await run(serviceOf(fake, { authorizer }));
      expect(authorizer.calls).toEqual([
        {
          userId: ACTOR,
          permission: "perm.case.request.create",
          scope: { type: "company" },
        },
      ]);
    },
  );

  it.each(operations)(
    "#146 R-60: %s は、拒否なら 403 のままで Repository を呼ばない",
    async (_label, run, calls) => {
      const fake = fakeRepository();
      const { error } = await attempt(() =>
        run(serviceOf(fake, { authorizer: fakeAuthorizer(true) })),
      );
      expectAppError(error, "FORBIDDEN");
      expect(calls(fake)).toEqual([]);
    },
  );

  it("#146 5-3 AC-14: 類似件名の確認は整形した件名で比べ、{ hasSimilar, formattedTitle } だけを返す", async () => {
    const fake = fakeRepository();
    fake.hasSimilarTitle.mockResolvedValue(true);
    const result = await serviceOf(fake).checkSimilarTitle(actor, {
      clientId: CLIENT,
      title: "　ＡＢＣ　保守 ",
    });
    expect(fake.hasSimilarTitle).toHaveBeenCalledWith({
      clientId: CLIENT,
      title: "ABC 保守",
    });
    expect(result).toEqual({ hasSimilar: true, formattedTitle: "ABC 保守" });
  });

  it("#146 自分の申請は、本人の ID で読む", async () => {
    const fake = fakeRepository();
    await serviceOf(fake).listMine(actor, { limit: 20 });
    expect(fake.listMine.mock.calls[0]?.[0]).toMatchObject({
      requesterId: ACTOR,
      limit: 20,
    });
  });
});

describe("#146 存在の非開示と拒否の記録（ミューテーションの生き残りへの対応）", () => {
  it("#146 5-3 AC-7: 本人の申請が見つからない 404 と、書き込みの not_found の 404 は、コード・文言が同じで、文言は空でない", async () => {
    const missing = fakeRepository();
    missing.findOwnForWithdraw.mockResolvedValue(null);
    const first = await attempt(() =>
      serviceOf(missing).withdraw(actor, REQUEST),
    );
    const gone = fakeRepository();
    gone.withdraw.mockRejectedValue(new CaseRequestWriteError("not_found"));
    const second = await attempt(() =>
      serviceOf(gone).withdraw(actor, REQUEST),
    );
    const a = expectAppError(first.error, "NOT_FOUND");
    const b = expectAppError(second.error, "NOT_FOUND");
    expect(a.userMessage.length).toBeGreaterThan(0);
    expect([b.code, b.userMessage, b.details]).toEqual([
      a.code,
      a.userMessage,
      a.details,
    ]);
  });

  it("#146 5-3 AC-1（logger）: 所属なしの拒否は、理由 no_department を監査に記録する", async () => {
    const fake = fakeRepository();
    fake.findUserDepartmentId.mockResolvedValue(null);
    await attempt(() => serviceOf(fake).create(actor, input()));
    const lines = auditLogLines(logLines).filter(
      (line) => line.attributes?.result === "failure",
    );
    expect(lines[0]?.attributes).toMatchObject({ reason: "no_department" });
  });

  it("#146 5-3 AC-7（logger）: 本人の申請が見つからない取り下げは、理由 not_found を監査に記録する", async () => {
    const fake = fakeRepository();
    fake.findOwnForWithdraw.mockResolvedValue(null);
    await attempt(() => serviceOf(fake).withdraw(actor, REQUEST));
    const lines = auditLogLines(logLines).filter(
      (line) => line.attributes?.result === "failure",
    );
    expect(lines[0]?.attributes).toMatchObject({
      reason: "not_found",
      target: REQUEST,
    });
  });
});
