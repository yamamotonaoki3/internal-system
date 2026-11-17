// #128（128-b）0-1 AC-16・AC-18: 部署異動（即時）の Service の判定の順と、書き込みの前提が崩れた後の読み直しを、Repository の代役で確かめる。
// 契約（計画 4.2〜4.4。実装前の仮置き）：
//   service.transfer(actor, targetId, { departmentId }): Promise<void>
//   actor は { userId, traceId, reauthenticatedAt }（無効化・再有効化と同じ AccountLifecycleActor）。
//   Repository：findTransferState(id) → { id, isActive, departmentId: string | null, ownedDepartmentIds: string[] } | null
//     （対象の事実。ownedDepartmentIds は role_owner の割り当ての部署）、findActiveDepartment(id)（既存）、
//     transfer({ targetId, fromDepartmentId, toDepartmentId, actorId, now, traceId })。
//   書き込みの前提が崩れたら Repository は AccountStateChangedError を投げる。Service は操作者の認可から事実を読み直し、同じ順で決める。
//   操作者の認可は authorize（perm.employee.info.edit、範囲 company）。permissions.md R-12 に「部署異動は全体管理者だけが行う」とあり、
//     部署異動の専用の権限 ID はないため、所属部署の変更の権限（全体管理者だけが持つ）を使う。拒否は監査に残る。
// 判定の順：404 → 403 → 422（新部署がない・無効／今の部署と同じ。fields: departmentId）→ 再認証 → 409（inactive → department_owner）。
//   対象が全体管理者でも異動できる。オーナーで止めるのは「今の部署」のオーナーだけ。
// データは架空（testuser_128_・[UNIT_TEST]）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AccountStateChangedError,
  type AccountRepository,
} from "../db/account.repository";
import type { RoleAssignmentRepository } from "../db/role-assignment.repository";
import { ROLE_IDS } from "../lib/permissions";
import { createAccountService } from "./account.service";

const ADMIN_ID = "01JTEST128XFADMIN000000001";
const TARGET_ID = "01JTEST128XFTARGET00000001";
const DEPT_A = "01JTEST128XFDEPTA000000001";
const DEPT_B = "01JTEST128XFDEPTB000000001";
const DEPT_C = "01JTEST128XFDEPTC000000001";

type TransferState = {
  id: string;
  isActive: boolean;
  departmentId: string | null;
  ownedDepartmentIds: string[];
};

type TransferInput = {
  targetId: string;
  fromDepartmentId: string;
  toDepartmentId: string;
  actorId: string;
  now: string;
  traceId: string;
};

const memberInA: TransferState = {
  id: TARGET_ID,
  isActive: true,
  departmentId: DEPT_A,
  ownedDepartmentIds: [],
};
const inactive: TransferState = {
  ...memberInA,
  isActive: false,
  departmentId: null,
};

type ActorFacts = { isActive: boolean; isGlobalAdmin: boolean };
const ADMIN: ActorFacts = { isActive: true, isGlobalAdmin: true };
const MEMBER: ActorFacts = { isActive: true, isGlobalAdmin: false };

/** 呼ばれるたびに次の事実を返す（最後の値はくり返す）。読み直しで事実が変わった場合を作る */
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
      return {
        user: { isActive: f.isActive },
        assignments: f.isGlobalAdmin
          ? [
              {
                roleId: ROLE_IDS.globalAdmin,
                scopeType: "company" as const,
                departmentId: null,
              },
            ]
          : [],
      };
    },
  };
}

