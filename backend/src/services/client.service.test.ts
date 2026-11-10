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

const created207 = {
  id: "00000000000000000000000207",
  code: "ABC",
  name: "[UNIT_TEST_207]Alpha",
  active: true,
  version: 1,
};
function serviceFor207(found: typeof current) {
  const unexpectedCall = async (): Promise<never> => {
    throw new Error("想定外のrepositoryメソッドが呼ばれました");
  };
  const repository = {
    listAdmin: vi.fn(unexpectedCall),
    listPublic: vi.fn(unexpectedCall),
    listCandidates: vi.fn(unexpectedCall),
    findById: vi.fn(async () => found),
    create: vi.fn<ClientRepository["create"]>(async () => created207),
    rename: vi.fn<ClientRepository["rename"]>(async () => created207),
    deactivate: vi.fn(async () => created207),
  } satisfies ClientRepository;
  return { repository, service: createClientService(repository, roles) };
}

describe("#207 AC-1: client.service の保存内容と拒否", () => {
  it("#207 AC-1: 登録は前後の空白を除いた名前で保存する", async () => {
    const { repository, service } = serviceFor207(current);
    await service.create(actor, {
      code: "ABC",
      name: "  [UNIT_TEST_207]Alpha  ",
    });
    expect(repository.create.mock.calls[0]?.[0].name).toBe(
      "[UNIT_TEST_207]Alpha",
    );
  });

  it("#207 AC-1: 改名は前後の空白を除いた名前で保存する", async () => {
    const { repository, service } = serviceFor207(current);
    await service.rename(actor, current.id, {
      name: "  [UNIT_TEST_207]Beta  ",
      version: 2,
    });
    expect(repository.rename.mock.calls[0]?.[2]).toBe("[UNIT_TEST_207]Beta");
  });

  it("#207 AC-1: 有効・版一致の改名は、更新した結果を返す", async () => {
    const { service } = serviceFor207(current);
    await expect(
      service.rename(actor, current.id, {
        name: "[UNIT_TEST_207]B",
        version: 2,
      }),
    ).resolves.toBe(created207);
  });

  it("#207 AC-1: 有効・版一致の無効化は、更新した結果を返す", async () => {
    const { service } = serviceFor207(current);
    await expect(
      service.deactivate(actor, current.id, { active: false, version: 2 }),
    ).resolves.toBe(created207);
  });

  it("#207 AC-1: 無効の取引先の改名は409で、更新しない", async () => {
    const { repository, service } = serviceFor207({
      ...current,
      active: false,
    });
    await expect(
      service.rename(actor, current.id, {
        name: "[UNIT_TEST_207]B",
        version: 2,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(repository.rename).not.toHaveBeenCalled();
  });

  it("#207 AC-1: 版が違う改名は409で、更新しない", async () => {
    const { repository, service } = serviceFor207(current);
    await expect(
      service.rename(actor, current.id, {
        name: "[UNIT_TEST_207]B",
        version: 1,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(repository.rename).not.toHaveBeenCalled();
  });

  it("#207 AC-1: 社内（INT）の取引先の無効化は409で、更新しない", async () => {
    const { repository, service } = serviceFor207({ ...current, code: "INT" });
    await expect(
      service.deactivate(actor, current.id, { active: false, version: 2 }),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(repository.deactivate).not.toHaveBeenCalled();
  });

  it("#207 AC-1: 無効の取引先の無効化は409で、更新しない", async () => {
    const { repository, service } = serviceFor207({
      ...current,
      active: false,
    });
    await expect(
      service.deactivate(actor, current.id, { active: false, version: 2 }),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(repository.deactivate).not.toHaveBeenCalled();
  });

  it("#207 AC-1: 版が違う無効化は409で、更新しない", async () => {
    const { repository, service } = serviceFor207(current);
    await expect(
      service.deactivate(actor, current.id, { active: false, version: 1 }),
    ).rejects.toMatchObject({ code: "CONFLICT", status: 409 });
    expect(repository.deactivate).not.toHaveBeenCalled();
  });
});
