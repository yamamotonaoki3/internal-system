// #150（150-B）5-1 AC-16・AC-13、3-3 AC-2・AC-3、EP-5-12：再開のときの参加者の選び直し（POST /api/cases/:caseId/reopen の本文）を、
// 実際のアプリ入口（index.ts の app）と隔離 D1 で確かめる。
// この層で確かめるもの（計画 150-B 10章の「結合」の行）：
//   - 本文の形（422）：本文なし・余分な項目・ULID でない・配列の中の重複・add と remove の重なり・remove が participantIds にない・
//     add が participantIds と重なる・上限（追加 100 人・外す 100 人）超え。非参加者には本文が壊れていても 403、案件がなければ 404（判定の順）
//   - 1人を外し1人を足して再開：状態・参加の行・無効な人の行が残ること・通知の宛先・個別の通知の種類がないこと・監査
//   - 外した人は詳細が 403・部屋のメッセージが 404（部屋の存在を明かさない。5-2 AC-3・docs/design/cases.md）、足した人は再開の前のメッセージを読める
//   - 選び直しなし（空の配列）は 150-A と同じ結果
//   - participants_changed・本人を外す 422・自動参加 409・追加の無効と不在 422（同じ本文）
//   - participantIds に上限がない：501 人以上の案件を選び直しなしで再開できる。500 人から1人足して再開 → 終了 → 選び直しなしで再開の往復
// batch の前提の網羅・件数の確認は DB（db/case-reopen-reselect.db.test.ts）、同時の操作は割り込み（services/case-reopen-reselect.interleave.test.ts）で確かめる。
// 契約（実装前の仮置き。計画 150-B 6.1。実装の担当へ）：本文は strict で必須の
//   { participantIds: string[]（確認の画面で見た有効な参加者・本人を含む）, addUserIds: string[], removeUserIds: string[] }。応答は 200 { caseId, status: "active" }。
// 期待値は要件 5-1 AC-16・AC-13、3-3 AC-2・AC-3 と計画 150-B 6.1・6.5 から決める。データは架空（testuser_casereq_・testuser_case150_・[UNIT_TEST]・@example.com）。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import {
  CASES_BASE,
  MISSING_CASE_ID,
  joinedAt,
  seedCase,
  type SeededCase,
} from "../../test/case-fixtures";
import {
  addCaseMembers,
  caseCloseAudits,
  caseCloseSnapshot,
  caseRowOf,
  closePath,
  recipientsOf,
  reopenPath,
} from "../../test/case-close-fixtures";
import {
  CASE_REOPEN_MESSAGES,
  CASE_REOPEN_REASONS,
  REOPEN_LIMITS,
  activeParticipantIdsOf,
  insertBulkUsersFast,
  notificationKindsFor,
  participantAudits,
  type ReopenBody,
} from "../../test/case-reopen-fixtures";
import {
  isFlat,
  parseDetail,
  participantIdsOf,
} from "../../test/case-participant-fixtures";
import {
  CASEREQ_NOW,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import {
  cleanupCaseRoomWorld,
  seedRoomMessage,
} from "../../test/case-room-fixtures";

type ErrorBody = {
  code: string;
  message: string;
  fields?: string[];
  reason?: string;
};

let w: CaseWorld;
/** 終了中・deptS 担当：memberS1・memberD1・memberS2・admin（自動参加の全体管理者）・inactive（退職者の行）。noDept・ownerS は参加していない */
let room: SeededCase;
/** 再開の前に memberD1 が投稿したメッセージ */
let pastMessageId: string;

const reopen = (caseId: string, token: string | null, body?: unknown) =>
  apiRequest("POST", reopenPath(caseId), { token, body });

/** 確認の画面で見た参加者（いまの有効な参加者）を participantIds にした本文 */
async function bodyFor(
  roomId: string,
  change: Partial<Omit<ReopenBody, "participantIds">> = {},
): Promise<ReopenBody> {
  return {
    participantIds: await activeParticipantIdsOf(roomId),
    addUserIds: change.addUserIds ?? [],
    removeUserIds: change.removeUserIds ?? [],
  };
}

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

const sorted = (ids: string[]) => [...ids].sort();
/** 架空の ULID（存在しない社員。I・L・O・U を使わない 26 文字） */
const fakeUlid = (i: number) =>
  `01JTESTCASE150BFK${String(i).padStart(9, "0")}`;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(CASEREQ_NOW));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  w = await setupCaseWorld();
  room = await seedCase({
    n: 1601,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]150選び直しの結合",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    status: "closed",
    members: [
      { userId: w.memberS1.id, joinedAt: joinedAt(1) },
      { userId: w.memberD1.id, joinedAt: joinedAt(2) },
      { userId: w.memberS2.id, joinedAt: joinedAt(3) },
      { userId: w.admin.id, joinedAt: joinedAt(4) },
      { userId: w.inactive.id, joinedAt: joinedAt(5) },
    ],
  });
  pastMessageId = await seedRoomMessage(
    room.roomId,
    w.memberD1.id,
    16011,
    "[UNIT_TEST]150再開の前のやり取り",
  );
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await cleanupCaseRoomWorld();
});

