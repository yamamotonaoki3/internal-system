// #128（128-c）0-1 AC-20・C-177（U-1・U-2）: 退職処理の申請の Service の判定の順を、Repository の代役で確かめる。
// 契約（計画 5.2・5.3。実装前の仮置き）：
//   createRetirementRequestService(repository, roles, deps?: { now?: () => Date })（retirement-request.service.ts）
//   service.create(actor, { targetUserId })・service.withdraw(actor, requestId)・service.reject(actor, requestId, reason)
//   actor は { userId, traceId, reauthenticatedAt }。
//   Repository：findTarget(id) → { id, isActive, departmentId, isGlobalAdmin, isDepartmentOwner } | null、findGlobalAdminIds() → 有効な全体管理者のID、
//     findForDecision(id) → { id, requestedBy, targetUserId, departmentId, status } | null、create・reject・withdraw（DB テストの契約）。
//   書き込みの前提が崩れたら Repository は RetirementRequestStateChangedError、同じ対象の pending は RetirementRequestConflictError を投げる。
// 権限（docs/requirements/permissions.md R-54・R-12）：
//   作成：perm.workspace.manage を「対象の今の部署」の範囲で authorize（オーナーはその部署だけ。全体管理者は任命された部署だけ）。
//   却下：perm.account.deactivate を会社の範囲で authorize（承認＝無効化の権限を持つ全体管理者）。
//   取り下げ：申請者本人であること（権限IDではなく所有者の条件）。
// 判定の順（統括の決定 2026-11-17）：作成 404（対象がない）→ 403（対象が無効・所属なし・ほかの部署を含む）→
//   409（department_owner：対象がその部署のオーナー〔申請者自身を含む〕／global_admin／重複は一意索引の違反を変換して duplicate_pending）。
//           却下 403（全体管理者でない。申請の有無を明かさない）→ 再認証 → 404 → 409（not_pending）。
//           取り下げ 404（ない・自分の申請でない。同じ応答）→ 409（not_pending）。
//   作成は再認証を求めない（00-foundation.md 0-5。利用者の決定）。却下は再認証が必要。取り下げは求めない。
// データは架空（[UNIT_TEST]）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RetirementRequestConflictError,
  RetirementRequestStateChangedError,
  type RetirementRequestRepository,
} from "../db/retirement-request.repository";
import type { RoleAssignmentRepository } from "../db/role-assignment.repository";
import { ROLE_IDS } from "../lib/permissions";
import { createRetirementRequestService } from "./retirement-request.service";

const OWNER_ID = "01JTEST128CSVC0WNER0000001";
const ADMIN_ID = "01JTEST128CSVCADM1N0000010";
const TARGET_ID = "01JTEST128CSVCTARGET000001";
const DEPT_A = "01JTEST128CSVCDEPTA0000001";
const DEPT_B = "01JTEST128CSVCDEPTB0000001";
const REQUEST_ID = "01JTEST128CSVCREQ000000001";

type Target = {
  id: string;
  isActive: boolean;
  departmentId: string | null;
  isGlobalAdmin: boolean;
  isDepartmentOwner: boolean;
};
type Request = {
  id: string;
  requestedBy: string;
  targetUserId: string;
  departmentId: string;
  status: "pending" | "approved" | "rejected" | "withdrawn";
};

const activeTarget: Target = {
  id: TARGET_ID,
  isActive: true,
  departmentId: DEPT_A,
  isGlobalAdmin: false,
  isDepartmentOwner: false,
};
const pending: Request = {
  id: REQUEST_ID,
  requestedBy: OWNER_ID,
  targetUserId: TARGET_ID,
  departmentId: DEPT_A,
  status: "pending",
};

type Assignment = {
  roleId: string;
  scopeType: "company" | "department";
  departmentId: string | null;
};
type ActorFacts = { isActive: boolean; assignments: Assignment[] };
const ownerOf = (departmentId: string): ActorFacts => ({
  isActive: true,
  assignments: [
    { roleId: ROLE_IDS.owner, scopeType: "department", departmentId },
  ],
});
const OWNER_A = ownerOf(DEPT_A);
const OWNER_B = ownerOf(DEPT_B);
const MEMBER: ActorFacts = { isActive: true, assignments: [] };
const ADMIN: ActorFacts = {
  isActive: true,
  assignments: [
    { roleId: ROLE_IDS.globalAdmin, scopeType: "company", departmentId: null },
  ],
};

