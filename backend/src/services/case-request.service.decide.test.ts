// #146（146-B）5-3 AC-3・AC-4・AC-5・AC-9、C-178・C-179：案件の作成申請の審査一覧・承認・却下の Service を、Repository を代役にして確かめる。
// 結合（routes/case-requests.decide.test.ts）と DB（db/case-request.approve.db.test.ts）で確かめているものは重ねず、
// ミューテーションが「その層で通っていない」とした分岐だけを足す：
//   審査者の門の 403（拒否の記録・Repository に触れない）、存在しない・範囲外の 404 の本文が同じこと、自分の申請の 403、
//   承認者が足す候補の存在・有効の確認（422）、batch の中で資格が崩れた reviewer_ineligible（403 と失敗の監査）、前提の崩れの変換、canApprove。
// 期待値は 5-3 と決定記録 C-178・C-179 から決め、実装の動きを写さない。データは架空。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLogLines } from "../../test/channel-request-fixtures";
import {
  CaseRequestWriteError,
  type CaseRequestForDecision,
  type CaseRequestRepository,
  type CaseRequestStatus,
  type CaseRequestWriteReason,
} from "../db/case-request.repository";
import type {
  RoleAssignmentRepository,
  UserWithAssignments,
} from "../db/role-assignment.repository";
import { AppError } from "../lib/app-error";
import { ROLE_IDS, type Permission } from "../lib/permissions";
import { createCaseRequestService } from "./case-request.service";

const ACTOR = "01JTESTCASEDECACTR00000001";
const REQUESTER = "01JTESTCASEDECRQST00000001";
const DEPT = "01JTESTCASEDECDPTA00000001";
const OTHER_DEPT = "01JTESTCASEDECDPTB00000001";
const REQUEST = "01JTESTCASEDECRQST00000002";
const CANDIDATE_A = "01JTESTCASEDECCNDA00000001";
const CANDIDATE_B = "01JTESTCASEDECCNDB00000001";
const NOW = new Date("2026-11-17T03:00:00.000Z");

type Who = "owner" | "admin" | "outsideOwner" | "member";

function rolesOf(who: Who): RoleAssignmentRepository {
  const assignment = (
    roleId: string,
    scopeType: "company" | "department",
    departmentId: string | null,
  ) => ({
    id: "01JTESTCASEDECASGN00000001",
    userId: ACTOR,
    roleId,
    scopeType,
    departmentId,
    assignedAt: NOW.toISOString(),
  });
  const assignments = {
    owner: [assignment(ROLE_IDS.owner, "department", DEPT)],
    outsideOwner: [assignment(ROLE_IDS.owner, "department", OTHER_DEPT)],
    admin: [assignment(ROLE_IDS.globalAdmin, "company", null)],
    member: [],
  }[who];
  const found = {
    user: { isActive: true },
    assignments,
  } as unknown as UserWithAssignments;
  return {
    findByUserId: vi.fn<(userId: string) => Promise<UserWithAssignments>>(
      async () => found,
    ),
  };
}

type Created = { caseId: string; caseNumber: string; roomId: string };
type DecideArgs = {
  requestId: string;
  version: number;
  deciderId: string;
  now: string;
  traceId: string;
};
type ReviewScope = { isAdmin: boolean; ownedDepartmentIds: readonly string[] };
type ReviewItem = {
  id: string;
  requesterId: string;
  status: CaseRequestStatus;
  departments: { id: string }[];
};

const PENDING: CaseRequestForDecision = {
  id: REQUEST,
  requestedBy: REQUESTER,
  status: "pending",
  version: 4,
  departmentIds: [DEPT],
};

function fakeRepository() {
  return {
    findForDecision: vi.fn<
      (requestId: string) => Promise<CaseRequestForDecision | null>
    >(async () => PENDING),
    countActiveUsers: vi.fn<(userIds: readonly string[]) => Promise<number>>(
      async (userIds) => userIds.length,
    ),
    approve: vi.fn<
      (
        input: DecideArgs & { additionalCandidateIds: string[] },
      ) => Promise<Created>
    >(async () => ({
      caseId: "01JTESTCASEDECCASE00000001",
      caseNumber: "QZA-261117-0001",
      roomId: "01JTESTCASEDECROOM00000001",
    })),
    reject: vi.fn<(input: DecideArgs & { reason: string }) => Promise<void>>(
      async () => undefined,
    ),
    listReviewable: vi.fn<
      (
        scope: ReviewScope,
        options: { limit: number },
      ) => Promise<{ items: ReviewItem[]; nextCursor: string | null }>
    >(async () => ({ items: [], nextCursor: null })),
  };
}
type Fake = ReturnType<typeof fakeRepository>;

