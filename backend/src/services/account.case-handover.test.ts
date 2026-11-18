// #147（147-C-2）5-1 AC-15（決定 Q1）：進行中の案件の唯一の有効な参加者は、無効化できない（409 case_handover_required）。
// 実際の入口（index.ts の app）と隔離 D1 で、応答と判定の順を確かめる。期待は計画 147-C-2「無効化」：
//   判定の順は 404 → 403 → 422（本人）→ 再認証 → 409 already_inactive → global_admin → department_owner → case_handover_required。
//   文言は「この社員が唯一の有効な参加者になっている進行中の案件があるため、無効化できません」。何も変えない（状態・参加・監査）。
// あわせて、Service（本物の Repository）で「最初の判定 → ほかの参加者の無効化 → 書き込み」の順を固定し、
// batch の前提で取り消された後の読み直しで 409 case_handover_required になることを確かめる。
// 引き継ぎの画面は作らない（Q1）。データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import {
  cleanupCaseTestData,
  joinedAt,
  seedCase,
} from "../../test/case-fixtures";
import {
  casereqTraceId,
  setUserActive,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import { sessionFor } from "../../test/channel-request-fixtures";
import {
  AccountStateChangedError,
  withAccounts,
} from "../db/account.repository";
import { createAccountService } from "../services/account.service";

const BASE = "/api/admin/accounts";
const HANDOVER_MESSAGE =
  "この社員が唯一の有効な参加者になっている進行中の案件があるため、無効化できません";

let w: CaseWorld;
let caseSeq = 0;

async function caseWith(
  memberIds: string[],
  status: "active" | "closed" = "active",
) {
  caseSeq += 1;
  return seedCase({
    n: 200 + caseSeq,
    clientId: w.clientA.id,
    code: "QZA",
    title: `[UNIT_TEST]147C2結合${caseSeq}`,
    createdBy: memberIds[0] ?? w.memberS1.id,
    departmentIds: [w.deptD.id],
    status,
    members: memberIds.map((userId, i) => ({ userId, joinedAt: joinedAt(i) })),
  });
}

const deactivate = async (id: string, token?: string) =>
  apiRequest("POST", `${BASE}/${id}/deactivate`, {
    token: token ?? (await sessionFor(w.admin.id)),
  });

async function stateOf(id: string) {
  return env.DB.prepare(
    "SELECT is_active, department_id FROM users WHERE id = ?",
  )
    .bind(id)
    .first<{ is_active: number; department_id: string | null }>();
}

async function deactivateAuditCount() {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'account.deactivate'",
  ).first<{ n: number }>();
  return row?.n ?? 0;
}

async function membersOfUser(userId: string) {
  const { results } = await env.DB.prepare(
    "SELECT channel_id FROM channel_members WHERE user_id = ? ORDER BY channel_id",
  )
    .bind(userId)
    .all<{ channel_id: string }>();
  return results.map((r) => r.channel_id);
}

beforeEach(async () => {
  caseSeq = 0;
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  w = await setupCaseWorld();
  await env.DB.prepare(
    "UPDATE users SET must_change_password = 0 WHERE login_id LIKE 'testuser!_casereq!_%' ESCAPE '!'",
  ).run();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupCaseTestData();
});

describe("#147 147-C-2 AC-15（Q1）: 無効化の 409 case_handover_required", () => {
  it("#147 AC-15: 進行中の案件の唯一の有効な参加者は 409 case_handover_required（文言つき）で、状態・参加・監査が変わらない", async () => {
    const target = w.memberS2.id;
    await caseWith([target, w.inactive.id]);
    const channelsBefore = await membersOfUser(target);

    const res = await deactivate(target);

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: "CONFLICT",
      reason: "case_handover_required",
      message: HANDOVER_MESSAGE,
    });
    expect(await stateOf(target)).toEqual({
      is_active: 1,
      department_id: w.deptS.id,
    });
    expect(await membersOfUser(target)).toEqual(channelsBefore);
    expect(await deactivateAuditCount()).toBe(0);
  });

  it("#147 AC-15: 終了した案件だけなら 204 で無効化でき、終了した案件の参加の行は残る（C-142(1)）", async () => {
    const target = w.memberS2.id;
    const closed = await caseWith([target], "closed");
    const res = await deactivate(target);
    expect(res.status).toBe(204);
    expect(await stateOf(target)).toMatchObject({ is_active: 0 });
    expect(await membersOfUser(target)).toEqual([closed.roomId]);
  });

  it("#147 AC-15・Q1: ほかに有効な参加者（自動参加の全体管理者だけでも）がいれば 204", async () => {
    const target = w.memberS2.id;
    await caseWith([target, w.admin.id]);
    const res = await deactivate(target);
    expect(res.status).toBe(204);
  });

  it("#147 AC-15（判定の順）: 部署のオーナーで唯一の有効な参加者なら、先に 409 department_owner", async () => {
    await caseWith([w.ownerS.id]);
    const res = await deactivate(w.ownerS.id);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "department_owner" });
  });

  it("#147 AC-15（判定の順）: すでに無効な社員は、残った参加の行で唯一でも、409 already_inactive", async () => {
    await caseWith([w.inactive.id]);
    const res = await deactivate(w.inactive.id);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "already_inactive" });
  });

  it("#147 AC-15（判定の順）: 再認証がなければ、唯一の有効な参加者でも 403 REAUTH_REQUIRED", async () => {
    const target = w.memberS2.id;
    await caseWith([target]);
    const res = await deactivate(target, await sessionFor(w.admin.id, null));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "REAUTH_REQUIRED" });
  });

  it("#147 AC-15（判定の順）: 全体管理者でない操作者は、唯一の有効な参加者が対象でも 403（409 の理由を漏らさない）", async () => {
    const target = w.memberS2.id;
    await caseWith([target]);
    const res = await deactivate(target, await sessionFor(w.memberS1.id));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { reason?: string };
    expect(body.reason).toBeUndefined();
  });

  it("#147 AC-15（判定の順）: ない社員は 404", async () => {
    const res = await deactivate("01KZZZZZZZZZZZZZZZZZZZZZZZ");
    expect(res.status).toBe(404);
  });
});

describe("#147 147-C-2 AC-15: 最初の判定の後に、ほかの唯一の有効な参加者が無効になった場合（Service と本物の Repository）", () => {
  it("#147 AC-15: batch の前提で取り消され、読み直しで 409 case_handover_required になり、何も変わらない", async () => {
    const target = w.memberS2.id;
    await caseWith([target, w.memberD1.id]);

    const run = withAccounts(env, (repository, roles) => {
      // 書き込みの直前に、ほかの唯一の有効な参加者を無効にする（読み直しは本物のまま）
      const interleaved = {
        ...repository,
        deactivate: async (
          input: Parameters<typeof repository.deactivate>[0],
        ) => {
          await setUserActive(w.memberD1.id, false);
          return repository.deactivate(input);
        },
      };
      return createAccountService(interleaved, roles).deactivate(
        {
          userId: w.admin.id,
          traceId: casereqTraceId(),
          reauthenticatedAt: new Date(Date.now() - 60_000).toISOString(),
        },
        target,
      );
    });

    const error = await run.then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).not.toBeNull();
    expect(error).not.toBeInstanceOf(AccountStateChangedError);
    expect(error).toMatchObject({
      code: "CONFLICT",
      details: { reason: "case_handover_required" },
    });
    expect(await stateOf(target)).toMatchObject({ is_active: 1 });
    expect(await deactivateAuditCount()).toBe(0);
  });
});
