// #146（146-A）5-3 AC-1・AC-2・AC-5・AC-6・AC-7・AC-11・AC-14、3-4 AC-1・AC-3：案件の作成申請の Repository を、マイグレーション済みの D1 で確かめる。
// この層で確かめるもの（計画 A-9・1.3）：batch の原子性・失敗の見分け（表と列）・書き込みの条件（最初の判定の後に前提が変わった場合）・類似件名の SQL・版の確認。
// 判定と書き込みの間の変化は、Service を通さずに「読んだときの値（宛先・申請者）」を渡したまま DB を変えてから create を呼んで作る。
// 契約（実装前の仮置き。計画 A-3・A-6・突き合わせの表。実装の担当へ）：
//   withCaseRequests(env, (repository) => …)
//   repository.create({ requesterId, clientId, title, description, dueDate, departmentIds, candidateIds, resubmitOf, recipientIds, now, traceId })
//     : Promise<{ id: string }>。1回の db.batch。title は整形済みで渡す。recipientIds は読んだときの宛先（Q3 で決めたもの）。
//   repository.readSubmittedRecipientCandidates(departmentIds): Promise<{ ownerIds: string[]; adminIds: string[] }>
//     （担当部署の有効なオーナーと、有効な全体管理者）
//   repository.hasSimilarTitle({ clientId, title }): Promise<boolean>（整形済みの title。同じ取引先の pending と完全一致）
//   repository.withdraw({ requestId, requesterId, version, now, traceId }): Promise<void>
//   失敗は CaseRequestWriteError（reason）で、何も残さない：
//     client_unavailable（NOT NULL case_creation_requests.client_id）・department_unavailable（…departments.department_id）・
//     candidate_unavailable（…candidates.user_id）・resubmit_unavailable（再申請元の確認文）・requester_ineligible（…requests.requested_by）・
//     recipients_changed（申請の作成での …requests.version）・decided（取り下げでの …requests.version）・not_found（取り下げで本人の申請の行がない）
//   それ以外の DB エラーは変換せずに再送出する。
// 監査：case_request.create（target_type: case_request、detail のキーは requestId・clientId・departmentCount・candidateCount・resubmittedFrom）、
//       case_request.withdraw（detail のキーは requestId・departmentCount）。件名・説明の本文は入れない。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CASEREQ_NOW,
  TEST_TAG,
  caseRequestAudits,
  caseRequestNotifications,
  caseRequestRow,
  caseRequestSnapshot,
  casereqTraceId,
  cleanupCaseRequestTestData,
  detailKeys,
  failAuditOf,
  failNotificationInsert,
  insertCaseRequest,
  removeGlobalAdmin,
  removeOwner,
  requestCandidates,
  requestDepartments,
  setDepartmentActive,
  setUserActive,
  setUserDepartment,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import { makeOwner } from "../../test/department-fixtures";
import {
  CaseRequestWriteError,
  withCaseRequests,
} from "./case-request.repository";

let w: CaseWorld;
const NOW_2 = "2026-11-17T04:00:00.000Z";
const MISSING = "01JTESTCASEREQMISSING00001";

type CreateOverrides = Partial<{
  requesterId: string;
  clientId: string;
  title: string;
  description: string;
  dueDate: string | null;
  departmentIds: string[];
  candidateIds: string[];
  resubmitOf: string | null;
  recipientIds: string[];
}>;

const create = (overrides: CreateOverrides = {}) =>
  withCaseRequests(env, (repository) =>
    repository.create({
      requesterId: w.memberS1.id,
      clientId: w.clientA.id,
      title: `${TEST_TAG}保守契約`,
      description: "[UNIT_TEST]説明",
      dueDate: "2026-12-01",
      departmentIds: [w.deptS.id],
      candidateIds: [],
      resubmitOf: null,
      recipientIds: [w.ownerS.id],
      now: CASEREQ_NOW,
      traceId: casereqTraceId(),
      ...overrides,
    }),
  );

