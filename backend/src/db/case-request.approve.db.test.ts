// #146（146-B）5-3 AC-2・AC-4・AC-5・AC-6・AC-7・AC-8・AC-9・AC-14、5-1 AC-6・AC-7・AC-18、C-117・C-133・C-134・C-141(1)・C-178(U-1)(U-2)：
// 案件の作成申請の承認・却下の Repository を、マイグレーション済みの D1（Miniflare）で確かめる。
// この層で確かめるもの（計画 1.3・B-7・突き合わせの表 146-B）：承認の batch の中身と順・採番（形・取引先ごと・年ごと・同時実行・上限・一意）・
// 前提の崩れ（各理由で何も残らない）・最初の判定の後の資格の変化・却下の batch・類似件名の比較に案件が入ること。
// 判定の順・応答の形・通知の宛先の HTTP は結合のテスト（routes/case-requests.decide.test.ts）で確かめ、ここでは重ねない。
// 判定と書き込みの間の変化は、Service を通さずに「読んだときの版」を渡したまま DB を変えてから approve・reject を呼んで作る。
// 契約（実装前の仮置き。計画 B-2・B-5・突き合わせの表。実装の担当へ）：
//   withCaseRequests(env, (repository) => …)
//   repository.approve({ requestId, version, deciderId, additionalCandidateIds, now, traceId })
//     : Promise<{ caseId: string; caseNumber: string; roomId: string }>。1回の db.batch（計画 B-5 の 1〜13 の順）。
//     now は ISO 文字列。案件番号の YYMMDD と連番の年（case_number_sequences.year。西暦4桁の整数）は now の日本時間で決める。
//   repository.reject({ requestId, version, deciderId, reason, now, traceId }): Promise<void>。1回の db.batch。reason は前後の空白を除いた後の値。
//   失敗は CaseRequestWriteError（reason）で、何も残さない（batch 全体が取り消される）：
//     decided（guardPending。決裁済み・取り下げ・自動取消・版の違い。最優先）・reviewer_ineligible（決裁者の資格・自己承認の禁止。申請の requested_by を NULL）・
//     department_inactive（departments.version）・client_inactive（clients.version）・candidate_inactive（申請の候補が無効）・
//     added_candidate_unavailable（承認者がいま足した候補が存在しない・無効）・number_exhausted（case_number_sequences の CHECK）・
//     number_conflict（cases.case_number の UNIQUE）
// 監査：case_request.approve・case_request.reject（target_type: case_request、target_id: 申請 ID）。件名・説明・理由の本文は入れない。
// 通知：case_request.approved・case_request.rejected（target_id: 申請 ID）を申請者へ。決裁者が申請者なら送らない。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com。取引先のコードは QZA・QZB）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CASE_NUMBER_PATTERN,
  approvalSnapshot,
  caseDepartmentIds,
  caseNumberSequence,
  caseOfRequest,
  channelOf,
  cleanupCaseApprovalTestData,
  deleteCaseRow,
  insertCase,
  memberIdsOf,
  setCaseNumberSequence,
} from "../../test/case-approval-fixtures";
import {
  CASEREQ_NOW,
  TEST_TAG,
  caseRequestAudits,
  caseRequestNotifications,
  caseRequestRow,
  casereqTraceId,
  detailKeys,
  failAuditOf,
  failNotificationInsert,
  insertCaseRequest,
  removeGlobalAdmin,
  removeOwner,
  requestCandidates,
  setClientActive,
  setDepartmentActive,
  setUserActive,
  setupCaseWorld,
  type CaseRequestStatus,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import { insertChannel, makeOwner } from "../../test/department-fixtures";
import {
  CaseRequestWriteError,
  withCaseRequests,
} from "./case-request.repository";

let w: CaseWorld;
/** 日本時間 2026-11-17 の案件番号の日付の部分 */
const TODAY_PART = "261117";
/** 存在しない社員の ID（ULID の形） */
const MISSING_USER = "01KZZZZZZZZZZZZZZZZZZZZZZZ";

type ApproveOverrides = Partial<{
  version: number;
  deciderId: string;
  additionalCandidateIds: string[];
  now: string;
}>;

const approve = (requestId: string, overrides: ApproveOverrides = {}) =>
  withCaseRequests(env, (repository) =>
    repository.approve({
      requestId,
      version: 1,
      deciderId: w.ownerS.id,
      additionalCandidateIds: [],
      now: CASEREQ_NOW,
      traceId: casereqTraceId(),
      ...overrides,
    }),
  );

const reject = (
  requestId: string,
  overrides: Partial<{
    version: number;
    deciderId: string;
    reason: string;
  }> = {},
) =>
  withCaseRequests(env, (repository) =>
    repository.reject({
      requestId,
      version: 1,
      deciderId: w.ownerS.id,
      reason: "[UNIT_TEST]却下の理由",
      now: CASEREQ_NOW,
      traceId: casereqTraceId(),
      ...overrides,
    }),
  );

let titleSeq = 0;
/** 審査中の申請（既定：memberS1 が deptS・clientA で申請） */
async function pending(
  overrides: Partial<{
    requestedBy: string;
    clientId: string;
    departmentIds: string[];
    candidateIds: string[];
    status: CaseRequestStatus;
    title: string;
  }> = {},
) {
  titleSeq += 1;
  return insertCaseRequest({
    clientId: w.clientA.id,
    title: `${TEST_TAG}承認${titleSeq}`,
    requestedBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    description: "[UNIT_TEST]説明",
    dueDate: "2026-12-01",
    ...overrides,
  });
}

async function expectWriteError(
  run: Promise<unknown>,
  reason: string,
): Promise<void> {
  const error = await run.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(CaseRequestWriteError);
  expect((error as CaseRequestWriteError).reason).toBe(reason);
}

/** 失敗した操作が、何も残さないこと（操作の前と完全に同じ） */
async function expectNothingChanged(
  run: () => Promise<unknown>,
  reason: string,
) {
  const before = await approvalSnapshot();
  await expectWriteError(run(), reason);
  expect(await approvalSnapshot()).toEqual(before);
}

beforeEach(async () => {
  w = await setupCaseWorld();
});

afterEach(async () => {
  await cleanupCaseApprovalTestData();
});

describe("#146 5-3 AC-2・5-1 AC-6・AC-7・C-133・C-134 承認の batch（案件・専用チャンネル・自動参加）", () => {
  it("#146 5-3 AC-2・5-1 AC-6: 承認すると、案件1行と、非公開の案件専用チャンネル1つ（部署なし・名前は案件番号）ができ、申請が approved になる", async () => {
    const requestId = await pending({
      departmentIds: [w.deptS.id, w.deptD.id],
    });
    const result = await approve(requestId);

    expect(result.caseNumber).toBe(`QZA-${TODAY_PART}-0001`);
    const created = await caseOfRequest(requestId);
    expect(created).toMatchObject({
      id: result.caseId,
      case_number: result.caseNumber,
      number_client_id: w.clientA.id,
      client_id: w.clientA.id,
      channel_id: result.roomId,
      request_id: requestId,
      title: expect.stringContaining(TEST_TAG),
      description: "[UNIT_TEST]説明",
      due_date: "2026-12-01",
      status: "active",
      approved_by: w.ownerS.id,
    });
    expect(await caseDepartmentIds(result.caseId)).toEqual(
      [w.deptS.id, w.deptD.id].sort(),
    );
    expect(await channelOf(result.roomId)).toEqual({
      room_id: result.roomId,
      department_id: null,
      name: result.caseNumber,
      name_normalized: `case:${result.caseNumber.toLowerCase()}`,
      visibility: "private",
      purpose: "case",
    });
    expect(await caseRequestRow(requestId)).toMatchObject({
      status: "approved",
      case_id: result.caseId,
      decided_by: w.ownerS.id,
      decided_at: CASEREQ_NOW,
      decision_reason: null,
    });
    expect(await caseNumberSequence(w.clientA.id, 2026)).toBe(1);
  });

  it("#146 5-1 AC-7・C-133・C-134: 参加者は、申請者・候補・全担当部署の有効なオーナー・有効な全体管理者で、重複がない（他部署のオーナー・同じ部署のメンバーは入らない）", async () => {
    const requestId = await pending({
      departmentIds: [w.deptS.id, w.deptD.id],
      candidateIds: [w.memberD1.id],
    });
    const { roomId } = await approve(requestId);
    expect(await memberIdsOf(roomId)).toEqual(
      [
        w.memberS1.id,
        w.memberD1.id,
        w.ownerS.id,
        w.ownerD.id,
        w.admin.id,
      ].sort(),
    );
  });

  it("#146 5-1 AC-7: 候補が担当部署のオーナーを兼ねていても、参加の行は1つだけ", async () => {
    const requestId = await pending({
      departmentIds: [w.deptS.id, w.deptD.id],
      candidateIds: [w.ownerD.id],
    });
    const { roomId } = await approve(requestId);
    const members = await memberIdsOf(roomId);
    expect(members.filter((id) => id === w.ownerD.id)).toHaveLength(1);
    expect(new Set(members).size).toBe(members.length);
  });

  it("#146 5-1 AC-7・C-134: 無効な社員（担当部署のオーナーが無効）は参加者に入らない。全体管理者がいなければ全体管理者は入らない", async () => {
    await setUserActive(w.ownerD.id, false);
    await removeGlobalAdmin(w.admin.id);
    const requestId = await pending({
      departmentIds: [w.deptS.id, w.deptD.id],
    });
    const { roomId } = await approve(requestId);
    expect(await memberIdsOf(roomId)).toEqual(
      [w.memberS1.id, w.ownerS.id].sort(),
    );
  });

  it("#146 5-3 AC-5: 承認者が足した候補は、申請の候補に added_by=承認者 で入り、参加者にも入る", async () => {
    const requestId = await pending({ candidateIds: [w.memberD1.id] });
    const { roomId } = await approve(requestId, {
      additionalCandidateIds: [w.memberS2.id],
    });
    expect(await requestCandidates(requestId)).toEqual(
      [
        { user_id: w.memberD1.id, added_by: w.memberS1.id },
        { user_id: w.memberS2.id, added_by: w.ownerS.id },
      ].sort((a, b) => a.user_id.localeCompare(b.user_id)),
    );
    expect(await memberIdsOf(roomId)).toContain(w.memberS2.id);
  });

  it("#146 5-3 AC-5: 承認者が足す候補が無効・存在しないなら added_candidate_unavailable で、何も残らない", async () => {
    const requestId = await pending();
    await expectNothingChanged(
      () => approve(requestId, { additionalCandidateIds: [w.inactive.id] }),
      "added_candidate_unavailable",
    );
    await expectNothingChanged(
      () => approve(requestId, { additionalCandidateIds: [MISSING_USER] }),
      "added_candidate_unavailable",
    );
  });

  it("#146 監査・3-4 AC-2: 承認で、監査 case_request.approve が1件（件名・説明の本文なし）、申請者へ通知 case_request.approved が1件残る", async () => {
    const requestId = await pending({
      departmentIds: [w.deptS.id, w.deptD.id],
      candidateIds: [w.memberD1.id],
    });
    const result = await approve(requestId);
    const audits = (await caseRequestAudits()).filter(
      (a) => a.action === "case_request.approve",
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_id: w.ownerS.id,
      target_type: "case_request",
      target_id: requestId,
      result: "success",
    });
    expect(detailKeys(audits[0]?.detail ?? null)).toEqual(
      expect.arrayContaining([
        "requestId",
        "caseId",
        "caseNumber",
        "channelId",
        "departmentCount",
        "participantCount",
      ]),
    );
    const detail = JSON.parse(audits[0]?.detail ?? "{}") as Record<
      string,
      unknown
    >;
    expect(detail).toMatchObject({
      requestId,
      caseId: result.caseId,
      caseNumber: result.caseNumber,
      channelId: result.roomId,
      departmentCount: 2,
      participantCount: 5,
    });
    expect(audits[0]?.detail ?? "").not.toContain(TEST_TAG);
    expect(audits[0]?.detail ?? "").not.toContain("[UNIT_TEST]説明");
    expect(
      (await caseRequestNotifications()).filter(
        (n) => n.kind === "case_request.approved",
      ),
    ).toEqual([
      expect.objectContaining({
        user_id: w.memberS1.id,
        kind: "case_request.approved",
        target_id: requestId,
      }),
    ]);
  });

  it("#146 3-4 AC-3: 全体管理者が自分の申請を承認すると、承認の通知は送らない", async () => {
    const requestId = await pending({
      requestedBy: w.admin.id,
      departmentIds: [w.deptH.id],
    });
    await approve(requestId, { deciderId: w.admin.id });
    expect(
      (await caseRequestNotifications()).filter(
        (n) => n.kind === "case_request.approved",
      ),
    ).toEqual([]);
  });

  it("#146 原子性: 監査の書き込みが失敗したら、案件・チャンネル・参加・連番・申請の更新・通知のどれも残らない", async () => {
    const requestId = await pending();
    await failAuditOf("case_request.approve");
    const before = await approvalSnapshot();
    await expect(approve(requestId)).rejects.toThrow();
    expect(await approvalSnapshot()).toEqual(before);
  });

  it("#146 原子性: 通知の書き込みが失敗したら、何も残らない", async () => {
    const requestId = await pending();
    await failNotificationInsert();
    const before = await approvalSnapshot();
    await expect(approve(requestId)).rejects.toThrow();
    expect(await approvalSnapshot()).toEqual(before);
  });
});