describe("#150 150-B 本文の形（計画 6.1。422）", () => {
  // 表には関数だけを書く（beforeEach で代入する変数は、呼ばれた時点で読む）
  it.each([
    { name: "本文なし", body: async () => undefined },
    {
      name: "participantIds がない",
      body: async () => ({ addUserIds: [], removeUserIds: [] }),
    },
    {
      name: "addUserIds がない",
      body: async () => {
        const { participantIds, removeUserIds } = await bodyFor(room.roomId);
        return { participantIds, removeUserIds };
      },
    },
    {
      name: "removeUserIds がない",
      body: async () => {
        const { participantIds, addUserIds } = await bodyFor(room.roomId);
        return { participantIds, addUserIds };
      },
    },
    {
      name: "余分な項目がある（strict）",
      body: async () => ({ ...(await bodyFor(room.roomId)), status: "active" }),
    },
    {
      name: "配列でない",
      body: async () => ({
        ...(await bodyFor(room.roomId)),
        addUserIds: w.noDept.id,
      }),
    },
    {
      name: "addUserIds の要素が ULID でない",
      body: async () => bodyFor(room.roomId, { addUserIds: ["not-a-ulid"] }),
    },
    {
      name: "removeUserIds の要素が小文字の ULID",
      body: async () =>
        bodyFor(room.roomId, { removeUserIds: [w.memberD1.id.toLowerCase()] }),
    },
    {
      name: "participantIds の要素が ULID でない",
      body: async () => ({
        ...(await bodyFor(room.roomId)),
        participantIds: [
          ...(await activeParticipantIdsOf(room.roomId)),
          "not-a-ulid",
        ],
      }),
    },
    {
      name: "participantIds の中の重複",
      body: async () => {
        const ids = await activeParticipantIdsOf(room.roomId);
        return {
          participantIds: [...ids, w.memberD1.id],
          addUserIds: [],
          removeUserIds: [],
        };
      },
    },
    {
      name: "addUserIds の中の重複",
      body: async () =>
        bodyFor(room.roomId, { addUserIds: [w.noDept.id, w.noDept.id] }),
    },
    {
      name: "removeUserIds の中の重複",
      body: async () =>
        bodyFor(room.roomId, {
          removeUserIds: [w.memberD1.id, w.memberD1.id],
        }),
    },
    {
      name: "addUserIds と removeUserIds が重なる",
      body: async () =>
        bodyFor(room.roomId, {
          addUserIds: [w.memberD1.id],
          removeUserIds: [w.memberD1.id],
        }),
    },
    {
      name: "removeUserIds に participantIds にない人（参加していない社員）",
      body: async () => bodyFor(room.roomId, { removeUserIds: [w.noDept.id] }),
    },
    {
      name: "removeUserIds に無効な人（参加の行はあるが、確認の画面の候補にない。行は消せない。Q1）",
      body: async () =>
        bodyFor(room.roomId, { removeUserIds: [w.inactive.id] }),
    },
    {
      name: "addUserIds が participantIds と重なる",
      body: async () => bodyFor(room.roomId, { addUserIds: [w.memberD1.id] }),
    },
    {
      name: `addUserIds が上限（${REOPEN_LIMITS.add} 人）を1人超える`,
      body: async () =>
        bodyFor(room.roomId, {
          addUserIds: Array.from({ length: REOPEN_LIMITS.add + 1 }, (_, i) =>
            fakeUlid(i),
          ),
        }),
    },
    {
      name: `removeUserIds が上限（${REOPEN_LIMITS.remove} 人）を1人超える`,
      body: async () => {
        const extra = Array.from({ length: REOPEN_LIMITS.remove + 1 }, (_, i) =>
          fakeUlid(i),
        );
        return {
          participantIds: [
            ...(await activeParticipantIdsOf(room.roomId)),
            ...extra,
          ],
          addUserIds: [],
          removeUserIds: extra,
        };
      },
    },
  ])(
    "#150 6.1: $name → 422 VALIDATION_ERROR で、状態・参加・監査・通知は何も変わらない",
    async ({ body }) => {
      const value = await body();
      const before = await caseCloseSnapshot();
      await expectError(await reopen(room.id, w.memberS1.token, value), 422, {
        code: "VALIDATION_ERROR",
      });
      expect(await caseCloseSnapshot()).toEqual(before);
    },
  );

  it("#150 6.1・security: 参加していない社員には、本文が壊れていても 403（422 より先。存在・状態・参加者を漏らさない）", async () => {
    const before = await caseCloseSnapshot();
    const body = await expectError(
      await reopen(room.id, w.noDept.token, { addUserIds: "x" }),
      403,
      { code: "FORBIDDEN", message: "参加者だけが操作できます" },
    );
    expect(body.reason).toBeUndefined();
    expect(await caseCloseSnapshot()).toEqual(before);
  });

  it("#150 6.1・security: 参加していない担当部署のオーナーにも 403（R-77）", async () => {
    for (const token of [w.ownerS.token]) {
      await expectError(
        await reopen(room.id, token, await bodyFor(room.roomId)),
        403,
        { code: "FORBIDDEN" },
      );
    }
  });

  it("#150 6.1: 案件がなければ、本文が壊れていても 404「案件が見つかりません」", async () => {
    await expectError(
      await reopen(MISSING_CASE_ID, w.memberS1.token, { bad: true }),
      404,
      { code: "NOT_FOUND", message: "案件が見つかりません" },
    );
  });

  it("#150 6.1: 進行中の案件でも、本文の形の 422 が 409 already_active より先", async () => {
    await apiRequest("POST", reopenPath(room.id), {
      token: w.memberS1.token,
      body: await bodyFor(room.roomId),
    });
    await expectError(
      await reopen(room.id, w.memberS1.token, { participantIds: [] }),
      422,
      { code: "VALIDATION_ERROR" },
    );
  });
});

