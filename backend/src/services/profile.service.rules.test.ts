// #130 AC-1（0-4 AC-4・AC-5・AC-9・AC-10・AC-11）・AC-3（7-3 AC-1）：プロフィールの Service（services/profile.service.ts）の業務ルールを、
// Repository の代役で確かめる（コードレビューとミューテーションの指摘）。
//  - 認可：操作ごとの権限名と範囲（拒否の監査ログに出る権限名・範囲で照合する。authorize の引数そのもの）
//  - 本名の鍵がないときは SERVICE_UNAVAILABLE（復号しない・空の値を返さない）
//  - 戻り予定だけの変更：いまの種類を読んでから判定。Repository が 0 行（null）なら、競合として VALIDATION_ERROR（returnAt）
//  - 「1年」は暦の1年（翌年の同じ月日。2/29 は翌年の 3/1）
// データは架空（テスト太郎・テスト花子・[UNIT_TEST]）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnProfile, ProfileRepository } from "../db/profile.repository";
import type {
  RoleAssignmentRepository,
  UserWithAssignments,
} from "../db/role-assignment.repository";
import { AppError } from "../lib/app-error";
import { ROLE_IDS } from "../lib/permissions";
import { createProfileService } from "./profile.service";

const USER_ID = "01JTESTPR0FSVCRVSER0000001";
const TARGET_ID = "01JTESTPR0FSVCTARGET000001";
const DEPT_ID = "01JTESTPR0FSVCDEPT00000001";
const NOW = new Date("2026-11-11T00:00:00.000Z");
const actor = { userId: USER_ID, traceId: "unit-prof-rules-trace" };

const memberRoles: RoleAssignmentRepository = {
  findByUserId: vi.fn(async (): Promise<UserWithAssignments> => ({
    user: { isActive: true },
    assignments: [],
  })),
};
// 存在しない利用者として扱われ、全員の権限も持たない（すべての操作が拒否され、拒否の監査が出る）
const noRoles: RoleAssignmentRepository = {
  findByUserId: vi.fn(async () => null),
};
const adminRoles: RoleAssignmentRepository = {
  findByUserId: vi.fn(async (): Promise<UserWithAssignments> => ({
    user: { isActive: true },
    assignments: [
      {
        roleId: ROLE_IDS.globalAdmin,
        scopeType: "company",
        departmentId: null,
      },
    ],
  })),
};

function ownProfile(overrides: Partial<OwnProfile> = {}): OwnProfile {
  return {
    id: USER_ID,
    loginId: "testuser_prof_rules",
    displayName: "テスト太郎",
    legalNameEncrypted: "v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAAAA",
    department: { id: DEPT_ID, name: "[UNIT_TEST]部署" },
    jobTitle: null,
    email: "testuser_prof_rules@example.com",
    extension: null,
    status: { kind: "away", returnAt: null, message: null },
    ...overrides,
  };
}

function fakeProfiles(overrides: Record<string, unknown> = {}) {
  const repository = {
    findOwnProfile: vi.fn(async () => ownProfile()),
    updateOwnProfile: vi.fn(async () => ({
      displayName: "テスト太郎",
      status: "away",
      returnAt: null,
      statusMessage: null,
      updatedAt: NOW.toISOString(),
    })),
    findProfileCard: vi.fn(async () => ({
      id: TARGET_ID,
      displayName: "テスト花子",
      legalNameEncrypted: "v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAAAA",
      isActive: true,
      department: null,
      status: { kind: "available", returnAt: null, message: null },
    })),
    listDirectory: vi.fn(async () => ({
      items: [
        {
          id: TARGET_ID,
          displayName: "テスト花子",
          department: { id: DEPT_ID, name: "[UNIT_TEST]部署" },
          extension: null,
          email: "testuser_prof_target@example.com",
          status: { kind: "available", returnAt: null, message: null },
        },
      ],
      nextCursor: null,
    })),
    listActiveDepartments: vi.fn(async () => []),
    findStatusTarget: vi.fn(async () => ({
      id: TARGET_ID,
      isActive: true,
      departmentId: DEPT_ID,
    })),
    setStatusByProxy: vi.fn(async () => ({
      userId: TARGET_ID,
      status: "away",
      returnAt: null,
      updatedAt: NOW.toISOString(),
    })),
    ...overrides,
  };
  return repository as unknown as ProfileRepository & typeof repository;
}

