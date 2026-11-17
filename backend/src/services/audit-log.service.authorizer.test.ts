// #156（0-6 AC-1）: 監査ログの閲覧の認可が、権限 perm.audit_log.view を「会社の範囲」で確かめ、拒否の記録に trace と閲覧する人の ID を残すことを、
// 拒否のとき authorizer が出す運用ログ（log_type: audit）で確かめる（本物の authorizer を使う。モジュールの差し替えはしない）。
// 認可の結果そのものは audit-log.service.test.ts で確かめている。データは架空（[UNIT_TEST]）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoleAssignmentRepository } from "../db/role-assignment.repository";
import { createAuditLogService } from "./audit-log.service";

const actor = {
  userId: "01JTEST156AUTHZMEMB000010",
  sessionId: "a".repeat(64),
  traceId: "trace-156-authz",
};

const memberRoles: RoleAssignmentRepository = {
  async findByUserId() {
    return { user: { isActive: true }, assignments: [] };
  },
};

let lines: Record<string, unknown>[];

beforeEach(() => {
  lines = [];
  const capture = (line: unknown) => {
    lines.push(JSON.parse(String(line)) as Record<string, unknown>);
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("#156 0-6 AC-1: 拒否の記録（Service の authorize）", () => {
  it("#156 0-6 AC-1: 一般メンバーの拒否は、権限 perm.audit_log.view・会社の範囲（target: company）・失敗として、trace と利用者の ID つきで記録される", async () => {
    const service = createAuditLogService({} as never, memberRoles);
    await expect(service.authorize(actor)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const audit = lines.filter(
      (line) =>
        (line.attributes as Record<string, unknown>).log_type === "audit",
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      body: "perm.audit_log.view",
      trace_id: actor.traceId,
      user_id: actor.userId,
      attributes: { target: "company", result: "failure", reason: "forbidden" },
    });
  });

  it("#156 0-6 AC-1: search の拒否も、同じ内容で記録される", async () => {
    const service = createAuditLogService({} as never, memberRoles);
    await expect(service.search(actor, { limit: 20 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      body: "perm.audit_log.view",
      trace_id: actor.traceId,
      user_id: actor.userId,
      attributes: { target: "company" },
    });
  });
});