describe("#146 統括の決定 cases.created_by", () => {
  it("#146 統括の決定: cases.created_by は申請者、approved_by は承認者", async () => {
    const requestId = await pending();
    await approve(requestId, { deciderId: w.ownerS.id });
    expect(await caseOfRequest(requestId)).toMatchObject({
      created_by: w.memberS1.id,
      approved_by: w.ownerS.id,
    });
  });
});

describe("#146 統括の決定 案件専用チャンネルの created_by", () => {
  it("#146 統括の決定: 承認で作られた案件専用チャンネルの created_by は申請者（チャンネルの作成申請の承認と同じ）", async () => {
    const requestId = await pending();
    const { roomId } = await approve(requestId);
    const row = await env.DB.prepare(
      "SELECT created_by FROM channels WHERE room_id = ?",
    )
      .bind(roomId)
      .first<{ created_by: string | null }>();
    expect(row?.created_by).toBe(w.memberS1.id);
  });
});

describe("#146 5-1 AC-18・C-117 採番", () => {
  it("#146 5-1 AC-18: 同じ取引先・同じ日の承認は 0001・0002 と続き、別の取引先は 0001 から", async () => {
    const first = await approve(await pending());
    const second = await approve(await pending());
    const other = await approve(await pending({ clientId: w.clientB.id }));
    expect([first.caseNumber, second.caseNumber, other.caseNumber]).toEqual([
      `QZA-${TODAY_PART}-0001`,
      `QZA-${TODAY_PART}-0002`,
      `QZB-${TODAY_PART}-0001`,
    ]);
    for (const n of [first, second, other])
      expect(n.caseNumber).toMatch(CASE_NUMBER_PATTERN);
  });

  it("#146 5-1 AC-18: 日付は日本時間の承認日（UTC 15:00 の後は翌日）。年が変わると連番は 0001 から", async () => {
    await setCaseNumberSequence(w.clientA.id, 2026, 5);
    const lateDec31 = await approve(await pending(), {
      now: "2026-12-31T14:59:59.000Z",
    });
    const newYear = await approve(await pending(), {
      now: "2026-12-31T15:00:00.000Z",
    });
    expect(lateDec31.caseNumber).toBe("QZA-261231-0006");
    expect(newYear.caseNumber).toBe("QZA-270101-0001");
    expect(await caseNumberSequence(w.clientA.id, 2026)).toBe(6);
    expect(await caseNumberSequence(w.clientA.id, 2027)).toBe(1);
  });

  it("#146 C-117: 案件の行を消しても連番は戻らない（次は 0002）", async () => {
    const first = await approve(await pending());
    await deleteCaseRow(first.caseId);
    const second = await approve(await pending());
    expect(second.caseNumber).toBe(`QZA-${TODAY_PART}-0002`);
  });

  it("#146 5-1 AC-18: 連番が 9999 の取引先・年では number_exhausted で、何も残らない", async () => {
    await setCaseNumberSequence(w.clientA.id, 2026, 9999);
    const requestId = await pending();
    await expectNothingChanged(() => approve(requestId), "number_exhausted");
    expect(await caseNumberSequence(w.clientA.id, 2026)).toBe(9999);
  });

  it("#146 5-1 AC-18: 9999 番そのものは発行できる", async () => {
    await setCaseNumberSequence(w.clientA.id, 2026, 9998);
    const result = await approve(await pending());
    expect(result.caseNumber).toBe(`QZA-${TODAY_PART}-9999`);
  });

  it("#146 5-1 AC-18: 同じ案件番号の案件が既にあれば number_conflict で、何も残らない（UNIQUE を最後の砦にする）", async () => {
    await insertCase({
      clientId: w.clientA.id,
      caseNumber: `QZA-${TODAY_PART}-0001`,
      title: `${TEST_TAG}既存の案件`,
      createdBy: w.memberS1.id,
    });
    const requestId = await pending();
    await expectNothingChanged(() => approve(requestId), "number_conflict");
  });

  it("#146 着手前の条件・5-1 AC-18: 同じ取引先・同じ年の申請を同時に承認しても、番号は重複せず抜けもない", async () => {
    const ids = [await pending(), await pending(), await pending()];
    const results = await Promise.all(ids.map((id) => approve(id)));
    expect(results.map((r) => r.caseNumber).sort()).toEqual([
      `QZA-${TODAY_PART}-0001`,
      `QZA-${TODAY_PART}-0002`,
      `QZA-${TODAY_PART}-0003`,
    ]);
    expect(await caseNumberSequence(w.clientA.id, 2026)).toBe(3);
  });

  it("#146 着手前の条件・5-1 AC-18: 残りが2番（9998・9999）のときに3件を同時に承認すると、2件が成功し、1件は number_exhausted で何も作られない", async () => {
    await setCaseNumberSequence(w.clientA.id, 2026, 9997);
    const ids = [await pending(), await pending(), await pending()];
    const settled = await Promise.allSettled(ids.map((id) => approve(id)));
    const fulfilled = settled.flatMap((s) =>
      s.status === "fulfilled" ? [s.value.caseNumber] : [],
    );
    const rejected = settled.flatMap((s) =>
      s.status === "rejected" ? [s.reason as unknown] : [],
    );
    expect(fulfilled.sort()).toEqual([
      `QZA-${TODAY_PART}-9998`,
      `QZA-${TODAY_PART}-9999`,
    ]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toBeInstanceOf(CaseRequestWriteError);
    expect((rejected[0] as CaseRequestWriteError).reason).toBe(
      "number_exhausted",
    );
    const statuses = await Promise.all(
      ids.map(async (id) => (await caseRequestRow(id))?.status),
    );
    expect(statuses.filter((s) => s === "pending")).toHaveLength(1);
    const { results } = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM cases WHERE client_id = ?",
    )
      .bind(w.clientA.id)
      .all<{ n: number }>();
    expect(results[0]?.n).toBe(2);
  });

  it("#146 5-1 AC-6・C-83: 通常のチャンネルに案件番号と同じ名前があっても、案件専用チャンネルは作れる（名前の正規化が case: で分かれる）", async () => {
    // 名前に [UNIT_TEST] を付けられない（案件番号と同じ名前にする）ため、このテストの中で消す
    const normalRoomId = await insertChannel({
      name: `QZA-${TODAY_PART}-0001`,
      purpose: "normal",
      departmentId: null,
    });
    try {
      const result = await approve(await pending());
      expect(result.caseNumber).toBe(`QZA-${TODAY_PART}-0001`);
    } finally {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM channels WHERE room_id = ?").bind(
          normalRoomId,
        ),
        env.DB.prepare("DELETE FROM rooms WHERE id = ?").bind(normalRoomId),
      ]);
    }
  });
});

