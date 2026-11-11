// #130 AC-1（0-4 AC-5・canSetStatus）: 一覧の各行の canSetStatus を判定する canForDepartments（services/authorizer.ts）。
// 権限の組み立てを2か所にしないため、EP-0-15 の authorize と同じ Resolver（resolvePermissions）で判定し、割り当ては一覧1回につき1回だけ読む。
// 公開形の仮定（契約。計画 2章）：
//   canForDepartments(repository: RoleAssignmentRepository, userId: string, permission: Permission, departmentIds: readonly string[])
//     → Promise<Map<string, boolean>>（キーは渡した部署ID。重複した部署IDは1つにまとめる）
// 期待値は権限の表（オーナーは自部署・全体管理者は全部署・メンバーはなし・無効な利用者はなし）から決め、
// 同じ入力で createAppAuthorizer の can を部署ごとに呼んだ結果とも一致することを確かめる。
import { describe, expect, it, vi } from "vitest";
import type {
  RoleAssignmentRepository,
  UserWithAssignments,
} from "../db/role-assignment.repository";
import type { Logger } from "../lib/logger/logger";
import { ROLE_IDS } from "../lib/permissions";
import { canForDepartments, createAppAuthorizer } from "./authorizer";

const OWNER = "01JTESTAUTHZOWNER000000001";
const ADMIN = "01JTESTAUTHZADMIN000000001";
const MEMBER = "01JTESTAUTHZMEMBER00000001";
const INACTIVE_OWNER = "01JTESTAUTHZINACTIVE000001";
const MISSING = "01JTESTAUTHZMISSING0000001";
const DEPT_A = "01JTESTAUTHZDEPTA000000001";
const DEPT_B = "01JTESTAUTHZDEPTB000000001";
const DEPT_C = "01JTESTAUTHZDEPTC000000001";
const DEPARTMENTS = [DEPT_A, DEPT_B, DEPT_C];

const fixtures: Record<string, UserWithAssignments> = {
  [OWNER]: {
    user: { isActive: true },
    assignments: [
      { roleId: ROLE_IDS.owner, scopeType: "department", departmentId: DEPT_A },
    ],
  },
  [ADMIN]: {
    user: { isActive: true },
    assignments: [
      {
        roleId: ROLE_IDS.globalAdmin,
        scopeType: "company",
        departmentId: null,
      },
    ],
  },
  [MEMBER]: { user: { isActive: true }, assignments: [] },
  [INACTIVE_OWNER]: {
    user: { isActive: false },
    assignments: [
      { roleId: ROLE_IDS.owner, scopeType: "department", departmentId: DEPT_A },
    ],
  },
};

function spyRepository() {
  const findByUserId = vi.fn(
    async (userId: string) => fixtures[userId] ?? null,
  );
  const repository: RoleAssignmentRepository = { findByUserId };
  return { repository, findByUserId };
}

const silentLogger = () =>
  ({
    audit: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }) as unknown as Logger;

describe("#130 AC-1（0-4 AC-5）canForDepartments", () => {
  it("#130 AC-1（0-4 AC-5）: 異なる部署を複数含む一覧1回につき、findByUserId は1回だけ呼ばれる", async () => {
    const { repository, findByUserId } = spyRepository();
    await canForDepartments(repository, OWNER, "perm.status.proxy.set", [
      DEPT_A,
      DEPT_B,
      DEPT_C,
      DEPT_A,
    ]);
    expect(findByUserId).toHaveBeenCalledTimes(1);
    expect(findByUserId).toHaveBeenCalledWith(OWNER);
  });

  it.each<[string, string, Record<string, boolean>]>([
    [
      "オーナーは自部署だけ true",
      OWNER,
      { [DEPT_A]: true, [DEPT_B]: false, [DEPT_C]: false },
    ],
    [
      "全体管理者は全部 true",
      ADMIN,
      { [DEPT_A]: true, [DEPT_B]: true, [DEPT_C]: true },
    ],
    [
      "メンバーは全部 false",
      MEMBER,
      { [DEPT_A]: false, [DEPT_B]: false, [DEPT_C]: false },
    ],
    [
      "無効な利用者は割り当てがあっても全部 false",
      INACTIVE_OWNER,
      { [DEPT_A]: false, [DEPT_B]: false, [DEPT_C]: false },
    ],
    [
      "存在しない利用者は全部 false",
      MISSING,
      { [DEPT_A]: false, [DEPT_B]: false, [DEPT_C]: false },
    ],
  ])("#130 AC-1（0-4 AC-5）: %s", async (_label, userId, expected) => {
    const { repository } = spyRepository();
    const result = await canForDepartments(
      repository,
      userId,
      "perm.status.proxy.set",
      DEPARTMENTS,
    );
    expect(Object.fromEntries(result)).toEqual(expected);
  });

  it.each([OWNER, ADMIN, MEMBER, INACTIVE_OWNER, MISSING])(
    "#130 AC-1（0-4 AC-5）: 結果は、部署ごとの authorize（can）の結果と一致する（%s）",
    async (userId) => {
      const { repository } = spyRepository();
      const result = await canForDepartments(
        repository,
        userId,
        "perm.status.proxy.set",
        DEPARTMENTS,
      );
      const authorizer = createAppAuthorizer(repository, {
        logger: silentLogger(),
      });
      for (const departmentId of DEPARTMENTS) {
        const expected = await authorizer.can(
          { userId },
          "perm.status.proxy.set",
          { type: "department", departmentId },
        );
        expect(result.get(departmentId), departmentId).toBe(expected);
      }
    },
  );

  it("#130 AC-1（0-4 AC-5）: 部署が0件なら空の Map（割り当てを読まなくてよい）", async () => {
    const { repository } = spyRepository();
    const result = await canForDepartments(
      repository,
      OWNER,
      "perm.status.proxy.set",
      [],
    );
    expect(result.size).toBe(0);
  });

  it("#130 AC-1（0-4 AC-5）: 割り当ての読み込みの失敗は、false にせず呼び出し元へ伝える", async () => {
    const failure = new Error("unit test failure");
    const repository: RoleAssignmentRepository = {
      findByUserId: vi.fn(async () => {
        throw failure;
      }),
    };
    await expect(
      canForDepartments(repository, OWNER, "perm.status.proxy.set", [DEPT_A]),
    ).rejects.toBe(failure);
  });
});
