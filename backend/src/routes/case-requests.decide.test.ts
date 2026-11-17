// #146（146-B）5-3 AC-3・AC-4・AC-5・AC-6・AC-7・AC-8・AC-9・AC-14、3-4 AC-2・AC-3、C-81：案件の作成申請の審査一覧（EP-5-03）・承認（EP-5-04）・
// 却下（EP-5-05）を、実際のアプリ入口（index.ts の app）と隔離 D1 で確かめる。時刻は Date だけを CASEREQ_NOW（日本時間 2026-11-17 12:00）に固定する。
// この層で確かめるもの（計画 1.3・B-7）：状態コード・判定の順・存在の非開示（同じ 404）・応答の形・入力の検査・一覧の範囲と項目・通知の宛先・再認証を求めないこと。
// batch の中身・採番・前提の崩れの各理由の原子性は DB のテスト（db/case-request.approve.db.test.ts）で確かめ、ここでは重ねない。
// 再認証：要件 0-5（「案件の作成・再開の承認は、従来どおり再認証を求めない」）・screens.md の S-29（「再認証は挟まない（C-81）」）・計画 B-3 が一致する。
//   このテストの利用者のセッションは再認証していない（sessionFor(id, null)）ため、成功すること自体が「再認証を求めない」の確認になる。
// 判定の順（計画 B-4。全 API で固定）：
//   (1) 審査者の門（perm.case.request.approve と reviewerFactsOf：全体管理者か、いずれかの部署の有効なオーナー）。でなければ 403 FORBIDDEN
//   (2) 申請が存在しない・範囲外（全体管理者でなく、申請の担当部署のどれのオーナーでもない）なら 404 NOT_FOUND（同じ本文。logger.audit に記録）
//   (3) 全体管理者でないオーナーが自分の申請を決裁するなら 403 FORBIDDEN（logger.audit に記録）
//   (4) 承認者が足す候補が存在しない・無効なら 422（fields: ["additionalCandidateIds"]）
//   (5) batch の中で 409（決裁済みが最優先）
// 契約（実装の担当へ。テストが決めたもの）：
//  - GET /api/case-requests?status&limit&cursor → 200 { items: 審査項目[], nextCursor }。no-store。ID の降順。審査者でなければ 403
//      審査項目 = 自分の申請の項目（id・title・description・dueDate・client・departments・status・rejectReason・caseId・resubmittedFrom・createdAt・decidedAt）
//               ＋ requesterId・requesterDisplayName・candidates: [{ userId, displayName, isActive }]・hasSimilarTitle（自分自身を除く）・canApprove
//      canApprove：審査中（pending）で、決裁者が決裁できる（全体管理者、または自分の申請でない担当部署のオーナー）ときだけ true
//  - POST /api/case-requests/:requestId/approve 本文（strict。省略可）{ additionalCandidateIds?: ULID[]（重複不可・上限なし） }
//      → 200 { requestId, status: "approved", caseId, caseNumber, roomId }
//  - POST /api/case-requests/:requestId/reject 本文（strict）{ reason }（rejectReasonSchema：前後の空白を除いて 1〜200 文字。違反は 422 fields: ["reason"]）
//      → 200 { requestId, status: "rejected" }
//  - 409 の文言は case-approval-fixtures.ts の DECIDE_MESSAGES
// データは架空（testuser_casereq_・@example.com・[UNIT_TEST] の部署と取引先）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import {
  DECIDE_MESSAGES,
  cleanupCaseApprovalTestData,
  insertCase,
  setCaseNumberSequence,
} from "../../test/case-approval-fixtures";
import {
  BAD_ORIGIN,
  BASE,
  CASEREQ_NOW,
  TEST_TAG,
  caseRequestAudits,
  caseRequestIdAt,
  caseRequestNotifications,
  caseRequestRow,
  insertCaseRequest,
  removeOwner,
  setClientActive,
  setDepartmentActive,
  setUserActive,
  setupCaseWorld,
  type Actor,
  type CaseRequestStatus,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import { makeOwner } from "../../test/department-fixtures";
import { isUlid } from "../lib/ulid";

type ErrorBody = { code: string; message: string; fields?: string[] };
type ReviewItem = {
  id: string;
  title: string;
  description: string;
  dueDate: string | null;
  client: { id: string; code: string; name: string; isActive: boolean };
  departments: { id: string; name: string; isActive: boolean }[];
  candidates: { userId: string; displayName: string; isActive: boolean }[];
  status: string;
  rejectReason: string | null;
  caseId: string | null;
  resubmittedFrom: string | null;
  createdAt: string;
  decidedAt: string | null;
  requesterId: string;
  requesterDisplayName: string;
  hasSimilarTitle: boolean;
  canApprove: boolean;
};
type ReviewPage = { items: ReviewItem[]; nextCursor: string | null };

type ActorKey =
  | "ownerS"
  | "memberS1"
  | "memberS2"
  | "ownerD"
  | "memberD1"
  | "ownerH"
  | "admin";
type DeptKey = "deptS" | "deptD" | "deptH";

let w: CaseWorld;
let logLines: string[];

/** 存在しない申請の ID（ULID の形） */
const MISSING_REQUEST = caseRequestIdAt(1_799_000_000_000);

const actorOf = (key: ActorKey): Actor => w[key];

const post = (
  path: string,
  token: string | null,
  body?: unknown,
  origin?: string,
) =>
  apiRequest("POST", path, {
    token,
    ...(body === undefined ? {} : { body }),
    ...(origin === undefined ? {} : { origin }),
  });
const get = (path: string, token: string | null) =>
  apiRequest("GET", path, { token });

const approve = (id: string, token: string, body?: unknown) =>
  post(`${BASE}/${id}/approve`, token, body);
const reject = (
  id: string,
  token: string,
  reason: unknown = "[UNIT_TEST]理由",
) => post(`${BASE}/${id}/reject`, token, { reason });

let titleSeq = 0;
async function pending(
  requester: ActorKey,
  depts: DeptKey[],
  options: Partial<{
    status: CaseRequestStatus;
    title: string;
    candidateIds: string[];
    clientId: string;
  }> = {},
) {
  titleSeq += 1;
  return insertCaseRequest({
    clientId: options.clientId ?? w.clientA.id,
    title: options.title ?? `${TEST_TAG}審査${titleSeq}`,
    requestedBy: actorOf(requester).id,
    departmentIds: depts.map((d) => w[d].id),
    ...(options.status === undefined ? {} : { status: options.status }),
    ...(options.candidateIds === undefined
      ? {}
      : { candidateIds: options.candidateIds }),
  });
}

async function reviewAll(
  token: string,
  query = "",
  limit = 100,
): Promise<ReviewItem[]> {
  const items: ReviewItem[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 100; i += 1) {
    const params = new URLSearchParams(query);
    params.set("limit", String(limit));
    if (cursor !== null) params.set("cursor", cursor);
    const res = await get(`${BASE}?${params.toString()}`, token);
    expect(res.status).toBe(200);
    const page = (await res.json()) as ReviewPage;
    items.push(...page.items);
    cursor = page.nextCursor;
    if (cursor === null) return items;
  }
  throw new Error("一覧のページが終わりませんでした");
}

/** logger.audit の failure の行 */
const failureAudits = () => logLines.filter((line) => line.includes("failure"));

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
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await cleanupCaseApprovalTestData();
});