describe("#146 5-3 AC-7・AC-8・C-141(1)・C-178(U-2) 承認の前提が崩れたら何も残らない（突き合わせの表 146-B）", () => {
  it.each<[string, CaseRequestStatus]>([
    ["取り下げ", "withdrawn"],
    ["自動取消", "auto_cancelled"],
    ["承認済み", "approved"],
    ["却下", "rejected"],
  ])(
    "#146 5-3 AC-7・C-178(U-5): 申請が%sなら decided で、何も残らない",
    async (_label, status) => {
      const requestId = await pending({ status });
      await expectNothingChanged(() => approve(requestId), "decided");
    },
  );

  it("#146 版の確認: 読んだ版と違えば（他の操作が先に確定した）decided で、何も残らない", async () => {
    const requestId = await pending();
    await expectNothingChanged(
      () => approve(requestId, { version: 2 }),
      "decided",
    );
  });

  it("#146 C-141(1): 担当部署の一部が無効なら department_inactive で、何も残らない（部署の値と版は変えない）", async () => {
    const requestId = await pending({
      departmentIds: [w.deptS.id, w.deptD.id],
    });
    await setDepartmentActive(w.deptD.id, false);
    await expectNothingChanged(() => approve(requestId), "department_inactive");
  });

  it("#146 C-178(U-2): 取引先が無効なら client_inactive で、何も残らない", async () => {
    const requestId = await pending();
    await setClientActive(w.clientA.id, false);
    await expectNothingChanged(() => approve(requestId), "client_inactive");
  });

  it("#146 5-3 AC-8: 申請の時の候補が無効になったら candidate_inactive で、何も残らない", async () => {
    const requestId = await pending({ candidateIds: [w.memberD1.id] });
    await setUserActive(w.memberD1.id, false);
    await expectNothingChanged(() => approve(requestId), "candidate_inactive");
  });

  it("#146 B-5 の順: 決裁済みで、部署も無効なら、decided を優先する", async () => {
    const requestId = await pending({ status: "withdrawn" });
    await setDepartmentActive(w.deptS.id, false);
    await setClientActive(w.clientA.id, false);
    await expectNothingChanged(() => approve(requestId), "decided");
  });

  it("#146 B-5 の順: 部署と取引先がどちらも無効なら、department_inactive を優先する", async () => {
    const requestId = await pending();
    await setDepartmentActive(w.deptS.id, false);
    await setClientActive(w.clientA.id, false);
    await expectNothingChanged(() => approve(requestId), "department_inactive");
  });

  it("#146 突き合わせの表(1)・5-3 AC-9: 最初の判定の後、batch の前に決裁者のオーナーの割り当てが外れたら reviewer_ineligible で、何も残らない", async () => {
    const requestId = await pending();
    await removeOwner(w.ownerS.id, w.deptS.id);
    await expectNothingChanged(() => approve(requestId), "reviewer_ineligible");
  });

  it("#146 突き合わせの表・5-3 AC-3: 決裁者が担当部署のどれのオーナーでもなく、全体管理者でもなければ reviewer_ineligible", async () => {
    const requestId = await pending();
    await expectNothingChanged(
      () => approve(requestId, { deciderId: w.ownerH.id }),
      "reviewer_ineligible",
    );
  });

  it("#146 突き合わせの表・5-3 AC-3: 決裁者が無効になっていたら reviewer_ineligible", async () => {
    const requestId = await pending();
    await setUserActive(w.ownerS.id, false);
    await expectNothingChanged(() => approve(requestId), "reviewer_ineligible");
  });

  it("#146 突き合わせの表(2)・5-3 AC-4・AC-9: 全体管理者でない申請者が、交代で担当部署のオーナーになり、自分の申請を決裁すると reviewer_ineligible", async () => {
    const requestId = await pending({ requestedBy: w.memberS2.id });
    await removeOwner(w.ownerS.id, w.deptS.id);
    await makeOwner(w.memberS2.id, w.deptS.id);
    await expectNothingChanged(
      () => approve(requestId, { deciderId: w.memberS2.id }),
      "reviewer_ineligible",
    );
  });

  it("#146 突き合わせの表・5-3 AC-4: 全体管理者でなくなった申請者は、自分の申請を決裁できない（reviewer_ineligible）", async () => {
    const requestId = await pending({
      requestedBy: w.admin.id,
      departmentIds: [w.deptH.id],
    });
    await removeGlobalAdmin(w.admin.id);
    await expectNothingChanged(
      () => approve(requestId, { deciderId: w.admin.id }),
      "reviewer_ineligible",
    );
  });

  it("#146 5-3 AC-4: 全体管理者は自分の申請を承認できる", async () => {
    const requestId = await pending({
      requestedBy: w.admin.id,
      departmentIds: [w.deptH.id],
    });
    const result = await approve(requestId, { deciderId: w.admin.id });
    expect((await caseRequestRow(requestId))?.status).toBe("approved");
    expect(await memberIdsOf(result.roomId)).toContain(w.admin.id);
  });

  it("#146 5-3 AC-3: 複数の担当部署のうち、片方のオーナーだけで承認できる", async () => {
    const requestId = await pending({
      departmentIds: [w.deptS.id, w.deptD.id],
    });
    await approve(requestId, { deciderId: w.ownerD.id });
    expect((await caseRequestRow(requestId))?.status).toBe("approved");
  });
});

