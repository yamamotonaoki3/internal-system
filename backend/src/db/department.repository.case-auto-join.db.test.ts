// #147（147-C-2）5-1 AC-7（C-133(4)）・決定 Q3：部署のオーナーの交代で、新しいオーナーを、その部署が担当部署の案件（進行中・終了とも）の
// 参加者に入れる。部署の Repository（本物の batch。隔離 D1）で確かめる（期待は計画 147-C-2「オーナー交代」と決定記録 C-133(4)・C-182 Q3）。
//   - 交代（changeOwner）で、新しいオーナーが、担当部署の進行中・終了の両方の案件に入る。担当部署でない案件には入らない
//   - 前のオーナーは消さない（一般の参加者として残る。C-142(1)）。すでに参加していれば重複しない（joined_at も変えない）
//   - 元部署の後任（previousDepartmentSuccessorUserId）がオーナーになる経路（changeOwner・create）でも、元部署の案件に後任が入る
//   - 監査：department.owner_change（と、後任があるときの department.create）の detail に caseJoinCount（新しく入れた行の数。
//     新しいオーナーと後任の合計）を足す。個別の監査は増やさない。通知はしない
//   - 承認とオーナー交代をどちらの順で実行しても、新しいオーナーが参加者になる
// 契約（実装前の仮置き）：withDepartments(env, r => r.changeOwner({ departmentId, version, ownerUserId,
//   previousDepartmentSuccessorUserId, previousDepartmentVersion }, { actorId, traceId }))、r.create({ name, description, ... }, write)。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。全体管理者は w.admin の1人だけ。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupCaseTestData,
  joinedAt,
  seedCase,
  type SeededCase,
} from "../../test/case-fixtures";
import { participantIdsOf } from "../../test/case-participant-fixtures";
import {
  casereqTraceId,
  insertCaseRequest,
  setupCaseWorld,
  TEST_TAG,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import { withCaseRequests } from "./case-request.repository";
import { withDepartments } from "./department.repository";

let w: CaseWorld;
let caseSeq = 0;

async function caseOf(
  departmentIds: string[],
  memberIds: string[],
  status: "active" | "closed" = "active",
): Promise<SeededCase> {
  caseSeq += 1;
  return seedCase({
    n: 100 + caseSeq,
    clientId: w.clientA.id,
    code: "QZA",
    title: `[UNIT_TEST]147C2交代${caseSeq}`,
    createdBy: memberIds[0] ?? w.memberS1.id,
    departmentIds,
    status,
    members: memberIds.map((userId, i) => ({ userId, joinedAt: joinedAt(i) })),
  });
}

async function versionOf(departmentId: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT version FROM departments WHERE id = ?",
  )
    .bind(departmentId)
    .first<{ version: number }>();
  if (row === null) throw new Error("部署がありません");
  return row.version;
}

const changeOwner = async (input: {
  departmentId: string;
  ownerUserId: string;
  previousDepartmentSuccessorUserId?: string | null;
}) =>
  withDepartments(env, async (r) =>
    r.changeOwner(
      {
        departmentId: input.departmentId,
        version: await versionOf(input.departmentId),
        ownerUserId: input.ownerUserId,
        previousDepartmentSuccessorUserId:
          input.previousDepartmentSuccessorUserId ?? null,
        previousDepartmentVersion: null,
      },
      { actorId: w.admin.id, traceId: casereqTraceId() },
    ),
  );

async function auditDetails(action: string) {
  const { results } = await env.DB.prepare(
    "SELECT detail FROM audit_logs WHERE action = ? AND actor_id = ? ORDER BY occurred_at, id",
  )
    .bind(action, w.admin.id)
    .all<{ detail: string }>();
  return results.map((r) => JSON.parse(r.detail) as unknown);
}

async function caseAuditCount() {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM audit_logs WHERE action LIKE 'case.%'",
  ).first<{ n: number }>();
  return row?.n ?? 0;
}

async function notificationCount() {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM notifications",
  ).first<{ n: number }>();
  return row?.n ?? 0;
}

beforeEach(async () => {
  caseSeq = 0;
  w = await setupCaseWorld();
});

afterEach(async () => {
  await cleanupCaseTestData();
});

