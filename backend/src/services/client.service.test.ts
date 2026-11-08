import { describe, expect, it, vi } from "vitest";
import type { ClientRepository } from "../db/client.repository";
import type { RoleAssignmentRepository } from "../db/role-assignment.repository";
import { ROLE_IDS } from "../lib/permissions";
import { createClientService } from "./client.service";

const actor = { userId: "testuser_192_cas", traceId: "unit_test_192_cas" };
const current = {
  id: "00000000000000000000000002",
  code: "AAA",
  name: "[UNIT_TEST_192_CAS]Alpha",
  active: true,
  version: 2,
};
const roles: RoleAssignmentRepository = {
  async findByUserId() {
    return {
      user: { isActive: true },
      assignments: [
        {
          roleId: ROLE_IDS.globalAdmin,
          scopeType: "company",
          departmentId: null,
        },
      ],
    };
  },
};
function serviceWithLostUpdate() {
  const unexpectedCall = async (): Promise<never> => {
    throw new Error("競合テストで想定外のrepositoryメソッドが呼ばれました");
  };
  const repository = {
    listAdmin: vi.fn(unexpectedCall),
    listPublic: vi.fn(unexpectedCall),
    listCandidates: vi.fn(unexpectedCall),
    findById: vi.fn(async () => current),
    create: vi.fn(unexpectedCall),
    rename: vi.fn(async () => null),
    deactivate: vi.fn(async () => null),
  } satisfies ClientRepository;
  return createClientService(repository, roles);
}
describe("#192 AC-3・AC-4・AC-8: 読取後に更新を失った競合", () => {
  it("#192 AC-3・AC-8: 読取時は版一致でも改名更新0件なら成功DTOを返さず409", async () => {
    const service = serviceWithLostUpdate();
    await expect(
      service.rename(actor, current.id, {
        name: "[UNIT_TEST_192_CAS]Changed",
        version: 2,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
  });
  it("#192 AC-4・AC-8: 読取時は版一致でも無効化更新0件なら成功DTOを返さず409", async () => {
    const service = serviceWithLostUpdate();
    await expect(
      service.deactivate(actor, current.id, { active: false, version: 2 }),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
  });
});
