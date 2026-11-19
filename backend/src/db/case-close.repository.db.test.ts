// #150（150-A）5-1 AC-8・AC-9・AC-10（C-142(2)）・AC-13、3-3 AC-1・AC-2：案件の終了・再開の Repository（本物の db.batch。隔離 D1）。
// この層で確かめるもの（計画 150-A 10章の「DB」の行）：
//   - 終了・再開で状態が変わり、版に1を足し、更新日時が今になる。監査（case.close・case.reopen）が1件で、detail は { caseId, notifiedCount } だけ
//   - 通知（case.closed・case.reopened）は渡した宛先だけに作る。room_id・message_id は NULL、target_id は案件の ID
//   - 宛先の読み取り（listCaseNotifyRecipients）は「有効な参加者から本人を除く」（無効な参加者・参加していない全体管理者は含まない。自動参加の人は含む）
//   - AC-8：終了しても、案件専用チャンネルの行・参加の行（退職者の行を含む）には触れず、チャンネルのアーカイブの記録を作らない
//   - #196 の前提（状態・操作者が有効な参加者・宛先が読んだまま・版が読んだまま・案件がある）のどれかが崩れていると、CaseStateChangedError で何も残らない
//   - D1 の上限：有効な参加者 120 人の案件でも、終了・再開が1回で成り立つ（通知 119 件）
//   - 同時の2回の終了・再開では1回分だけ。参加者の追加・削除では版が変わらない（宛先の一致で検出する前提）
// 判定の順・応答は Service・結合のテストで確かめ、ここでは重ねない。
// 契約（実装前の仮置き。計画 150-A 6.3・8章。実装の担当へ）：backend/src/db/case.repository.ts の createCaseRepository に
//   closeCase(input: CaseStatusWriteInput): Promise<void>・reopenCase(input: CaseReopenWriteInput): Promise<void>（150-B で本文つき。ここでは選び直しなしで呼ぶ）
//     input = { caseId, actorId, version（最初の判定で読んだ版）, recipientIds（読んだ宛先）, traceId }。前提が崩れていたら CaseStateChangedError
//   listCaseNotifyRecipients(caseId, actorId): Promise<string[]>（ID の昇順）
//   findWriteFacts の結果に version（cases.version）を足す
// 時刻は CLOSE_NOW に固定する。データは架空（testuser_casereq_・testuser_case150_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MISSING_CASE_ID,
  addCaseMember,
  cleanupCaseTestData,
  joinedAt,
  removeCaseMember,
  seedCase,
  type SeededCase,
} from "../../test/case-fixtures";
import {
  addCaseMembers,
  caseCloseAudits,
  caseCloseNotifications,
  caseCloseSnapshot,
  caseRowOf,
  insertBulkUsers,
  recipientsOf,
} from "../../test/case-close-fixtures";
import { parseDetail } from "../../test/case-participant-fixtures";
import {
  activeParticipantIdsOf,
  roomIdOf,
} from "../../test/case-reopen-fixtures";
import {
  casereqTraceId,
  setUserActive,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import { CaseStateChangedError, withCases } from "./case.repository";

const CLOSE_NOW = "2026-11-18T02:00:00.000Z";

let w: CaseWorld;
/** 進行中・deptS 担当：memberS1（操作者）・memberD1・ownerS（自動参加のオーナー）・admin（自動参加の全体管理者）・inactive（退職者） */
let main: SeededCase;
/** 終了・deptS 担当：参加者は main と同じ */
let closed: SeededCase;
/** 進行中・deptD 担当：memberS2・memberD1。全体管理者は参加していない（比べる相手。終了・再開で変わらないこと） */
let other: SeededCase;

type Kind = "close" | "reopen";
type WriteInput = {
  caseId: string;
  actorId: string;
  version: number;
  recipientIds: string[];
};

type ReopenExtras = { participantIds?: string[] };

/**
 * 再開は 150-B から本文つき（CaseReopenWriteInput）。150-A のテストは選び直しなし（空の追加・除外）で呼ぶ。
 * participantIds を渡さなければ、呼んだ時点のいまの有効な参加者（読んだ後に参加者を変える行は、変える前に読んだ値を渡す）
 */
const write = async (kind: Kind, input: WriteInput & ReopenExtras) => {
  const { participantIds, ...base } = input;
  if (kind === "close")
    return withCases(env, (r) =>
      r.closeCase({ ...base, traceId: casereqTraceId() }),
    );
  const roomId = await roomIdOf(base.caseId);
  const seen =
    participantIds ??
    (roomId === null ? [] : await activeParticipantIdsOf(roomId));
  return withCases(env, (r) =>
    r.reopenCase({
      ...base,
      participantIds: seen,
      addUserIds: [],
      removeUserIds: [],
      readRecipientIds: base.recipientIds,
      traceId: casereqTraceId(),
    }),
  );
};

const recipientsFor = (caseId: string, actorId: string) =>
  withCases(env, (r) => r.listCaseNotifyRecipients(caseId, actorId));

const sorted = (ids: string[]) => [...ids].sort();

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(CLOSE_NOW));
  w = await setupCaseWorld();
  const members = [
    { userId: w.memberS1.id, joinedAt: joinedAt(1) },
    { userId: w.memberD1.id, joinedAt: joinedAt(2) },
    { userId: w.ownerS.id, joinedAt: joinedAt(3) },
    { userId: w.admin.id, joinedAt: joinedAt(4) },
    { userId: w.inactive.id, joinedAt: joinedAt(5) },
  ];
  main = await seedCase({
    n: 1501,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]150終了",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    members,
  });
  closed = await seedCase({
    n: 1502,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]150再開",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    status: "closed",
    members,
  });
  other = await seedCase({
    n: 1503,
    clientId: w.clientB.id,
    code: "QZB",
    title: "[UNIT_TEST]150別の案件",
    createdBy: w.memberS2.id,
    departmentIds: [w.deptD.id],
    members: [
      { userId: w.memberS2.id, joinedAt: joinedAt(1) },
      { userId: w.memberD1.id, joinedAt: joinedAt(2) },
    ],
  });
});