type AuthorizeCall = { userId: string; permission: Permission; scope: unknown };
function fakeAuthorizer() {
  const calls: AuthorizeCall[] = [];
  return {
    calls,
    async authorize(
      principal: { userId: string },
      permission: Permission,
      scope: unknown,
    ) {
      calls.push({ userId: principal.userId, permission, scope });
      await Promise.resolve();
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
  who: Who,
  authorizer?: ReturnType<typeof fakeAuthorizer>,
) {
  return createCaseRequestService(
    fake as unknown as CaseRequestRepository,
    rolesOf(who),
    { now: () => NOW, ...(authorizer ? { authorizer } : {}) } as never,
  );
}
type Service = ReturnType<typeof serviceOf>;

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

const actor = { userId: ACTOR, traceId: "unit-case-decide-svc" };
const failureAudits = () =>
  auditLogLines(logLines).filter(
    (line) => line.attributes?.result === "failure",
  );

type Operation = "approve" | "reject";
const OPERATIONS: [Operation][] = [["approve"], ["reject"]];
const run = (service: Service, operation: Operation): Promise<unknown> =>
  operation === "approve"
    ? service.approve(actor, REQUEST, {})
    : service.reject(actor, REQUEST, "[UNIT_TEST]理由");
const writeOf = (fake: Fake, operation: Operation) =>
  operation === "approve" ? fake.approve : fake.reject;

describe("#146 5-3 AC-3・AC-9 batch の時点で決裁者の資格が崩れた（reviewer_ineligible）", () => {
  it.each(OPERATIONS)(
    "#146 5-3 AC-9: %s で reviewer_ineligible なら 403「この申請を審査する権限がありません」。失敗の監査が1件（操作の名前・対象の申請 ID・理由）",
    async (operation) => {
      const fake = fakeRepository();
      writeOf(fake, operation).mockRejectedValue(
        new CaseRequestWriteError("reviewer_ineligible"),
      );
      const { error } = await attempt(() =>
        run(serviceOf(fake, "owner"), operation),
      );
      const appError = expectAppError(error, "FORBIDDEN");
      expect(appError.userMessage).toBe("この申請を審査する権限がありません");
      const audits = failureAudits();
      expect(audits).toHaveLength(1);
      expect(audits[0]?.body).toBe(`case_request.${operation}`);
      expect(audits[0]?.attributes).toMatchObject({
        target: REQUEST,
        result: "failure",
        reason: "reviewer_ineligible",
      });
    },
  );
});

describe("#146 5-3 AC-3 審査者の門の 403（判定の順(1)）", () => {
  const calls: [string, (service: Service) => Promise<unknown>][] = [
    ["審査の一覧", (s) => s.listForReview(actor, { limit: 20 })],
    ["承認", (s) => s.approve(actor, REQUEST, {})],
    ["却下", (s) => s.reject(actor, REQUEST, "[UNIT_TEST]理由")],
  ];

  it.each(calls)(
    "#146 5-3 AC-3: 審査者でない人（メンバー）の%sは、perm.case.request.approve を会社の範囲で確かめ、認可が通っても 403（デフォルト拒否）で、Repository に触れない",
    async (_label, call) => {
      const fake = fakeRepository();
      const authorizer = fakeAuthorizer();
      const { error } = await attempt(() =>
        call(serviceOf(fake, "member", authorizer)),
      );
      const appError = expectAppError(error, "FORBIDDEN");
      expect(appError.userMessage).toBe("この操作を行う権限がありません");
      expect(authorizer.calls).toEqual([
        {
          userId: ACTOR,
          permission: "perm.case.request.approve",
          scope: { type: "company" },
        },
      ]);
      expect(fake.findForDecision).not.toHaveBeenCalled();
      expect(fake.listReviewable).not.toHaveBeenCalled();
      expect(fake.countActiveUsers).not.toHaveBeenCalled();
      expect(fake.approve).not.toHaveBeenCalled();
      expect(fake.reject).not.toHaveBeenCalled();
    },
  );

  it.each(calls)(
    "#146 5-3 AC-3: 審査者でない人（メンバー）の%sを、実際の認可が 403 で拒否し、拒否の監査に操作者が残る",
    async (_label, call) => {
      const { error } = await attempt(() =>
        call(serviceOf(fakeRepository(), "member")),
      );
      expectAppError(error, "FORBIDDEN");
      const denied = failureAudits();
      expect(denied.length).toBeGreaterThanOrEqual(1);
      expect(denied.some((line) => line.user_id === ACTOR)).toBe(true);
    },
  );

  it.each(calls)(
    "#146 5-3 AC-3: 審査者（オーナー・全体管理者）の%sは、門で止めない",
    async (_label, call) => {
      for (const who of ["owner", "admin"] as const) {
        const { error } = await attempt(() =>
          call(serviceOf(fakeRepository(), who)),
        );
        expect(error).toBeUndefined();
      }
    },
  );
});

describe("#146 5-3 AC-3・AC-4 存在の非開示と自分の申請（判定の順(2)(3)）", () => {
  it.each(OPERATIONS)(
    "#146 5-3 AC-3: %s で、存在しない申請と、範囲外のオーナーに見える申請は、コード・文言・details が完全に同じ 404 で、理由 not_found を監査に記録し、書き込まない",
    async (operation) => {
      const missing = fakeRepository();
      missing.findForDecision.mockResolvedValue(null);
      const first = await attempt(() =>
        run(serviceOf(missing, "owner"), operation),
      );
      const outside = fakeRepository();
      const second = await attempt(() =>
        run(serviceOf(outside, "outsideOwner"), operation),
      );
      const a = expectAppError(first.error, "NOT_FOUND");
      const b = expectAppError(second.error, "NOT_FOUND");
      expect(a.userMessage).toBe("申請が見つかりません");
      expect([b.code, b.userMessage, b.details]).toEqual([
        a.code,
        a.userMessage,
        a.details,
      ]);
      expect(missing.countActiveUsers).not.toHaveBeenCalled();
      expect(writeOf(missing, operation)).not.toHaveBeenCalled();
      expect(writeOf(outside, operation)).not.toHaveBeenCalled();
      const audits = failureAudits();
      expect(audits).toHaveLength(2);
      for (const audit of audits) {
        expect(audit.body).toBe(`case_request.${operation}`);
        expect(audit.attributes).toMatchObject({
          target: REQUEST,
          reason: "not_found",
        });
      }
    },
  );

  it.each(OPERATIONS)(
    "#146 5-3 AC-4: %s で、全体管理者でないオーナーが自分の申請を決裁すると 403「この申請は承認・却下できません」。理由 own_request を監査に記録し、書き込まない",
    async (operation) => {
      const fake = fakeRepository();
      fake.findForDecision.mockResolvedValue({
        ...PENDING,
        requestedBy: ACTOR,
      });
      const { error } = await attempt(() =>
        run(serviceOf(fake, "owner"), operation),
      );
      const appError = expectAppError(error, "FORBIDDEN");
      expect(appError.userMessage).toBe("この申請は承認・却下できません");
      expect(writeOf(fake, operation)).not.toHaveBeenCalled();
      const audits = failureAudits();
      expect(audits).toHaveLength(1);
      expect(audits[0]?.body).toBe(`case_request.${operation}`);
      expect(audits[0]?.attributes).toMatchObject({
        target: REQUEST,
        reason: "own_request",
      });
    },
  );

  it("#146 5-3 AC-4: 全体管理者は自分の申請も承認できる", async () => {
    const fake = fakeRepository();
    fake.findForDecision.mockResolvedValue({ ...PENDING, requestedBy: ACTOR });
    const { error } = await attempt(() =>
      serviceOf(fake, "admin").approve(actor, REQUEST, {}),
    );
    expect(error).toBeUndefined();
    expect(fake.approve).toHaveBeenCalledTimes(1);
  });
});

describe("#146 5-3 AC-5・AC-6 承認者が足す候補の確認（判定の順(4)）と書き込みの引数", () => {
  it.each<[string, string[], number]>([
    ["無効な社員だけ", [CANDIDATE_A], 0],
    ["存在しない ID だけ", [CANDIDATE_A], 0],
    ["一部だけ無効（または存在しない）", [CANDIDATE_A, CANDIDATE_B], 1],
  ])(
    "#146 5-3 AC-5: 足す候補が%sなら 422（fields: additionalCandidateIds）で、承認を書き込まない",
    async (_label, ids, activeCount) => {
      const fake = fakeRepository();
      fake.countActiveUsers.mockResolvedValue(activeCount);
      const { error } = await attempt(() =>
        serviceOf(fake, "owner").approve(actor, REQUEST, {
          additionalCandidateIds: ids,
        }),
      );
      const appError = expectAppError(error, "VALIDATION_ERROR");
      expect(appError.details).toEqual({ fields: ["additionalCandidateIds"] });
      expect(fake.countActiveUsers).toHaveBeenCalledWith(ids);
      expect(fake.approve).not.toHaveBeenCalled();
    },
  );

  it("#146 5-3 AC-5: 全員が有効なら、足す候補・読んだ版・決裁者を渡して承認し、requestId・status・案件の情報を返す", async () => {
    const fake = fakeRepository();
    const result = await serviceOf(fake, "owner").approve(actor, REQUEST, {
      additionalCandidateIds: [CANDIDATE_A, CANDIDATE_B],
    });
    expect(fake.approve).toHaveBeenCalledTimes(1);
    expect(fake.approve.mock.calls[0]?.[0]).toEqual({
      requestId: REQUEST,
      version: PENDING.version,
      deciderId: ACTOR,
      additionalCandidateIds: [CANDIDATE_A, CANDIDATE_B],
      now: NOW.toISOString(),
      traceId: actor.traceId,
    });
    expect(result).toEqual({
      requestId: REQUEST,
      status: "approved",
      caseId: "01JTESTCASEDECCASE00000001",
      caseNumber: "QZA-261117-0001",
      roomId: "01JTESTCASEDECROOM00000001",
    });
  });

  it("#146 5-3 AC-5: 候補を省いたら、空の配列で確かめて承認する", async () => {
    const fake = fakeRepository();
    await serviceOf(fake, "owner").approve(actor, REQUEST, {});
    expect(fake.countActiveUsers).toHaveBeenCalledWith([]);
    expect(fake.approve.mock.calls[0]?.[0]).toMatchObject({
      additionalCandidateIds: [],
    });
  });

  it("#146 5-3 AC-6: 却下は、読んだ版・決裁者・理由を渡し、候補の確認をせず { requestId, status: rejected } を返す", async () => {
    const fake = fakeRepository();
    const result = await serviceOf(fake, "owner").reject(
      actor,
      REQUEST,
      "[UNIT_TEST]理由",
    );
    expect(fake.reject.mock.calls[0]?.[0]).toEqual({
      requestId: REQUEST,
      version: PENDING.version,
      deciderId: ACTOR,
      reason: "[UNIT_TEST]理由",
      now: NOW.toISOString(),
      traceId: actor.traceId,
    });
    expect(fake.countActiveUsers).not.toHaveBeenCalled();
    expect(result).toEqual({ requestId: REQUEST, status: "rejected" });
  });
});

describe("#146 5-3 AC-3・AC-5・AC-7・AC-8・C-178 batch の前提の崩れの変換", () => {
  it.each<[CaseRequestWriteReason, string]>([
    ["decided", "この申請はすでに処理されています"],
    [
      "department_inactive",
      "担当部署の一部が無効のため承認できません。却下して再申請を依頼してください",
    ],
    [
      "client_inactive",
      "取引先が無効のため承認できません。却下して再申請を依頼してください",
    ],
    [
      "candidate_inactive",
      "無効になった候補がいます。申請者に取り下げと再申請を依頼してください",
    ],
    [
      "number_exhausted",
      "この取引先の今年の案件番号が上限に達したため承認できません",
    ],
    ["number_conflict", "採番が競合しました。もう一度承認してください"],
  ])(
    "#146 5-3 AC-7: 承認の書き込みが %s なら 409 CONFLICT で、文言は決めたとおり、details は空",
    async (reason, message) => {
      const fake = fakeRepository();
      fake.approve.mockRejectedValue(new CaseRequestWriteError(reason));
      const { error } = await attempt(() =>
        serviceOf(fake, "owner").approve(actor, REQUEST, {}),
      );
      const appError = expectAppError(error, "CONFLICT");
      expect(appError.userMessage).toBe(message);
      expect(appError.details).toEqual({});
    },
  );

  it("#146 5-3 AC-5: 書き込みが added_candidate_unavailable（読んだ後に無効になった）なら 422（fields: additionalCandidateIds）", async () => {
    const fake = fakeRepository();
    fake.approve.mockRejectedValue(
      new CaseRequestWriteError("added_candidate_unavailable"),
    );
    const { error } = await attempt(() =>
      serviceOf(fake, "owner").approve(actor, REQUEST, {}),
    );
    const appError = expectAppError(error, "VALIDATION_ERROR");
    expect(appError.details).toEqual({ fields: ["additionalCandidateIds"] });
  });

  it.each(OPERATIONS)(
    "#146 5-3 AC-3: %s の書き込みが not_found（読んだ後に申請がなくなった）なら、成功にせず 404「申請が見つかりません」",
    async (operation) => {
      const fake = fakeRepository();
      writeOf(fake, operation).mockRejectedValue(
        new CaseRequestWriteError("not_found"),
      );
      const { error } = await attempt(() =>
        run(serviceOf(fake, "owner"), operation),
      );
      const appError = expectAppError(error, "NOT_FOUND");
      expect(appError.userMessage).toBe("申請が見つかりません");
    },
  );

  it.each(OPERATIONS)(
    "#146 計画 A-6: %s で想定外のエラーは、変えずに投げ直す（成功にしない）",
    async (operation) => {
      const fake = fakeRepository();
      const failure = new Error("[UNIT_TEST]想定外");
      writeOf(fake, operation).mockRejectedValue(failure);
      const { error } = await attempt(() =>
        run(serviceOf(fake, "owner"), operation),
      );
      expect(error).toBe(failure);
    },
  );
});

describe("#146 5-3 AC-3・AC-4・S-29 審査一覧の canApprove と審査の範囲", () => {
  const item = (
    id: string,
    status: CaseRequestStatus,
    requesterId = REQUESTER,
  ): ReviewItem => ({ id, status, requesterId, departments: [{ id: DEPT }] });

  it("#146 S-29: canApprove は、審査中（pending）で決裁できるときだけ true。決裁済みの状態・オーナー自身の申請は false", async () => {
    const fake = fakeRepository();
    const statuses: CaseRequestStatus[] = [
      "approved",
      "rejected",
      "withdrawn",
      "auto_cancelled",
    ];
    fake.listReviewable.mockResolvedValue({
      items: [
        item("a-pending", "pending"),
        ...statuses.map((status) => item(`a-${status}`, status)),
        item("a-own", "pending", ACTOR),
      ],
      nextCursor: null,
    });
    const page = await serviceOf(fake, "owner").listForReview(actor, {
      limit: 20,
    });
    expect(page.items).toHaveLength(6);
    expect(page.items.map((i) => [i.id, i.canApprove])).toEqual([
      ["a-pending", true],
      ["a-approved", false],
      ["a-rejected", false],
      ["a-withdrawn", false],
      ["a-auto_cancelled", false],
      ["a-own", false],
    ]);
  });

  it("#146 5-3 AC-3: 審査の範囲として、決裁者が全体管理者か・オーナーである部署を Repository に渡す", async () => {
    const owner = fakeRepository();
    await serviceOf(owner, "owner").listForReview(actor, { limit: 5 });
    expect(owner.listReviewable.mock.calls[0]?.[0]).toEqual({
      isAdmin: false,
      ownedDepartmentIds: [DEPT],
    });
    const admin = fakeRepository();
    await serviceOf(admin, "admin").listForReview(actor, { limit: 5 });
    expect(admin.listReviewable.mock.calls[0]?.[0]).toEqual({
      isAdmin: true,
      ownedDepartmentIds: [],
    });
  });
});
