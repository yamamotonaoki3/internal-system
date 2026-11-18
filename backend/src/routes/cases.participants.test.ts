// #147（147-B）5-1 AC-3・AC-7・AC-11・AC-17・AC-21（Q6）、C-182 Q1・Q2・Q8：参加者の追加（EP-5-09）・削除と本人の退出（EP-5-10）・
// 納期の変更（PATCH /api/cases/:caseId/due-date）と、詳細・概要に足す項目を、実際のアプリ入口（index.ts の app）と隔離 D1 で確かめる。
// この層で確かめるもの（計画 147-B のテストケースの「結合」の行）：判定の順（404 → 403 → 422 → 409）と reason・存在の非開示・本人の退出・
//   最後の有効な参加者・納期の検証（形・今日〔日本時間〕より前・未定に戻す・同じ値）・応答の形・再認証を求めないこと。
// batch の前提が崩れたときに何も残らないこと・監査の中身・同時の操作は、DB のテスト（db/case-participant.repository.db.test.ts）と
// 割り込みのテスト（services/case-participant.interleave.test.ts）で確かめ、ここでは重ねない。
// 判定の順（計画 147-B「API と判定の順」）：
//   追加：認証 → 案件がない（404「案件が見つかりません」）→ 操作者が参加者でない（403「参加者だけが操作できます」）→ authorize(perm.case.participant.edit)
//     → 本文の形（422）→ 対象の社員がない・無効（422。fields ["userId"]。同じ文）→ 終了中（409 closed）→ すでに参加者（409 already_participant）→ 201
//   削除・退出：404 → 403 → authorize → 対象が参加者でない（404「参加者が見つかりません」）→ 409 closed
//     → 自動参加の人（409 auto_participant「担当部署のオーナー・全体管理者は外せません」。本人の退出も）→ 最後の有効な参加者（409 last_active_participant）→ 204
//   納期：404 → 編集できない（403。参加者・担当部署のどれかのオーナー・全体管理者だけ）→ 形・今日より前（422。fields ["dueDate"]）→ 409 closed
//     → 今と同じ値（200。何も書かない）→ 200 { caseId, dueDate }
//   パスの caseId・userId が ULID の形でなければ 422。どれも再認証を求めない（5-1 AC-3、C-122）。
// 契約（実装前の仮置き。実装の担当へ）：
//   409 の本文は { code: "CONFLICT", message, reason }。422 は { code: "VALIDATION_ERROR", message, fields }。
//   詳細の participants[] のキーは、ちょうど userId・displayName・departmentName・isActive・isCreator・autoRole・removable（Q8）。
//     autoRole は "global_admin" | "department_owner" | null（有効で、その時点の割り当て）。removable は、自動参加でなく、外しても有効な参加者が1人以上残ること。
//   概要・一覧の項目に canEditDueDate（真偽）を足す。進行中の案件で、有効な参加者・管理の資格のある人（canManage）は true、ほかは false。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import {
  CASES_BASE,
  CASE_MESSAGES,
  MISSING_CASE_ID,
  addCaseMember,
  cleanupCaseTestData,
  joinedAt,
  seedCase,
  type SeededCase,
} from "../../test/case-fixtures";
import {
  CASE_CONFLICT_REASONS,
  CASE_PARTICIPANT_MESSAGES,
  caseWriteAudits,
  caseWriteRow,
  caseWriteSnapshot,
  participantIdsOf,
  setCaseDueDate,
} from "../../test/case-participant-fixtures";
import {
  CASEREQ_NOW,
  TODAY_JST,
  TOMORROW_JST,
  YESTERDAY_JST,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";

type ErrorBody = {
  code: string;
  message: string;
  fields?: string[];
  reason?: string;
};
type Participant = {
  userId: string;
  autoRole: string | null;
  removable: boolean;
};

const PARTICIPANT_KEYS = [
  "autoRole",
  "departmentName",
  "displayName",
  "isActive",
  "isCreator",
  "removable",
  "userId",
];

let w: CaseWorld;
let logLines: string[];
/** 進行中・deptS 担当：memberS1（作成者）・memberD1・ownerS（自動参加）・inactive（退職者）。納期なし */
let main: SeededCase;
/** 終了・deptS 担当：memberS1・memberD1 */
let closed: SeededCase;
/** 進行中・deptS 担当：memberS1 と inactive（退職者）だけ。有効な参加者は memberS1 の1人 */
let lonely: SeededCase;

const participantsPath = (caseId: string) =>
  `${CASES_BASE}/${caseId}/participants`;
const addTo = (caseId: string, token: string, body: unknown) =>
  apiRequest("POST", participantsPath(caseId), { token, body });
const removeFrom = (caseId: string, userId: string, token: string) =>
  apiRequest("DELETE", `${participantsPath(caseId)}/${userId}`, { token });
const changeDueDate = (caseId: string, token: string, body: unknown) =>
  apiRequest("PATCH", `${CASES_BASE}/${caseId}/due-date`, { token, body });
const detailOf = (caseId: string, token: string) =>
  apiRequest("GET", `${CASES_BASE}/${caseId}/detail`, { token });
const summaryOf = (caseId: string, token: string) =>
  apiRequest("GET", `${CASES_BASE}/${caseId}`, { token });

async function expectError(
  res: Response,
  status: number,
  expected: Partial<ErrorBody>,
) {
  expect(res.status).toBe(status);
  expect(res.headers.get("Cache-Control") ?? "").toContain("no-store");
  expect(await res.json()).toMatchObject(expected);
}

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
  main = await seedCase({
    n: 81,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]147B参加者の管理",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    members: [
      { userId: w.memberS1.id, joinedAt: joinedAt(1) },
      { userId: w.memberD1.id, joinedAt: joinedAt(2) },
      { userId: w.ownerS.id, joinedAt: joinedAt(3) },
      { userId: w.inactive.id, joinedAt: joinedAt(4) },
    ],
  });
  closed = await seedCase({
    n: 82,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]147B終了",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    status: "closed",
    members: [
      { userId: w.memberS1.id, joinedAt: joinedAt(1) },
      { userId: w.memberD1.id, joinedAt: joinedAt(2) },
    ],
  });
  lonely = await seedCase({
    n: 83,
    clientId: w.clientB.id,
    code: "QZB",
    title: "[UNIT_TEST]147B最後の1人",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    members: [
      { userId: w.memberS1.id, joinedAt: joinedAt(1) },
      { userId: w.inactive.id, joinedAt: joinedAt(2) },
    ],
  });
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await cleanupCaseTestData();
});