afterEach(async () => {
  vi.useRealTimers();
  await cleanupCaseTestData();
});

describe("#150 150-A 宛先の読み取り（3-3 AC-1・AC-2）", () => {
  it("#150 3-3 AC-1: 有効な参加者から本人を除く（自動参加のオーナー・全体管理者を含み、退職者・非参加者を含まない）。ID の昇順", async () => {
    expect(await recipientsFor(main.id, w.memberS1.id)).toEqual(
      sorted([w.memberD1.id, w.ownerS.id, w.admin.id]),
    );
  });

  it("#150 3-3 AC-2: 参加していない全体管理者・担当部署のオーナーは宛先に入らない（全社員公開を見るだけの人に送らない）", async () => {
    expect(await recipientsFor(other.id, w.memberS2.id)).toEqual([
      w.memberD1.id,
    ]);
  });

  it("#150 3-3 AC-1: 終了中の案件でも、宛先は同じ規則（再開の宛先）", async () => {
    expect(await recipientsFor(closed.id, w.memberD1.id)).toEqual(
      sorted([w.memberS1.id, w.ownerS.id, w.admin.id]),
    );
  });
});

describe("#150 150-A 5-1 AC-9・3-3 AC-1：終了", () => {
  it("#150 AC-9: 状態が closed になり、版に1を足し、更新日時が今になる。ほかの案件は変わらない", async () => {
    const before = await caseCloseSnapshot();
    await write("close", {
      caseId: main.id,
      actorId: w.memberS1.id,
      version: 1,
      recipientIds: await recipientsFor(main.id, w.memberS1.id),
    });
    expect(await caseRowOf(main.id)).toEqual({
      status: "closed",
      version: 2,
      updated_at: CLOSE_NOW,
    });
    const after = await caseCloseSnapshot();
    expect(after.cases.filter((c) => c.id !== main.id)).toEqual(
      before.cases.filter((c) => c.id !== main.id),
    );
  });

  it("#150 AC-13: 監査 case.close が1件で、detail は { caseId, notifiedCount } だけ（氏名・本文を入れない）", async () => {
    await write("close", {
      caseId: main.id,
      actorId: w.memberS1.id,
      version: 1,
      recipientIds: await recipientsFor(main.id, w.memberS1.id),
    });
    const audits = await caseCloseAudits();
    expect(audits).toHaveLength(1);
    const [audit] = audits;
    expect(audit).toMatchObject({
      actor_id: w.memberS1.id,
      action: "case.close",
      target_type: "case",
      target_id: main.id,
      result: "success",
    });
    expect(parseDetail(audit?.detail ?? null)).toEqual({
      caseId: main.id,
      notifiedCount: 3,
    });
  });

  it("#150 3-3 AC-1: 通知 case.closed は、本人を除く有効な参加者（自動参加の人を含む）だけに作る。部屋・メッセージは NULL、target_id は案件", async () => {
    await write("close", {
      caseId: main.id,
      actorId: w.memberS1.id,
      version: 1,
      recipientIds: await recipientsFor(main.id, w.memberS1.id),
    });
    const rows = await caseCloseNotifications();
    expect(rows).toEqual(
      sorted([w.memberD1.id, w.ownerS.id, w.admin.id]).map((userId) => ({
        user_id: userId,
        kind: "case.closed",
        room_id: null,
        message_id: null,
        target_id: main.id,
      })),
    );
    // 本人・退職者・非参加者には作らない
    const users = rows.map((row) => row.user_id);
    for (const excluded of [
      w.memberS1.id,
      w.inactive.id,
      w.memberS2.id,
      w.ownerD.id,
    ])
      expect(users).not.toContain(excluded);
  });

  it("#150 3-3 AC-1: 宛先が0人（本人のほかに有効な参加者がいない）でも終了でき、通知は作らず、監査の notifiedCount は 0", async () => {
    const lonely = await seedCase({
      n: 1504,
      clientId: w.clientA.id,
      code: "QZA",
      title: "[UNIT_TEST]150ひとり",
      createdBy: w.memberS1.id,
      departmentIds: [w.deptD.id],
      members: [
        { userId: w.memberS1.id, joinedAt: joinedAt(1) },
        { userId: w.inactive.id, joinedAt: joinedAt(2) },
      ],
    });
    const recipientIds = await recipientsFor(lonely.id, w.memberS1.id);
    expect(recipientIds).toEqual([]);
    await write("close", {
      caseId: lonely.id,
      actorId: w.memberS1.id,
      version: 1,
      recipientIds,
    });
    expect((await caseRowOf(lonely.id)).status).toBe("closed");
    expect(await caseCloseNotifications()).toEqual([]);
    expect(parseDetail((await caseCloseAudits())[0]?.detail ?? null)).toEqual({
      caseId: lonely.id,
      notifiedCount: 0,
    });
  });
});