describe("#146 146-B 共通：認証と Origin", () => {
  it.each([
    ["GET", BASE],
    ["POST", `${BASE}/${MISSING_REQUEST}/approve`],
    ["POST", `${BASE}/${MISSING_REQUEST}/reject`],
  ])(
    "#146 共通: 未認証の %s %s は 401 UNAUTHENTICATED",
    async (method, path) => {
      const res =
        method === "GET" ? await get(path, null) : await post(path, null, {});
      expect(res.status).toBe(401);
      expect(((await res.json()) as ErrorBody).code).toBe("UNAUTHENTICATED");
    },
  );

  it("#146 共通: 許可外の Origin からの承認・却下は 403 FORBIDDEN_ORIGIN で、申請は変わらない", async () => {
    const id = await pending("memberS1", ["deptS"]);
    for (const path of [`${BASE}/${id}/approve`, `${BASE}/${id}/reject`]) {
      const res = await post(
        path,
        w.ownerS.token,
        path.endsWith("reject") ? { reason: "理由" } : {},
        BAD_ORIGIN,
      );
      expect(res.status).toBe(403);
      expect(((await res.json()) as ErrorBody).code).toBe("FORBIDDEN_ORIGIN");
    }
    expect((await caseRequestRow(id))?.status).toBe("pending");
  });
});