const withdraw = (input: {
  requestId: string;
  requesterId: string;
  version: number;
}) =>
  withCaseRequests(env, (repository) =>
    repository.withdraw({ ...input, now: NOW_2, traceId: casereqTraceId() }),
  );

/** 失敗が CaseRequestWriteError で、決めた理由であることを確かめる */
async function expectWriteError(promise: Promise<unknown>, reason: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(CaseRequestWriteError);
  expect((error as CaseRequestWriteError).reason).toBe(reason);
}

beforeEach(async () => {
  w = await setupCaseWorld();
});

afterEach(async () => {
  await cleanupCaseRequestTestData();
});

describe("#146 申請の作成（create の batch）", () => {
  it("#146 5-3 AC-1・AC-5・3-4 AC-1: 申請・部署・候補・監査・通知を1回で確定する。宛先は渡した担当部署のオーナーだけ", async () => {
    const { id } = await create({
      departmentIds: [w.deptS.id, w.deptD.id],
      candidateIds: [w.memberD1.id],
      recipientIds: [w.ownerS.id, w.ownerD.id],
    });
    expect(await caseRequestRow(id)).toMatchObject({
      client_id: w.clientA.id,
      title: `${TEST_TAG}保守契約`,
      description: "[UNIT_TEST]説明",
      due_date: "2026-12-01",
      requested_by: w.memberS1.id,
      status: "pending",
      version: 1,
      decided_by: null,
      decision_reason: null,
      case_id: null,
      resubmitted_from: null,
      requested_at: CASEREQ_NOW,
      decided_at: null,
    });
    expect(await requestDepartments(id)).toEqual(
      [w.deptS.id, w.deptD.id].sort(),
    );
    expect(await requestCandidates(id)).toEqual([
      { user_id: w.memberD1.id, added_by: w.memberS1.id },
    ]);
    const audits = await caseRequestAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_id: w.memberS1.id,
      action: "case_request.create",
      target_type: "case_request",
      target_id: id,
      result: "success",
    });
    expect(detailKeys(audits[0]?.detail ?? null)).toEqual(
      [
        "candidateCount",
        "clientId",
        "departmentCount",
        "requestId",
        "resubmittedFrom",
      ].sort(),
    );
    expect(JSON.parse(audits[0]?.detail ?? "{}")).toMatchObject({
      requestId: id,
      clientId: w.clientA.id,
      departmentCount: 2,
      candidateCount: 1,
      resubmittedFrom: null,
    });
    // 監査に件名・説明の本文を入れない
    expect(audits[0]?.detail ?? "").not.toContain("保守契約");
    expect(audits[0]?.detail ?? "").not.toContain("説明");
    expect(await caseRequestNotifications()).toEqual(
      [w.ownerS.id, w.ownerD.id].sort().map((user_id) => ({
        user_id,
        kind: "case_request.submitted",
        room_id: null,
        message_id: null,
        target_id: id,
      })),
    );
  });

  it("#146 5-3 AC-2・AC-11: 申請だけでは rooms・channels が増えず、申請に案件の ID がない", async () => {
    const before = await caseRequestSnapshot();
    const { id } = await create();
    const after = await caseRequestSnapshot();
    expect(after.rooms).toEqual(before.rooms);
    expect(after.channels).toEqual(before.channels);
    expect((await caseRequestRow(id))?.case_id).toBeNull();
  });

  it("#146 5-3 AC-6: 説明・納期・候補なしでも申請できる（説明は空、納期は NULL）", async () => {
    const { id } = await create({ description: "", dueDate: null });
    expect(await caseRequestRow(id)).toMatchObject({
      description: "",
      due_date: null,
    });
    expect(await requestCandidates(id)).toEqual([]);
  });
});

