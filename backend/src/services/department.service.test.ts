// #196 AC-1・AC-2・AC-4・AC-5（計画レビュー 6）: 部署の Service の業務ルールを、Repository の代役で確かめる。
// Repository の専用エラー（理由ごと）を、利用者向けのエラー（コード・文言・項目）に正しく変えること、
// 認可の対象（会社の範囲）と、作成の既定値（説明は空文字・指名なしは作成者）を、振る舞い（返すエラー・Repository への入力・拒否の監査）で確かめる。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DepartmentConflictError,
  DuplicateDepartmentError,
  type ConflictReason,
  type DepartmentRepository,
} from "../db/department.repository";
import type { RoleAssignmentRepository } from "../db/role-assignment.repository";
import { AppError } from "../lib/app-error";
import { ROLE_IDS } from "../lib/permissions";
import { createDepartmentService } from "./department.service";

const ADMIN_ID = "01JTESTDEPTSVCADMIN0000001";
const MEMBER_ID = "01JTESTDEPTSVCMEMBER000001";
const DEPT_ID = "01JTESTDEPTSVCDEPT00000001";
const STALE = "他の人が先に更新しました。読み込み直してください";
const NAME_CONFLICT =
  "同じ名前の部署またはチャンネルがあります。別の部署名を入力してください";

let roleLookups: string[];
const roles: RoleAssignmentRepository = {
  async findByUserId(userId) {
    roleLookups.push(userId);
    return {
      user: { isActive: true },
      assignments:
        userId === ADMIN_ID
          ? [
              {
                roleId: ROLE_IDS.globalAdmin,
                scopeType: "company",
                departmentId: null,
              },
            ]
          : [],
    };
  },
};

const summary = {
  id: DEPT_ID,
  name: "[UNIT_TEST]部署",
  isActive: true,
  version: 1,
};
function fakeRepository(overrides: Partial<DepartmentRepository> = {}) {
  const repository = {
    list: vi.fn(async () => ({ items: [], nextCursor: null })),
    listOwnerCandidates: vi.fn(async () => ({ items: [], nextCursor: null })),
    findById: vi.fn(async () => summary),
    create: vi.fn(async () => ({
      id: DEPT_ID,
      name: "[UNIT_TEST]部署",
      description: "",
      ownerUserId: ADMIN_ID,
      dedicatedChannelId: "01JTESTDEPTSVCROOM00000001",
      announcementChannelId: "01JTESTDEPTSVCROOM00000002",
      version: 1,
      createdAt: "2026-11-09T00:00:00.000Z",
    })),
    rename: vi.fn(async () => ({
      id: DEPT_ID,
      name: "[UNIT_TEST]部署改",
      version: 2,
      updatedAt: "2026-11-09T00:00:00.000Z",
    })),
    changeOwner: vi.fn(async () => ({
      departmentId: DEPT_ID,
      ownerUserId: MEMBER_ID,
      version: 2,
      updatedAt: "2026-11-09T00:00:00.000Z",
    })),
    ...overrides,
  };
  return repository as unknown as DepartmentRepository & typeof repository;
}

const reauthNow = () => new Date().toISOString();
const admin = (traceId = "unit-dept-svc-trace") => ({
  userId: ADMIN_ID,
  traceId,
  reauthenticatedAt: reauthNow(),
});

let logLines: string[];
const auditLines = () =>
  logLines
    .filter((line) => line.startsWith("{"))
    .map(
      (line) =>
        JSON.parse(line) as {
          body?: string;
          trace_id?: string;
          user_id?: string;
          attributes?: Record<string, unknown>;
        },
    )
    .filter((line) => line.attributes?.log_type === "audit");