describe("#146 5-3 AC-6 却下の batch", () => {
  it("#146 5-3 AC-6: 却下すると、申請が rejected になり理由が残る。案件・チャンネル・連番は作らない。監査1件（理由の本文なし）と申請者への通知1件", async () => {
    const requestId = await pending();
    const before = await approvalSnapshot();
    await reject(requestId);
    expect(await caseRequestRow(requestId)).toMatchObject({
      status: "rejected",
      decided_by: w.ownerS.id,
      decided_at: CASEREQ_NOW,
      decision_reason: "[UNIT_TEST]却下の理由",
      case_id: null,
    });
    const after = await approvalSnapshot();
    expect(after.cases).toEqual(before.cases);
    expect(after.channels).toEqual(before.channels);
    expect(after.sequences).toEqual(before.sequences);
    expect(after.members).toEqual(before.members);
    const audits = (await caseRequestAudits()).filter(
      (a) => a.action === "case_request.reject",
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_id: w.ownerS.id,
      target_type: "case_request",
      target_id: requestId,
    });
    expect(detailKeys(audits[0]?.detail ?? null)).toContain("requestId");
    expect(audits[0]?.detail ?? "").not.toContain("却下の理由");
    expect(
      (await caseRequestNotifications()).filter(
        (n) => n.kind === "case_request.rejected",
      ),
    ).toEqual([
      expect.objectContaining({
        user_id: w.memberS1.id,
        room_id: null,
        target_id: requestId,
      }),
    ]);
  });

  it("#146 C-141(1)・C-178(U-2)・5-3 AC-8: 部署・取引先・候補が無効でも却下できる", async () => {
    const requestId = await pending({ candidateIds: [w.memberD1.id] });
    await setDepartmentActive(w.deptS.id, false);
    await setClientActive(w.clientA.id, false);
    await setUserActive(w.memberD1.id, false);
    await reject(requestId);
    expect((await caseRequestRow(requestId))?.status).toBe("rejected");
  });

  it.each<[string, CaseRequestStatus]>([
    ["取り下げ", "withdrawn"],
    ["自動取消", "auto_cancelled"],
    ["承認済み", "approved"],
    ["却下", "rejected"],
  ])(
    "#146 5-3 AC-7: 申請が%sなら、却下も decided で何も残らない",
    async (_label, status) => {
      const requestId = await pending({ status });
      await expectNothingChanged(() => reject(requestId), "decided");
    },
  );

  it("#146 突き合わせの表(1): 最初の判定の後に決裁者のオーナーの割り当てが外れたら、却下も reviewer_ineligible で何も残らない", async () => {
    const requestId = await pending();
    await removeOwner(w.ownerS.id, w.deptS.id);
    await expectNothingChanged(() => reject(requestId), "reviewer_ineligible");
  });

  it("#146 突き合わせの表(2)・5-3 AC-4: 交代でオーナーになった申請者は、自分の申請を却下できない（reviewer_ineligible）", async () => {
    const requestId = await pending({ requestedBy: w.memberS2.id });
    await removeOwner(w.ownerS.id, w.deptS.id);
    await makeOwner(w.memberS2.id, w.deptS.id);
    await expectNothingChanged(
      () => reject(requestId, { deciderId: w.memberS2.id }),
      "reviewer_ineligible",
    );
  });

  it("#146 原子性: 却下の通知が失敗したら、申請は pending のままで監査も残らない", async () => {
    const requestId = await pending();
    await failNotificationInsert();
    const before = await approvalSnapshot();
    await expect(reject(requestId)).rejects.toThrow();
    expect(await approvalSnapshot()).toEqual(before);
  });
});