describe("#147 147-B EP-5-09 参加者の追加", () => {
  it("#147 5-1 AC-3・AC-7: 参加者が社員を追加すると 201 { caseId, userId }。再認証なしで通り、追加された人は詳細を見られる", async () => {
    // sessionFor(id, null) のセッションは再認証していない
    const res = await addTo(main.id, w.memberS1.token, {
      userId: w.memberS2.id,
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("Cache-Control") ?? "").toContain("no-store");
    expect(await res.json()).toMatchObject({
      caseId: main.id,
      userId: w.memberS2.id,
    });
    expect(await participantIdsOf(main.roomId)).toContain(w.memberS2.id);
    expect((await detailOf(main.id, w.memberS2.token)).status).toBe(200);
  });

  it("#147 5-1 AC-3: 案件がなければ 404「案件が見つかりません」（logger.audit に残す）", async () => {
    await expectError(
      await addTo(MISSING_CASE_ID, w.memberS1.token, {
        userId: w.memberS2.id,
      }),
      404,
      { code: "NOT_FOUND", message: CASE_MESSAGES.notFound },
    );
    expect(failureAudits().length).toBeGreaterThan(0);
  });

  it("#147 5-1 AC-3: パスの caseId が ULID の形でなければ 422", async () => {
    await expectError(
      await addTo("not-a-ulid", w.memberS1.token, { userId: w.memberS2.id }),
      422,
      { code: "VALIDATION_ERROR" },
    );
  });

  it("#147 5-1 AC-3: 未認証は 401", async () => {
    const res = await apiRequest("POST", participantsPath(main.id), {
      token: null,
      body: { userId: w.memberS2.id },
    });
    expect(res.status).toBe(401);
  });

  it.each([
    { label: "一般の非参加者", actor: () => w.memberS2 },
    { label: "参加していない全体管理者", actor: () => w.admin },
    { label: "参加していない他部署のオーナー", actor: () => w.ownerD },
  ])(
    "#147 5-1 AC-3: $label は 403「参加者だけが操作できます」で、何も書かない",
    async ({ actor }) => {
      const before = await caseWriteSnapshot();
      await expectError(
        await addTo(main.id, actor().token, { userId: w.noDept.id }),
        403,
        {
          code: "FORBIDDEN",
          message: CASE_PARTICIPANT_MESSAGES.participantsOnly,
        },
      );
      expect(await caseWriteSnapshot()).toEqual(before);
      expect(failureAudits().length).toBeGreaterThan(0);
    },
  );

  it("#147 存在の非開示: 非参加者には、対象がいない・無効・すでに参加者・本文の形の誤り・終了中のどれでも、同じ 403 を返す", async () => {
    const token = w.memberS2.token;
    const responses = [
      await addTo(main.id, token, { userId: w.noDept.id }),
      await addTo(main.id, token, { userId: MISSING_CASE_ID }),
      await addTo(main.id, token, { userId: w.inactive.id }),
      await addTo(main.id, token, { userId: w.memberD1.id }),
      await addTo(main.id, token, { userId: "x" }),
      await addTo(main.id, token, {}),
      await addTo(closed.id, token, { userId: w.noDept.id }),
    ];
    const bodies: unknown[] = [];
    for (const res of responses) {
      expect(res.status).toBe(403);
      bodies.push(await res.json());
    }
    for (const body of bodies) expect(body).toEqual(bodies[0]);
  });

  it.each([
    { label: "本文が空", body: () => ({}) },
    { label: "userId が ULID の形でない", body: () => ({ userId: "x" }) },
    { label: "userId が文字列でない", body: () => ({ userId: 1 }) },
    {
      label: "知らない項目がある（strict）",
      body: () => ({ userId: w.memberS2.id, role: "owner" }),
    },
  ])(
    "#147 5-1 AC-3: 参加者が送った本文の $label なら 422（fields に userId を含むか、形の誤り）",
    async ({ body }) => {
      const res = await addTo(main.id, w.memberS1.token, body());
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ code: "VALIDATION_ERROR" });
    },
  );

  it("#147 5-1 AC-3: 対象の社員がいない・無効なら 422（fields に userId）で、2つの文言は同じ", async () => {
    const missing = await addTo(main.id, w.memberS1.token, {
      userId: MISSING_CASE_ID,
    });
    const inactive = await addTo(main.id, w.memberS1.token, {
      userId: w.inactive.id,
    });
    expect(missing.status).toBe(422);
    expect(inactive.status).toBe(422);
    const a = (await missing.json()) as ErrorBody;
    const b = (await inactive.json()) as ErrorBody;
    expect(a).toMatchObject({ code: "VALIDATION_ERROR", fields: ["userId"] });
    expect(b).toEqual(a);
  });

  it("#147 5-1 AC-11: 終了中の案件は 409 closed で、何も書かない", async () => {
    const before = await caseWriteSnapshot();
    await expectError(
      await addTo(closed.id, w.memberS1.token, { userId: w.memberS2.id }),
      409,
      { code: "CONFLICT", reason: CASE_CONFLICT_REASONS.closed },
    );
    expect(await caseWriteSnapshot()).toEqual(before);
  });

  it("#147 判定の順: 終了中でも、対象が無効なら 422 が先", async () => {
    await expectError(
      await addTo(closed.id, w.memberS1.token, { userId: w.inactive.id }),
      422,
      { code: "VALIDATION_ERROR", fields: ["userId"] },
    );
  });

  it("#147 5-1 AC-3: すでに参加者なら 409 already_participant", async () => {
    await expectError(
      await addTo(main.id, w.memberS1.token, { userId: w.memberD1.id }),
      409,
      { code: "CONFLICT", reason: CASE_CONFLICT_REASONS.alreadyParticipant },
    );
  });

  it("#147 判定の順: 終了中で、対象がすでに参加者なら 409 closed が先", async () => {
    await expectError(
      await addTo(closed.id, w.memberS1.token, { userId: w.memberD1.id }),
      409,
      { reason: CASE_CONFLICT_REASONS.closed },
    );
  });

  it("#147 147-C-1: 無効になった操作者（参加の行は残る）は追加できない（セッションが失効して 401、または 403）", async () => {
    await env.DB.prepare("UPDATE users SET is_active = 0 WHERE id = ?")
      .bind(w.memberD1.id)
      .run();
    const res = await addTo(main.id, w.memberD1.token, {
      userId: w.memberS2.id,
    });
    expect([401, 403]).toContain(res.status);
    expect(await participantIdsOf(main.roomId)).not.toContain(w.memberS2.id);
  });
});

