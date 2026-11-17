// #146（146-A）5-3 AC-8：申請者が部署を異動したら、その人の審査中の案件の作成申請を自動で取り消し（auto_cancelled）、履歴を残す。
// 全体管理者の部署変更は取消の対象外（5-3 AC-8・C-06）。異動の batch（account.repository.ts の transfer）に、無効化と同じ形で文を足す。
// 決定（利用者・統括）：decided_by は異動を行った操作者、decided_at は異動の時刻。異動の監査（account.transfer）の detail に
//   cancelledCaseRequestCount（数値。0件なら 0）を入れ、申請ごとの監査・通知は作らない。
//   判定（件数の読み取り）と batch の間に件数が変わったら、無効化と同じく前提の崩れとして何も変えない（AccountStateChangedError）。
// データは架空（testuser_casereq_・[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  TEST_TAG,
  caseRequestNotifications,
  caseRequestRow,
  casereqTraceId,
  cleanupCaseRequestTestData,
  insertCaseRequest,
  requestCandidates,
  requestDepartments,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import { AccountStateChangedError, withAccounts } from "./account.repository";

const TRANSFERRED_AT = "2026-11-17T06:00:00.000Z";
let w: CaseWorld;

type TransferOverrides = Partial<{
  targetId: string;
  fromDepartmentId: string;
  toDepartmentId: string;
  actorId: string;
}>;

const transferWith = (target: Env, overrides: TransferOverrides = {}) =>
  withAccounts(target, (repository) =>
    repository.transfer({
      targetId: w.memberS1.id,
      fromDepartmentId: w.deptS.id,
      toDepartmentId: w.deptD.id,
      actorId: w.admin.id,
      now: TRANSFERRED_AT,
      traceId: casereqTraceId(),
      ...overrides,
    }),
  );
const transfer = (overrides: TransferOverrides = {}) =>
  transferWith(env, overrides);

const request = (
  requestedBy: string,
  status: "pending" | "rejected" | "withdrawn" | "approved" = "pending",
) =>
  insertCaseRequest({
    clientId: w.clientA.id,
    title: `${TEST_TAG}異動の自動取消`,
    requestedBy,
    departmentIds: [w.deptS.id],
    candidateIds: [w.memberD1.id],
    status,
  });

async function transferAudits() {
  const { results } = await env.DB.prepare(
    "SELECT action, detail FROM audit_logs WHERE action = 'account.transfer' OR action LIKE 'case_request.%'",
  ).all<{ action: string; detail: string | null }>();
  return results;
}

/** batch の直前に before を実行する env（判定と batch の間に状態を変えるため） */
function envInterruptingBatch(before: () => Promise<void>): Env {
  const db = env.DB;
  const proxy = new Proxy(db, {
    get(target, property) {
      if (property === "batch")
        return async (statements: D1PreparedStatement[]) => {
          await before();
          return target.batch(statements);
        };
      const value: unknown = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return { ...env, DB: proxy } as Env;
}

beforeEach(async () => {
  w = await setupCaseWorld();
});

afterEach(async () => {
  await cleanupCaseRequestTestData();
});

describe("#146 5-3 AC-8 申請者の異動による、案件の作成申請の自動取消", () => {
  it("#146 5-3 AC-8: 異動した申請者の審査中の申請は auto_cancelled になり、決裁者は操作者・時刻は異動の時刻。行・部署・候補は残り、案件の ID はない", async () => {
    const id = await request(w.memberS1.id);
    await transfer();
    expect(await caseRequestRow(id)).toMatchObject({
      status: "auto_cancelled",
      decided_by: w.admin.id,
      decided_at: TRANSFERRED_AT,
      case_id: null,
    });
    expect(await requestDepartments(id)).toEqual([w.deptS.id]);
    expect(await requestCandidates(id)).toHaveLength(1);
  });

  it("#146 5-3 AC-8: 申請者の審査中でない申請と、ほかの人の申請は変えない", async () => {
    const ids = [
      await request(w.memberS1.id, "rejected"),
      await request(w.memberS1.id, "withdrawn"),
      await request(w.memberS1.id, "approved"),
      await request(w.memberS2.id),
    ];
    const before = await Promise.all(ids.map((id) => caseRequestRow(id)));
    await transfer();
    expect(await Promise.all(ids.map((id) => caseRequestRow(id)))).toEqual(
      before,
    );
  });

  it("#146 5-3 AC-8・C-06: 全体管理者の異動では、その人の申請を取り消さない", async () => {
    const id = await request(w.admin.id);
    await transfer({
      targetId: w.admin.id,
      fromDepartmentId: w.deptH.id,
      toDepartmentId: w.deptD.id,
    });
    expect((await caseRequestRow(id))?.status).toBe("pending");
    const [audit] = await transferAudits();
    expect(JSON.parse(audit?.detail ?? "{}")).toMatchObject({
      cancelledCaseRequestCount: 0,
    });
  });

  it("#146 5-3 AC-8: 異動の前提が崩れて取り消されたら（対象が今の部署のオーナー）、申請も変わらない", async () => {
    const id = await request(w.ownerS.id);
    await expect(transfer({ targetId: w.ownerS.id })).rejects.toBeInstanceOf(
      AccountStateChangedError,
    );
    expect((await caseRequestRow(id))?.status).toBe("pending");
  });

  it("#146 5-3 AC-8: 異動の監査の detail に取り消した件数を入れ、申請ごとの監査・通知は作らない", async () => {
    await request(w.memberS1.id);
    await request(w.memberS1.id);
    await request(w.memberS1.id, "rejected");
    await transfer();
    const audits = await transferAudits();
    expect(audits.map((a) => a.action)).toEqual(["account.transfer"]);
    expect(JSON.parse(audits[0]?.detail ?? "{}")).toMatchObject({
      cancelledCaseRequestCount: 2,
    });
    expect(await caseRequestNotifications()).toEqual([]);
  });

  it("#146 5-3 AC-8: 判定の後、batch の前に対象が新しい申請を出したら、前提の崩れとして何も変えない（件数と状態の不整合を残さない）", async () => {
    const first = await request(w.memberS1.id);
    let added: string | null = null;
    const interrupted = envInterruptingBatch(async () => {
      if (added === null) added = await request(w.memberS1.id);
    });
    await expect(transferWith(interrupted)).rejects.toBeInstanceOf(
      AccountStateChangedError,
    );
    expect((await caseRequestRow(first))?.status).toBe("pending");
    expect(added).not.toBeNull();
    expect((await caseRequestRow(added ?? ""))?.status).toBe("pending");
    const row = await env.DB.prepare(
      "SELECT department_id FROM users WHERE id = ?",
    )
      .bind(w.memberS1.id)
      .first<{ department_id: string }>();
    expect(row?.department_id).toBe(w.deptS.id);
    expect(await transferAudits()).toEqual([]);
  });
});