describe("#146 5-3 AC-3・AC-4・AC-9 判定の順（承認）", () => {
  // [説明, 申請者, 担当部署, 決裁する人, 期待する status]
  it.each<[string, ActorKey, DeptKey[], ActorKey, number]>([
    ["担当部署のオーナーが", "memberS1", ["deptS"], "ownerS", 200],
    [
      "複数の担当部署の片方のオーナーが（AC-3）",
      "memberS1",
      ["deptS", "deptD"],
      "ownerD",
      200,
    ],
    [
      "担当部署でない部署のオーナーが（範囲外）",
      "memberS1",
      ["deptS"],
      "ownerH",
      404,
    ],
    [
      "同じ部署のメンバーが（門で拒否）",
      "memberS1",
      ["deptS"],
      "memberS2",
      403,
    ],
    ["他部署のメンバーが（門で拒否）", "memberS1", ["deptS"], "memberD1", 403],
    [
      "全体管理者が（担当部署のオーナーでなくても。AC-3）",
      "memberS1",
      ["deptS"],
      "admin",
      200,
    ],
    [
      "オーナー自身の申請をそのオーナーが（AC-4）",
      "ownerS",
      ["deptS"],
      "ownerS",
      403,
    ],
    [
      "オーナー自身の申請を全体管理者が（AC-4）",
      "ownerS",
      ["deptS"],
      "admin",
      200,
    ],
    [
      "全体管理者自身の申請を全体管理者が（AC-4）",
      "admin",
      ["deptH"],
      "admin",
      200,
    ],
    [
      "全体管理者自身の申請を担当部署のオーナーが",
      "admin",
      ["deptH"],
      "ownerH",
      200,
    ],
  ])(
    "#146 5-3 AC-3・AC-4: %s承認する（期待する状態コードは表のとおり）",
    async (_label, requester, depts, decider, status) => {
      const id = await pending(requester, depts);
      const res = await approve(id, actorOf(decider).token);
      expect(res.status).toBe(status);
      if (status !== 200)
        expect((await caseRequestRow(id))?.status).toBe("pending");
    },
  );

  it("#146 判定の順(1): 審査者でない人は、存在しない ID でも 403 FORBIDDEN（404 にしない）", async () => {
    for (const path of [
      `${BASE}/${MISSING_REQUEST}/approve`,
      `${BASE}/${MISSING_REQUEST}/reject`,
    ]) {
      const res = await post(
        path,
        w.memberS1.token,
        path.endsWith("reject") ? { reason: "理由" } : {},
      );
      expect(res.status).toBe(403);
      expect(((await res.json()) as ErrorBody).code).toBe("FORBIDDEN");
    }
  });

  it("#146 判定の順(2)・存在の非開示: 範囲外の申請と存在しない申請は、同じ 404 の本文。拒否は logger.audit に記録する", async () => {
    const id = await pending("memberS1", ["deptS"]);
    const outOfScope = await approve(id, w.ownerH.token);
    const missing = await approve(MISSING_REQUEST, w.ownerH.token);
    expect(outOfScope.status).toBe(404);
    expect(missing.status).toBe(404);
    const a = (await outOfScope.json()) as ErrorBody;
    const b = (await missing.json()) as ErrorBody;
    expect(a.code).toBe("NOT_FOUND");
    expect(a).toEqual(b);
    expect(failureAudits().length).toBeGreaterThanOrEqual(2);
  });

  it("#146 判定の順(2)・存在の非開示: 却下でも、範囲外と存在しない申請は同じ 404 の本文", async () => {
    const id = await pending("memberS1", ["deptS"]);
    const outOfScope = await reject(id, w.ownerH.token);
    const missing = await reject(MISSING_REQUEST, w.ownerH.token);
    expect(outOfScope.status).toBe(404);
    expect(await outOfScope.json()).toEqual(await missing.json());
  });

  it("#146 判定の順(2)→(3): 範囲外のオーナーには、決裁済みの申請も 404（409 を返して存在を明かさない）", async () => {
    const id = await pending("memberS1", ["deptS"], { status: "approved" });
    const res = await approve(id, w.ownerH.token);
    expect(res.status).toBe(404);
  });

  it("#146 判定の順(3)→(5): オーナー自身の取り下げ済みの申請を、そのオーナーが承認すると 403（409 より先）", async () => {
    const id = await pending("ownerS", ["deptS"], { status: "withdrawn" });
    const res = await approve(id, w.ownerS.token);
    expect(res.status).toBe(403);
    expect(((await res.json()) as ErrorBody).code).toBe("FORBIDDEN");
  });

  it("#146 判定の順(3): オーナー自身の申請をそのオーナーが却下しても 403", async () => {
    const id = await pending("ownerS", ["deptS"]);
    const res = await reject(id, w.ownerS.token);
    expect(res.status).toBe(403);
    expect((await caseRequestRow(id))?.status).toBe("pending");
  });

  it("#146 5-3 AC-9: オーナーの交代後は、新しいオーナーが承認でき、前のオーナー（別の部署のオーナー）は 404", async () => {
    const id = await pending("memberS1", ["deptS"]);
    await removeOwner(w.ownerS.id, w.deptS.id);
    await makeOwner(w.memberS2.id, w.deptS.id);
    await removeOwner(w.ownerD.id, w.deptD.id);
    await makeOwner(w.ownerS.id, w.deptD.id);
    const former = await approve(id, w.ownerS.token);
    expect(former.status).toBe(404);
    const current = await approve(id, w.memberS2.token);
    expect(current.status).toBe(200);
  });

  it("#146 5-3 AC-9: オーナーの交代で、どの部署のオーナーでもなくなった前のオーナーは 403（審査者の門）", async () => {
    const id = await pending("memberS1", ["deptS"]);
    await removeOwner(w.ownerS.id, w.deptS.id);
    await makeOwner(w.memberS2.id, w.deptS.id);
    const res = await approve(id, w.ownerS.token);
    expect(res.status).toBe(403);
  });

  it("#146 C-81・0-5・S-29: 再認証していないセッションでも承認・却下ができ、REAUTH_REQUIRED にならない", async () => {
    const a = await pending("memberS1", ["deptS"]);
    const b = await pending("memberS1", ["deptS"]);
    const approved = await approve(a, w.ownerS.token);
    const rejected = await reject(b, w.ownerS.token);
    expect(approved.status).toBe(200);
    expect(rejected.status).toBe(200);
  });
});

