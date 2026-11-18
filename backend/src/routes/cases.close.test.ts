// #150（150-A）5-1 AC-9・AC-10（C-142(2)）、EP-5-11・EP-5-12：案件の終了（POST /api/cases/:caseId/close）・再開（POST /api/cases/:caseId/reopen）を、
// 実際のアプリ入口（index.ts の app）と隔離 D1 で確かめる。
// この層で確かめるもの（計画 150-A 10章の「結合」の行）：判定の順・応答の形・存在の非開示・再認証を求めないこと・no-store・拒否の記録。
// 判定の順（計画 150-A 6.2。変えない）：認証（401）・送信元（403 FORBIDDEN_ORIGIN）→ パスの形（422 fields ["caseId"]）→ 案件がない（404）
//   → 操作者が有効な参加者でない（403「参加者だけが操作できます」。状態より先：終了済み・進行中を漏らさない。全体管理者・オーナーでも参加の行がなければ 403）
//   → authorize(perm.case.close) → 状態（409 already_closed／already_active）→ 200
// batch の前提・監査と通知の中身・同時の操作は、DB（db/case-close.repository.db.test.ts）と割り込み（services/case-close.interleave.test.ts）で確かめ、ここでは重ねない。
// 契約（実装前の仮置き。計画 150-A 6.1。実装の担当へ）：
//   成功は 200 で、本文はちょうど { caseId, status: "closed" }（終了）・{ caseId, status: "active" }（再開）。closedAt・reopenedAt は返さない。
//   本文は送られても読まない。409 の本文は { code: "CONFLICT", message, reason }。拒否（404・403）は logger.audit に操作 case.close／case.reopen で残す。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import {
  CASES_BASE,
  MISSING_CASE_ID,
  cleanupCaseTestData,
  joinedAt,
  seedCase,
  type SeededCase,
} from "../../test/case-fixtures";
import {
  CASE_CLOSE_MESSAGES,
  CASE_CLOSE_REASONS,
  caseCloseAudits,
  caseCloseSnapshot,
  closePath,
  reopenPath,
} from "../../test/case-close-fixtures";
import {
  BAD_ORIGIN,
  CASEREQ_NOW,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";

type ErrorBody = {
  code: string;
  message: string;
  fields?: string[];
  reason?: string;
};

let w: CaseWorld;
let logLines: string[];
/** 進行中・deptS 担当：memberS1・memberD1・admin（自動参加の全体管理者）・inactive（退職者）。ownerS（deptS のオーナー）は参加していない */
let main: SeededCase;
/** 終了・deptS 担当：memberS1・memberD1。admin・ownerS は参加していない */
let closed: SeededCase;

const closeCase = (caseId: string, token: string | null, body?: unknown) =>
  apiRequest("POST", closePath(caseId), { token, body });
const reopenCase = (caseId: string, token: string | null, body?: unknown) =>
  apiRequest("POST", reopenPath(caseId), { token, body });
const summaryOf = (caseId: string, token: string) =>
  apiRequest("GET", `${CASES_BASE}/${caseId}`, { token });

async function expectError(
  res: Response,
  status: number,
  expected: Partial<ErrorBody>,
) {
  expect(res.status).toBe(status);
  expect(res.headers.get("Cache-Control") ?? "").toContain("no-store");
  const body = (await res.json()) as ErrorBody;
  expect(body).toMatchObject(expected);
  return body;
}

const failureAudits = (action: string) =>
  logLines.filter((line) => line.includes("failure") && line.includes(action));

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(CASEREQ_NOW));
  logLines = [];
  const capture = (...args: unknown[]) => {
    logLines.push(args.map(String).join(" "));
  };
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
  w = await setupCaseWorld();
  main = await seedCase({
    n: 1511,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]150終了の結合",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    members: [
      { userId: w.memberS1.id, joinedAt: joinedAt(1) },
      { userId: w.memberD1.id, joinedAt: joinedAt(2) },
      { userId: w.admin.id, joinedAt: joinedAt(3) },
      { userId: w.inactive.id, joinedAt: joinedAt(4) },
    ],
  });
  closed = await seedCase({
    n: 1512,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]150再開の結合",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    status: "closed",
    members: [
      { userId: w.memberS1.id, joinedAt: joinedAt(1) },
      { userId: w.memberD1.id, joinedAt: joinedAt(2) },
    ],
  });
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await cleanupCaseTestData();
});