function fakeRepository(
  options: {
    states?: readonly (TransferState | null)[];
    departments?: readonly ({ id: string; name: string } | null)[];
    transfer?: (input: TransferInput) => Promise<void>;
  } = {},
) {
  const nextState = sequence(options.states ?? [memberInA]);
  const nextDepartment = sequence(
    options.departments ?? [{ id: DEPT_B, name: "[UNIT_TEST]128部署B" }],
  );
  const repository = {
    findTransferState: vi.fn<(id: string) => Promise<TransferState | null>>(
      async () => nextState(),
    ),
    findAccountState: vi.fn(async () => null),
    findActiveDepartment: vi.fn<
      (id: string) => Promise<{ id: string; name: string } | null>
    >(async () => nextDepartment()),
    listActiveDepartments: vi.fn(async () => []),
    createAccount: vi.fn(async () => undefined),
    listAdmin: vi.fn(async () => ({ items: [], nextCursor: null })),
    deactivate: vi.fn(async () => undefined),
    reactivate: vi.fn(async () => undefined),
    transfer: vi.fn<(input: TransferInput) => Promise<void>>(
      options.transfer ?? (async () => undefined),
    ),
  };
  return repository as unknown as AccountRepository & typeof repository;
}

const recent = () => new Date().toISOString();
const actor = (
  overrides: Partial<{ userId: string; reauthenticatedAt: string | null }> = {},
) => ({
  userId: ADMIN_ID,
  traceId: "unit-auth-128-xfer",
  reauthenticatedAt: recent(),
  ...overrides,
});
const toB = { departmentId: DEPT_B };

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