describe("#146 5-3 AC-2・AC-5 承認の応答と入力", () => {
  it("#146 5-3 AC-2・5-1 AC-18: 承認は 200 { requestId, status, caseId, caseNumber, roomId } だけを返し、no-store", async () => {
    const id = await pending("memberS1", ["deptS"]);
    const res = await approve(id, w.ownerS.token);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      ["caseId", "caseNumber", "requestId", "roomId", "status"].sort(),
    );
    expect(body).toMatchObject({
      requestId: id,
      status: "approved",
      caseNumber: "QZA-261117-0001",
    });
    expect(isUlid(String(body.caseId))).toBe(true);
    expect(isUlid(String(body.roomId))).toBe(true);
    expect((await caseRequestRow(id))?.case_id).toBe(body.caseId);
  });

  it("#146 B-3: 本文を省いても（空のオブジェクトでも）承認できる", async () => {
    const a = await pending("memberS1", ["deptS"]);
    const b = await pending("memberS1", ["deptS"]);
    expect((await approve(a, w.ownerS.token)).status).toBe(200);
    expect((await approve(b, w.ownerS.token, {})).status).toBe(200);
  });

  it("#146 5-3 AC-5: 承認者は候補を足せる（他部署を含む有効な社員）", async () => {
    const id = await pending("memberS1", ["deptS"]);
    const res = await approve(id, w.ownerS.token, {
      additionalCandidateIds: [w.memberD1.id, w.memberS2.id],
    });
    expect(res.status).toBe(200);
  });

  it.each<[string, () => unknown]>([
    ["無効な社員", () => ({ additionalCandidateIds: [w.inactive.id] })],
    [
      "存在しない社員",
      () => ({ additionalCandidateIds: [caseRequestIdAt(1_798_000_000_000)] }),
    ],
    [
      "重複した ID",
      () => ({ additionalCandidateIds: [w.memberD1.id, w.memberD1.id] }),
    ],
    ["ULID でない値", () => ({ additionalCandidateIds: ["not-a-ulid"] })],
    ["配列でない値", () => ({ additionalCandidateIds: w.memberD1.id })],
  ])(
    "#146 5-3 AC-5: 足す候補が%sなら 422 fields: [additionalCandidateIds] で、申請は変わらない",
    async (_label, body) => {
      const id = await pending("memberS1", ["deptS"]);
      const res = await approve(id, w.ownerS.token, body());
      expect(res.status).toBe(422);
      const error = (await res.json()) as ErrorBody;
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.fields).toEqual(["additionalCandidateIds"]);
      expect((await caseRequestRow(id))?.status).toBe("pending");
    },
  );

  it("#146 backend-hono（strict）: 承認の本文に知らない項目があれば 422", async () => {
    const id = await pending("memberS1", ["deptS"]);
    const res = await approve(id, w.ownerS.token, {
      caseNumber: "QZA-261117-0099",
    });
    expect(res.status).toBe(422);
    expect((await caseRequestRow(id))?.status).toBe("pending");
  });

  it("#146 判定の順(2)→(4): 範囲外のオーナーが無効な候補を足しても、422 でなく 404", async () => {
    const id = await pending("memberS1", ["deptS"]);
    const res = await approve(id, w.ownerH.token, {
      additionalCandidateIds: [w.inactive.id],
    });
    expect(res.status).toBe(404);
  });
});