describe("#150 150-A 5-1 AC-8：終了しても、チャンネルと参加者を残す", () => {
  it("#150 AC-8: 案件専用チャンネルの行（deleted_at は NULL のまま・版も同じ）と参加の行（退職者の行・参加の時刻を含む）は変わらず、アーカイブの記録を作らない", async () => {
    const before = await caseCloseSnapshot();
    await write("close", {
      caseId: main.id,
      actorId: w.memberS1.id,
      version: 1,
      recipientIds: await recipientsFor(main.id, w.memberS1.id),
    });
    const after = await caseCloseSnapshot();
    expect(after.channels).toEqual(before.channels);
    expect(after.members).toEqual(before.members);
    expect(after.archiveEvents).toEqual([]);
    const room = after.channels.find((c) => c.room_id === main.roomId);
    expect(room?.deleted_at).toBeNull();
    expect(
      after.members
        .filter((m) => m.channel_id === main.roomId)
        .map((m) => m.user_id),
    ).toContain(w.inactive.id);
  });
});

describe("#150 150-A 5-1 AC-10（C-142(2)）：再開（参加者の選び直しなし）", () => {
  it("#150 AC-10: 状態が active になり、版に1を足す。監査 case.reopen の detail は { caseId, notifiedCount, addedCount: 0, removedCount: 0 }（150-B で件数を足した）。通知 case.reopened は再開後の有効な参加者から本人を除いた人だけ", async () => {
    const before = await caseCloseSnapshot();
    await write("reopen", {
      caseId: closed.id,
      actorId: w.memberD1.id,
      version: 1,
      recipientIds: await recipientsFor(closed.id, w.memberD1.id),
    });
    expect(await caseRowOf(closed.id)).toEqual({
      status: "active",
      version: 2,
      updated_at: CLOSE_NOW,
    });
    const audits = await caseCloseAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_id: w.memberD1.id,
      action: "case.reopen",
      target_type: "case",
      target_id: closed.id,
      result: "success",
    });
    expect(parseDetail(audits[0]?.detail ?? null)).toEqual({
      caseId: closed.id,
      notifiedCount: 3,
      addedCount: 0,
      removedCount: 0,
    });
    expect(await caseCloseNotifications()).toEqual(
      sorted([w.memberS1.id, w.ownerS.id, w.admin.id]).map((userId) => ({
        user_id: userId,
        kind: "case.reopened",
        room_id: null,
        message_id: null,
        target_id: closed.id,
      })),
    );
    // 参加の行は選び直さない（いまの参加者のまま）
    const after = await caseCloseSnapshot();
    expect(after.members).toEqual(before.members);
    expect(after.channels).toEqual(before.channels);
  });
});

