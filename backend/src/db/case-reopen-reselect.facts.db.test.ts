// #324（#150 150-B のミューテーションの生き残り）：再開の判定の材料（case.repository.ts の findReopenFacts）の管理の資格（actorCanManage）を、
// 隔離 D1 で確かめる。既存の case-reopen-reselect.db.test.ts は、参加者の操作者でしか読まず、actorCanManage を見ていなかった。
// 期待値は設計書 docs/design/cases.md「管理の資格と参加者数」：操作者が有効で、(a) 有効な全体管理者、または (b) その案件の担当部署の有効なオーナー。
// 参加しているかどうかには依らない（参加していない管理者でも真、参加している一般の人は偽）。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupCaseTestData,
  joinedAt,
  seedCase,
  type SeededCase,
} from "../../test/case-fixtures";
import {
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import { withCases } from "./case.repository";

let w: CaseWorld;
/** 終了中・deptD 担当：memberS2・memberD1 が参加。ownerD（deptD のオーナー）・admin・ownerS・noDept は参加していない */
let room: SeededCase;

beforeEach(async () => {
  w = await setupCaseWorld();
  room = await seedCase({
    n: 3241,
    clientId: w.clientB.id,
    code: "QZB",
    title: "[UNIT_TEST]324再開の材料",
    createdBy: w.memberS2.id,
    departmentIds: [w.deptD.id],
    status: "closed",
    members: [
      { userId: w.memberS2.id, joinedAt: joinedAt(1) },
      { userId: w.memberD1.id, joinedAt: joinedAt(2) },
    ],
  });
});

afterEach(async () => {
  await cleanupCaseTestData();
});

const factsFor = (actorId: string) =>
  withCases(env, (r) =>
    r.findReopenFacts({
      caseId: room.id,
      actorId,
      addUserIds: [],
      removeUserIds: [],
    }),
  );

describe("#324 #150 150-B findReopenFacts の管理の資格（actorCanManage）", () => {
  it.each([
    [
      "参加していない担当部署のオーナー（ownerD）",
      () => w.ownerD.id,
      true,
      false,
    ],
    ["参加していない全体管理者（admin）", () => w.admin.id, true, false],
    ["担当部署でない部署のオーナー（ownerS）", () => w.ownerS.id, false, false],
    ["参加していない一般の人（noDept）", () => w.noDept.id, false, false],
    ["参加している一般の人（memberD1）", () => w.memberD1.id, false, true],
  ] as const)(
    "#324 #150: %s は actorCanManage=%s・actorIsParticipant=%s",
    async (_label, actorOf, canManage, isParticipant) => {
      const facts = await factsFor(actorOf());
      expect(facts).not.toBeNull();
      expect(facts?.actorCanManage).toBe(canManage);
      expect(facts?.actorIsParticipant).toBe(isParticipant);
    },
  );
});