/** 呼ばれるたびに次の値を返す（最後の値はくり返す）。読み直しで事実が変わった場合を作る */
function sequence<T>(values: readonly T[]) {
  let i = 0;
  return () => {
    const value = values[Math.min(i, values.length - 1)] as T;
    i += 1;
    return value;
  };
}

function rolesOf(facts: readonly ActorFacts[]): RoleAssignmentRepository {
  const next = sequence(facts);
  return {
    async findByUserId() {
      const f = next();
      return { user: { isActive: f.isActive }, assignments: f.assignments };
    },
  };
}

type CreateInput = {
  targetUserId: string;
  departmentId: string;
  actorId: string;
  reviewerIds: string[];
  now: string;
  traceId: string;
};
type RejectInput = {
  id: string;
  actorId: string;
  reason: string;
  now: string;
  traceId: string;
};
type WithdrawInput = {
  id: string;
  actorId: string;
  now: string;
  traceId: string;
};

function fakeRepository(
  options: {
    targets?: readonly (Target | null)[];
    requests?: readonly (Request | null)[];
    adminIds?: string[];
    create?: (input: CreateInput) => Promise<{ id: string }>;
    reject?: (input: RejectInput) => Promise<void>;
    withdraw?: (input: WithdrawInput) => Promise<void>;
  } = {},
) {
  const nextTarget = sequence(options.targets ?? [activeTarget]);
  const nextRequest = sequence(options.requests ?? [pending]);
  const repository = {
    findTarget: vi.fn<(id: string) => Promise<Target | null>>(async () =>
      nextTarget(),
    ),
    findGlobalAdminIds: vi.fn<() => Promise<string[]>>(
      async () => options.adminIds ?? [ADMIN_ID],
    ),
    findForDecision: vi.fn<(id: string) => Promise<Request | null>>(async () =>
      nextRequest(),
    ),
    create: vi.fn<(input: CreateInput) => Promise<{ id: string }>>(
      options.create ?? (async () => ({ id: REQUEST_ID })),
    ),
    reject: vi.fn<(input: RejectInput) => Promise<void>>(
      options.reject ?? (async () => undefined),
    ),
    withdraw: vi.fn<(input: WithdrawInput) => Promise<void>>(
      options.withdraw ?? (async () => undefined),
    ),
  };
  return repository as unknown as RetirementRequestRepository &
    typeof repository;
}

const actor = (
  overrides: Partial<{ userId: string; reauthenticatedAt: string | null }> = {},
) => ({
  userId: OWNER_ID,
  traceId: "unit-auth-128c-svc",
  reauthenticatedAt: new Date().toISOString(),
  ...overrides,
});

let logLines: string[];
const auditLines = () =>
  logLines
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter(
      (line) =>
        (line.attributes as Record<string, unknown> | undefined)?.log_type ===
        "audit",
    );

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