describe("#147 147-B EP-5-10 参加者の削除・本人の退出", () => {
  it("#147 5-1 AC-3・AC-7: 参加者が別の参加者を外すと 204（本文なし）。外された人は詳細が 403 になり、概要は見られる", async () => {
    const res = await removeFrom(main.id, w.memberD1.id, w.memberS1.token);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(await participantIdsOf(main.roomId)).not.toContain(w.memberD1.id);
    const detail = await detailOf(main.id, w.memberD1.token);
    expect(detail.status).toBe(403);
    const summary = await summaryOf(main.id, w.memberD1.token);
    expect(summary.status).toBe(200);
    expect(await summary.json()).toMatchObject({ isParticipant: false });
  });

  it("#147 5-1 AC-3: 本人は退出できる（204）", async () => {
    const res = await removeFrom(main.id, w.memberD1.id, w.memberD1.token);
    expect(res.status).toBe(204);
    expect(await participantIdsOf(main.roomId)).not.toContain(w.memberD1.id);
  });

  it("#147 C-142(1): 退職者（無効な社員）の参加の行も外せる（204）", async () => {
    const res = await removeFrom(main.id, w.inactive.id, w.memberS1.token);
    expect(res.status).toBe(204);
  });

  it("#147 5-1 AC-3: 案件がなければ 404「案件が見つかりません」", async () => {
    await expectError(
      await removeFrom(MISSING_CASE_ID, w.memberD1.id, w.memberS1.token),
      404,
      { code: "NOT_FOUND", message: CASE_MESSAGES.notFound },
    );
  });

  it.each([
    {
      label: "caseId",
      path: () => `${participantsPath("x")}/${w.memberD1.id}`,
    },
    { label: "userId", path: () => `${participantsPath(main.id)}/x` },
  ])(
    "#147 5-1 AC-3: パスの $label が ULID の形でなければ 422",
    async ({ path }) => {
      const res = await apiRequest("DELETE", path(), {
        token: w.memberS1.token,
      });
      expect(res.status).toBe(422);
    },
  );

  it("#147 存在の非開示: 非参加者には、対象が参加者でも、参加者でなくても、いなくても、同じ 403「参加者だけが操作できます」", async () => {
    const token = w.memberS2.token;
    const responses = [
      await removeFrom(main.id, w.memberD1.id, token),
      await removeFrom(main.id, w.noDept.id, token),
      await removeFrom(main.id, MISSING_CASE_ID, token),
      await removeFrom(main.id, w.ownerS.id, token),
      await removeFrom(main.id, w.memberS2.id, token),
    ];
    const bodies: unknown[] = [];
    for (const res of responses) {
      expect(res.status).toBe(403);
      bodies.push(await res.json());
    }
    expect(bodies[0]).toMatchObject({
      code: "FORBIDDEN",
      message: CASE_PARTICIPANT_MESSAGES.participantsOnly,
    });
    for (const body of bodies) expect(body).toEqual(bodies[0]);
    expect(await participantIdsOf(main.roomId)).toContain(w.memberD1.id);
  });

  it("#147 5-1 AC-3: 参加していない全体管理者・担当部署のオーナーも、外す操作は 403（管理の資格は参加者の変更の資格でない）", async () => {
    await expectError(
      await removeFrom(lonely.id, w.inactive.id, w.admin.token),
      403,
      { code: "FORBIDDEN" },
    );
    await expectError(
      await removeFrom(lonely.id, w.inactive.id, w.ownerS.token),
      403,
      { code: "FORBIDDEN" },
    );
  });

  it("#147 5-1 AC-3: 対象が参加者でなければ 404「参加者が見つかりません」", async () => {
    await expectError(
      await removeFrom(main.id, w.memberS2.id, w.memberS1.token),
      404,
      {
        code: "NOT_FOUND",
        message: CASE_PARTICIPANT_MESSAGES.participantNotFound,
      },
    );
  });

  it("#147 5-1 AC-11: 終了中の案件は 409 closed（本人の退出も）で、何も変えない", async () => {
    const before = await caseWriteSnapshot();
    await expectError(
      await removeFrom(closed.id, w.memberD1.id, w.memberS1.token),
      409,
      { code: "CONFLICT", reason: CASE_CONFLICT_REASONS.closed },
    );
    await expectError(
      await removeFrom(closed.id, w.memberD1.id, w.memberD1.token),
      409,
      { reason: CASE_CONFLICT_REASONS.closed },
    );
    expect(await caseWriteSnapshot()).toEqual(before);
  });

  it("#147 判定の順: 終了中でも、対象が参加者でなければ 404 が先", async () => {
    await expectError(
      await removeFrom(closed.id, w.memberS2.id, w.memberS1.token),
      404,
      { message: CASE_PARTICIPANT_MESSAGES.participantNotFound },
    );
  });

  it("#147 C-133・Q2: 担当部署のオーナー（自動参加）は、ほかの人も本人も外せない（409 auto_participant）", async () => {
    for (const token of [w.memberS1.token, w.ownerS.token])
      await expectError(await removeFrom(main.id, w.ownerS.id, token), 409, {
        code: "CONFLICT",
        reason: CASE_CONFLICT_REASONS.autoParticipant,
        message: CASE_PARTICIPANT_MESSAGES.autoParticipant,
      });
    expect(await participantIdsOf(main.roomId)).toContain(w.ownerS.id);
  });

  it("#147 C-134・Q2: 全体管理者（自動参加）は、ほかの人も本人も外せない（409 auto_participant）", async () => {
    await addCaseMember(main.roomId, w.admin.id);
    for (const token of [w.memberS1.token, w.admin.token])
      await expectError(await removeFrom(main.id, w.admin.id, token), 409, {
        reason: CASE_CONFLICT_REASONS.autoParticipant,
      });
  });

  it("#147 判定の順: 終了中の案件で自動参加の人を外そうとすると 409 closed が先", async () => {
    await addCaseMember(closed.roomId, w.ownerS.id);
    await expectError(
      await removeFrom(closed.id, w.ownerS.id, w.memberS1.token),
      409,
      { reason: CASE_CONFLICT_REASONS.closed },
    );
  });

  it("#147 Q1: 最後の有効な参加者は、退出できない（409 last_active_participant。退職者の行は数えない）", async () => {
    const before = await caseWriteSnapshot();
    await expectError(
      await removeFrom(lonely.id, w.memberS1.id, w.memberS1.token),
      409,
      { code: "CONFLICT", reason: CASE_CONFLICT_REASONS.lastActiveParticipant },
    );
    expect(await caseWriteSnapshot()).toEqual(before);
  });
});