// 判定（Service の読み取り）の後に取引先・部署・候補が無効になった場合も、DB の層では「書き込みの時点で無効」と同じ状態なので、ここで確かめる
describe("#146 5-3 AC-11・AC-1・AC-5 前提が成り立たない申請は、別の理由で失敗し、何も残らない", () => {
  it.each([
    ["無効な取引先", "clientOff", "client_unavailable"],
    ["存在しない取引先", "missing", "client_unavailable"],
  ])(
    "#146 5-3 AC-11: %s なら %s で、申請・部署・候補・監査・通知が残らない",
    async (_label, which) => {
      const before = await caseRequestSnapshot();
      await expectWriteError(
        create({
          clientId: which === "missing" ? MISSING : w.clientOff.id,
          candidateIds: [w.memberD1.id],
        }),
        "client_unavailable",
      );
      expect(await caseRequestSnapshot()).toEqual(before);
    },
  );

  it("#146 5-3 AC-1: 担当部署の1つが無効なら department_unavailable で、何も残らない（もう1つが有効でも）", async () => {
    await setDepartmentActive(w.deptD.id, false);
    const before = await caseRequestSnapshot();
    await expectWriteError(
      create({
        departmentIds: [w.deptS.id, w.deptD.id],
        recipientIds: [w.ownerS.id],
      }),
      "department_unavailable",
    );
    expect(await caseRequestSnapshot()).toEqual(before);
  });

  it("#146 5-3 AC-1: 存在しない部署を含むなら department_unavailable で、何も残らない", async () => {
    const before = await caseRequestSnapshot();
    await expectWriteError(
      create({ departmentIds: [w.deptS.id, MISSING] }),
      "department_unavailable",
    );
    expect(await caseRequestSnapshot()).toEqual(before);
  });

  it.each([
    ["無効な社員", "inactive"],
    ["存在しない社員", "missing"],
  ])(
    "#146 5-3 AC-5: 候補が%sなら candidate_unavailable で、何も残らない",
    async (_label, which) => {
      const before = await caseRequestSnapshot();
      await expectWriteError(
        create({
          candidateIds: [
            w.memberD1.id,
            which === "missing" ? MISSING : w.inactive.id,
          ],
        }),
        "candidate_unavailable",
      );
      expect(await caseRequestSnapshot()).toEqual(before);
    },
  );

  it("#146 計画 A-6: 想定外の DB エラー（通知の挿入の失敗）は変換せずに再送出し、何も残らない", async () => {
    await failNotificationInsert();
    const before = await caseRequestSnapshot();
    const error = await create().then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(CaseRequestWriteError);
    expect(await caseRequestSnapshot()).toEqual(before);
  });

  it("#146 計画 A-6: 監査の挿入が失敗したら、申請・部署・候補・通知も残らない", async () => {
    await failAuditOf("case_request.create");
    const before = await caseRequestSnapshot();
    await expect(create({ candidateIds: [w.memberD1.id] })).rejects.toThrow();
    expect(await caseRequestSnapshot()).toEqual(before);
  });
});

describe("#146 重大1 申請者の資格が判定の後に変わったら、何も残らず requester_ineligible", () => {
  it("#146 5-3 AC-1: 判定の後に申請者が無効になった", async () => {
    const before = await caseRequestSnapshot();
    await setUserActive(w.memberS1.id, false);
    await expectWriteError(create(), "requester_ineligible");
    expect(await caseRequestSnapshot()).toEqual(before);
  });

  it("#146 5-3 AC-1: 判定の後に申請者の所属がなくなった（全体管理者ではない）", async () => {
    const before = await caseRequestSnapshot();
    await setUserDepartment(w.memberS1.id, null);
    await expectWriteError(create(), "requester_ineligible");
    expect(await caseRequestSnapshot()).toEqual(before);
  });

  it("#146 5-3 AC-1: 所属のない全体管理者は申請できる", async () => {
    await setUserDepartment(w.admin.id, null);
    const { id } = await create({ requesterId: w.admin.id });
    expect((await caseRequestRow(id))?.requested_by).toBe(w.admin.id);
  });

  it("#146 5-3 AC-1: 所属のない全体管理者が、判定の後に全体管理者でなくなった", async () => {
    await setUserDepartment(w.admin.id, null);
    const before = await caseRequestSnapshot();
    await removeGlobalAdmin(w.admin.id);
    await expectWriteError(
      create({ requesterId: w.admin.id }),
      "requester_ineligible",
    );
    expect(await caseRequestSnapshot()).toEqual(before);
  });
});