describe("#128（128-c）0-1 AC-20 作成の判定の順（Service）", () => {
  it("#128 0-1 AC-20: 対象がなければ、操作者が権限を持たなくても 404 NOT_FOUND で書き込まない（404 が 403 より先）", async () => {
    const repository = fakeRepository({ targets: [null] });
    const service = createRetirementRequestService(
      repository,
      rolesOf([MEMBER]),
    );
    await expect(
      service.create(actor(), { targetUserId: TARGET_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it.each<[string, ActorFacts]>([
    ["ほかの部署のオーナー", OWNER_B],
    ["一般社員", MEMBER],
    ["その部署のオーナーでない全体管理者", ADMIN],
    [
      "無効なオーナー（割り当てが残っていても）",
      { ...OWNER_A, isActive: false },
    ],
  ])(
    "#128 0-1 AC-20: %sは 403 FORBIDDEN で書き込まず、拒否は perm.workspace.manage・対象の部署の範囲で監査に残る",
    async (_label, facts) => {
      const repository = fakeRepository();
      const service = createRetirementRequestService(
        repository,
        rolesOf([facts]),
      );
      await expect(
        service.create(actor(), { targetUserId: TARGET_ID }),
      ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
      expect(repository.create).not.toHaveBeenCalled();
      const audits = auditLines();
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        body: "perm.workspace.manage",
        attributes: { target: `department:${DEPT_A}`, result: "failure" },
      });
    },
  );

  it.each<[string, Target]>([
    [
      "無効（所属なし）",
      { ...activeTarget, isActive: false, departmentId: null },
    ],
    [
      "無効だが所属がある（部署の割り当てが残っている）",
      { ...activeTarget, isActive: false },
    ],
    ["有効だが所属なし", { ...activeTarget, departmentId: null }],
  ])(
    "#128 0-1 AC-20: 対象が%sなら、自分の部署のオーナーでも 403 FORBIDDEN で書き込まない",
    async (_label, target) => {
      const repository = fakeRepository({ targets: [target] });
      const service = createRetirementRequestService(
        repository,
        rolesOf([OWNER_A]),
      );
      await expect(
        service.create(actor(), { targetUserId: TARGET_ID }),
      ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
      expect(repository.create).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["再認証していない", null],
    ["再認証から時間が経った", "2020-01-01T00:00:00.000Z"],
  ])(
    "#128 0-1 AC-20（0-5）: %s場合でも、作成は再認証を求めずに create を1回呼ぶ",
    async (_label, at) => {
      const repository = fakeRepository();
      const service = createRetirementRequestService(
        repository,
        rolesOf([OWNER_A]),
      );
      await expect(
        service.create(actor({ reauthenticatedAt: at }), {
          targetUserId: TARGET_ID,
        }),
      ).resolves.toMatchObject({ id: REQUEST_ID });
      expect(repository.create).toHaveBeenCalledTimes(1);
    },
  );

  it("#128 0-1 AC-20: 権限がなければ、再認証していなくても 403 FORBIDDEN", async () => {
    const repository = fakeRepository();
    const service = createRetirementRequestService(
      repository,
      rolesOf([OWNER_B]),
    );
    await expect(
      service.create(actor({ reauthenticatedAt: null }), {
        targetUserId: TARGET_ID,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it.each<[string, Target, string]>([
    [
      "その部署のオーナー",
      { ...activeTarget, isDepartmentOwner: true },
      "department_owner",
    ],
    [
      "申請者自身（オーナー）",
      { ...activeTarget, id: OWNER_ID, isDepartmentOwner: true },
      "department_owner",
    ],
    ["全体管理者", { ...activeTarget, isGlobalAdmin: true }, "global_admin"],
  ])(
    "#128 0-1 AC-20（0-1 AC-9）: 対象が%sなら 409 CONFLICT（details.reason）で書き込まない",
    async (_label, target, reason) => {
      const repository = fakeRepository({ targets: [target] });
      const service = createRetirementRequestService(
        repository,
        rolesOf([OWNER_A]),
      );
      await expect(
        service.create(actor(), { targetUserId: target.id }),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        status: 409,
        details: { reason },
      });
      expect(repository.create).not.toHaveBeenCalled();
    },
  );

  it("#128 0-1 AC-20: 前提を満たせば、対象・対象の今の部署・操作者・全体管理者の宛先・traceId で create を1回呼び、作成した申請を返す", async () => {
    const repository = fakeRepository();
    const service = createRetirementRequestService(
      repository,
      rolesOf([OWNER_A]),
    );
    const created = await service.create(actor(), {
      targetUserId: TARGET_ID,
    });
    expect(created).toMatchObject({ id: REQUEST_ID });
    expect(repository.create).toHaveBeenCalledTimes(1);
    expect(repository.create.mock.calls[0]?.[0]).toMatchObject({
      targetUserId: TARGET_ID,
      departmentId: DEPT_A,
      actorId: OWNER_ID,
      reviewerIds: [ADMIN_ID],
      traceId: "unit-auth-128c-svc",
    });
  });

  it("#128 3-4 AC-1: 申請者本人が全体管理者（その部署のオーナーを兼ねる）なら、submitted の宛先から本人を除く", async () => {
    const repository = fakeRepository({ adminIds: [ADMIN_ID] });
    const service = createRetirementRequestService(
      repository,
      rolesOf([
        {
          isActive: true,
          assignments: [...ADMIN.assignments, ...OWNER_A.assignments],
        },
      ]),
    );
    await service.create(actor({ userId: ADMIN_ID }), {
      targetUserId: TARGET_ID,
    });
    expect(repository.create.mock.calls[0]?.[0]?.reviewerIds).toEqual([]);
  });

  it("#128 C-177（U-2）: 一意索引の違反（RetirementRequestConflictError）は 409 CONFLICT（details.reason＝duplicate_pending）に変える", async () => {
    const repository = fakeRepository({
      create: async () => {
        throw new RetirementRequestConflictError("duplicate_pending");
      },
    });
    const service = createRetirementRequestService(
      repository,
      rolesOf([OWNER_A]),
    );
    await expect(
      service.create(actor(), { targetUserId: TARGET_ID }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      status: 409,
      details: { reason: "duplicate_pending" },
    });
  });

  it("#128 C-177（U-2）: 409 CONFLICT（duplicate_pending）は、元の RetirementRequestConflictError を cause に持つ", async () => {
    const original = new RetirementRequestConflictError("duplicate_pending");
    const repository = fakeRepository({
      create: async () => {
        throw original;
      },
    });
    const service = createRetirementRequestService(
      repository,
      rolesOf([OWNER_A]),
    );
    const error = await service
      .create(actor(), { targetUserId: TARGET_ID })
      .catch((e: unknown) => e);
    expect((error as Error).cause).toBe(original);
  });
});

describe("#128（128-c）0-1 AC-20 作成の書き込みの前提が崩れた後の読み直し（Service）", () => {
  const changed = async (): Promise<{ id: string }> => {
    throw new RetirementRequestStateChangedError();
  };

  it("#128 0-1 AC-20: 判定の後に操作者がオーナーでなくなったら、読み直しは操作者の認可から行い 403", async () => {
    const repository = fakeRepository({ create: changed });
    const service = createRetirementRequestService(
      repository,
      rolesOf([OWNER_A, MEMBER]),
    );
    await expect(
      service.create(actor(), { targetUserId: TARGET_ID }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("#128 0-1 AC-20: 判定の後に対象がほかの部署へ異動したら、新しい部署の範囲で判定し 403", async () => {
    const repository = fakeRepository({
      targets: [activeTarget, { ...activeTarget, departmentId: DEPT_B }],
      create: changed,
    });
    const service = createRetirementRequestService(
      repository,
      rolesOf([OWNER_A]),
    );
    await expect(
      service.create(actor(), { targetUserId: TARGET_ID }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("#128 0-1 AC-20: 判定の後に対象が部署のオーナーになったら、読み直して 409 department_owner", async () => {
    const repository = fakeRepository({
      targets: [activeTarget, { ...activeTarget, isDepartmentOwner: true }],
      create: changed,
    });
    const service = createRetirementRequestService(
      repository,
      rolesOf([OWNER_A]),
    );
    await expect(
      service.create(actor(), { targetUserId: TARGET_ID }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: { reason: "department_owner" },
    });
  });

  it("#128 0-1 AC-20: 判定の後に対象が無効になったら、読み直して 403", async () => {
    const repository = fakeRepository({
      targets: [
        activeTarget,
        { ...activeTarget, isActive: false, departmentId: null },
      ],
      create: changed,
    });
    const service = createRetirementRequestService(
      repository,
      rolesOf([OWNER_A]),
    );
    await expect(
      service.create(actor(), { targetUserId: TARGET_ID }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("#128 0-1 AC-20: 判定の後に対象がなくなったら 404", async () => {
    const repository = fakeRepository({
      targets: [activeTarget, null],
      create: changed,
    });
    const service = createRetirementRequestService(
      repository,
      rolesOf([OWNER_A]),
    );
    await expect(
      service.create(actor(), { targetUserId: TARGET_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("#128 0-1 AC-20: 読み直してもどの理由にも当たらないときは、成功にせずエラーを投げる", async () => {
    const repository = fakeRepository({ create: changed });
    const service = createRetirementRequestService(
      repository,
      rolesOf([OWNER_A]),
    );
    await expect(
      service.create(actor(), { targetUserId: TARGET_ID }),
    ).rejects.toBeDefined();
  });

  it("#128 0-1 AC-20: 専用のエラー以外の書き込みの失敗は、読み直さず同じエラーのオブジェクトをそのまま伝える", async () => {
    const failure = new Error("unit test failure");
    const repository = fakeRepository({
      targets: [activeTarget, null],
      create: async () => {
        throw failure;
      },
    });
    const service = createRetirementRequestService(
      repository,
      rolesOf([OWNER_A]),
    );
    const error = await service
      .create(actor(), { targetUserId: TARGET_ID })
      .catch((e: unknown) => e);
    expect(error).toBe(failure);
  });
});

describe("#128（128-c）C-177（U-1）却下の判定の順（Service）", () => {
  it("#128 C-177（U-1）: 全体管理者でなければ、申請が存在してもしなくても同じ 403 FORBIDDEN（申請の有無を明かさない）。拒否は perm.account.deactivate・company で監査に残る", async () => {
    for (const request of [pending, null]) {
      logLines = [];
      const repository = fakeRepository({ requests: [request] });
      const service = createRetirementRequestService(
        repository,
        rolesOf([OWNER_A]),
      );
      await expect(
        service.reject(actor(), REQUEST_ID, "[UNIT_TEST]理由"),
      ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
      expect(repository.reject).not.toHaveBeenCalled();
      expect(auditLines()[0]).toMatchObject({
        body: "perm.account.deactivate",
        attributes: { target: "company", result: "failure" },
      });
    }
  });

  it.each([
    ["再認証していない", null],
    ["再認証から時間が経った", "2020-01-01T00:00:00.000Z"],
  ])(
    "#128 C-177（U-1）: 全体管理者でも%s場合は、申請がなくても REAUTH_REQUIRED（再認証が 404 より先）で書き込まない",
    async (_label, at) => {
      const repository = fakeRepository({ requests: [null] });
      const service = createRetirementRequestService(
        repository,
        rolesOf([ADMIN]),
      );
      await expect(
        service.reject(
          actor({ userId: ADMIN_ID, reauthenticatedAt: at }),
          REQUEST_ID,
          "[UNIT_TEST]理由",
        ),
      ).rejects.toMatchObject({ code: "REAUTH_REQUIRED", status: 403 });
      expect(repository.reject).not.toHaveBeenCalled();
    },
  );

  it("#128 C-177（U-1）: 取り下げは再認証を求めない", async () => {
    const repository = fakeRepository();
    const service = createRetirementRequestService(
      repository,
      rolesOf([OWNER_A]),
    );
    await service.withdraw(actor({ reauthenticatedAt: null }), REQUEST_ID);
    expect(repository.withdraw).toHaveBeenCalledTimes(1);
  });

  it("#128 C-177（U-1）: 全体管理者で、申請がなければ 404", async () => {
    const repository = fakeRepository({ requests: [null] });
    const service = createRetirementRequestService(
      repository,
      rolesOf([ADMIN]),
    );
    await expect(
      service.reject(
        actor({ userId: ADMIN_ID }),
        REQUEST_ID,
        "[UNIT_TEST]理由",
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(repository.reject).not.toHaveBeenCalled();
  });

  it.each(["approved", "rejected", "withdrawn"] as const)(
    "#128 C-177（U-1）: 申請が %s なら 409 CONFLICT（details.reason＝not_pending）で書き込まない",
    async (status) => {
      const repository = fakeRepository({ requests: [{ ...pending, status }] });
      const service = createRetirementRequestService(
        repository,
        rolesOf([ADMIN]),
      );
      await expect(
        service.reject(
          actor({ userId: ADMIN_ID }),
          REQUEST_ID,
          "[UNIT_TEST]理由",
        ),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        status: 409,
        details: { reason: "not_pending" },
      });
      expect(repository.reject).not.toHaveBeenCalled();
    },
  );

  it("#128 C-177（U-1）: 前提を満たせば、申請・操作者・理由・traceId で reject を1回呼ぶ", async () => {
    const repository = fakeRepository();
    const service = createRetirementRequestService(
      repository,
      rolesOf([ADMIN]),
    );
    await service.reject(
      actor({ userId: ADMIN_ID }),
      REQUEST_ID,
      "[UNIT_TEST]理由",
    );
    expect(repository.reject).toHaveBeenCalledTimes(1);
    expect(repository.reject.mock.calls[0]?.[0]).toMatchObject({
      id: REQUEST_ID,
      actorId: ADMIN_ID,
      reason: "[UNIT_TEST]理由",
      traceId: "unit-auth-128c-svc",
    });
  });

  it("#128 C-177（U-1）: 判定の後に申請が取り下げられていたら、読み直して 409 not_pending", async () => {
    const repository = fakeRepository({
      requests: [pending, { ...pending, status: "withdrawn" }],
      reject: async () => {
        throw new RetirementRequestStateChangedError();
      },
    });
    const service = createRetirementRequestService(
      repository,
      rolesOf([ADMIN]),
    );
    await expect(
      service.reject(
        actor({ userId: ADMIN_ID }),
        REQUEST_ID,
        "[UNIT_TEST]理由",
      ),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: { reason: "not_pending" },
    });
  });

  it("#128 C-177（U-1）: 判定の後に操作者が全体管理者でなくなったら、読み直しは操作者の認可から行い 403", async () => {
    const repository = fakeRepository({
      reject: async () => {
        throw new RetirementRequestStateChangedError();
      },
    });
    const service = createRetirementRequestService(
      repository,
      rolesOf([ADMIN, MEMBER]),
    );
    await expect(
      service.reject(
        actor({ userId: ADMIN_ID }),
        REQUEST_ID,
        "[UNIT_TEST]理由",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("#128（128-c）C-177（U-1）取り下げの判定の順（Service）", () => {
  it("#128 C-177（U-1）: 申請がない場合と、他人の申請の場合は、同じ 404 NOT_FOUND（存在を明かさない）", async () => {
    const results: unknown[] = [];
    for (const request of [null, { ...pending, requestedBy: ADMIN_ID }]) {
      const repository = fakeRepository({ requests: [request] });
      const service = createRetirementRequestService(
        repository,
        rolesOf([OWNER_A]),
      );
      const error = await service
        .withdraw(actor(), REQUEST_ID)
        .catch((e: unknown) => e);
      expect(error).toMatchObject({ code: "NOT_FOUND", status: 404 });
      expect(repository.withdraw).not.toHaveBeenCalled();
      results.push((error as { userMessage?: unknown }).userMessage);
    }
    expect(results[0]).toBe(results[1]);
  });

  it.each(["approved", "rejected", "withdrawn"] as const)(
    "#128 C-177（U-1）: 自分の申請が %s なら 409 CONFLICT（details.reason＝not_pending）",
    async (status) => {
      const repository = fakeRepository({ requests: [{ ...pending, status }] });
      const service = createRetirementRequestService(
        repository,
        rolesOf([OWNER_A]),
      );
      await expect(service.withdraw(actor(), REQUEST_ID)).rejects.toMatchObject(
        {
          code: "CONFLICT",
          details: { reason: "not_pending" },
        },
      );
      expect(repository.withdraw).not.toHaveBeenCalled();
    },
  );

  it("#128 C-177（U-3）: 申請者がオーナーでなくなっていても、自分の pending の申請は取り下げられる（withdraw を1回呼ぶ）", async () => {
    const repository = fakeRepository();
    const service = createRetirementRequestService(
      repository,
      rolesOf([MEMBER]),
    );
    await service.withdraw(actor(), REQUEST_ID);
    expect(repository.withdraw).toHaveBeenCalledTimes(1);
    expect(repository.withdraw.mock.calls[0]?.[0]).toMatchObject({
      id: REQUEST_ID,
      actorId: OWNER_ID,
    });
  });

  it("#128 C-177（U-1）: 判定の後に却下されていたら、読み直して 409 not_pending", async () => {
    const repository = fakeRepository({
      requests: [pending, { ...pending, status: "rejected" }],
      withdraw: async () => {
        throw new RetirementRequestStateChangedError();
      },
    });
    const service = createRetirementRequestService(
      repository,
      rolesOf([OWNER_A]),
    );
    await expect(service.withdraw(actor(), REQUEST_ID)).rejects.toMatchObject({
      code: "CONFLICT",
      details: { reason: "not_pending" },
    });
  });
});
