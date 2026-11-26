// #339 AC-1（決定1）：スレッド一覧・返信の取得の成功応答に caseId を足しても、perm.case.view だけを外した利用者には、案件の中身も案件の ID も出さない。
// 外し方：固定ロールはすべて perm.case.* を持つため、API では作れない。既存の慣例（case-room.permissions.test.ts）どおり、
//   偽の authorizer（dm-fixtures の fakeAuthorizer）を Service に渡す。Repository は本物（隔離 D1）。
// API 結合の側（成功応答の caseId・非参加者の 404・ページング）は routes/threads.case-id.test.ts・routes/messages.replies.case-room.test.ts にある。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupCaseRoomWorld,
  insertCaseWorldDm,
  seedRoomMessage,
  seedRoomReply,
  setupCaseRoomWorld,
  type CaseRoomWorld,
} from "../../test/case-room-fixtures";
import { fakeAuthorizer } from "../../test/dm-fixtures";
import { ZERO } from "../../test/thread-fixtures";
import { withMessages } from "../db/message.repository";
import { withThreads } from "../db/thread.repository";
import { createMessageService } from "./message.service";
import { createThreadService } from "./thread.service";

let cw: CaseRoomWorld;

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  cw = await setupCaseRoomWorld(1680);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupCaseRoomWorld();
});

/**
 * memberS1 から見て、案件の部屋・通常のチャンネル・DM が混ざる 5 スレッドを入れる（routes/threads.case-id.test.ts と同じ形）。
 * 最後の返信の番号：E=14・D=13・C=12・B=11・A=10（並びは E, D, C, B, A）。
 */
async function seedMixed() {
  const s1 = cw.w.memberS1.id;
  const d1 = cw.w.memberD1.id;
  const dm = await insertCaseWorldDm(s1, d1);
  const a = await seedRoomMessage(cw.open.roomId, s1, 1);
  const b = await seedRoomMessage(cw.normal, s1, 2);
  const c = await seedRoomMessage(dm, d1, 3);
  const d = await seedRoomMessage(cw.open.roomId, d1, 4);
  const e = await seedRoomMessage(cw.normal, d1, 5);
  await seedRoomReply(cw.open.roomId, a, d1, 10);
  await seedRoomReply(cw.normal, b, d1, 11);
  await seedRoomReply(dm, c, s1, 12);
  await seedRoomReply(cw.open.roomId, d, s1, 13);
  await seedRoomReply(cw.normal, e, s1, 14);
  return { a, b, c, d, e, dm };
}

describe("#339 AC-1 スレッド一覧の caseId と、閲覧の制限の維持（Service の層）", () => {
  it("#339 AC-1: 案件の対応情報を返しても閲覧制限を維持する：perm.case.view がなければ、案件のスレッドも案件の ID も出ず、ほかの項目の caseId は null", async () => {
    const t = await seedMixed();
    const outcome = await withThreads(env, (repository) =>
      createThreadService(repository, {
        authorizer: fakeAuthorizer(["perm.case.view"]),
      }).list(
        { userId: cw.w.memberS1.id, traceId: "unit-339-case-id" },
        { limit: 100 },
      ),
    );
    expect(JSON.stringify(outcome)).not.toContain(cw.open.id);
    expect(outcome.items.map((item) => item.parent.id)).toEqual([
      t.e,
      t.c,
      t.b,
    ]);
    expect(
      outcome.items.map((item) => ({
        parent: item.parent.id,
        caseId: (item as { caseId?: unknown }).caseId,
      })),
    ).toEqual([
      { parent: t.e, caseId: null },
      { parent: t.c, caseId: null },
      { parent: t.b, caseId: null },
    ]);
  });
});

describe("#339 AC-1 返信の取得の成功応答の caseId と、閲覧の制限の維持（Service の層）", () => {
  it.each([
    ["最新", { limit: 50 }],
    ["after", { after: ZERO, limit: 50 }],
  ] as const)(
    "#339 AC-1: 案件の対応情報を返しても閲覧制限を維持する：perm.case.view がなければ 403 で、エラーに caseId も案件の ID も含めない（%s）",
    async (_l, query) => {
      const parent = await seedRoomMessage(cw.open.roomId, cw.w.memberS1.id, 9);
      await seedRoomReply(cw.open.roomId, parent, cw.w.memberD1.id, 10);
      const me = {
        userId: cw.w.memberS1.id,
        traceId: "unit-339-case-id",
        reauthenticatedAt: new Date().toISOString(),
      };
      const outcome = await withMessages(env, (repository) =>
        createMessageService(repository, {
          authorizer: fakeAuthorizer(["perm.case.view"]),
        })
          .listReplies(me, parent, query)
          .then(
            (value) => ({ value, error: null as unknown }),
            (error: unknown) => ({ value: null, error }),
          ),
      );
      expect(outcome.value).toBeNull();
      expect(outcome.error).toMatchObject({ code: "FORBIDDEN", status: 403 });
      expect(Object.hasOwn(outcome.error as object, "caseId")).toBe(false);
      expect(JSON.stringify(outcome.error)).not.toContain(cw.open.id);
    },
  );
});