let logLines: string[];
const deniedAudits = () =>
  logLines
    .filter((line) => line.startsWith("{"))
    .map(
      (line) =>
        JSON.parse(line) as {
          body?: string;
          attributes?: Record<string, unknown>;
        },
    )
    .filter(
      (line) =>
        line.attributes?.log_type === "audit" &&
        line.attributes.result === "failure",
    )
    .map((line) => ({
      permission: line.body,
      target: line.attributes?.target,
    }));

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

const codeOf = (error: unknown) =>
  error instanceof AppError ? error.code : String(error);

describe("#130 認可：操作ごとの権限名と範囲", () => {
  it.each<
    [
      string,
      (s: ReturnType<typeof createProfileService>) => Promise<unknown>,
      string,
      string,
    ]
  >([
    [
      "updateOwnProfile",
      (s) => s.updateOwnProfile(actor, { displayName: "テスト改名" }),
      "perm.profile.edit.own",
      "company",
    ],
    [
      "getProfileCard",
      (s) => s.getProfileCard(actor, TARGET_ID),
      "perm.employee.legal_name.view",
      "company",
    ],
    [
      "listDepartments",
      (s) => s.listDepartments(actor),
      "perm.employee.view",
      "company",
    ],
    [
      "listDirectory",
      (s) => s.listDirectory(actor, { limit: 20 }),
      "perm.employee.view",
      "company",
    ],
    [
      "setStatusByProxy",
      (s) => s.setStatusByProxy(actor, TARGET_ID, { status: "away" }),
      "perm.status.proxy.set",
      `department:${DEPT_ID}`,
    ],
  ])(
    "#130 AC-1・AC-3: %s は %s（範囲 %s）で認可し、拒否なら FORBIDDEN で Repository に書かない",
    async (_name, call, permission, target) => {
      const profiles = fakeProfiles();
      const service = createProfileService(profiles, noRoles, {
        now: () => NOW,
        piiKey: "unused",
      });
      const error = await call(service).catch((e: unknown) => e);
      expect(codeOf(error)).toBe("FORBIDDEN");
      expect(deniedAudits()).toEqual([{ permission, target }]);
      expect(profiles.updateOwnProfile).not.toHaveBeenCalled();
      expect(profiles.setStatusByProxy).not.toHaveBeenCalled();
      expect(profiles.listDirectory).not.toHaveBeenCalled();
      expect(profiles.listActiveDepartments).not.toHaveBeenCalled();
      expect(profiles.findProfileCard).not.toHaveBeenCalled();
    },
  );

  it("#130 AC-1（0-4 AC-5）: 一般メンバーは、全員の権限（表示名の変更・一覧・カード）では拒否されない", async () => {
    const service = createProfileService(fakeProfiles(), memberRoles, {
      now: () => NOW,
    });
    await service.updateOwnProfile(actor, { displayName: "テスト改名" });
    await service.listDepartments(actor);
    await service.listDirectory(actor, { limit: 20 });
    expect(deniedAudits()).toEqual([]);
  });

  it("#130 AC-1（0-4 AC-5）: 一覧の canSetStatus は、判定が true の部署の行だけ true", async () => {
    const admin = await createProfileService(fakeProfiles(), adminRoles, {
      now: () => NOW,
    }).listDirectory(actor, { limit: 20 });
    expect(admin.items.map((item) => item.canSetStatus)).toEqual([true]);
    const member = await createProfileService(fakeProfiles(), memberRoles, {
      now: () => NOW,
    }).listDirectory(actor, { limit: 20 });
    expect(member.items.map((item) => item.canSetStatus)).toEqual([false]);
  });
});