describe("#147 147-C-2 C-133(4)・Q3: オーナーの交代で、新しいオーナーが担当部署の案件に入る", () => {
  it("#147 C-133(4)・Q3: 担当部署（deptS）の進行中・終了・複数部署の案件に入り、担当部署でない案件には入らない。前のオーナーは残る", async () => {
    const active = await caseOf([w.deptS.id], [w.memberD1.id, w.ownerS.id]);
    const closed = await caseOf(
      [w.deptS.id],
      [w.memberD1.id, w.ownerS.id],
      "closed",
    );
    const shared = await caseOf([w.deptD.id, w.deptS.id], [w.memberD1.id]);
    // 対象でない案件：担当部署が deptD だけ
    const otherDept = await caseOf([w.deptD.id], [w.memberD1.id]);

    await changeOwner({ departmentId: w.deptS.id, ownerUserId: w.memberS1.id });

    expect(await participantIdsOf(active.roomId)).toEqual(
      [w.memberD1.id, w.ownerS.id, w.memberS1.id].sort(),
    );
    expect(await participantIdsOf(closed.roomId)).toEqual(
      [w.memberD1.id, w.ownerS.id, w.memberS1.id].sort(),
    );
    expect(await participantIdsOf(shared.roomId)).toEqual(
      [w.memberD1.id, w.memberS1.id].sort(),
    );
    expect(await participantIdsOf(otherDept.roomId)).toEqual([w.memberD1.id]);
  });

  it("#147 Q3: すでに参加していれば重複せず、参加の時刻も変わらない。監査の caseJoinCount は新しく入れた行の数だけ", async () => {
    const already = await caseOf([w.deptS.id], [w.memberS1.id, w.ownerS.id]);
    await caseOf([w.deptS.id], [w.ownerS.id]);
    await caseOf([w.deptS.id], [w.ownerS.id], "closed");
    const before = await env.DB.prepare(
      "SELECT joined_at FROM channel_members WHERE channel_id = ? AND user_id = ?",
    )
      .bind(already.roomId, w.memberS1.id)
      .first<{ joined_at: string }>();

    await changeOwner({ departmentId: w.deptS.id, ownerUserId: w.memberS1.id });

    expect(await participantIdsOf(already.roomId)).toEqual(
      [w.memberS1.id, w.ownerS.id].sort(),
    );
    expect(
      await env.DB.prepare(
        "SELECT joined_at FROM channel_members WHERE channel_id = ? AND user_id = ?",
      )
        .bind(already.roomId, w.memberS1.id)
        .first<{ joined_at: string }>(),
    ).toEqual(before);
    expect(await auditDetails("department.owner_change")).toEqual([
      {
        previousOwnerUserId: w.ownerS.id,
        newOwnerUserId: w.memberS1.id,
        previousDepartmentId: null,
        successorUserId: null,
        previousVersion: 1,
        nextVersion: 2,
        caseJoinCount: 2,
      },
    ]);
  });

  it("#147 Q3: 担当の案件がなければ、caseJoinCount は 0。案件の監査（case.*）と通知は増えない", async () => {
    await caseOf([w.deptD.id], [w.memberD1.id]);
    const notifications = await notificationCount();
    await changeOwner({ departmentId: w.deptS.id, ownerUserId: w.memberS1.id });
    expect(await auditDetails("department.owner_change")).toEqual([
      expect.objectContaining({ caseJoinCount: 0 }),
    ]);
    expect(await caseAuditCount()).toBe(0);
    expect(await notificationCount()).toBe(notifications);
  });

  it("#147 Q3・D1 の上限: 担当の案件が101件あっても1回で全部に入り、caseJoinCount は 101", async () => {
    const rooms: string[] = [];
    for (let i = 0; i < 101; i += 1)
      rooms.push((await caseOf([w.deptS.id], [w.ownerS.id])).roomId);
    await changeOwner({ departmentId: w.deptS.id, ownerUserId: w.memberS1.id });
    const { results } = await env.DB.prepare(
      `SELECT m.channel_id FROM channel_members m JOIN channels c ON c.room_id = m.channel_id
       WHERE m.user_id = ? AND c.purpose = 'case' ORDER BY m.channel_id`,
    )
      .bind(w.memberS1.id)
      .all<{ channel_id: string }>();
    expect(results.map((r) => r.channel_id)).toEqual(rooms.sort());
    expect(await auditDetails("department.owner_change")).toEqual([
      expect.objectContaining({ caseJoinCount: 101 }),
    ]);
  });

  it("#147 C-133(4)・Q3: 別部署のオーナーを新しいオーナーにし、元部署に後任を立てると、新しいオーナーは交代先の案件に、後任は元部署の案件に入る。caseJoinCount は合計", async () => {
    // ownerS（deptS のオーナー）を deptD のオーナーにし、deptS の後任を memberS1 にする
    const dCase = await caseOf([w.deptD.id], [w.memberD1.id, w.ownerD.id]);
    const dClosed = await caseOf([w.deptD.id], [w.ownerD.id], "closed");
    const sCase = await caseOf([w.deptS.id], [w.memberS2.id, w.ownerS.id]);
    // 対象でない案件：deptH だけが担当
    const hCase = await caseOf([w.deptH.id], [w.ownerH.id]);

    await changeOwner({
      departmentId: w.deptD.id,
      ownerUserId: w.ownerS.id,
      previousDepartmentSuccessorUserId: w.memberS1.id,
    });

    expect(await participantIdsOf(dCase.roomId)).toEqual(
      [w.memberD1.id, w.ownerD.id, w.ownerS.id].sort(),
    );
    expect(await participantIdsOf(dClosed.roomId)).toEqual(
      [w.ownerD.id, w.ownerS.id].sort(),
    );
    // 元部署（deptS）の案件：後任が入り、ownerS は一般の参加者として残る
    expect(await participantIdsOf(sCase.roomId)).toEqual(
      [w.memberS2.id, w.ownerS.id, w.memberS1.id].sort(),
    );
    expect(await participantIdsOf(hCase.roomId)).toEqual([w.ownerH.id]);
    expect(await auditDetails("department.owner_change")).toEqual([
      {
        previousOwnerUserId: w.ownerD.id,
        newOwnerUserId: w.ownerS.id,
        previousDepartmentId: w.deptS.id,
        successorUserId: w.memberS1.id,
        previousVersion: 1,
        nextVersion: 2,
        caseJoinCount: 3,
      },
    ]);
  });

  it("#147 C-133(4)・Q3: 部署の作成で、別部署のオーナーを指名して元部署に後任を立てると、後任が元部署の案件に入り、department.create の caseJoinCount に数える", async () => {
    const sActive = await caseOf([w.deptS.id], [w.ownerS.id]);
    const sClosed = await caseOf([w.deptS.id], [w.ownerS.id], "closed");
    const dCase = await caseOf([w.deptD.id], [w.memberD1.id]);

    await withDepartments(env, (r) =>
      r.create(
        {
          name: `${TEST_TAG}147C2新部署`,
          description: "",
          ownerUserId: w.ownerS.id,
          previousDepartmentSuccessorUserId: w.memberS1.id,
          previousDepartmentVersion: null,
        },
        { actorId: w.admin.id, traceId: casereqTraceId() },
      ),
    );

    expect(await participantIdsOf(sActive.roomId)).toEqual(
      [w.ownerS.id, w.memberS1.id].sort(),
    );
    expect(await participantIdsOf(sClosed.roomId)).toEqual(
      [w.ownerS.id, w.memberS1.id].sort(),
    );
    expect(await participantIdsOf(dCase.roomId)).toEqual([w.memberD1.id]);
    expect(await auditDetails("department.create")).toEqual([
      {
        ownerUserId: w.ownerS.id,
        previousDepartmentId: w.deptS.id,
        successorUserId: w.memberS1.id,
        caseJoinCount: 2,
      },
    ]);
  });
});

