// #199 AC-1〜AC-3・AC-5: アカウントの Service（account.service.ts）の単体テスト。Repository はスタブにする。
// 認可が先に評価されること、部署の確認、409 への変換、Repository に平文を渡さないことを確かめる。
import { describe, expect, it, vi } from "vitest";
import { SCRYPT_TEST_TIMEOUT_MS } from "../../test/auth-fixtures";
import { newPiiKey } from "../../test/random-secrets";
import {
  AccountConflictError,
  type AccountCreateInput,
  type AccountRepository,
} from "../db/account.repository";
import type { RoleAssignmentRepository } from "../db/role-assignment.repository";
import { decryptLegalName } from "../lib/pii-crypto";
import { verifyPassword } from "../lib/password";
import { ROLE_IDS } from "../lib/permissions";
import { createAccountService } from "./account.service";

const DEPT = "01JTESTDEPT000000000000001";
const actor = { userId: "testuser_199_admin", traceId: "unit-auth-199-svc" };
const input = {
  loginId: "testuser_199_new",
  legalName: "テスト太郎",
  // 本名と別の値にし、Repository への入力に本名の平文が含まれないことを確かめる
  displayName: "テスト表示",
  email: "testuser_199_new@example.com",
  emailConfirmed: true as const,
  departmentId: DEPT,
};

function roles(
  roleId: string,
  scopeType: "company" | "department" = "company",
): RoleAssignmentRepository {
  return {
    async findByUserId() {
      return {
        user: { isActive: true },
        assignments: [
          {
            roleId,
            scopeType,
            departmentId: scopeType === "company" ? null : DEPT,
          },
        ],
      };
    },
  };
}

function stub(overrides: Partial<AccountRepository> = {}) {
  const created: AccountCreateInput[] = [];
  const repository = {
    findActiveDepartment: vi.fn(async () => ({ id: DEPT, name: "テスト部" })),
    listActiveDepartments: vi.fn(async () => [{ id: DEPT, name: "テスト部" }]),
    createAccount: vi.fn(async (value: AccountCreateInput) => {
      created.push(value);
    }),
    listAdmin: vi.fn(async () => ({ items: [], nextCursor: null })),
    ...overrides,
  } as unknown as AccountRepository;
  return { repository, created };
}

