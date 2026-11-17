// #146（146-B）5-3 AC-3・AC-5・AC-6：決裁の前の読み取り（findForDecision・countActiveUsers）と、存在しない申請への決裁・自分の申請の読み取りを、
// マイグレーション済みの D1（Miniflare）で確かめる（ミューテーションの生き残りへの対応）。
// 承認・却下の batch の中身は case-request.approve.db.test.ts で確かめており、ここでは重ねない。
// 期待値は 5-3（存在しない申請は決裁できず、読み取りは null。足す候補は有効な社員だけ数える）から決める。
// 起こせない防御（count の行が返らない・batch の後に作った案件を読めない）は、到達しないため足さない。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanupCaseApprovalTestData } from "../../test/case-approval-fixtures";
import {
  CASEREQ_NOW,
  TEST_TAG,
  casereqTraceId,
  insertCaseRequest,
  setUserActive,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import {
  CaseRequestWriteError,
  withCaseRequests,
} from "./case-request.repository";

let w: CaseWorld;
/** 存在しない申請・社員の ID（ULID の形。I・L・O・U を使わない） */
const MISSING_REQUEST = "01KZZZZZZZZZZZZZZZZZZZZZZY";
const MISSING_USER = "01KZZZZZZZZZZZZZZZZZZZZZZZ";

const pending = (departmentIds: string[]) =>
  insertCaseRequest({
    clientId: w.clientA.id,
    title: `${TEST_TAG}決裁の読み取り`,
    requestedBy: w.memberS1.id,
    departmentIds,
    description: "[UNIT_TEST]説明",
    dueDate: "2026-12-01",
  });

beforeEach(async () => {
  w = await setupCaseWorld();
});

afterEach(async () => {
  await cleanupCaseApprovalTestData();
});

describe("#146 5-3 AC-3 findForDecision（決裁の前に申請を読む）", () => {
  it("#146 5-3 AC-3: 存在しない申請は null（成功した値にしない）", async () => {
    const found = await withCaseRequests(env, (repository) =>
      repository.findForDecision(MISSING_REQUEST),
    );
    expect(found).toBeNull();
  });

  it("#146 5-3 AC-3: 存在する申請は、申請者・状態・版・全担当部署を返す", async () => {
    const requestId = await pending([w.deptS.id, w.deptD.id]);
    const found = await withCaseRequests(env, (repository) =>
      repository.findForDecision(requestId),
    );
    expect(found).toMatchObject({
      id: requestId,
      requestedBy: w.memberS1.id,
      status: "pending",
      version: 1,
    });
    expect([...(found?.departmentIds ?? [])].sort()).toEqual(
      [w.deptS.id, w.deptD.id].sort(),
    );
  });
});

describe("#146 5-3 AC-3 存在しない申請の決裁は、成功にせず not_found", () => {
  it("#146 5-3 AC-3: 存在しない申請の承認は not_found", async () => {
    const error = await withCaseRequests(env, (repository) =>
      repository.approve({
        requestId: MISSING_REQUEST,
        version: 1,
        deciderId: w.ownerS.id,
        additionalCandidateIds: [],
        now: CASEREQ_NOW,
        traceId: casereqTraceId(),
      }),
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(CaseRequestWriteError);
    expect((error as CaseRequestWriteError).reason).toBe("not_found");
  });

  it("#146 5-3 AC-3: 存在しない申請の却下は not_found", async () => {
    const error = await withCaseRequests(env, (repository) =>
      repository.reject({
        requestId: MISSING_REQUEST,
        version: 1,
        deciderId: w.ownerS.id,
        reason: "[UNIT_TEST]却下の理由",
        now: CASEREQ_NOW,
        traceId: casereqTraceId(),
      }),
    ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(CaseRequestWriteError);
    expect((error as CaseRequestWriteError).reason).toBe("not_found");
  });
});

describe("#146 5-3 AC-5 countActiveUsers（足す候補の数）", () => {
  const count = (ids: string[]) =>
    withCaseRequests(env, (repository) => repository.countActiveUsers(ids));

  it("#146 5-3 AC-5: 空の配列は 0", async () => {
    expect(await count([])).toBe(0);
  });

  it("#146 5-3 AC-5: 有効な社員だけを数える（無効・存在しない ID は数えない）", async () => {
    expect(await count([w.memberS1.id, w.memberS2.id])).toBe(2);
    expect(await count([w.memberS1.id, w.inactive.id])).toBe(1);
    expect(await count([w.inactive.id])).toBe(0);
    expect(await count([MISSING_USER])).toBe(0);
    expect(await count([w.memberS1.id, MISSING_USER])).toBe(1);
  });

  it("#146 5-3 AC-5: 有効だった社員が無効になれば数えない", async () => {
    await setUserActive(w.memberS2.id, false);
    expect(await count([w.memberS1.id, w.memberS2.id])).toBe(1);
  });
});

describe("#146 5-1 AC-6 findOwnItem（自分の申請の読み取り）", () => {
  const own = (requestId: string, requesterId: string) =>
    withCaseRequests(env, (repository) =>
      repository.findOwnItem({ requestId, requesterId }),
    );

  it("#146 5-1 AC-6: 本人には申請の項目を返し、他人・存在しない申請には null", async () => {
    const requestId = await pending([w.deptS.id]);
    const item = await own(requestId, w.memberS1.id);
    expect(item?.id).toBe(requestId);
    expect(await own(requestId, w.memberS2.id)).toBeNull();
    expect(await own(MISSING_REQUEST, w.memberS1.id)).toBeNull();
  });
});