describe("#128 AC-16 部署異動の判定の順（Service）", () => {
  it("#128 AC-16: 対象がなければ、操作者が権限を持たなくても 404 で、書き込まない（404 が 403 より先）", async () => {
    const repository = fakeRepository({ states: [null] });
    const service = createAccountService(repository, rolesOf([MEMBER]));
    await expect(
      service.transfer(actor(), TARGET_ID, toB),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(repository.transfer).not.toHaveBeenCalled();
  });

  it("#128 AC-16: 全体管理者でない操作者は、部署が無効・再認証切れ・対象が無効でも 403（403 が 422・再認証・409 より先）。拒否は perm.employee.info.edit・company で監査に残る", async () => {
    const repository = fakeRepository({
      states: [inactive],
      departments: [null],
    });
    const service = createAccountService(repository, rolesOf([MEMBER]));
    await expect(
      service.transfer(actor({ reauthenticatedAt: null }), TARGET_ID, toB),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(repository.transfer).not.toHaveBeenCalled();
    const audits = auditLines();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      body: "perm.employee.info.edit",
      attributes: { target: "company", result: "failure" },
    });
  });

  it("#128 AC-16: 無効な操作者（全体管理者の割り当てが残っていても）は 403", async () => {
    const repository = fakeRepository();
    const service = createAccountService(
      repository,
      rolesOf([{ isActive: false, isGlobalAdmin: true }]),
    );
    await expect(
      service.transfer(actor(), TARGET_ID, toB),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(repository.transfer).not.toHaveBeenCalled();
  });

  it("#128 AC-16: 新しい部署がない・無効なら、再認証切れ・対象が無効でも 422（fields: departmentId）", async () => {
    const repository = fakeRepository({
      states: [inactive],
      departments: [null],
    });
    const service = createAccountService(repository, rolesOf([ADMIN]));
    await expect(
      service.transfer(actor({ reauthenticatedAt: null }), TARGET_ID, toB),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      details: { fields: ["departmentId"] },
    });
    expect(repository.findActiveDepartment).toHaveBeenCalledWith(DEPT_B);
    expect(repository.transfer).not.toHaveBeenCalled();
  });

  it("#128 AC-16: 新しい部署が今の部署と同じなら、再認証切れ・対象がオーナーでも 422（fields: departmentId）", async () => {
    const repository = fakeRepository({
      states: [{ ...memberInA, ownedDepartmentIds: [DEPT_A] }],
      departments: [{ id: DEPT_A, name: "[UNIT_TEST]128部署A" }],
    });
    const service = createAccountService(repository, rolesOf([ADMIN]));
    await expect(
      service.transfer(actor({ reauthenticatedAt: null }), TARGET_ID, {
        departmentId: DEPT_A,
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 422,
      details: { fields: ["departmentId"] },
    });
    expect(repository.transfer).not.toHaveBeenCalled();
  });

  it.each([
    ["再認証していない", null],
    ["再認証から時間が経った", "2020-01-01T00:00:00.000Z"],
  ])(
    "#128 AC-16: %s場合は、対象が無効でも REAUTH_REQUIRED（再認証が 409 より先）で書き込まない",
    async (_label, at) => {
      const repository = fakeRepository({ states: [inactive] });
      const service = createAccountService(repository, rolesOf([ADMIN]));
      await expect(
        service.transfer(actor({ reauthenticatedAt: at }), TARGET_ID, toB),
      ).rejects.toMatchObject({ code: "REAUTH_REQUIRED", status: 403 });
      expect(repository.transfer).not.toHaveBeenCalled();
    },
  );

  it.each<[string, TransferState, string]>([
    [
      "無効（オーナーの印があっても無効を先に返す）",
      { ...inactive, ownedDepartmentIds: [DEPT_A] },
      "inactive",
    ],
    [
      "今の部署のオーナー（AC-18 先に交代）",
      { ...memberInA, ownedDepartmentIds: [DEPT_A] },
      "department_owner",
    ],
  ])(
    "#128 AC-16・AC-18: 対象が%sなら 409 CONFLICT（details.reason）で書き込まない",
    async (_label, state, reason) => {
      const repository = fakeRepository({ states: [state] });
      const service = createAccountService(repository, rolesOf([ADMIN]));
      await expect(
        service.transfer(actor(), TARGET_ID, toB),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        status: 409,
        details: { reason },
      });
      expect(repository.transfer).not.toHaveBeenCalled();
    },
  );

  it("#128 AC-16: 前提を満たせば Repository の transfer を、対象・旧部署・新部署・操作者・traceId で1回だけ呼ぶ", async () => {
    const repository = fakeRepository();
    const service = createAccountService(repository, rolesOf([ADMIN]));
    await expect(
      service.transfer(actor(), TARGET_ID, toB),
    ).resolves.toBeUndefined();
    expect(repository.transfer).toHaveBeenCalledTimes(1);
    expect(repository.transfer.mock.calls[0]?.[0]).toMatchObject({
      targetId: TARGET_ID,
      fromDepartmentId: DEPT_A,
      toDepartmentId: DEPT_B,
      actorId: ADMIN_ID,
      traceId: "unit-auth-128-xfer",
    });
  });

  it("#128 AC-16: 対象が全体管理者（操作者本人）でも異動できる", async () => {
    const repository = fakeRepository({
      states: [{ ...memberInA, id: ADMIN_ID }],
    });
    const service = createAccountService(repository, rolesOf([ADMIN]));
    await expect(
      service.transfer(actor(), ADMIN_ID, toB),
    ).resolves.toBeUndefined();
    expect(repository.transfer).toHaveBeenCalledTimes(1);
  });

  it("#128 AC-18: 今の部署以外のオーナー（兼務の全体管理者など）は止めない", async () => {
    const repository = fakeRepository({
      states: [{ ...memberInA, ownedDepartmentIds: [DEPT_C] }],
    });
    const service = createAccountService(repository, rolesOf([ADMIN]));
    await expect(
      service.transfer(actor(), TARGET_ID, toB),
    ).resolves.toBeUndefined();
    expect(repository.transfer).toHaveBeenCalledTimes(1);
  });
});