describe("#150 150-A #196 の前提：崩れていたら何も残さない", () => {
  type Case = {
    name: string;
    kind: Kind;
    arrange?: () => Promise<void>;
    input: () => Promise<WriteInput & ReopenExtras>;
  };
  // 表には関数だけを書く（beforeEach で代入する変数は、呼ばれた時点で読む）
  const CASES: Case[] = [
    {
      name: "終了：案件がすでに終了している",
      kind: "close",
      input: async () => ({
        caseId: closed.id,
        actorId: w.memberS1.id,
        version: 1,
        recipientIds: await recipientsFor(closed.id, w.memberS1.id),
      }),
    },
    {
      name: "再開：案件が進行中",
      kind: "reopen",
      input: async () => ({
        caseId: main.id,
        actorId: w.memberS1.id,
        version: 1,
        recipientIds: await recipientsFor(main.id, w.memberS1.id),
      }),
    },
    {
      name: "終了：操作者が参加者でない（参加していない一般の社員）",
      kind: "close",
      input: async () => ({
        caseId: main.id,
        actorId: w.memberS2.id,
        version: 1,
        recipientIds: await recipientsFor(main.id, w.memberS2.id),
      }),
    },
    {
      name: "終了：操作者が参加していない担当部署のオーナー（R-77。管理の資格では終了できない）",
      kind: "close",
      input: async () => ({
        caseId: other.id,
        actorId: w.ownerD.id,
        version: 1,
        recipientIds: await recipientsFor(other.id, w.ownerD.id),
      }),
    },
    {
      name: "終了：操作者が無効（参加の行は残る）",
      kind: "close",
      input: async () => {
        const recipientIds = await recipientsFor(main.id, w.memberS1.id);
        await setUserActive(w.memberS1.id, false);
        return {
          caseId: main.id,
          actorId: w.memberS1.id,
          version: 1,
          recipientIds,
        };
      },
    },
    {
      name: "再開：操作者が外された",
      kind: "reopen",
      input: async () => {
        const recipientIds = await recipientsFor(closed.id, w.memberS1.id);
        const participantIds = await activeParticipantIdsOf(closed.roomId);
        await removeCaseMember(closed.roomId, w.memberS1.id);
        return {
          caseId: closed.id,
          actorId: w.memberS1.id,
          version: 1,
          recipientIds,
          participantIds,
        };
      },
    },
    {
      name: "終了：宛先が1人足りない（読んだ後にほかの人が加わった）",
      kind: "close",
      input: async () => {
        const recipientIds = await recipientsFor(main.id, w.memberS1.id);
        await addCaseMember(main.roomId, w.memberS2.id);
        return {
          caseId: main.id,
          actorId: w.memberS1.id,
          version: 1,
          recipientIds,
        };
      },
    },
    {
      name: "終了：宛先に、読んだ後に無効になった人が残っている",
      kind: "close",
      input: async () => {
        const recipientIds = await recipientsFor(main.id, w.memberS1.id);
        await setUserActive(w.memberD1.id, false);
        return {
          caseId: main.id,
          actorId: w.memberS1.id,
          version: 1,
          recipientIds,
        };
      },
    },
    {
      name: "終了：宛先に、参加者でない人が入っている",
      kind: "close",
      input: async () => ({
        caseId: main.id,
        actorId: w.memberS1.id,
        version: 1,
        recipientIds: sorted([
          ...(await recipientsFor(main.id, w.memberS1.id)),
          w.memberS2.id,
        ]),
      }),
    },
    {
      name: "再開：宛先が1人少ない（読んだ後にほかの人が外された）",
      kind: "reopen",
      input: async () => {
        const recipientIds = await recipientsFor(closed.id, w.memberD1.id);
        const participantIds = await activeParticipantIdsOf(closed.roomId);
        await removeCaseMember(closed.roomId, w.memberS1.id);
        return {
          caseId: closed.id,
          actorId: w.memberD1.id,
          version: 1,
          recipientIds,
          participantIds,
        };
      },
    },
    {
      name: "終了：版が読んだ値と違う",
      kind: "close",
      input: async () => ({
        caseId: main.id,
        actorId: w.memberS1.id,
        version: 2,
        recipientIds: await recipientsFor(main.id, w.memberS1.id),
      }),
    },
    {
      name: "再開：版が読んだ値と違う",
      kind: "reopen",
      input: async () => ({
        caseId: closed.id,
        actorId: w.memberS1.id,
        version: 0,
        recipientIds: await recipientsFor(closed.id, w.memberS1.id),
      }),
    },
    {
      name: "終了：案件がない",
      kind: "close",
      input: async () => ({
        caseId: MISSING_CASE_ID,
        actorId: w.memberS1.id,
        version: 1,
        recipientIds: [],
      }),
    },
    {
      name: "再開：案件がない",
      kind: "reopen",
      input: async () => ({
        caseId: MISSING_CASE_ID,
        actorId: w.memberS1.id,
        version: 1,
        recipientIds: [],
      }),
    },
  ];

  it.each(CASES)(
    "#150 #196: $name → CaseStateChangedError で、状態・版・監査・通知・参加・チャンネルのどれも変わらない",
    async ({ kind, input }) => {
      const value = await input();
      const before = await caseCloseSnapshot();
      await expect(write(kind, value)).rejects.toBeInstanceOf(
        CaseStateChangedError,
      );
      expect(await caseCloseSnapshot()).toEqual(before);
    },
  );
});

