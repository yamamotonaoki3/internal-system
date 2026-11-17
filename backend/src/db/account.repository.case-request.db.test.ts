// #146（146-A。#128-a からの引き継ぎ）5-3 AC-8：申請者が無効化されたら、その人の審査中の案件の作成申請を自動で取り消し、履歴を残す。
// 無効化の batch（account.repository.ts の deactivate）に、対象が申請者である pending の申請を取り消す文を足す（引き継ぎ 2026-11-17）。
// 期待値は要件 5-3 AC-8（自動取消し、履歴を残す）・5-3 AC-11（自動取消の申請には案件番号を付けない）から決める。
// 決定（利用者・統括 2026-11-17）：状態は auto_cancelled（本人の withdrawn と区別する）。decided_at は無効化の時刻、decided_by は無効化した操作者。
//   無効化の監査（account.deactivate）の detail に cancelledCaseRequestCount（取り消した件数）を足し、申請ごとの監査は作らない。通知は出さない。
// 部署異動（128-b）での自動取消は、この worktree にないため入れない。
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

const DEACTIVATED_AT = "2026-11-17T05:00:00.000Z";
let w: CaseWorld;

const deactivate = (targetId: string, actorId = w.admin.id) =>
  withAccounts(env, (repository) =>
    repository.deactivate({
      targetId,
      actorId,
      now: DEACTIVATED_AT,
      traceId: casereqTraceId(),
    }),
  );

const request = (
  requestedBy: string,
  status: "pending" | "rejected" | "withdrawn" | "approved" = "pending",
) =>
  insertCaseRequest({
    clientId: w.clientA.id,
    title: `${TEST_TAG}自動取消`,
    requestedBy,
    departmentIds: [w.deptS.id],
    candidateIds: [w.memberD1.id],
    status,
  });

beforeEach(async () => {
  w = await setupCaseWorld();
});

afterEach(async () => {
  await env.DB.exec("DROP TRIGGER IF EXISTS unit_146_fail_deactivate_audit");
  await cleanupCaseRequestTestData();
});

describe("#146 5-3 AC-8 申請者の無効化による、案件の作成申請の自動取消", () => {
  it("#146 5-3 AC-8: 無効化された申請者の審査中の申請は auto_cancelled になり、決裁者は操作者・時刻は無効化の時刻。行・部署・候補は履歴として残り、案件の ID は付かない", async () => {
    const id = await request(w.memberS1.id);
    await deactivate(w.memberS1.id);
    const row = await caseRequestRow(id);
    expect(row).not.toBeNull();
    expect(row?.status).toBe("auto_cancelled");
    expect(row?.case_id).toBeNull();
    expect(row?.decided_at).toBe(DEACTIVATED_AT);
    expect(row?.decided_by).toBe(w.admin.id);
    expect(await requestDepartments(id)).toEqual([w.deptS.id]);
    expect(await requestCandidates(id)).toHaveLength(1);
  });

  it("#146 5-3 AC-8: 申請者の決裁済み・取り下げ済みの申請は変えない", async () => {
    const done = [
      await request(w.memberS1.id, "rejected"),
      await request(w.memberS1.id, "withdrawn"),
      await request(w.memberS1.id, "approved"),
    ];
    const before = await Promise.all(done.map((id) => caseRequestRow(id)));
    await deactivate(w.memberS1.id);
    expect(await Promise.all(done.map((id) => caseRequestRow(id)))).toEqual(
      before,
    );
  });

  it("#146 5-3 AC-8: ほかの人の審査中の申請は変えない（無効化した人が候補に入っているだけの申請も変えない）", async () => {
    const other = await request(w.memberS2.id);
    const withCandidate = await insertCaseRequest({
      clientId: w.clientA.id,
      title: `${TEST_TAG}候補だけ`,
      requestedBy: w.memberS2.id,
      departmentIds: [w.deptS.id],
      candidateIds: [w.memberS1.id],
    });
    const before = [
      await caseRequestRow(other),
      await caseRequestRow(withCandidate),
    ];
    await deactivate(w.memberS1.id);
    expect([
      await caseRequestRow(other),
      await caseRequestRow(withCandidate),
    ]).toEqual(before);
  });

  it("#146 5-3 AC-8: 無効化が前提の崩れで失敗したら、申請は審査中のまま（同じ batch で取り消される）", async () => {
    const id = await request(w.memberS1.id);
    // 操作者が全体管理者でないので、無効化の前提が崩れる
    await expect(deactivate(w.memberS1.id, w.ownerS.id)).rejects.toBeInstanceOf(
      AccountStateChangedError,
    );
    expect((await caseRequestRow(id))?.status).toBe("pending");
  });

  it("#146 5-3 AC-8: 無効化の監査の挿入が失敗したら、申請は審査中のまま", async () => {
    const id = await request(w.memberS1.id);
    await env.DB.exec(
      "CREATE TRIGGER unit_146_fail_deactivate_audit BEFORE INSERT ON audit_logs WHEN NEW.action = 'account.deactivate' BEGIN SELECT RAISE(ABORT, 'unit_146_fail_deactivate_audit'); END",
    );
    await expect(deactivate(w.memberS1.id)).rejects.toThrow();
    expect((await caseRequestRow(id))?.status).toBe("pending");
  });
  it("#146 5-3 AC-8: 無効化の監査の detail に取り消した件数を入れ、申請ごとの監査・通知は作らない", async () => {
    await request(w.memberS1.id);
    await request(w.memberS1.id);
    await request(w.memberS1.id, "rejected");
    await deactivate(w.memberS1.id);
    const { results } = await env.DB.prepare(
      "SELECT action, detail FROM audit_logs WHERE action = 'account.deactivate' OR action LIKE 'case_request.%'",
    ).all<{ action: string; detail: string | null }>();
    expect(results).toHaveLength(1);
    expect(JSON.parse(results[0]?.detail ?? "{}")).toMatchObject({
      cancelledCaseRequestCount: 2,
    });
    expect(await caseRequestNotifications()).toEqual([]);
  });
});