describe("#146 5-3 AC-14・C-141(3)・C-178(7) 類似件名の比較に案件を足す", () => {
  const similar = (clientId: string, title: string) =>
    withCaseRequests(env, (repository) =>
      repository.hasSimilarTitle({ clientId, title }),
    );

  it.each<["active" | "closed", string]>([
    ["active", "進行中"],
    ["closed", "終了"],
  ])(
    "#146 5-3 AC-14: 同じ取引先に同じ件名の案件（%s＝%s）があれば true",
    async (status) => {
      await insertCase({
        clientId: w.clientA.id,
        caseNumber: `QZA-${TODAY_PART}-0101`,
        title: `${TEST_TAG}既存の案件`,
        createdBy: w.memberS1.id,
        status,
      });
      expect(await similar(w.clientA.id, `${TEST_TAG}既存の案件`)).toBe(true);
    },
  );

  it("#146 5-3 AC-14: 案件の取引先が違う・件名が違うなら false（完全一致だけ）", async () => {
    await insertCase({
      clientId: w.clientA.id,
      caseNumber: `QZA-${TODAY_PART}-0102`,
      title: `${TEST_TAG}既存の案件`,
      createdBy: w.memberS1.id,
    });
    expect(await similar(w.clientB.id, `${TEST_TAG}既存の案件`)).toBe(false);
    expect(await similar(w.clientA.id, `${TEST_TAG}既存の案件2`)).toBe(false);
  });

  it("#146 5-3 AC-14: 承認で申請が approved になっても、できた案件と比べて true のまま", async () => {
    const requestId = await pending({ title: `${TEST_TAG}承認後の件名` });
    await approve(requestId);
    expect(await similar(w.clientA.id, `${TEST_TAG}承認後の件名`)).toBe(true);
  });
});