describe("#150 150-A 終了（EP-5-11）・再開（EP-5-12）の成功", () => {
  it("#150 5-1 AC-9: 参加者が終了すると 200 { caseId, status: closed }（closedAt は返さない）・no-store。概要の状態が closed になる", async () => {
    const res = await closeCase(main.id, w.memberD1.token);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control") ?? "").toContain("no-store");
    expect(await res.json()).toEqual({ caseId: main.id, status: "closed" });
    const summary = await summaryOf(main.id, w.memberS1.token);
    expect(((await summary.json()) as { status: string }).status).toBe(
      "closed",
    );
  });

  it("#150 5-1 AC-10（C-142(2)）: 参加者が終了中の案件を申請なしで再開すると 200 { caseId, status: active }（reopenedAt は返さない）・no-store", async () => {
    const res = await reopenCase(closed.id, w.memberS1.token);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control") ?? "").toContain("no-store");
    expect(await res.json()).toEqual({ caseId: closed.id, status: "active" });
    const summary = await summaryOf(closed.id, w.memberD1.token);
    expect(((await summary.json()) as { status: string }).status).toBe(
      "active",
    );
  });

  it("#150 5-1 AC-9・AC-10: 自動参加の全体管理者（参加の行がある）も、終了・再開できる", async () => {
    expect((await closeCase(main.id, w.admin.token)).status).toBe(200);
    expect((await reopenCase(main.id, w.admin.token)).status).toBe(200);
  });

  it("#150 5-1 AC-9（C-81）: 終了・再開は再認証を求めない（再認証していないセッションで 200）", async () => {
    // setupCaseWorld の利用者のセッションは、再認証の日時を持たない
    expect((await closeCase(main.id, w.memberS1.token)).status).toBe(200);
    expect((await reopenCase(main.id, w.memberS1.token)).status).toBe(200);
  });

  it("#150 6.1: 本文は送られても読まない（余分な項目があっても 200）", async () => {
    const res = await closeCase(main.id, w.memberS1.token, {
      status: "active",
      closedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ caseId: main.id, status: "closed" });
  });
});

