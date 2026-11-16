// #128（128-a）0-1 AC-9・AC-11・AC-12・AC-14: アカウントの無効化・再有効化の Service の判定の順を、Repository の代役で確かめる。
// 契約（計画 3.3・3.4。実装前の仮置き）：
//   service.deactivate(actor, targetId): Promise<void>
//   service.reactivate(actor, targetId, { departmentId }): Promise<{ id, initialPassword }>
//   actor は { userId, traceId, reauthenticatedAt }。
//   Repository：findAccountState(id) → { id, isActive, isGlobalAdmin, isDepartmentOwner } | null（対象の事実）、
//     findActiveDepartment(id)（既存）、deactivate({ targetId, actorId, now, traceId })、
//     reactivate({ targetId, departmentId, passwordHash, actorId, now, traceId })。
//   書き込みの前提が崩れたら Repository は AccountStateChangedError を投げる。Service は操作者の認可から事実を読み直し、同じ順で決める。
//   操作者の認可は authorize（perm.account.deactivate / perm.account.reactivate、範囲 company）。拒否は監査に残る。
// 判定の順：無効化 404 → 403 → 422（本人）→ 再認証 → 409（already_inactive → global_admin → department_owner）。
//           再有効化 404 → 403 → 422（部署）→ 再認証 → 409（already_active）。
// データは架空（testuser_128_・[UNIT_TEST]）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCRYPT_TEST_TIMEOUT_MS } from "../../test/auth-fixtures";
import {
  AccountStateChangedError,
  type AccountRepository,
} from "../db/account.repository";
import type { RoleAssignmentRepository } from "../db/role-assignment.repository";
import { verifyPassword } from "../lib/password";
import { ROLE_IDS } from "../lib/permissions";
import { createAccountService } from "./account.service";

const ADMIN_ID = "01JTEST128SVCADMIN00000001";
const TARGET_ID = "01JTEST128SVCTARGET0000001";
const DEPT_ID = "01JTEST128SVCDEPT000000001";

type TargetState = {
  id: string;
  isActive: boolean;
  isGlobalAdmin: boolean;
  isDepartmentOwner: boolean;
};

const activeMember: TargetState = {
  id: TARGET_ID,
  isActive: true,
  isGlobalAdmin: false,
  isDepartmentOwner: false,
};
const inactiveMember: TargetState = { ...activeMember, isActive: false };

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
    states?: readonly (TargetState | null)[];
    department?: { id: string; name: string } | null;
    deactivate?: (input: unknown) => Promise<void>;
    reactivate?: (input: unknown) => Promise<void>;
  } = {},
) {
  const next = sequence(options.states ?? [activeMember]);
  const repository = {
    findAccountState: vi.fn(async () => next()),
    findActiveDepartment: vi.fn(async () =>
      options.department === undefined
        ? { id: DEPT_ID, name: "[UNIT_TEST]128部署" }
        : options.department,
    ),
    listActiveDepartments: vi.fn(async () => []),
    createAccount: vi.fn(async () => undefined),
    listAdmin: vi.fn(async () => ({ items: [], nextCursor: null })),
    deactivate: vi.fn<(input: unknown) => Promise<void>>(
      options.deactivate ?? (async () => undefined),
    ),
    reactivate: vi.fn<(input: unknown) => Promise<void>>(
      options.reactivate ?? (async () => undefined),
    ),
  };
  return repository as unknown as AccountRepository & typeof repository;
}