describe("#150 150-A D1 の上限：宛先が多い案件", () => {
  it("#150 D1 の上限: 有効な参加者 120 人の案件で、終了・再開が1回ずつで成り立ち、通知はそれぞれ 119 件", async () => {
    const bulk = await insertBulkUsers(118, w.deptD.id);
    const big = await seedCase({
      n: 1505,
      clientId: w.clientA.id,
      code: "QZA",
      title: "[UNIT_TEST]150大人数",
      createdBy: w.memberS1.id,
      departmentIds: [w.deptD.id],
      members: [
        { userId: w.memberS1.id, joinedAt: joinedAt(1) },
        { userId: w.memberD1.id, joinedAt: joinedAt(2) },
      ],
    });
    await addCaseMembers(big.roomId, bulk, joinedAt(3));

    const closeRecipients = await recipientsFor(big.id, w.memberS1.id);
    expect(closeRecipients).toHaveLength(119);
    await write("close", {
      caseId: big.id,
      actorId: w.memberS1.id,
      version: 1,
      recipientIds: closeRecipients,
    });
    expect(await recipientsOf("case.closed")).toEqual(sorted(closeRecipients));

    const reopenRecipients = await recipientsFor(big.id, w.memberD1.id);
    expect(reopenRecipients).toHaveLength(119);
    await write("reopen", {
      caseId: big.id,
      actorId: w.memberD1.id,
      version: 2,
      recipientIds: reopenRecipients,
    });
    expect(await recipientsOf("case.reopened")).toEqual(
      sorted(reopenRecipients),
    );
    expect(await caseRowOf(big.id)).toMatchObject({
      status: "active",
      version: 3,
    });
    expect((await caseCloseAudits()).map((a) => parseDetail(a.detail))).toEqual(
      [
        { caseId: big.id, notifiedCount: 119 },
        { caseId: big.id, notifiedCount: 119, addedCount: 0, removedCount: 0 },
      ],
    );
  });
});