describe("#130 AC-1（0-4 AC-11）本名の鍵", () => {
  it.each([
    ["鍵の指定なし", {}],
    ["鍵が null", { piiKey: null }],
  ])(
    "#130 AC-1（0-4 AC-11）: %s なら、自分のプロフィール・カードとも SERVICE_UNAVAILABLE",
    async (_label, deps) => {
      const service = createProfileService(fakeProfiles(), memberRoles, {
        now: () => NOW,
        ...deps,
      });
      for (const call of [
        () => service.getOwnProfile(actor),
        () => service.getProfileCard(actor, TARGET_ID),
      ]) {
        const error = await call().catch((e: unknown) => e);
        expect(codeOf(error)).toBe("SERVICE_UNAVAILABLE");
      }
    },
  );

  it("#130 AC-1（0-4 AC-10）: 自分の行がなければ NOT_FOUND、無効化済み・不在のカードは NOT_FOUND", async () => {
    const service = createProfileService(
      fakeProfiles({
        findOwnProfile: vi.fn(async () => null),
        findProfileCard: vi.fn(async () => null),
      }),
      memberRoles,
      { now: () => NOW, piiKey: "unused" },
    );
    expect(
      codeOf(await service.getOwnProfile(actor).catch((e: unknown) => e)),
    ).toBe("NOT_FOUND");
    expect(
      codeOf(
        await service.getProfileCard(actor, TARGET_ID).catch((e: unknown) => e),
      ),
    ).toBe("NOT_FOUND");
    const inactive = createProfileService(
      fakeProfiles({
        findProfileCard: vi.fn(async () => ({
          id: TARGET_ID,
          displayName: "テスト花子",
          legalNameEncrypted: "x",
          isActive: false,
          department: null,
          status: { kind: "available", returnAt: null, message: null },
        })),
      }),
      memberRoles,
      { now: () => NOW, piiKey: "unused" },
    );
    expect(
      codeOf(
        await inactive
          .getProfileCard(actor, TARGET_ID)
          .catch((e: unknown) => e),
      ),
    ).toBe("NOT_FOUND");
  });
});