describe("#150 150-B 1人を外し1人を足して再開（5-1 AC-16・AC-13、3-3 AC-2・AC-3）", () => {
  it("#150 AC-16: 200 { caseId, status: active }・no-store。外した人の行はなく、足した人の行があり、無効な人の行は残る", async () => {
    const res = await reopen(
      room.id,
      w.memberS1.token,
      await bodyFor(room.roomId, {
        addUserIds: [w.noDept.id],
        removeUserIds: [w.memberD1.id],
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control") ?? "").toContain("no-store");
    expect(await res.json()).toEqual({ caseId: room.id, status: "active" });
    expect(await caseRowOf(room.id)).toMatchObject({
      status: "active",
      version: 2,
    });
    expect(await participantIdsOf(room.roomId)).toEqual(
      sorted([
        w.memberS1.id,
        w.memberS2.id,
        w.admin.id,
        w.inactive.id,
        w.noDept.id,
      ]),
    );
  });

  it("#150 3-3 AC-2・AC-3: 通知 case.reopened は、選び直しの後の有効な参加者から本人を除いた人だけ（外した人にはなく、足した人にはある）。追加・除外の個別の通知の種類はない", async () => {
    expect(
      (
        await reopen(
          room.id,
          w.memberS1.token,
          await bodyFor(room.roomId, {
            addUserIds: [w.noDept.id],
            removeUserIds: [w.memberD1.id],
          }),
        )
      ).status,
    ).toBe(200);
    expect(await recipientsOf("case.reopened")).toEqual(
      sorted([w.memberS2.id, w.admin.id, w.noDept.id]),
    );
    expect(
      await notificationKindsFor([
        w.memberS1.id,
        w.memberD1.id,
        w.memberS2.id,
        w.admin.id,
        w.noDept.id,
        w.inactive.id,
      ]),
    ).toEqual(["case.reopened"]);
  });

  it("#150 5-1 AC-13: 監査 case.reopen の detail は { caseId, notifiedCount, addedCount, removedCount }。人ごとの case.participant.add／remove に viaReopen: true（平ら・氏名なし）", async () => {
    await reopen(
      room.id,
      w.memberS1.token,
      await bodyFor(room.roomId, {
        addUserIds: [w.noDept.id],
        removeUserIds: [w.memberD1.id],
      }),
    );
    const audits = await caseCloseAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_id: w.memberS1.id,
      action: "case.reopen",
      target_type: "case",
      target_id: room.id,
      result: "success",
    });
    expect(parseDetail(audits[0]?.detail ?? null)).toEqual({
      caseId: room.id,
      notifiedCount: 3,
      addedCount: 1,
      removedCount: 1,
    });
    const people = await participantAudits();
    expect(
      people.map((row) => ({
        actor: row.actor_id,
        action: row.action,
        targetType: row.target_type,
        target: row.target_id,
        result: row.result,
        detail: parseDetail(row.detail),
      })),
    ).toEqual(
      expect.arrayContaining([
        {
          actor: w.memberS1.id,
          action: "case.participant.add",
          targetType: "case",
          target: room.id,
          result: "success",
          detail: { caseId: room.id, userId: w.noDept.id, viaReopen: true },
        },
        {
          actor: w.memberS1.id,
          action: "case.participant.remove",
          targetType: "case",
          target: room.id,
          result: "success",
          detail: {
            caseId: room.id,
            userId: w.memberD1.id,
            self: false,
            viaReopen: true,
          },
        },
      ]),
    );
    expect(people).toHaveLength(2);
    for (const row of [...audits, ...people]) {
      expect(isFlat(parseDetail(row.detail))).toBe(true);
      expect(row.detail ?? "").not.toContain("テスト太郎");
    }
  });

  it("#150 AC-16（過去の情報の共有）: 外した人は詳細が 403・部屋のメッセージが 404（部屋の存在を明かさない。5-2 AC-3・docs/design/cases.md）、足した人は再開の前のメッセージを読める", async () => {
    await reopen(
      room.id,
      w.memberS1.token,
      await bodyFor(room.roomId, {
        addUserIds: [w.noDept.id],
        removeUserIds: [w.memberD1.id],
      }),
    );
    const messages = (token: string) =>
      apiRequest("GET", `/api/rooms/${room.roomId}/messages?limit=50`, {
        token,
      });
    expect(
      (
        await apiRequest("GET", `${CASES_BASE}/${room.id}/detail`, {
          token: w.memberD1.token,
        })
      ).status,
    ).toBe(403);
    expect((await messages(w.memberD1.token)).status).toBe(404);
    const added = await messages(w.noDept.token);
    expect(added.status).toBe(200);
    expect(
      ((await added.json()) as { items: { id: string }[] }).items.map(
        (item) => item.id,
      ),
    ).toContain(pastMessageId);
    expect(
      (
        await apiRequest("GET", `${CASES_BASE}/${room.id}/detail`, {
          token: w.noDept.token,
        })
      ).status,
    ).toBe(200);
  });
});

describe("#150 150-B 選び直しなし（Q7：空の配列も同じ経路）", () => {
  it("#150 AC-10・Q7: 2つの配列が空なら、参加の行は変わらず、通知はいまの有効な参加者から本人を除いた人、監査の addedCount・removedCount は 0、人ごとの監査はない", async () => {
    const before = await caseCloseSnapshot();
    expect(
      (await reopen(room.id, w.memberS1.token, await bodyFor(room.roomId)))
        .status,
    ).toBe(200);
    expect((await caseCloseSnapshot()).members).toEqual(before.members);
    expect(await recipientsOf("case.reopened")).toEqual(
      sorted([w.memberD1.id, w.memberS2.id, w.admin.id]),
    );
    expect(parseDetail((await caseCloseAudits())[0]?.detail ?? null)).toEqual({
      caseId: room.id,
      notifiedCount: 3,
      addedCount: 0,
      removedCount: 0,
    });
    expect(await participantAudits()).toEqual([]);
  });
});

describe("#150 150-B 判定の結果（計画 6.1 の 6〜10）", () => {
  it.each([
    {
      name: "画面で見た参加者に、いまは有効でない人が入っている（集合が違う）→ 409 participants_changed",
      body: async () => ({
        participantIds: sorted([
          ...(await activeParticipantIdsOf(room.roomId)),
          w.inactive.id,
        ]),
        addUserIds: [],
        removeUserIds: [],
      }),
      status: 409,
      expected: {
        code: "CONFLICT",
        reason: CASE_REOPEN_REASONS.participantsChanged,
        message: CASE_REOPEN_MESSAGES.participantsChanged,
      },
    },
    {
      name: "画面で見た参加者が、いまの有効な参加者より1人少ない→ 409 participants_changed",
      body: async () => ({
        participantIds: (await activeParticipantIdsOf(room.roomId)).filter(
          (id) => id !== w.memberS2.id,
        ),
        addUserIds: [],
        removeUserIds: [],
      }),
      status: 409,
      expected: {
        code: "CONFLICT",
        reason: CASE_REOPEN_REASONS.participantsChanged,
      },
    },
    {
      name: "再開する本人を外す → 422 fields [removeUserIds]「再開する本人は外せません」",
      body: async () =>
        bodyFor(room.roomId, { removeUserIds: [w.memberS1.id] }),
      status: 422,
      expected: {
        code: "VALIDATION_ERROR",
        fields: ["removeUserIds"],
        message: CASE_REOPEN_MESSAGES.cannotRemoveSelf,
      },
    },
    {
      name: "自動参加の全体管理者を外す → 409 auto_participant",
      body: async () => bodyFor(room.roomId, { removeUserIds: [w.admin.id] }),
      status: 409,
      expected: {
        code: "CONFLICT",
        reason: CASE_REOPEN_REASONS.autoParticipant,
        message: CASE_REOPEN_MESSAGES.autoParticipant,
      },
    },
    {
      name: "無効な社員を足す → 422 fields [addUserIds]「追加できる社員を選んでください」",
      body: async () => bodyFor(room.roomId, { addUserIds: [w.inactive.id] }),
      status: 422,
      expected: {
        code: "VALIDATION_ERROR",
        fields: ["addUserIds"],
        message: CASE_REOPEN_MESSAGES.targetInvalid,
      },
    },
    {
      name: "存在しない社員を足す → 422（無効と同じ本文）",
      body: async () => bodyFor(room.roomId, { addUserIds: [fakeUlid(1)] }),
      status: 422,
      expected: {
        code: "VALIDATION_ERROR",
        fields: ["addUserIds"],
        message: CASE_REOPEN_MESSAGES.targetInvalid,
      },
    },
  ])(
    "#150 5-1 AC-16: $name。状態・参加・監査・通知は何も変わらない",
    async ({ body, status, expected }) => {
      const value = await body();
      const before = await caseCloseSnapshot();
      await expectError(
        await reopen(room.id, w.memberS1.token, value),
        status,
        expected,
      );
      expect(await caseCloseSnapshot()).toEqual(before);
    },
  );

  it("#150 5-1 AC-16（Q2）: 自動参加の担当部署のオーナーを外す → 409 auto_participant", async () => {
    await addCaseMembers(room.roomId, [w.ownerS.id], joinedAt(6));
    const before = await caseCloseSnapshot();
    await expectError(
      await reopen(
        room.id,
        w.memberS1.token,
        await bodyFor(room.roomId, { removeUserIds: [w.ownerS.id] }),
      ),
      409,
      { reason: CASE_REOPEN_REASONS.autoParticipant },
    );
    expect(await caseCloseSnapshot()).toEqual(before);
  });
});

describe("#150 150-B 参加者の上限なし（レビュー1回目の重大3）", () => {
  it("#150 6.1: 有効な参加者が 501 人以上の案件を、選び直しなしで再開できる（通知は本人を除く全員）", async () => {
    const bulk = await insertBulkUsersFast(497, w.deptD.id);
    await addCaseMembers(room.roomId, bulk, joinedAt(10));
    const body = await bodyFor(room.roomId);
    expect(body.participantIds.length).toBeGreaterThanOrEqual(501);
    const res = await reopen(room.id, w.memberS1.token, body);
    expect(res.status).toBe(200);
    expect(await recipientsOf("case.reopened")).toHaveLength(
      body.participantIds.length - 1,
    );
  });

  it("#150 6.1: 有効な参加者 500 人から1人足して再開 → 終了 → 選び直しなしで再開の往復が通る", async () => {
    // いまの有効な参加者は4人（memberS1・memberD1・memberS2・admin）。496 人を足して 500 人にする
    const bulk = await insertBulkUsersFast(496, w.deptD.id);
    await addCaseMembers(room.roomId, bulk, joinedAt(10));
    expect(await activeParticipantIdsOf(room.roomId)).toHaveLength(500);
    expect(
      (
        await reopen(
          room.id,
          w.memberS1.token,
          await bodyFor(room.roomId, { addUserIds: [w.noDept.id] }),
        )
      ).status,
    ).toBe(200);
    expect(await activeParticipantIdsOf(room.roomId)).toHaveLength(501);
    expect(
      (
        await apiRequest("POST", closePath(room.id), {
          token: w.memberS1.token,
        })
      ).status,
    ).toBe(200);
    expect(
      (await reopen(room.id, w.memberD1.token, await bodyFor(room.roomId)))
        .status,
    ).toBe(200);
    expect(await caseRowOf(room.id)).toMatchObject({
      status: "active",
      version: 4,
    });
  });
});