describe("#146 5-3 AC-7・AC-8・C-141(1)・C-178(U-2) 承認の 409", () => {
  it.each<[string, CaseRequestStatus]>([
    ["取り下げ済み", "withdrawn"],
    ["自動取消", "auto_cancelled"],
    ["承認済み", "approved"],
    ["却下済み", "rejected"],
  ])(
    "#146 5-3 AC-7: %sの申請の承認・却下は 409「この申請はすでに処理されています」",
    async (_label, status) => {
      const id = await pending("memberS1", ["deptS"], { status });
      for (const res of [
        await approve(id, w.ownerS.token),
        await reject(id, w.ownerS.token),
      ]) {
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({
          code: "CONFLICT",
          message: DECIDE_MESSAGES.decided,
        });
      }
    },
  );

  it.each<[string, () => Promise<void>, string]>([
    [
      "担当部署の一部が無効",
      () => setDepartmentActive(w.deptD.id, false),
      DECIDE_MESSAGES.departmentInactive,
    ],
    [
      "取引先が無効",
      () => setClientActive(w.clientA.id, false),
      DECIDE_MESSAGES.clientInactive,
    ],
    [
      "申請の時の候補が無効",
      () => setUserActive(w.memberD1.id, false),
      DECIDE_MESSAGES.candidateInactive,
    ],
    [
      "連番が上限",
      () => setCaseNumberSequence(w.clientA.id, 2026, 9999),
      DECIDE_MESSAGES.numberExhausted,
    ],
  ])(
    "#146 B-5: %sなら承認は 409 で、その文言を返す",
    async (_label, breakIt, message) => {
      const id = await pending("memberS1", ["deptS", "deptD"], {
        candidateIds: [w.memberD1.id],
      });
      await breakIt();
      const res = await approve(id, w.ownerS.token);
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: "CONFLICT", message });
      expect((await caseRequestRow(id))?.status).toBe("pending");
    },
  );

  it("#146 B-5: 同じ案件番号の案件が既にあれば 409「採番が競合しました。もう一度承認してください」", async () => {
    await insertCase({
      clientId: w.clientA.id,
      caseNumber: "QZA-261117-0001",
      title: `${TEST_TAG}既存の案件`,
      createdBy: w.memberS1.id,
    });
    const id = await pending("memberS1", ["deptS"]);
    const res = await approve(id, w.ownerS.token);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: "CONFLICT",
      message: DECIDE_MESSAGES.numberConflict,
    });
  });
});