beforeEach(() => {
  roleLookups = [];
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

async function createFailingWith(error: unknown) {
  const repository = fakeRepository({
    create: vi.fn(async () => {
      throw error;
    }),
  });
  const service = createDepartmentService(repository, roles);
  return service
    .create(admin(), { name: "[UNIT_TEST]部署" })
    .catch((e: unknown) => e);
}

describe("#196 Repository の専用エラーの変換（計画レビュー 6）", () => {
  it.each<[ConflictReason, string, string, string[] | undefined]>([
    ["owner_not_found", "NOT_FOUND", "指名した社員が見つかりません", undefined],
    [
      "owner_inactive",
      "VALIDATION_ERROR",
      "無効な社員はオーナーに指名できません",
      ["ownerUserId"],
    ],
    [
      "successor_required",
      "VALIDATION_ERROR",
      "元部署の後任を、元部署の有効な一般社員から選んでください",
      ["previousDepartmentSuccessorUserId"],
    ],
    [
      "successor_unneeded",
      "VALIDATION_ERROR",
      "この指名では元部署の後任は要りません",
      ["previousDepartmentSuccessorUserId"],
    ],
    [
      "successor_invalid",
      "VALIDATION_ERROR",
      "元部署の後任は、元部署の有効な一般社員から選んでください",
      ["previousDepartmentSuccessorUserId"],
    ],
    ["already_owner", "CONFLICT", "すでにこの部署のオーナーです", undefined],
    [
      "inactive_department",
      "CONFLICT",
      "無効な部署は変更できません",
      undefined,
    ],
    ["version", "CONFLICT", STALE, undefined],
    ["state_changed", "CONFLICT", STALE, undefined],
  ])(
    "#196 AC-2・AC-5: 理由 %s は %s・決まった文言・項目に変わり、元のエラーを原因として持つ",
    async (reason, code, message, fields) => {
      const original = new DepartmentConflictError(reason);
      const error = await createFailingWith(original);
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({ code, userMessage: message });
      expect((error as AppError).details).toEqual(
        fields === undefined ? {} : { fields },
      );
      expect((error as AppError).cause).toBe(original);
    },
  );

  it.each(["department_name", "channel_name"] as const)(
    "#196 AC-1・AC-3: 名前の衝突（%s）は CONFLICT と案内の文言になり、元のエラーを原因として持つ",
    async (reason) => {
      const original = new DuplicateDepartmentError(reason);
      const error = await createFailingWith(original);
      expect(error).toMatchObject({
        code: "CONFLICT",
        userMessage: NAME_CONFLICT,
      });
      expect((error as AppError).details).toEqual({});
      expect((error as AppError).cause).toBe(original);
    },
  );

  it("#196 AC-5: 専用エラーでない失敗は、変えずにそのまま投げる", async () => {
    const original = new Error("unit_unknown_failure");
    expect(await createFailingWith(original)).toBe(original);
  });

  it("#196 AC-1: 改名で部署が無ければ NOT_FOUND「部署が見つかりません」で、Repository を呼ばない", async () => {
    const repository = fakeRepository({ findById: vi.fn(async () => null) });
    const service = createDepartmentService(repository, roles);
    const error = await service
      .rename(admin(), DEPT_ID, { name: "[UNIT_TEST]改", version: 1 })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({
      code: "NOT_FOUND",
      userMessage: "部署が見つかりません",
    });
    expect(repository.rename).not.toHaveBeenCalled();
  });

  it("#196 AC-2: 交代で部署が無ければ NOT_FOUND「部署が見つかりません」", async () => {
    const repository = fakeRepository({ findById: vi.fn(async () => null) });
    const service = createDepartmentService(repository, roles);
    await expect(
      service.changeOwner(admin(), DEPT_ID, {
        ownerUserId: MEMBER_ID,
        version: 1,
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      userMessage: "部署が見つかりません",
    });
  });
});

describe("#196 作成の既定値と指名の権限", () => {
  it("#196 AC-1（2-1 AC-2）: 指名しなければ作成者がオーナー、説明は空文字、後任なしで Repository に渡す。権限の確認は1回", async () => {
    const repository = fakeRepository();
    const service = createDepartmentService(repository, roles);
    await service.create(admin(), { name: "[UNIT_TEST]部署" });
    expect(repository.create).toHaveBeenCalledWith(
      {
        name: "[UNIT_TEST]部署",
        description: "",
        ownerUserId: ADMIN_ID,
        previousDepartmentSuccessorUserId: null,
        previousDepartmentVersion: null,
      },
      { actorId: ADMIN_ID, traceId: "unit-dept-svc-trace" },
    );
    expect(roleLookups).toEqual([ADMIN_ID]);
  });

  it("#196 AC-2（2-1 AC-2・R-41）: 指名したときは、作成の権限に加えて指名の権限も確かめ、指名と後任をそのまま渡す", async () => {
    const repository = fakeRepository();
    const service = createDepartmentService(repository, roles);
    await service.create(admin(), {
      name: "[UNIT_TEST]部署",
      description: "説明",
      ownerUserId: MEMBER_ID,
      previousDepartmentSuccessorUserId: ADMIN_ID,
    });
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "説明",
        ownerUserId: MEMBER_ID,
        previousDepartmentSuccessorUserId: ADMIN_ID,
      }),
      expect.anything(),
    );
    // 作成（perm.workspace.create）と指名（perm.workspace.owner.designate）の2回
    expect(roleLookups).toEqual([ADMIN_ID, ADMIN_ID]);
  });

  it("#196 AC-1（0-5）: 時計を渡さなければ現在時刻で再認証の期限を判定し、直前の再認証なら作成できる", async () => {
    const repository = fakeRepository();
    const service = createDepartmentService(repository, roles);
    await expect(
      service.create(admin(), { name: "[UNIT_TEST]部署" }),
    ).resolves.toMatchObject({ id: DEPT_ID });
  });
});

describe("#196 認可の対象（会社の範囲）と拒否の監査", () => {
  it.each([
    [
      "一覧",
      (
        service: ReturnType<typeof createDepartmentService>,
        actor: ReturnType<typeof admin>,
      ) => service.list(actor, { limit: 20 }),
      "perm.workspace.create",
    ],
    [
      "作成",
      (
        service: ReturnType<typeof createDepartmentService>,
        actor: ReturnType<typeof admin>,
      ) => service.create(actor, { name: "[UNIT_TEST]部署" }),
      "perm.workspace.create",
    ],
    [
      "交代",
      (
        service: ReturnType<typeof createDepartmentService>,
        actor: ReturnType<typeof admin>,
      ) =>
        service.changeOwner(actor, DEPT_ID, {
          ownerUserId: ADMIN_ID,
          version: 1,
        }),
      "perm.role.assign",
    ],
  ])(
    "#196 AC-4: 一般社員の%sは FORBIDDEN で、会社の範囲（target: company）への拒否として、要求の traceId・操作者つきで監査に残す",
    async (_label, run, permission) => {
      const repository = fakeRepository();
      const service = createDepartmentService(repository, roles);
      const actor = {
        userId: MEMBER_ID,
        traceId: "unit-dept-svc-denied",
        reauthenticatedAt: reauthNow(),
      };
      await expect(run(service, actor)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(auditLines()).toEqual([
        expect.objectContaining({
          body: permission,
          trace_id: "unit-dept-svc-denied",
          user_id: MEMBER_ID,
          attributes: expect.objectContaining({
            target: "company",
            result: "failure",
          }),
        }),
      ]);
      expect(repository.create).not.toHaveBeenCalled();
      expect(repository.changeOwner).not.toHaveBeenCalled();
    },
  );
});
