// #147（147-C-2）0-1 AC-19：部署の異動では、案件の参加の状態を変えない（コードは変えず、いまの作りをテストで固定する）。
// 異動の Repository（本物の batch。隔離 D1）の前後で、案件専用チャンネル（purpose=case）の参加の行が同じで、
// 旧部署の専用チャンネル2つから外れ、新部署の専用チャンネル2つに入ることを確かめる。旧部署が担当部署の案件でも、参加は残る。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupCaseTestData,
  joinedAt,
  seedCase,
} from "../../test/case-fixtures";
import {
  casereqTraceId,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import { withAccounts } from "./account.repository";

let w: CaseWorld;

async function rowsOf(userId: string) {
  const { results } = await env.DB.prepare(
    "SELECT channel_id, joined_at FROM channel_members WHERE user_id = ? ORDER BY channel_id",
  )
    .bind(userId)
    .all<{ channel_id: string; joined_at: string }>();
  return results;
}

async function caseRowsOf(userId: string) {
  const { results } = await env.DB.prepare(
    `SELECT m.channel_id, m.joined_at FROM channel_members m
     JOIN channels c ON c.room_id = m.channel_id
     WHERE m.user_id = ? AND c.purpose = 'case' ORDER BY m.channel_id`,
  )
    .bind(userId)
    .all<{ channel_id: string; joined_at: string }>();
  return results;
}

beforeEach(async () => {
  w = await setupCaseWorld();
});

afterEach(async () => {
  await cleanupCaseTestData();
});

describe("#147 147-C-2 0-1 AC-19: 異動では、案件の参加の状態を変えない", () => {
  it("#147 0-1 AC-19: 旧部署が担当の案件・ほかの部署の案件・終了した案件の参加の行は、異動の前後で同じ（joined_at も）", async () => {
    const target = w.memberS2.id;
    const sameDept = await seedCase({
      n: 91,
      clientId: w.clientA.id,
      code: "QZA",
      title: "[UNIT_TEST]147C2異動・旧部署",
      createdBy: w.memberS1.id,
      departmentIds: [w.deptS.id],
      members: [
        { userId: w.memberS1.id, joinedAt: joinedAt(1) },
        { userId: target, joinedAt: joinedAt(2) },
      ],
    });
    const otherDept = await seedCase({
      n: 92,
      clientId: w.clientA.id,
      code: "QZA",
      title: "[UNIT_TEST]147C2異動・他部署",
      createdBy: w.memberD1.id,
      departmentIds: [w.deptD.id],
      members: [
        { userId: w.memberD1.id, joinedAt: joinedAt(3) },
        { userId: target, joinedAt: joinedAt(4) },
      ],
    });
    const closed = await seedCase({
      n: 93,
      clientId: w.clientA.id,
      code: "QZA",
      title: "[UNIT_TEST]147C2異動・終了",
      createdBy: w.memberS1.id,
      departmentIds: [w.deptS.id],
      status: "closed",
      members: [{ userId: target, joinedAt: joinedAt(5) }],
    });
    const before = await caseRowsOf(target);
    expect(before.map((r) => r.channel_id)).toEqual(
      [sameDept.roomId, otherDept.roomId, closed.roomId].sort(),
    );

    await withAccounts(env, (r) =>
      r.transfer({
        targetId: target,
        fromDepartmentId: w.deptS.id,
        toDepartmentId: w.deptD.id,
        actorId: w.admin.id,
        now: "2026-11-17T07:00:00.000Z",
        traceId: casereqTraceId(),
      }),
    );

    expect(await caseRowsOf(target)).toEqual(before);
    const channels = (await rowsOf(target)).map((r) => r.channel_id);
    expect(channels).not.toContain(w.deptS.dedicatedChannelId);
    expect(channels).not.toContain(w.deptS.announcementChannelId);
    expect(channels).toEqual(
      expect.arrayContaining([
        w.deptD.dedicatedChannelId,
        w.deptD.announcementChannelId,
      ]),
    );
  });
});