describe("#146 重大2 宛先が読んだ後に変わったら、何も残らず recipients_changed", () => {
  it("#146 3-4 AC-1（Q3）: 宛先の候補は、担当部署の有効なオーナーと、有効な全体管理者", async () => {
    await setUserActive(w.ownerD.id, false);
    const found = await withCaseRequests(env, (repository) =>
      repository.readSubmittedRecipientCandidates([w.deptS.id, w.deptD.id]),
    );
    expect([...found.ownerIds].sort()).toEqual([w.ownerS.id]);
    expect([...found.adminIds].sort()).toEqual([w.admin.id]);
  });

  it("#146 3-4 AC-1: 担当部署のオーナーが交代した（読んだのは前のオーナー）", async () => {
    const before = await caseRequestSnapshot();
    await removeOwner(w.ownerS.id, w.deptS.id);
    await makeOwner(w.memberS2.id, w.deptS.id);
    await expectWriteError(
      create({ recipientIds: [w.ownerS.id] }),
      "recipients_changed",
    );
    expect(await caseRequestSnapshot()).toEqual(before);
  });

  it("#146 3-4 AC-1: 担当部署のオーナーが無効になった", async () => {
    const before = await caseRequestSnapshot();
    await setUserActive(w.ownerS.id, false);
    await expectWriteError(
      create({ recipientIds: [w.ownerS.id] }),
      "recipients_changed",
    );
    expect(await caseRequestSnapshot()).toEqual(before);
  });

  it("#146 3-4 AC-1（Q3）: オーナーがいなくなり、宛先が全体管理者に切り替わる条件になった", async () => {
    const before = await caseRequestSnapshot();
    await removeOwner(w.ownerS.id, w.deptS.id);
    await expectWriteError(
      create({ recipientIds: [w.ownerS.id] }),
      "recipients_changed",
    );
    expect(await caseRequestSnapshot()).toEqual(before);
  });

  it("#146 3-4 AC-1（Q3）: 全体管理者に送るつもりで読んだ後に、担当部署にオーナーが任命された", async () => {
    await removeOwner(w.ownerS.id, w.deptS.id);
    const before = await caseRequestSnapshot();
    await makeOwner(w.ownerS.id, w.deptS.id);
    await expectWriteError(
      create({ recipientIds: [w.admin.id] }),
      "recipients_changed",
    );
    expect(await caseRequestSnapshot()).toEqual(before);
  });

  it("#146 3-4 AC-1・AC-3: 変化がなければ現在のオーナーだけに届き、申請者本人には届かない", async () => {
    const { id } = await create({
      requesterId: w.ownerS.id,
      departmentIds: [w.deptS.id, w.deptD.id],
      recipientIds: [w.ownerD.id],
    });
    expect(await caseRequestNotifications()).toEqual([
      {
        user_id: w.ownerD.id,
        kind: "case_request.submitted",
        room_id: null,
        message_id: null,
        target_id: id,
      },
    ]);
  });
});