describe("#128 AC-16 部署異動の書き込みの前提が崩れた後の読み直し（Service）", () => {
  const changed = async (): Promise<void> => {
    throw new AccountStateChangedError();
  };

  it("#128 AC-16（重大2）: 判定の後に操作者が全体管理者でなくなったら、読み直しは操作者の認可から行い 403", async () => {
    const repository = fakeRepository({ transfer: changed });
    const service = createAccountService(repository, rolesOf([ADMIN, MEMBER]));
    await expect(
      service.transfer(actor(), TARGET_ID, toB),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
  });

  it("#128 AC-16（重大2）: 判定の後に操作者が無効になったら 403", async () => {
    const repository = fakeRepository({ transfer: changed });
    const service = createAccountService(
      repository,
      rolesOf([ADMIN, { isActive: false, isGlobalAdmin: true }]),
    );
    await expect(
      service.transfer(actor(), TARGET_ID, toB),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("#128 AC-16: 判定の後に対象が無効化されたら、読み直しで 409 inactive", async () => {
    const repository = fakeRepository({
      states: [memberInA, inactive],
      transfer: changed,
    });
    const service = createAccountService(repository, rolesOf([ADMIN]));
    await expect(
      service.transfer(actor(), TARGET_ID, toB),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: { reason: "inactive" },
    });
  });

  it("#128 AC-16: 判定の後に新しい部署が無効になったら、読み直しで 422", async () => {
    const repository = fakeRepository({
      departments: [{ id: DEPT_B, name: "[UNIT_TEST]128部署B" }, null],
      transfer: changed,
    });
    const service = createAccountService(repository, rolesOf([ADMIN]));
    await expect(
      service.transfer(actor(), TARGET_ID, toB),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      details: { fields: ["departmentId"] },
    });
  });

  it("#128 AC-16: 判定の後に対象が同じ新しい部署へ異動済みになったら（同時の異動）、読み直しで 422（成功にしない）", async () => {
    const repository = fakeRepository({
      states: [memberInA, { ...memberInA, departmentId: DEPT_B }],
      transfer: changed,
    });
    const service = createAccountService(repository, rolesOf([ADMIN]));
    await expect(
      service.transfer(actor(), TARGET_ID, toB),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("#128 AC-18: 判定の後に対象が今の部署のオーナーになったら、読み直しで 409 department_owner", async () => {
    const repository = fakeRepository({
      states: [memberInA, { ...memberInA, ownedDepartmentIds: [DEPT_A] }],
      transfer: changed,
    });
    const service = createAccountService(repository, rolesOf([ADMIN]));
    await expect(
      service.transfer(actor(), TARGET_ID, toB),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      details: { reason: "department_owner" },
    });
  });

  it("#128 AC-16: 判定の後に対象が別の部署へ異動済みになり、読み直してもどの理由にも当たらないときは、成功にせずエラーを投げる", async () => {
    const repository = fakeRepository({
      states: [memberInA, { ...memberInA, departmentId: DEPT_C }],
      transfer: changed,
    });
    const service = createAccountService(repository, rolesOf([ADMIN]));
    await expect(
      service.transfer(actor(), TARGET_ID, toB),
    ).rejects.toBeDefined();
  });

  it("#128 AC-16: 対象がなくなったら、読み直しで 404", async () => {
    const repository = fakeRepository({
      states: [memberInA, null],
      transfer: changed,
    });
    const service = createAccountService(repository, rolesOf([ADMIN]));
    await expect(
      service.transfer(actor(), TARGET_ID, toB),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  // 読み直すと 409 になる事実を用意し、読み直しをしていない（同じエラーのまま）ことを検出できるようにする
  it("#128 AC-16: AccountStateChangedError 以外の書き込みの失敗は、事実を読み直さず、同じエラーのオブジェクトをそのまま伝える", async () => {
    const failure = new Error("unit test failure");
    const repository = fakeRepository({
      states: [memberInA, inactive],
      transfer: async () => {
        throw failure;
      },
    });
    const service = createAccountService(repository, rolesOf([ADMIN]));
    const error = await service
      .transfer(actor(), TARGET_ID, toB)
      .catch((e: unknown) => e);
    expect(error).toBe(failure);
    expect(repository.findTransferState).toHaveBeenCalledTimes(1);
    expect(repository.findActiveDepartment).toHaveBeenCalledTimes(1);
  });
});