describe("#146 5-3 AC-6 却下", () => {
  it("#146 5-3 AC-6: 却下は 200 { requestId, status: rejected } で、理由は前後の空白を除いて保存する", async () => {
    const id = await pending("memberS1", ["deptS"]);
    const res = await reject(
      id,
      w.ownerS.token,
      "  [UNIT_TEST]件名を直してください　",
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.json()).toEqual({ requestId: id, status: "rejected" });
    expect((await caseRequestRow(id))?.decision_reason).toBe(
      "[UNIT_TEST]件名を直してください",
    );
  });

  it("#146 5-3 AC-6: 理由が 200 文字ちょうどなら却下できる", async () => {
    const id = await pending("memberS1", ["deptS"]);
    const res = await reject(id, w.ownerS.token, "あ".repeat(200));
    expect(res.status).toBe(200);
  });

  it.each<[string, unknown]>([
    ["空", ""],
    ["空白だけ", "  　 "],
    ["201 文字", "あ".repeat(201)],
    ["文字列でない", 123],
  ])(
    "#146 5-3 AC-6: 理由が%sなら 422 fields: [reason] で、却下されない",
    async (_label, reason) => {
      const id = await pending("memberS1", ["deptS"]);
      const res = await reject(id, w.ownerS.token, reason);
      expect(res.status).toBe(422);
      const error = (await res.json()) as ErrorBody;
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.fields).toEqual(["reason"]);
      expect((await caseRequestRow(id))?.status).toBe("pending");
    },
  );

  it("#146 5-3 AC-6: 理由を省いたら 422、知らない項目があっても 422（strict）", async () => {
    const id = await pending("memberS1", ["deptS"]);
    expect(
      (await post(`${BASE}/${id}/reject`, w.ownerS.token, {})).status,
    ).toBe(422);
    expect(
      (
        await post(`${BASE}/${id}/reject`, w.ownerS.token, {
          reason: "理由",
          extra: 1,
        })
      ).status,
    ).toBe(422);
  });

  it("#146 C-141(1)・C-178(U-2): 担当部署・取引先が無効でも却下できる", async () => {
    const id = await pending("memberS1", ["deptS"]);
    await setDepartmentActive(w.deptS.id, false);
    await setClientActive(w.clientA.id, false);
    const res = await reject(id, w.ownerS.token);
    expect(res.status).toBe(200);
  });
});

describe("#146 3-4 AC-2・AC-3・監査 通知と監査（HTTP 経由）", () => {
  it("#146 3-4 AC-2: 承認・却下の通知は申請者だけに届く（審査者・候補・担当部署のオーナーには届かない）", async () => {
    const a = await pending("memberS1", ["deptS", "deptD"], {
      candidateIds: [w.memberD1.id],
    });
    const b = await pending("memberS2", ["deptS"]);
    expect((await approve(a, w.ownerS.token)).status).toBe(200);
    expect((await reject(b, w.ownerS.token)).status).toBe(200);
    const decided = (await caseRequestNotifications()).filter(
      (n) =>
        n.kind === "case_request.approved" ||
        n.kind === "case_request.rejected",
    );
    expect(decided.map((n) => [n.user_id, n.kind, n.target_id]).sort()).toEqual(
      [
        [w.memberS1.id, "case_request.approved", a],
        [w.memberS2.id, "case_request.rejected", b],
      ].sort(),
    );
  });

  it("#146 3-4 AC-3: 全体管理者が自分の申請を承認・却下しても、自分には通知しない", async () => {
    const a = await pending("admin", ["deptH"]);
    const b = await pending("admin", ["deptH"]);
    expect((await approve(a, w.admin.token)).status).toBe(200);
    expect((await reject(b, w.admin.token)).status).toBe(200);
    expect(
      (await caseRequestNotifications()).filter(
        (n) =>
          n.kind === "case_request.approved" ||
          n.kind === "case_request.rejected",
      ),
    ).toEqual([]);
  });

  it("#146 監査: 承認・却下の監査が1件ずつ残り、件名・理由の本文を含まない。失敗（403・404・409・422）では残らない", async () => {
    const a = await pending("memberS1", ["deptS"], {
      title: `${TEST_TAG}監査の件名`,
    });
    const b = await pending("memberS1", ["deptS"]);
    const c = await pending("memberS1", ["deptS"], { status: "withdrawn" });
    await approve(a, w.ownerS.token);
    await reject(b, w.ownerS.token, "[UNIT_TEST]監査に入れない理由");
    await approve(b, w.ownerH.token);
    await approve(c, w.ownerS.token);
    await reject(a, w.memberS2.token);
    const audits = (await caseRequestAudits()).filter(
      (x) =>
        x.action === "case_request.approve" ||
        x.action === "case_request.reject",
    );
    expect(audits.map((x) => [x.action, x.target_id])).toEqual([
      ["case_request.approve", a],
      ["case_request.reject", b],
    ]);
    for (const x of audits) {
      expect(x.detail ?? "").not.toContain("監査の件名");
      expect(x.detail ?? "").not.toContain("監査に入れない理由");
    }
  });
});