describe("#146 5-3 AC-6 再申請の元（resubmitOf）", () => {
  it.each(["rejected", "withdrawn"] as const)(
    "#146 5-3 AC-6: 本人の %s の申請を元にすると、元の ID を持つ別の申請になる（元は変わらない）",
    async (status) => {
      const original = await insertCaseRequest({
        clientId: w.clientA.id,
        title: `${TEST_TAG}元の申請`,
        requestedBy: w.memberS1.id,
        departmentIds: [w.deptS.id],
        status,
      });
      const before = await caseRequestRow(original);
      const { id } = await create({ resubmitOf: original });
      expect(id).not.toBe(original);
      expect((await caseRequestRow(id))?.resubmitted_from).toBe(original);
      expect(await caseRequestRow(original)).toEqual(before);
      const audit = (await caseRequestAudits()).find((a) => a.target_id === id);
      expect(JSON.parse(audit?.detail ?? "{}")).toMatchObject({
        resubmittedFrom: original,
      });
    },
  );

  it.each([
    ["本人の pending", "pending", "self"],
    ["本人の approved", "approved", "self"],
    ["他人の rejected", "rejected", "other"],
    ["存在しない申請", "missing", "self"],
  ])(
    "#146 5-3 AC-6: %s を元にすると resubmit_unavailable で、何も残らない",
    async (_label, status, owner) => {
      const original =
        status === "missing"
          ? MISSING
          : await insertCaseRequest({
              clientId: w.clientA.id,
              title: `${TEST_TAG}元の申請`,
              requestedBy: owner === "self" ? w.memberS1.id : w.memberS2.id,
              departmentIds: [w.deptS.id],
              status: status as "pending" | "approved" | "rejected",
            });
      const before = await caseRequestSnapshot();
      await expectWriteError(
        create({ resubmitOf: original }),
        "resubmit_unavailable",
      );
      expect(await caseRequestSnapshot()).toEqual(before);
    },
  );
});

describe("#146 5-3 AC-14・C-141(3) 類似件名（hasSimilarTitle）", () => {
  const similar = (clientId: string, title: string) =>
    withCaseRequests(env, (repository) =>
      repository.hasSimilarTitle({ clientId, title }),
    );

  it("#146 C-141(3): 同じ取引先の審査中の申請と、件名が完全一致なら真", async () => {
    await insertCaseRequest({
      clientId: w.clientA.id,
      title: `${TEST_TAG}保守契約`,
      requestedBy: w.memberS2.id,
      departmentIds: [w.deptS.id],
    });
    expect(await similar(w.clientA.id, `${TEST_TAG}保守契約`)).toBe(true);
  });

  it.each(["rejected", "withdrawn"] as const)(
    "#146 C-141(3): %s の申請は比べる対象にしない",
    async (status) => {
      await insertCaseRequest({
        clientId: w.clientA.id,
        title: `${TEST_TAG}保守契約`,
        requestedBy: w.memberS2.id,
        departmentIds: [w.deptS.id],
        status,
      });
      expect(await similar(w.clientA.id, `${TEST_TAG}保守契約`)).toBe(false);
    },
  );

  it("#146 5-3 AC-14: 別の取引先の同じ件名は対象にしない", async () => {
    await insertCaseRequest({
      clientId: w.clientB.id,
      title: `${TEST_TAG}保守契約`,
      requestedBy: w.memberS2.id,
      departmentIds: [w.deptS.id],
    });
    expect(await similar(w.clientA.id, `${TEST_TAG}保守契約`)).toBe(false);
  });

  it("#146 C-141(3): 完全一致でなければ偽（部分一致・前後の違いは似ているとしない）", async () => {
    await insertCaseRequest({
      clientId: w.clientA.id,
      title: `${TEST_TAG}保守契約`,
      requestedBy: w.memberS2.id,
      departmentIds: [w.deptS.id],
    });
    expect(await similar(w.clientA.id, `${TEST_TAG}保守`)).toBe(false);
    expect(await similar(w.clientA.id, `${TEST_TAG}保守契約2`)).toBe(false);
  });
});