describe("#147 147-C-2 Q3: caseJoinCount を入れる監査と入れない監査", () => {
  it("#147 Q3: 後任のない部署の作成の監査には caseJoinCount を入れない（いまの detail の形のまま）", async () => {
    await caseOf([w.deptD.id], [w.memberD1.id]);
    await withDepartments(env, (r) =>
      r.create(
        {
          name: `${TEST_TAG}147C2後任なし`,
          description: "",
          ownerUserId: w.memberS1.id,
          previousDepartmentSuccessorUserId: null,
          previousDepartmentVersion: null,
        },
        { actorId: w.admin.id, traceId: casereqTraceId() },
      ),
    );
    expect(await auditDetails("department.create")).toEqual([
      {
        ownerUserId: w.memberS1.id,
        previousDepartmentId: null,
        successorUserId: null,
      },
    ]);
  });

  it("#147 Q3: オーナーの交代の監査には、入った行が0でも caseJoinCount: 0 を必ず入れる", async () => {
    await changeOwner({ departmentId: w.deptS.id, ownerUserId: w.memberS1.id });
    expect(await auditDetails("department.owner_change")).toEqual([
      {
        previousOwnerUserId: w.ownerS.id,
        newOwnerUserId: w.memberS1.id,
        previousDepartmentId: null,
        successorUserId: null,
        previousVersion: 1,
        nextVersion: 2,
        caseJoinCount: 0,
      },
    ]);
  });
});

describe("#147 147-C-2 Q3: 承認とオーナー交代の順", () => {
  async function pendingRequest() {
    return insertCaseRequest({
      clientId: w.clientA.id,
      title: `${TEST_TAG}147C2承認と交代`,
      requestedBy: w.memberS2.id,
      departmentIds: [w.deptS.id],
      description: "[UNIT_TEST]説明",
      dueDate: "2026-12-01",
    });
  }

  const approve = (requestId: string, deciderId: string) =>
    withCaseRequests(env, (r) =>
      r.approve({
        requestId,
        version: 1,
        deciderId,
        additionalCandidateIds: [],
        now: "2026-11-17T03:00:00.000Z",
        traceId: casereqTraceId(),
      }),
    );

  it("#147 Q3: 承認が先で交代が後でも、新しいオーナーは参加者になる", async () => {
    const requestId = await pendingRequest();
    const { roomId } = await approve(requestId, w.ownerS.id);
    expect(await participantIdsOf(roomId)).not.toContain(w.memberS1.id);
    await changeOwner({ departmentId: w.deptS.id, ownerUserId: w.memberS1.id });
    expect(await participantIdsOf(roomId)).toContain(w.memberS1.id);
  });

  it("#147 Q3: 交代が先で承認が後でも、新しいオーナーは参加者になる（重複しない）", async () => {
    const requestId = await pendingRequest();
    await changeOwner({ departmentId: w.deptS.id, ownerUserId: w.memberS1.id });
    const { roomId } = await approve(requestId, w.memberS1.id);
    const ids = await participantIdsOf(roomId);
    expect(ids.filter((id) => id === w.memberS1.id)).toHaveLength(1);
  });
});