describe(
  "#199 アカウントの Service",
  { timeout: SCRYPT_TEST_TIMEOUT_MS },
  () => {
    it.each<[string, string, "company" | "department"]>([
      ["一般社員", ROLE_IDS.member, "company"],
      ["部署オーナー", ROLE_IDS.owner, "department"],
    ])(
      "#199 AC-1: %sは FORBIDDEN で、部署の確認も保存もしない",
      async (_l, roleId, scope) => {
        vi.spyOn(console, "log").mockImplementation(() => {});
        const { repository } = stub();
        const service = createAccountService(repository, roles(roleId, scope));
        await expect(
          service.create(actor, input, { piiKey: newPiiKey() }),
        ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
        await expect(
          service.listAdmin(actor, { limit: 20 }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(service.departmentOptions(actor)).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
        expect(repository.findActiveDepartment).not.toHaveBeenCalled();
        expect(repository.createAccount).not.toHaveBeenCalled();
        expect(repository.listAdmin).not.toHaveBeenCalled();
        expect(repository.listActiveDepartments).not.toHaveBeenCalled();
        vi.restoreAllMocks();
      },
    );

    it("#199 AC-1: 拒否は監査ログに、要求の traceId・操作者・会社範囲（company）で残る", async () => {
      const lines: string[] = [];
      vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(" "));
      });
      try {
        const { repository } = stub();
        const service = createAccountService(
          repository,
          roles(ROLE_IDS.member),
        );
        await expect(
          service.create(actor, input, { piiKey: newPiiKey() }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        const audits = lines
          .filter((l) => l.startsWith("{"))
          .map(
            (l) =>
              JSON.parse(l) as {
                body: string;
                trace_id?: string;
                user_id?: string;
                attributes: Record<string, unknown>;
              },
          )
          .filter((l) => l.attributes.log_type === "audit");
        expect(audits).toHaveLength(1);
        expect(audits[0]).toMatchObject({
          body: "perm.account.create",
          trace_id: actor.traceId,
          user_id: actor.userId,
          attributes: { target: "company", result: "failure" },
        });
      } finally {
        vi.restoreAllMocks();
      }
    });

    it("#199 AC-1（V-12）: 有効な部署が見つからなければ 422（fields: departmentId）で保存しない", async () => {
      const { repository } = stub({
        findActiveDepartment: vi.fn(async () => null),
      } as Partial<AccountRepository>);
      const service = createAccountService(
        repository,
        roles(ROLE_IDS.globalAdmin),
      );
      await expect(
        service.create(actor, input, { piiKey: newPiiKey() }),
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        status: 422,
        userMessage: "入力内容を確かめてください",
        details: { fields: ["departmentId"] },
      });
      expect(repository.createAccount).not.toHaveBeenCalled();
    });

    it("#199 AC-3: Repository へはハッシュと暗号文だけを渡し、確認者は操作者、応答に初期パスワードを一度だけ含める", async () => {
      const piiKey = newPiiKey();
      const { repository, created } = stub();
      const service = createAccountService(
        repository,
        roles(ROLE_IDS.globalAdmin),
      );
      const result = await service.create(actor, input, { piiKey });
      expect(created).toHaveLength(1);
      const saved = created[0] as AccountCreateInput;
      expect(saved.actorId).toBe(actor.userId);
      expect(saved.traceId).toBe(actor.traceId);
      expect(saved.departmentId).toBe(DEPT);
      expect(JSON.stringify(saved)).not.toContain(result.initialPassword);
      expect(JSON.stringify(saved)).not.toContain("テスト太郎");
      expect(saved.legalNameEncrypted).not.toContain("テスト太郎");
      expect(
        await verifyPassword(result.initialPassword, saved.passwordHash),
      ).toBe(true);
      expect(
        await decryptLegalName(saved.legalNameEncrypted, piiKey, saved.id),
      ).toBe("テスト太郎");
      expect(result).toMatchObject({
        id: saved.id,
        loginId: input.loginId,
        displayName: "テスト表示",
        departmentId: DEPT,
        mustChangePassword: true,
      });
      expect(result).not.toHaveProperty("legalName");
      expect(result).not.toHaveProperty("email");
    });

    it.each([
      ["login_id", "そのユーザーIDはすでに使われています"],
      ["email", "そのメールアドレスはすでに使われています"],
    ] as const)(
      "#199 AC-2: Repository の AccountConflictError(%s) は 409 CONFLICT になり、どの項目かを案内し、入力値を含めず、原因を cause に残す",
      async (reason, message) => {
        const conflict = new AccountConflictError(reason);
        const { repository } = stub({
          createAccount: vi.fn(async () => {
            throw conflict;
          }),
        } as Partial<AccountRepository>);
        const service = createAccountService(
          repository,
          roles(ROLE_IDS.globalAdmin),
        );
        const error = await service
          .create(actor, input, { piiKey: newPiiKey() })
          .catch((e: unknown) => e);
        expect(error).toMatchObject({
          code: "CONFLICT",
          status: 409,
          userMessage: message,
        });
        expect((error as Error).cause).toBe(conflict);
        const text = JSON.stringify(error) + String((error as Error).message);
        expect(text).not.toContain(input.loginId);
        expect(text).not.toContain(input.email);
      },
    );

    it("#199 AC-2: 競合以外の Repository の失敗は、そのまま呼び出し元へ伝える（409にしない）", async () => {
      const failure = new Error("unit test failure");
      const { repository } = stub({
        createAccount: vi.fn(async () => {
          throw failure;
        }),
      } as Partial<AccountRepository>);
      const service = createAccountService(
        repository,
        roles(ROLE_IDS.globalAdmin),
      );
      const error = await service
        .create(actor, input, { piiKey: newPiiKey() })
        .catch((e: unknown) => e);
      expect(error).not.toMatchObject({ code: "CONFLICT" });
    });
  },
);