describe("#150 150-A 同時の操作（計画 7章）", () => {
  it("#150 7章: 同じ版・宛先を読んだ2回の終了を同時に送ると、片方だけが成り立ち、監査・通知は1回分", async () => {
    const input: WriteInput = {
      caseId: main.id,
      actorId: w.memberS1.id,
      version: 1,
      recipientIds: await recipientsFor(main.id, w.memberS1.id),
    };
    const results = await Promise.allSettled([
      write("close", input),
      write("close", { ...input, actorId: w.memberS1.id }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(
      rejected?.status === "rejected" ? rejected.reason : null,
    ).toBeInstanceOf(CaseStateChangedError);
    expect(await caseRowOf(main.id)).toMatchObject({
      status: "closed",
      version: 2,
    });
    expect(await caseCloseAudits()).toHaveLength(1);
    expect(await recipientsOf("case.closed")).toEqual(
      sorted([w.memberD1.id, w.ownerS.id, w.admin.id]),
    );
  });

  it("#150 7章: 別の参加者2人が、同じ版を読んで同時に再開すると、片方だけが成り立ち、監査・通知は1回分", async () => {
    const [a, b] = await Promise.all([
      recipientsFor(closed.id, w.memberS1.id),
      recipientsFor(closed.id, w.memberD1.id),
    ]);
    const results = await Promise.allSettled([
      write("reopen", {
        caseId: closed.id,
        actorId: w.memberS1.id,
        version: 1,
        recipientIds: a,
      }),
      write("reopen", {
        caseId: closed.id,
        actorId: w.memberD1.id,
        version: 1,
        recipientIds: b,
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await caseRowOf(closed.id)).toMatchObject({
      status: "active",
      version: 2,
    });
    expect(await caseCloseAudits()).toHaveLength(1);
    expect(
      (await caseCloseNotifications()).filter(
        (n) => n.kind === "case.reopened",
      ),
    ).toHaveLength(3);
  });

  it("#150 7章: 終了・再開を2回ずつ繰り返すと、版は5になり、監査・通知は成り立った回数（4回）分", async () => {
    const recipientIds = await recipientsFor(main.id, w.memberS1.id);
    for (const [kind, version] of [
      ["close", 1],
      ["reopen", 2],
      ["close", 3],
      ["reopen", 4],
    ] as const)
      await write(kind, {
        caseId: main.id,
        actorId: w.memberS1.id,
        version,
        recipientIds,
      });
    expect(await caseRowOf(main.id)).toMatchObject({
      status: "active",
      version: 5,
    });
    expect((await caseCloseAudits()).map((a) => a.action)).toEqual([
      "case.close",
      "case.reopen",
      "case.close",
      "case.reopen",
    ]);
    expect(await caseCloseNotifications()).toHaveLength(12);
  });

  it("#150 6.3 版の前提: 状態が一度変わって戻った（終了 → 再開）後に、前に読んだ版で終了すると、何も残らない", async () => {
    const recipientIds = await recipientsFor(main.id, w.memberS1.id);
    const stale: WriteInput = {
      caseId: main.id,
      actorId: w.memberS1.id,
      version: 1,
      recipientIds,
    };
    await write("close", {
      ...stale,
      actorId: w.memberD1.id,
      recipientIds: await recipientsFor(main.id, w.memberD1.id),
    });
    await write("reopen", {
      ...stale,
      actorId: w.memberD1.id,
      version: 2,
      recipientIds: await recipientsFor(main.id, w.memberD1.id),
    });
    const before = await caseCloseSnapshot();
    await expect(write("close", stale)).rejects.toBeInstanceOf(
      CaseStateChangedError,
    );
    expect(await caseCloseSnapshot()).toEqual(before);
    expect(await caseRowOf(main.id)).toMatchObject({
      status: "active",
      version: 3,
    });
  });

  it("#150 6.3 版を進めない操作: 参加者の追加・削除では、案件の版は変わらない（宛先の一致で検出する前提）", async () => {
    const traceId = casereqTraceId();
    await withCases(env, (r) =>
      r.addParticipant({
        caseId: main.id,
        actorId: w.memberS1.id,
        userId: w.memberS2.id,
        traceId,
      }),
    );
    expect((await caseRowOf(main.id)).version).toBe(1);
    await withCases(env, (r) =>
      r.removeParticipant({
        caseId: main.id,
        actorId: w.memberS1.id,
        userId: w.memberS2.id,
        traceId,
      }),
    );
    expect((await caseRowOf(main.id)).version).toBe(1);
  });

  it("#150 6.3: 最初の判定の材料（findWriteFacts）は、案件の版を返す", async () => {
    const facts = await withCases(env, (r) =>
      r.findWriteFacts({ caseId: main.id, actorId: w.memberS1.id }),
    );
    expect(facts?.version).toBe(1);
  });
});