describe("#146 5-3 AC-3・AC-14・S-29 審査一覧（EP-5-03）", () => {
  it("#146 5-3 AC-3: 審査者でない（メンバー）なら 403 FORBIDDEN", async () => {
    const res = await get(BASE, w.memberS1.token);
    expect(res.status).toBe(403);
    expect(((await res.json()) as ErrorBody).code).toBe("FORBIDDEN");
  });

  it("#146 5-3 AC-3・security: オーナーには担当部署のどれかが自分の部署の申請だけが出て、範囲外は limit=1 でページを送っても出ない", async () => {
    const inScope = await pending("memberS1", ["deptS"]);
    const shared = await pending("memberD1", ["deptD", "deptS"]);
    const outOfScope = await pending("memberD1", ["deptD"]);
    const other = await pending("ownerH", ["deptH"]);
    const items = await reviewAll(w.ownerS.token, "", 1);
    const ids = items.map((i) => i.id);
    expect(ids.sort()).toEqual([inScope, shared].sort());
    expect(ids).not.toContain(outOfScope);
    expect(ids).not.toContain(other);
  });

  it("#146 5-3 AC-3: 全体管理者には全部署の申請が出る。並びは ID の降順で、no-store", async () => {
    const ids = [
      await pending("memberS1", ["deptS"]),
      await pending("memberD1", ["deptD"]),
      await pending("ownerH", ["deptH"]),
    ];
    const res = await get(`${BASE}?limit=100`, w.admin.token);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const items = await reviewAll(w.admin.token);
    expect(items.map((i) => i.id)).toEqual([...ids].sort().reverse());
  });

  it("#146 S-29: 状態で絞り込める（status=pending なら承認待ちだけ）", async () => {
    const p = await pending("memberS1", ["deptS"]);
    await pending("memberS1", ["deptS"], { status: "rejected" });
    await pending("memberS1", ["deptS"], { status: "auto_cancelled" });
    const items = await reviewAll(w.ownerS.token, "status=pending");
    expect(items.map((i) => i.id)).toEqual([p]);
    const cancelled = await reviewAll(w.ownerS.token, "status=auto_cancelled");
    expect(cancelled.map((i) => i.status)).toEqual(["auto_cancelled"]);
  });

  it("#146 S-29: status が知らない値・limit が 0 や 101 なら 422", async () => {
    for (const q of ["status=unknown", "limit=0", "limit=101"]) {
      const res = await get(`${BASE}?${q}`, w.ownerS.token);
      expect(res.status).toBe(422);
    }
  });

  it("#146 B-3: 項目は自分の申請の項目に、申請者・候補（isActive つき）・類似件名・canApprove を足したもの", async () => {
    const id = await pending("memberS1", ["deptS"], {
      candidateIds: [w.memberD1.id, w.inactive.id],
    });
    const [item] = await reviewAll(w.ownerS.token, "status=pending");
    expect(item?.id).toBe(id);
    expect(Object.keys(item ?? {}).sort()).toEqual(
      [
        "id",
        "title",
        "description",
        "dueDate",
        "client",
        "departments",
        "candidates",
        "status",
        "rejectReason",
        "caseId",
        "resubmittedFrom",
        "createdAt",
        "decidedAt",
        "requesterId",
        "requesterDisplayName",
        "hasSimilarTitle",
        "canApprove",
      ].sort(),
    );
    expect(item?.requesterId).toBe(w.memberS1.id);
    expect(item?.requesterDisplayName).toEqual(expect.any(String));
    expect(
      [...(item?.candidates ?? [])].map((c) => [c.userId, c.isActive]).sort(),
    ).toEqual(
      [
        [w.memberD1.id, true],
        [w.inactive.id, false],
      ].sort(),
    );
    expect(item?.canApprove).toBe(true);
  });

  it("#146 5-3 AC-4・S-29: canApprove は、オーナー自身の申請と、審査中でない申請では false。全体管理者は自分の申請でも true", async () => {
    const own = await pending("ownerS", ["deptS"]);
    const done = await pending("memberS1", ["deptS"], { status: "rejected" });
    const adminOwn = await pending("admin", ["deptS"]);
    const byOwner = new Map(
      (await reviewAll(w.ownerS.token)).map((i) => [i.id, i.canApprove]),
    );
    expect(byOwner.get(own)).toBe(false);
    expect(byOwner.get(done)).toBe(false);
    expect(byOwner.get(adminOwn)).toBe(true);
    const byAdmin = new Map(
      (await reviewAll(w.admin.token)).map((i) => [i.id, i.canApprove]),
    );
    expect(byAdmin.get(own)).toBe(true);
    expect(byAdmin.get(adminOwn)).toBe(true);
    expect(byAdmin.get(done)).toBe(false);
  });

  it("#146 5-3 AC-14・C-141(3): hasSimilarTitle は自分自身を数えない。同じ取引先の審査中の申請か案件に同じ件名があれば true", async () => {
    const alone = await pending("memberS1", ["deptS"], {
      title: `${TEST_TAG}ひとつだけ`,
    });
    const twinA = await pending("memberS1", ["deptS"], {
      title: `${TEST_TAG}ふたつ`,
    });
    const twinB = await pending("memberS2", ["deptS"], {
      title: `${TEST_TAG}ふたつ`,
    });
    const withCase = await pending("memberS1", ["deptS"], {
      title: `${TEST_TAG}案件と同じ`,
    });
    const otherClient = await pending("memberS1", ["deptS"], {
      title: `${TEST_TAG}案件と同じ`,
      clientId: w.clientB.id,
    });
    await insertCase({
      clientId: w.clientA.id,
      caseNumber: "QZA-261117-0201",
      title: `${TEST_TAG}案件と同じ`,
      createdBy: w.memberS1.id,
      status: "closed",
    });
    const flags = new Map(
      (await reviewAll(w.ownerS.token)).map((i) => [i.id, i.hasSimilarTitle]),
    );
    expect(flags.get(alone)).toBe(false);
    expect(flags.get(twinA)).toBe(true);
    expect(flags.get(twinB)).toBe(true);
    expect(flags.get(withCase)).toBe(true);
    expect(flags.get(otherClient)).toBe(false);
  });
});