describe("#146 5-3 AC-7 取り下げ（withdraw の batch）", () => {
  const pending = () =>
    insertCaseRequest({
      clientId: w.clientA.id,
      title: `${TEST_TAG}取り下げ`,
      requestedBy: w.memberS1.id,
      departmentIds: [w.deptS.id, w.deptD.id],
    });

  it("#146 5-3 AC-7: 本人の審査中の申請を取り下げると withdrawn になり、決裁者は本人・版が1上がる。監査は1件で通知は出さない", async () => {
    const id = await pending();
    await withdraw({ requestId: id, requesterId: w.memberS1.id, version: 1 });
    expect(await caseRequestRow(id)).toMatchObject({
      status: "withdrawn",
      decided_by: w.memberS1.id,
      decided_at: NOW_2,
      version: 2,
    });
    const audits = await caseRequestAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_id: w.memberS1.id,
      action: "case_request.withdraw",
      target_type: "case_request",
      target_id: id,
      result: "success",
    });
    expect(detailKeys(audits[0]?.detail ?? null)).toEqual(
      ["departmentCount", "requestId"].sort(),
    );
    expect(JSON.parse(audits[0]?.detail ?? "{}")).toMatchObject({
      requestId: id,
      departmentCount: 2,
    });
    expect(await caseRequestNotifications()).toEqual([]);
  });

  it("#146 5-3 AC-7: 同じ版での二重の取り下げは2回目が decided で、監査は1件だけ", async () => {
    const id = await pending();
    await withdraw({ requestId: id, requesterId: w.memberS1.id, version: 1 });
    const before = await caseRequestSnapshot();
    await expectWriteError(
      withdraw({ requestId: id, requesterId: w.memberS1.id, version: 1 }),
      "decided",
    );
    expect(await caseRequestSnapshot()).toEqual(before);
    expect(await caseRequestAudits()).toHaveLength(1);
  });

  it("#146 5-3 AC-7: 同時の取り下げは片方だけが確定し、監査は1件だけ", async () => {
    const id = await pending();
    const results = await Promise.allSettled([
      withdraw({ requestId: id, requesterId: w.memberS1.id, version: 1 }),
      withdraw({ requestId: id, requesterId: w.memberS1.id, version: 1 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(
      rejected?.status === "rejected" ? rejected.reason : null,
    ).toBeInstanceOf(CaseRequestWriteError);
    expect(await caseRequestAudits()).toHaveLength(1);
  });

  it.each(["rejected", "approved"] as const)(
    "#146 5-3 AC-7: %s の申請は（版が一致していても）decided で変わらない",
    async (status) => {
      const id = await insertCaseRequest({
        clientId: w.clientA.id,
        title: `${TEST_TAG}決裁済み`,
        requestedBy: w.memberS1.id,
        departmentIds: [w.deptS.id],
        status,
      });
      const before = await caseRequestSnapshot();
      await expectWriteError(
        withdraw({ requestId: id, requesterId: w.memberS1.id, version: 1 }),
        "decided",
      );
      expect(await caseRequestSnapshot()).toEqual(before);
    },
  );

  it("#146 5-3 AC-7: 他人の申請は not_found で、状態も監査も変わらない", async () => {
    const id = await pending();
    const before = await caseRequestSnapshot();
    await expectWriteError(
      withdraw({ requestId: id, requesterId: w.memberS2.id, version: 1 }),
      "not_found",
    );
    expect(await caseRequestSnapshot()).toEqual(before);
  });

  it("#146 5-3 AC-7: 取り下げの batch が失敗したら（監査の失敗）、状態は変わらない", async () => {
    const id = await pending();
    await failAuditOf("case_request.withdraw");
    const before = await caseRequestSnapshot();
    await expect(
      withdraw({ requestId: id, requesterId: w.memberS1.id, version: 1 }),
    ).rejects.toThrow();
    expect(await caseRequestSnapshot()).toEqual(before);
    expect((await caseRequestRow(id))?.status).toBe("pending");
  });
});