describe("#130 AC-1（0-4 AC-4）戻り予定の判定", () => {
  it("#130 AC-1（0-4 AC-4・P-3）: 在席と戻り予定を同時に渡したときの誤りは、returnAt の欄で在席を理由に知らせる", async () => {
    const profiles = fakeProfiles();
    const error = await createProfileService(profiles, memberRoles, {
      now: () => NOW,
    })
      .updateOwnProfile(actor, {
        status: "available",
        returnAt: "2026-11-11T05:00:00.000Z",
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("VALIDATION_ERROR");
    expect((error as AppError).details).toEqual({ fields: ["returnAt"] });
    expect((error as AppError).userMessage).toContain("在席");
    expect(profiles.updateOwnProfile).not.toHaveBeenCalled();
  });

  it("#130 AC-1（0-4 AC-4）: 戻り予定だけなら、いまの種類（外出）を読んで、UTC にそろえた戻り予定だけを書く", async () => {
    const profiles = fakeProfiles();
    await createProfileService(profiles, memberRoles, {
      now: () => NOW,
    }).updateOwnProfile(actor, { returnAt: "2026-11-11T18:00:00+09:00" });
    expect(profiles.findOwnProfile).toHaveBeenCalledWith(USER_ID);
    expect(profiles.updateOwnProfile).toHaveBeenCalledWith(
      USER_ID,
      {
        displayName: undefined,
        statusKind: undefined,
        statusReturnAt: "2026-11-11T09:00:00.000Z",
        statusMessage: undefined,
        onlyIfNotAvailable: true,
      },
      { actorId: USER_ID, traceId: actor.traceId },
      NOW.toISOString(),
    );
  });

  it("#130 AC-1（0-4 AC-4）: 種類も戻り予定も渡さなければ、いまの種類を読まず、戻り予定に触れない", async () => {
    const profiles = fakeProfiles();
    await createProfileService(profiles, memberRoles, {
      now: () => NOW,
    }).updateOwnProfile(actor, { statusMessage: "テスト一言" });
    expect(profiles.findOwnProfile).not.toHaveBeenCalled();
    expect(profiles.updateOwnProfile).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({
        statusReturnAt: undefined,
        statusMessage: "テスト一言",
        onlyIfNotAvailable: false,
      }),
      expect.anything(),
      NOW.toISOString(),
    );
  });

  it("#130 AC-1（0-4 AC-4）: 戻り予定だけの変更で自分の行がなければ NOT_FOUND", async () => {
    const profiles = fakeProfiles({ findOwnProfile: vi.fn(async () => null) });
    const error = await createProfileService(profiles, memberRoles, {
      now: () => NOW,
    })
      .updateOwnProfile(actor, { returnAt: "2026-11-11T05:00:00.000Z" })
      .catch((e: unknown) => e);
    expect(codeOf(error)).toBe("NOT_FOUND");
    expect(profiles.updateOwnProfile).not.toHaveBeenCalled();
  });

  it("#130 AC-1（0-4 AC-4・P-3・競合）: 読んだときは外出でも、書くときに在席へ戻っていて Repository が 0 行（null）なら VALIDATION_ERROR（returnAt）", async () => {
    const profiles = fakeProfiles({
      updateOwnProfile: vi.fn(async () => null),
    });
    const error = await createProfileService(profiles, memberRoles, {
      now: () => NOW,
    })
      .updateOwnProfile(actor, { returnAt: "2026-11-11T05:00:00.000Z" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("VALIDATION_ERROR");
    expect((error as AppError).details).toEqual({ fields: ["returnAt"] });
  });

  it("#130 AC-1（0-4 AC-4・暦の1年）: 現在 2028-02-29 のとき、2029-03-01T00:00:00Z は可、その1ms 後は不可", async () => {
    const leap = new Date("2028-02-29T00:00:00.000Z");
    const profiles = fakeProfiles();
    const service = createProfileService(profiles, memberRoles, {
      now: () => leap,
    });
    await service.updateOwnProfile(actor, {
      status: "vacation",
      returnAt: "2029-03-01T00:00:00.000Z",
    });
    expect(profiles.updateOwnProfile).toHaveBeenCalledTimes(1);
    const error = await service
      .updateOwnProfile(actor, {
        status: "vacation",
        returnAt: "2029-03-01T00:00:00.001Z",
      })
      .catch((e: unknown) => e);
    expect((error as AppError).details).toEqual({ fields: ["returnAt"] });
    expect(profiles.updateOwnProfile).toHaveBeenCalledTimes(1);
  });
});

describe("#130 AC-1（0-4 AC-5）代理設定の対象", () => {
  it.each([
    ["不在", null],
    ["無効化済み", { id: TARGET_ID, isActive: false, departmentId: DEPT_ID }],
    ["所属なし", { id: TARGET_ID, isActive: true, departmentId: null }],
  ])(
    "#130 AC-1（0-4 AC-5）: %s は NOT_FOUND で書かない",
    async (_label, target) => {
      const profiles = fakeProfiles({
        findStatusTarget: vi.fn(async () => target),
      });
      const error = await createProfileService(profiles, adminRoles, {
        now: () => NOW,
      })
        .setStatusByProxy(actor, TARGET_ID, { status: "away" })
        .catch((e: unknown) => e);
      expect(codeOf(error)).toBe("NOT_FOUND");
      expect(profiles.setStatusByProxy).not.toHaveBeenCalled();
    },
  );

  it("#130 AC-1（0-4 AC-6）: 対象・部署・操作者・時刻を Repository に渡す", async () => {
    const profiles = fakeProfiles();
    await createProfileService(profiles, adminRoles, {
      now: () => NOW,
    }).setStatusByProxy(actor, TARGET_ID, {
      status: "away",
      returnAt: "2026-11-11T05:00:00.000Z",
    });
    expect(profiles.setStatusByProxy).toHaveBeenCalledWith(
      { userId: TARGET_ID, departmentId: DEPT_ID },
      { statusKind: "away", statusReturnAt: "2026-11-11T05:00:00.000Z" },
      { actorId: USER_ID, traceId: actor.traceId },
      NOW.toISOString(),
    );
  });
});