describe("#146 5-3 AC-14・C-178(7) 類似件名の確認 API に案件を足す（146-A の API）", () => {
  it("#146 5-3 AC-14: 同じ取引先に同じ件名の案件（進行中）があれば、申請の前の確認で hasSimilar が true", async () => {
    await insertCase({
      clientId: w.clientA.id,
      caseNumber: "QZA-261117-0301",
      title: `${TEST_TAG}既存の案件`,
      createdBy: w.memberS1.id,
    });
    const res = await get(
      `${BASE}/similar-title?clientId=${w.clientA.id}&title=${encodeURIComponent(`${TEST_TAG}既存の案件`)}`,
      w.memberS1.token,
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { hasSimilar: boolean }).hasSimilar).toBe(
      true,
    );
  });
});

describe("#146 5-1 AC-18・5-3 AC-2 自分の申請の一覧に案件番号（146-B）", () => {
  it("#146 5-1 AC-18: 承認された申請は、申請者の自分の申請の一覧で caseNumber に案件番号、承認待ちは null", async () => {
    const approvedId = await pending("memberS1", ["deptS"]);
    const pendingId = await pending("memberS1", ["deptS"]);
    const res = await approve(approvedId, w.ownerS.token);
    const { caseNumber } = (await res.json()) as { caseNumber: string };
    const mine = await get(`${BASE}/mine?limit=100`, w.memberS1.token);
    expect(mine.status).toBe(200);
    const items = (
      (await mine.json()) as {
        items: { id: string; caseNumber: string | null }[];
      }
    ).items;
    const byId = new Map(items.map((i) => [i.id, i.caseNumber]));
    expect(byId.get(approvedId)).toBe(caseNumber);
    expect(caseNumber).toBe("QZA-261117-0001");
    expect(byId.has(pendingId)).toBe(true);
    expect(byId.get(pendingId)).toBeNull();
  });
});
