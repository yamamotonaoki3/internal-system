// #200 AC-1（Q-5）: 全社連絡がなくて発行できないとき、運用担当者が気づけるログの中身（本文・追跡ID・利用者ID）を確かめる。
// account.service.test.ts は「ERROR が出ること」を確かめる。ここでは出力の中身を確かめる。
import { describe, expect, it, vi } from "vitest";
import { newPiiKey } from "../../test/random-secrets";
import {
  CompanyGeneralChannelMissingError,
  type AccountRepository,
} from "../db/account.repository";
import type { RoleAssignmentRepository } from "../db/role-assignment.repository";
import { ROLE_IDS } from "../lib/permissions";
import { createAccountService } from "./account.service";

const DEPT = "01JTESTDEPT000000000000001";
const actor = { userId: "testuser_200_logger", traceId: "unit-200-logger" };
const input = {
  loginId: "testuser_200_lognew",
  legalName: "テスト太郎",
  displayName: "テスト表示",
  email: "testuser_200_lognew@example.com",
  emailConfirmed: true as const,
  departmentId: DEPT,
};

const admin: RoleAssignmentRepository = {
  async findByUserId() {
    return {
      user: { isActive: true },
      assignments: [
        {
          roleId: ROLE_IDS.globalAdmin,
          scopeType: "company" as const,
          departmentId: null,
        },
      ],
    };
  },
};

describe("#200 AC-1 全社連絡がないときのログ", () => {
  it("#200 AC-1（Q-5）: ERROR の本文が決めた文言で、追跡ID・利用者IDを含み、入力値を含まない", async () => {
    const lines: string[] = [];
    const capture = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    vi.spyOn(console, "log").mockImplementation(capture);
    vi.spyOn(console, "warn").mockImplementation(capture);
    vi.spyOn(console, "error").mockImplementation(capture);
    try {
      const repository = {
        findActiveDepartment: vi.fn(async () => ({
          id: DEPT,
          name: "テスト部",
        })),
        createAccount: vi.fn(async () => {
          throw new CompanyGeneralChannelMissingError();
        }),
      } as unknown as AccountRepository;
      const service = createAccountService(repository, admin);
      await service
        .create(actor, input, { piiKey: newPiiKey() })
        .catch(() => undefined);
      const records = lines
        .filter((l) => l.startsWith("{"))
        .map((l) => JSON.parse(l) as Record<string, unknown>);
      const error = records.find((r) => r.severity_text === "ERROR");
      expect(error).toMatchObject({
        severity_text: "ERROR",
        body: "全社連絡のチャンネルがないため、アカウントを発行できません",
        trace_id: actor.traceId,
        user_id: actor.userId,
      });
      for (const line of lines) {
        expect(line).not.toContain(input.loginId);
        expect(line).not.toContain(input.email);
      }
    } finally {
      vi.restoreAllMocks();
    }
  });
});