const recent = () => new Date().toISOString();
const actor = (
  overrides: Partial<{ userId: string; reauthenticatedAt: string | null }> = {},
) => ({
  userId: ADMIN_ID,
  traceId: "unit-auth-128-svc",
  reauthenticatedAt: recent(),
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

describe("#128 AC-9 無効化の判定の順（Service）", () => {
  it("#128 AC-9: 対象がなければ、操作者が権限を持たなくても 404 で、書き込まない（404 が 403 より先）", async () => {
    const repository = fakeRepository({ states: [null] });
    const service = createAccountService(repository, rolesOf([MEMBER]));
    await expect(service.deactivate(actor(), TARGET_ID)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
    expect(repository.deactivate).not.toHaveBeenCalled();
  });

  it("#128 AC-11: 全体管理者でない操作者は、本人・再認証切れでも 403 FORBIDDEN（403 が 422・再認証より先）。拒否は perm.account.deactivate・company で監査に残る", async () => {
    const repository = fakeRepository();
    const service = createAccountService(repository, rolesOf([MEMBER]));
    await expect(
      service.deactivate(
        actor({ userId: TARGET_ID, reauthenticatedAt: null }),
        TARGET_ID,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(repository.deactivate).not.toHaveBeenCalled();
    const audits = auditLines();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      body: "perm.account.deactivate",
      attributes: { target: "company", result: "failure" },
    });
  });

  it("#128 AC-11: 無効な操作者（全体管理者の割り当てが残っていても）は 403", async () => {
    const repository = fakeRepository();
    const service = createAccountService(
      repository,
      rolesOf([{ isActive: false, isGlobalAdmin: true }]),
    );
    await expect(service.deactivate(actor(), TARGET_ID)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(repository.deactivate).not.toHaveBeenCalled();
  });

  it("#128 AC-9: 自分自身は、再認証切れでも 422 VALIDATION_ERROR（422 が再認証より先）で書き込まない", async () => {
    const repository = fakeRepository({
      states: [{ ...activeMember, id: ADMIN_ID, isGlobalAdmin: true }],
    });
    const service = createAccountService(repository, rolesOf([ADMIN]));
    await expect(
      service.deactivate(actor({ reauthenticatedAt: null }), ADMIN_ID),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 422 });
    expect(repository.deactivate).not.toHaveBeenCalled();
  });

  it.each([
    ["再認証していない", null],
    ["再認証から時間が経った", "2020-01-01T00:00:00.000Z"],
  ])(
    "#128 AC-9: %s場合は、対象が既に無効でも REAUTH_REQUIRED（再認証が 409 より先）で書き込まない",
    async (_label, at) => {
      const repository = fakeRepository({ states: [inactiveMember] });
      const service = createAccountService(repository, rolesOf([ADMIN]));
      await expect(
        service.deactivate(actor({ reauthenticatedAt: at }), TARGET_ID),
      ).rejects.toMatchObject({ code: "REAUTH_REQUIRED", status: 403 });
      expect(repository.deactivate).not.toHaveBeenCalled();
    },
  );

  it.each<[string, TargetState, string]>([
    [
      "既に無効（全体管理者・オーナーの印があっても既に無効を先に返す）",
      { ...activeMember, isActive: false, isDepartmentOwner: true },
      "already_inactive",
    ],
    [
      "全体管理者（オーナーでもある）",
      { ...activeMember, isGlobalAdmin: true, isDepartmentOwner: true },
      "global_admin",
    ],
    [
      "部署のオーナー",
      { ...activeMember, isDepartmentOwner: true },
      "department_owner",
    ],
  ])(
    "#128 AC-9: 対象が%sなら 409 CONFLICT（details.reason）で書き込まない",
    async (_label, state, reason) => {
      const repository = fakeRepository({ states: [state] });
      const service = createAccountService(repository, rolesOf([ADMIN]));
      await expect(
        service.deactivate(actor(), TARGET_ID),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        status: 409,
        details: { reason },
      });
      expect(repository.deactivate).not.toHaveBeenCalled();
    },
  );

  it("#128 AC-9: 前提を満たせば Repository の deactivate を、対象・操作者・traceId で1回だけ呼ぶ", async () => {
    const repository = fakeRepository();
    const service = createAccountService(repository, rolesOf([ADMIN]));
    await expect(
      service.deactivate(actor(), TARGET_ID),
    ).resolves.toBeUndefined();
    expect(repository.deactivate).toHaveBeenCalledTimes(1);
    expect(repository.deactivate.mock.calls[0]?.[0]).toMatchObject({
      targetId: TARGET_ID,
      actorId: ADMIN_ID,
      traceId: "unit-auth-128-svc",
    });
  });
});

describe("#128 AC-9 無効化の書き込みの前提が崩れた後の読み直し（Service）", () => {
  const changed = () => {
    throw new AccountStateChangedError();
  };

  it("#128 AC-9（重大2）: 判定の後に操作者が全体管理者でなくなったら、読み直しは操作者の認可から行い 403", async () => {
    const repository = fakeRepository({
      deactivate: async () => changed(),
    });
    const service = createAccountService(repository, rolesOf([ADMIN, MEMBER]));
    await expect(service.deactivate(actor(), TARGET_ID)).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
    });
  });

  it("#128 AC-9（重大2）: 判定の後に操作者が無効になったら 403", async () => {
    const repository = fakeRepository({
      deactivate: async () => changed(),
    });
    const service = createAccountService(
      repository,
      rolesOf([ADMIN, { isActive: false, isGlobalAdmin: true }]),
    );
    await expect(service.deactivate(actor(), TARGET_ID)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it.each<[string, string, TargetState | null, string | undefined]>([
    ["対象が既に無効になった", "CONFLICT", inactiveMember, "already_inactive"],
    [
      "対象がオーナーになった",
      "CONFLICT",
      { ...activeMember, isDepartmentOwner: true },
      "department_owner",
    ],
    ["対象がなくなった", "NOT_FOUND", null, undefined],
  ])(
    "#128 AC-9: 判定の後に%s場合は、最初と同じ判定で %s を返す",
    async (_label, code, after, reason) => {
      const repository = fakeRepository({
        states: [activeMember, after],
        deactivate: async () => changed(),
      });
      const service = createAccountService(repository, rolesOf([ADMIN]));
      const error = await service
        .deactivate(actor(), TARGET_ID)
        .catch((e: unknown) => e);
      expect(error).toMatchObject({ code });
      if (reason !== undefined)
        expect(error).toMatchObject({ details: { reason } });
    },
  );

  it("#128 AC-9: 読み直してもどの理由にも当たらないときは、成功にせずエラーを投げる", async () => {
    const repository = fakeRepository({
      states: [activeMember, activeMember],
      deactivate: async () => changed(),
    });
    const service = createAccountService(repository, rolesOf([ADMIN]));
    await expect(service.deactivate(actor(), TARGET_ID)).rejects.toBeDefined();
  });

  it("#128 AC-9: AccountStateChangedError 以外の Repository の失敗は、409 などに変えずにそのまま伝える", async () => {
    const failure = new Error("unit test failure");
    const repository = fakeRepository({
      deactivate: async () => {
        throw failure;
      },
    });
    const service = createAccountService(repository, rolesOf([ADMIN]));
    const error = await service
      .deactivate(actor(), TARGET_ID)
      .catch((e: unknown) => e);
    expect(error).toBe(failure);
  });
});

describe(
  "#128 AC-14 再有効化の判定の順（Service）",
  { timeout: SCRYPT_TEST_TIMEOUT_MS },
  () => {
    const body = { departmentId: DEPT_ID };

    it("#128 AC-14: 対象がなければ、権限がなくても 404", async () => {
      const repository = fakeRepository({ states: [null] });
      const service = createAccountService(repository, rolesOf([MEMBER]));
      await expect(
        service.reactivate(actor(), TARGET_ID, body),
      ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
      expect(repository.reactivate).not.toHaveBeenCalled();
    });

    it("#128 AC-11: 全体管理者でなければ、部署が無効・再認証切れでも 403。拒否は perm.account.reactivate・company で監査に残る", async () => {
      const repository = fakeRepository({
        states: [inactiveMember],
        department: null,
      });
      const service = createAccountService(repository, rolesOf([MEMBER]));
      await expect(
        service.reactivate(actor({ reauthenticatedAt: null }), TARGET_ID, body),
      ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
      expect(repository.reactivate).not.toHaveBeenCalled();
      expect(auditLines()[0]).toMatchObject({
        body: "perm.account.reactivate",
        attributes: { target: "company", result: "failure" },
      });
    });

    it("#128 AC-14: 部署がない・無効なら、再認証切れ・対象が有効でも 422（fields: departmentId）", async () => {
      const repository = fakeRepository({
        states: [activeMember],
        department: null,
      });
      const service = createAccountService(repository, rolesOf([ADMIN]));
      await expect(
        service.reactivate(actor({ reauthenticatedAt: null }), TARGET_ID, body),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        status: 422,
        details: { fields: ["departmentId"] },
      });
      expect(repository.reactivate).not.toHaveBeenCalled();
    });

    it("#128 AC-12: 再認証が切れていれば、対象が有効でも REAUTH_REQUIRED（再認証が 409 より先）", async () => {
      const repository = fakeRepository({ states: [activeMember] });
      const service = createAccountService(repository, rolesOf([ADMIN]));
      await expect(
        service.reactivate(actor({ reauthenticatedAt: null }), TARGET_ID, body),
      ).rejects.toMatchObject({ code: "REAUTH_REQUIRED" });
      expect(repository.reactivate).not.toHaveBeenCalled();
    });

    it("#128 AC-14: 対象が有効なら 409（details.reason: already_active）", async () => {
      const repository = fakeRepository({ states: [activeMember] });
      const service = createAccountService(repository, rolesOf([ADMIN]));
      await expect(
        service.reactivate(actor(), TARGET_ID, body),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        status: 409,
        details: { reason: "already_active" },
      });
      expect(repository.reactivate).not.toHaveBeenCalled();
    });

    it("#128 AC-14（U-7）: 成功すると一時パスワードを一度だけ返し、Repository にはハッシュだけを渡す", async () => {
      const repository = fakeRepository({ states: [inactiveMember] });
      const service = createAccountService(repository, rolesOf([ADMIN]));
      const result = await service.reactivate(actor(), TARGET_ID, body);
      expect(result.id).toBe(TARGET_ID);
      expect(result.initialPassword).toHaveLength(16);
      expect(repository.reactivate).toHaveBeenCalledTimes(1);
      const saved = repository.reactivate.mock.calls[0]?.[0] as unknown as {
        targetId: string;
        departmentId: string;
        passwordHash: string;
        actorId: string;
        traceId: string;
      };
      expect(saved).toMatchObject({
        targetId: TARGET_ID,
        departmentId: DEPT_ID,
        actorId: ADMIN_ID,
        traceId: "unit-auth-128-svc",
      });
      expect(JSON.stringify(saved)).not.toContain(result.initialPassword);
      expect(
        await verifyPassword(result.initialPassword, saved.passwordHash),
      ).toBe(true);
      for (const line of logLines)
        expect(line).not.toContain(result.initialPassword);
    });

    it("#128 AC-14（重大2）: 判定の後に操作者が全体管理者でなくなったら、読み直しで 403", async () => {
      const repository = fakeRepository({
        states: [inactiveMember],
        reactivate: async () => {
          throw new AccountStateChangedError();
        },
      });
      const service = createAccountService(
        repository,
        rolesOf([ADMIN, MEMBER]),
      );
      await expect(
        service.reactivate(actor(), TARGET_ID, body),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("#128 AC-14: 判定の後に対象が有効になった（同時の再有効化）なら、読み直しで 409 already_active（成功にしない）", async () => {
      const repository = fakeRepository({
        states: [inactiveMember, activeMember],
        reactivate: async () => {
          throw new AccountStateChangedError();
        },
      });
      const service = createAccountService(repository, rolesOf([ADMIN]));
      const error = await service
        .reactivate(actor(), TARGET_ID, body)
        .catch((e: unknown) => e);
      expect(error).toMatchObject({
        code: "CONFLICT",
        details: { reason: "already_active" },
      });
    });

    it("#128 AC-14: 判定の後に部署が無効になったら、読み直しで 422", async () => {
      const repository = fakeRepository({
        states: [inactiveMember],
        reactivate: async () => {
          throw new AccountStateChangedError();
        },
      });
      repository.findActiveDepartment
        .mockResolvedValueOnce({ id: DEPT_ID, name: "[UNIT_TEST]128部署" })
        .mockResolvedValue(null);
      const service = createAccountService(repository, rolesOf([ADMIN]));
      await expect(
        service.reactivate(actor(), TARGET_ID, body),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });
  },
);
