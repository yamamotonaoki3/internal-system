// #130 AC-1（0-4 AC-4）: 戻り予定の業務検証を Service（services/profile.service.ts）で行い、現在時刻は注入した now を使う（Date に直接頼らない）。
// 公開形の仮定（契約。department.service.ts と同じ形）：
//   createProfileService(profiles: ProfileRepository, roles: RoleAssignmentRepository, deps: { now?: () => Date, piiKey?: string })
//     .updateOwnProfile(actor: { userId, traceId }, input: { displayName?, status?, returnAt?, statusMessage? })
//     .setStatusByProxy(actor: { userId, traceId }, targetUserId, input: { status, returnAt? })
//   戻り予定の誤りは AppError("VALIDATION_ERROR", …, { fields: ["returnAt"] }) で、Repository の書き込みより前に返す。
// Repository は代役（Proxy）にし、関数の形に依存しない：呼ばれた関数の名前だけを記録する。
// 境界値の全体（現在ちょうど・1年ちょうど・在席と戻り予定）は、実際の入口から routes/me.profile.test.ts・routes/users.test.ts でも確かめる。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileRepository } from "../db/profile.repository";
import type {
  RoleAssignmentRepository,
  UserWithAssignments,
} from "../db/role-assignment.repository";
import { AppError } from "../lib/app-error";
import { ROLE_IDS } from "../lib/permissions";
import { createProfileService } from "./profile.service";

const ADMIN_ID = "01JTESTPROFSVCADMIN0000001";
const TARGET_ID = "01JTESTPROFSVCTARGET000001";
const DEPT_ID = "01JTESTPROFSVCDEPT00000001";
// 実際の時計（2026年）とずらした、注入する現在時刻
const INJECTED_NOW = new Date("2030-01-01T00:00:00.000Z");
const at = (ms: number) => new Date(INJECTED_NOW.getTime() + ms).toISOString();

const roles: RoleAssignmentRepository = {
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

let called: string[];
// どの関数も呼べる代役。読み込みには、対象の社員（有効・所属あり・在席）らしい値を返す
function fakeProfiles(): ProfileRepository {
  const sample = {
    id: TARGET_ID,
    userId: TARGET_ID,
    displayName: "テスト太郎",
    departmentId: DEPT_ID,
    department: { id: DEPT_ID, name: "[UNIT_TEST]部署" },
    isActive: true,
    status: { kind: "available", returnAt: null, message: null },
    statusKind: "available",
    statusReturnAt: null,
    statusMessage: null,
    updatedAt: "2030-01-01T00:00:00.000Z",
  };
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== "string" || prop === "then") return undefined;
        return vi.fn(async () => {
          called.push(prop);
          return sample;
        });
      },
    },
  ) as ProfileRepository;
}

const actor = { userId: ADMIN_ID, traceId: "unit-prof-svc-trace" };
const isReturnAtError = (error: unknown) =>
  error instanceof AppError &&
  error.code === "VALIDATION_ERROR" &&
  JSON.stringify(error).includes("returnAt");
const writes = () =>
  called.filter((name) => /^(update|set|save|write)/i.test(name));

beforeEach(() => {
  called = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

function service() {
  return createProfileService(fakeProfiles(), roles, {
    now: () => INJECTED_NOW,
  });
}

describe("#130 AC-1（0-4 AC-4）updateOwnProfile の戻り予定（注入した時刻）", () => {
  it.each([
    ["現在ちょうど", at(0)],
    ["過去", at(-1)],
    ["1年と1ms 先", "2031-01-01T00:00:00.001Z"],
    // 実際の時計では未来でも、注入した現在より過去なら拒否する（Date に直接頼らない）
    [
      "実際の時計では未来だが、注入した現在より過去",
      "2029-06-01T00:00:00.000Z",
    ],
  ])(
    "#130 AC-1（0-4 AC-4）: %s は VALIDATION_ERROR（returnAt）で、書き込まない",
    async (_label, returnAt) => {
      const error = await service()
        .updateOwnProfile(actor, { status: "away", returnAt })
        .catch((e: unknown) => e);
      expect(isReturnAtError(error)).toBe(true);
      expect(writes()).toEqual([]);
    },
  );

  it.each([
    ["1ms 先", at(1)],
    ["ちょうど1年先", "2031-01-01T00:00:00.000Z"],
  ])(
    "#130 AC-1（0-4 AC-4）: %s は戻り予定の誤りにしない",
    async (_label, returnAt) => {
      const error = await service()
        .updateOwnProfile(actor, { status: "away", returnAt })
        .then(
          () => null,
          (e: unknown) => e,
        );
      expect(isReturnAtError(error)).toBe(false);
    },
  );

  it("#130 AC-1（0-4 AC-4・P-3）: 在席と戻り予定を同時に渡すと VALIDATION_ERROR で、書き込まない", async () => {
    const error = await service()
      .updateOwnProfile(actor, { status: "available", returnAt: at(60_000) })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("VALIDATION_ERROR");
    expect(writes()).toEqual([]);
  });

  it("#130 AC-1（0-4 AC-4・P-3）: 在席のまま戻り予定だけを渡すと VALIDATION_ERROR で、書き込まない", async () => {
    const error = await service()
      .updateOwnProfile(actor, { returnAt: at(60_000) })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("VALIDATION_ERROR");
    expect(writes()).toEqual([]);
  });
});

describe("#130 AC-1（0-4 AC-4・EP-0-15）setStatusByProxy の戻り予定（注入した時刻）", () => {
  it.each([
    ["現在ちょうど", at(0)],
    ["過去", at(-1)],
    ["1年と1ms 先", "2031-01-01T00:00:00.001Z"],
    [
      "実際の時計では未来だが、注入した現在より過去",
      "2029-06-01T00:00:00.000Z",
    ],
  ])(
    "#130 AC-1（0-4 AC-4）: %s は VALIDATION_ERROR（returnAt）で、書き込まない",
    async (_label, returnAt) => {
      const error = await service()
        .setStatusByProxy(actor, TARGET_ID, { status: "away", returnAt })
        .catch((e: unknown) => e);
      expect(isReturnAtError(error)).toBe(true);
      expect(writes()).toEqual([]);
    },
  );

  it("#130 AC-1（0-4 AC-4）: ちょうど1年先は戻り予定の誤りにしない", async () => {
    const error = await service()
      .setStatusByProxy(actor, TARGET_ID, {
        status: "vacation",
        returnAt: "2031-01-01T00:00:00.000Z",
      })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(isReturnAtError(error)).toBe(false);
  });

  it("#130 AC-1（0-4 AC-4・P-3）: 在席と戻り予定を同時に渡すと VALIDATION_ERROR で、書き込まない", async () => {
    const error = await service()
      .setStatusByProxy(actor, TARGET_ID, {
        status: "available",
        returnAt: at(60_000),
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("VALIDATION_ERROR");
    expect(writes()).toEqual([]);
  });
});