describe("#147 147-B 納期の変更（PATCH /api/cases/:caseId/due-date）", () => {
  it("#147 5-1 AC-17: 参加者が納期を変えると 200 { caseId, dueDate }。再認証なしで通り、概要に反映される", async () => {
    const res = await changeDueDate(main.id, w.memberD1.token, {
      dueDate: TOMORROW_JST,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control") ?? "").toContain("no-store");
    expect(await res.json()).toEqual({
      caseId: main.id,
      dueDate: TOMORROW_JST,
    });
    const summary = await summaryOf(main.id, w.memberS2.token);
    expect(await summary.json()).toMatchObject({ dueDate: TOMORROW_JST });
  });

  it("#147 5-1 AC-17: 今日（日本時間）は設定できる", async () => {
    const res = await changeDueDate(main.id, w.memberS1.token, {
      dueDate: TODAY_JST,
    });
    expect(res.status).toBe(200);
  });

  it("#147 5-1 AC-17: null で未定に戻せる（200 { caseId, dueDate: null }）", async () => {
    await setCaseDueDate(main.id, "2026-12-01");
    const res = await changeDueDate(main.id, w.memberS1.token, {
      dueDate: null,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ caseId: main.id, dueDate: null });
    expect((await caseWriteRow(main.id)).due_date).toBeNull();
  });

  it.each([
    { label: "参加していない担当部署のオーナー", actor: () => w.ownerS },
    { label: "参加していない全体管理者", actor: () => w.admin },
  ])(
    "#147 5-1 AC-21（Q6）・AC-17: $label は納期を変えられる（200）",
    async ({ actor }) => {
      const res = await changeDueDate(lonely.id, actor().token, {
        dueDate: TOMORROW_JST,
      });
      expect(res.status).toBe(200);
      expect((await caseWriteRow(lonely.id)).due_date).toBe(TOMORROW_JST);
    },
  );

  it.each([
    { label: "一般の非参加者", actor: () => w.memberS2 },
    { label: "参加していない他部署のオーナー", actor: () => w.ownerD },
  ])(
    "#147 5-1 AC-17・AC-21: $label は 403 で、何も書かない",
    async ({ actor }) => {
      const before = await caseWriteSnapshot();
      await expectError(
        await changeDueDate(lonely.id, actor().token, {
          dueDate: TOMORROW_JST,
        }),
        403,
        { code: "FORBIDDEN" },
      );
      expect(await caseWriteSnapshot()).toEqual(before);
    },
  );

  it("#147 5-1 AC-17: 案件がなければ 404", async () => {
    await expectError(
      await changeDueDate(MISSING_CASE_ID, w.memberS1.token, {
        dueDate: TOMORROW_JST,
      }),
      404,
      { code: "NOT_FOUND", message: CASE_MESSAGES.notFound },
    );
  });

  it("#147 判定の順: 編集できない人が形の誤った納期を送っても 403 が先", async () => {
    await expectError(
      await changeDueDate(lonely.id, w.memberS2.token, {
        dueDate: YESTERDAY_JST,
      }),
      403,
      { code: "FORBIDDEN" },
    );
  });

  it.each([
    { label: "今日（日本時間）より前", body: { dueDate: YESTERDAY_JST } },
    { label: "実在しない日付", body: { dueDate: "2026-02-30" } },
    { label: "YYYY-MM-DD でない形", body: { dueDate: "2026/12/01" } },
    { label: "時刻つき", body: { dueDate: "2026-12-01T00:00:00Z" } },
    { label: "文字列でない", body: { dueDate: 20261201 } },
    { label: "dueDate がない", body: {} },
    {
      label: "知らない項目がある（strict）",
      body: { dueDate: TOMORROW_JST, title: "x" },
    },
  ])("#147 5-1 AC-17: $label なら 422 で、何も書かない", async ({ body }) => {
    const before = await caseWriteSnapshot();
    const res = await changeDueDate(main.id, w.memberS1.token, body);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await caseWriteSnapshot()).toEqual(before);
  });

  it("#147 5-1 AC-17: 今日より前・実在しない日付の 422 は fields に dueDate を持つ", async () => {
    for (const dueDate of [YESTERDAY_JST, "2026-02-30"]) {
      const res = await changeDueDate(main.id, w.memberS1.token, { dueDate });
      expect(await res.json()).toMatchObject({ fields: ["dueDate"] });
    }
  });

  it("#147 5-1 AC-11: 終了中の案件は 409 closed", async () => {
    await expectError(
      await changeDueDate(closed.id, w.memberS1.token, {
        dueDate: TOMORROW_JST,
      }),
      409,
      { code: "CONFLICT", reason: CASE_CONFLICT_REASONS.closed },
    );
  });

  it("#147 判定の順: 終了中でも、今日より前の日付なら 422 が先", async () => {
    await expectError(
      await changeDueDate(closed.id, w.memberS1.token, {
        dueDate: YESTERDAY_JST,
      }),
      422,
      { code: "VALIDATION_ERROR" },
    );
  });

  it("#147 5-1 AC-17: 今と同じ値なら 200 で、版・監査を変えない（null → null も）", async () => {
    await setCaseDueDate(main.id, "2026-12-01");
    const before = await caseWriteSnapshot();
    const same = await changeDueDate(main.id, w.memberS1.token, {
      dueDate: "2026-12-01",
    });
    expect(same.status).toBe(200);
    expect(await same.json()).toEqual({
      caseId: main.id,
      dueDate: "2026-12-01",
    });
    expect(await caseWriteSnapshot()).toEqual(before);

    const none = await changeDueDate(lonely.id, w.memberS1.token, {
      dueDate: null,
    });
    expect(none.status).toBe(200);
    expect(await caseWriteSnapshot()).toEqual(before);
    expect(await caseWriteAudits()).toEqual([]);
  });
});

describe("#147 147-B Q8: 詳細の参加者の autoRole・removable と、概要の canEditDueDate", () => {
  const participantsOf = async (caseId: string, token: string) => {
    const res = await detailOf(caseId, token);
    expect(res.status).toBe(200);
    return ((await res.json()) as { participants: Participant[] }).participants;
  };
  const byUser = (participants: Participant[], userId: string) => {
    const found = participants.find((p) => p.userId === userId);
    if (found === undefined) throw new Error(`${userId} がいません`);
    return found;
  };

  it("#147 Q8: 参加者の項目のキーは、ちょうど userId・displayName・departmentName・isActive・isCreator・autoRole・removable", async () => {
    const participants = await participantsOf(main.id, w.memberS1.token);
    expect(participants.length).toBeGreaterThan(0);
    for (const p of participants)
      expect(Object.keys(p).sort()).toEqual(PARTICIPANT_KEYS);
  });

  it("#147 Q8・C-133・C-134: 担当部署のオーナーは department_owner、全体管理者は global_admin で、どちらも removable が false。一般の人・退職者は null で true", async () => {
    await addCaseMember(main.roomId, w.admin.id, joinedAt(5));
    const participants = await participantsOf(main.id, w.memberS1.token);
    expect(byUser(participants, w.ownerS.id)).toMatchObject({
      autoRole: "department_owner",
      removable: false,
    });
    expect(byUser(participants, w.admin.id)).toMatchObject({
      autoRole: "global_admin",
      removable: false,
    });
    for (const id of [w.memberS1.id, w.memberD1.id, w.inactive.id])
      expect(byUser(participants, id)).toMatchObject({
        autoRole: null,
        removable: true,
      });
  });

  it("#147 Q1: 有効な参加者が1人だけなら、その人の removable は false（退職者の行は true）", async () => {
    const participants = await participantsOf(lonely.id, w.memberS1.token);
    expect(byUser(participants, w.memberS1.id)).toMatchObject({
      autoRole: null,
      removable: false,
    });
    expect(byUser(participants, w.inactive.id).removable).toBe(true);
  });

  it("#147 C-133: 他部署（担当部署でない）のオーナーは autoRole が null で、外せる", async () => {
    await addCaseMember(main.roomId, w.ownerD.id, joinedAt(6));
    const participants = await participantsOf(main.id, w.memberS1.token);
    expect(byUser(participants, w.ownerD.id)).toMatchObject({
      autoRole: null,
      removable: true,
    });
  });

  it.each([
    { label: "参加者", actor: () => w.memberS1, expected: true },
    {
      label: "参加していない担当部署のオーナー",
      actor: () => w.ownerS,
      expected: true,
    },
    { label: "参加していない全体管理者", actor: () => w.admin, expected: true },
    {
      label: "参加していない他部署のオーナー",
      actor: () => w.ownerD,
      expected: false,
    },
    { label: "一般の非参加者", actor: () => w.memberS2, expected: false },
  ])(
    "#147 5-1 AC-17・AC-21（Q6）: 進行中の案件の概要の canEditDueDate は、$label なら $expected",
    async ({ actor, expected }) => {
      const res = await summaryOf(lonely.id, actor().token);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ canEditDueDate: expected });
    },
  );

  it("#147 5-1 AC-17: 一覧の項目にも canEditDueDate がある", async () => {
    const res = await apiRequest(
      "GET",
      `${CASES_BASE}?scope=all&status=active`,
      { token: w.memberS2.token },
    );
    const page = (await res.json()) as {
      items: { canEditDueDate?: unknown }[];
    };
    expect(page.items.length).toBeGreaterThan(0);
    for (const item of page.items)
      expect(typeof item.canEditDueDate).toBe("boolean");
  });
});