describe("#150 150-A 判定の順（計画 6.2）", () => {
  it.each([
    { name: "終了", send: closeCase },
    { name: "再開", send: reopenCase },
  ])("#150 6.2: $name はログインしていなければ 401", async ({ send }) => {
    const res = await send(main.id, null);
    await expectError(res, 401, { code: "UNAUTHENTICATED" });
  });

  it.each([
    { name: "終了", path: closePath },
    { name: "再開", path: reopenPath },
  ])(
    "#150 6.2: $name は送信元（Origin）が許可されていなければ 403 FORBIDDEN_ORIGIN で、何も変わらない",
    async ({ path }) => {
      const before = await caseCloseSnapshot();
      const res = await apiRequest("POST", path(main.id), {
        token: w.memberS1.token,
        origin: BAD_ORIGIN,
      });
      // 送信元の確認は app.ts の一括で、no-store を付ける処理より前に動く（既存の経路のテストと同じく、no-store は確かめない）
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: "FORBIDDEN_ORIGIN" });
      expect(await caseCloseSnapshot()).toEqual(before);
    },
  );

  it.each([
    { name: "終了・ULID でない", send: closeCase, id: "not-a-ulid" },
    {
      name: "終了・小文字の ULID",
      send: closeCase,
      id: "01jtestcase150000000000001",
    },
    { name: "再開・ULID でない", send: reopenCase, id: "not-a-ulid" },
  ])(
    "#150 6.2: パスの caseId が ULID の形でなければ 422（fields に caseId）（$name）",
    async ({ send, id }) => {
      await expectError(await send(id, w.memberS1.token), 422, {
        code: "VALIDATION_ERROR",
        fields: ["caseId"],
      });
    },
  );

  it.each([
    { name: "終了", send: closeCase, action: "case.close" },
    { name: "再開", send: reopenCase, action: "case.reopen" },
  ])(
    "#150 6.2: $name で案件がなければ 404「案件が見つかりません」で、拒否が logger.audit に残る",
    async ({ send, action }) => {
      await expectError(await send(MISSING_CASE_ID, w.memberS1.token), 404, {
        code: "NOT_FOUND",
        message: CASE_CLOSE_MESSAGES.notFound,
      });
      expect(failureAudits(action).length).toBeGreaterThanOrEqual(1);
    },
  );

  // 表には関数だけを書く（beforeEach で代入する変数は、呼ばれた時点で読む）
  it.each([
    {
      name: "終了・進行中の案件・参加していない一般の社員",
      send: closeCase,
      target: () => main.id,
      token: () => w.memberS2.token,
      action: "case.close",
    },
    {
      name: "終了・進行中の案件・参加していない担当部署のオーナー（R-77）",
      send: closeCase,
      target: () => main.id,
      token: () => w.ownerS.token,
      action: "case.close",
    },
    {
      name: "終了・終了済みの案件・参加していない一般の社員（409 already_closed を漏らさない）",
      send: closeCase,
      target: () => closed.id,
      token: () => w.memberS2.token,
      action: "case.close",
    },
    {
      name: "終了・終了済みの案件・参加していない全体管理者（409 を漏らさない）",
      send: closeCase,
      target: () => closed.id,
      token: () => w.admin.token,
      action: "case.close",
    },
    {
      name: "再開・終了中の案件・参加していない全体管理者（R-77）",
      send: reopenCase,
      target: () => closed.id,
      token: () => w.admin.token,
      action: "case.reopen",
    },
    {
      name: "再開・終了中の案件・参加していない担当部署のオーナー",
      send: reopenCase,
      target: () => closed.id,
      token: () => w.ownerS.token,
      action: "case.reopen",
    },
    {
      name: "再開・進行中の案件・参加していない一般の社員（409 already_active を漏らさない）",
      send: reopenCase,
      target: () => main.id,
      token: () => w.memberS2.token,
      action: "case.reopen",
    },
  ])(
    "#150 6.2・security: $name → 403「参加者だけが操作できます」（reason なし）で、何も変わらず、拒否が logger.audit に残る",
    async ({ send, target, token, action }) => {
      const before = await caseCloseSnapshot();
      const body = await expectError(await send(target(), token()), 403, {
        code: "FORBIDDEN",
        message: CASE_CLOSE_MESSAGES.participantsOnly,
      });
      expect(body.reason).toBeUndefined();
      expect(await caseCloseSnapshot()).toEqual(before);
      expect(failureAudits(action).length).toBeGreaterThanOrEqual(1);
    },
  );

  it("#150 6.2: 参加者が終了済みの案件を終了すると 409 already_closed「この案件はすでに終了しています」で、監査・通知は増えない", async () => {
    const before = await caseCloseSnapshot();
    await expectError(await closeCase(closed.id, w.memberS1.token), 409, {
      code: "CONFLICT",
      reason: CASE_CLOSE_REASONS.alreadyClosed,
      message: CASE_CLOSE_MESSAGES.alreadyClosed,
    });
    expect(await caseCloseSnapshot()).toEqual(before);
  });

  it("#150 6.2: 参加者が進行中の案件を再開すると 409 already_active「この案件はすでに進行中です」で、監査・通知は増えない", async () => {
    const before = await caseCloseSnapshot();
    await expectError(await reopenCase(main.id, w.memberS1.token), 409, {
      code: "CONFLICT",
      reason: CASE_CLOSE_REASONS.alreadyActive,
      message: CASE_CLOSE_MESSAGES.alreadyActive,
    });
    expect(await caseCloseSnapshot()).toEqual(before);
  });

  it("#150 7章: 同じ案件を続けて2回終了すると、2回目は 409 already_closed で、監査は1件だけ", async () => {
    expect((await closeCase(main.id, w.memberS1.token)).status).toBe(200);
    await expectError(await closeCase(main.id, w.memberD1.token), 409, {
      reason: CASE_CLOSE_REASONS.alreadyClosed,
    });
    expect(
      (await caseCloseAudits()).filter((a) => a.action === "case.close"),
    ).toHaveLength(1);
  });
});
