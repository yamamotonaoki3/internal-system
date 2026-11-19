// #150（150-B）5-1 AC-16・AC-13、3-3 AC-2：再開のときの参加者の選び直しの Repository（本物の db.batch。隔離 D1）。
// この層で確かめるもの（計画 150-B 10章の「DB」の行）：
//   - 成功：状態・版・参加の行の追加と削除・人ごとの監査（1文）・再開の監査・通知が1回の batch でそろう。無効な人の行は消えない
//   - 監査の対象の取り違え：追加・除外を各2人以上にし、監査の (action, detail.userId) の集合が、実際の参加者の差分と一致する。
//     案件の ID・集計の件数（addedCount・removedCount・notifiedCount）・真偽値の型（viaReopen が JSON の true、self が false）を独立した期待値で
//   - 前提（計画 6.4）を1つずつ崩すと、CaseStateChangedError で何も残らない。末尾の不変条件（有効な参加者が1人以上）でも全部戻る
//   - 各変更の直後の件数の確認（計画 6.3.1）：buildReopenStatements の文を1つだけ差し替えて、余分な削除・余分な追加・更新 0 行・監査 0 行・
//     通知の不足・今回の通知の ID の取り違えを起こすと、状態・版・参加・監査・通知が全部戻る（差し替えない文の列は成功する＝差し替えの仕組みの確認）
//   - 同じ案件・種類・時刻の過去の通知があっても再開できる
//   - D1 の上限：参加者 500 人・追加 100 人・除外 100 人で1回の再開が成り立つ
// 判定の順・応答は Service・結合のテストで確かめ、ここでは重ねない。
// 契約（実装前の仮置き。計画 150-B 6.2・6.3・10章。実装の担当へ）：backend/src/db/case.repository.ts に
//   export type CaseReopenWriteInput = { caseId, actorId, version, participantIds, addUserIds, removeUserIds,
//     readRecipientIds（読んだ宛先 R）, recipientIds（新しい宛先）, traceId }（どれも省略できない）
//   createCaseRepository(db).reopenCase(input: CaseReopenWriteInput): Promise<void>（前提が崩れていたら CaseStateChangedError）
//   createCaseRepository(db).findReopenFacts({ caseId, actorId, addUserIds, removeUserIds }): Promise<CaseReopenFacts | null>
//   export function buildReopenStatements(db: Database, input: CaseReopenWriteInput): BatchItem の配列（同期・非同期のどちらでもよい）。
//     文の順は計画 6.3 のとおり（1 前提 → 2 監査 case.reopen → 2a → 3 人ごとの監査 → 3a → 4 参加の行の削除 → 4a → 5 参加の行の追加 → 5a
//     → 6 通知 → 6a → 6b → 7 案件の更新〔RETURNING〕→ 7a → 8 末尾の不変条件）。テストは文の SQL（toSQL／getQuery）で 4・5・6・7 と、
//     audit_logs への INSERT の1つ目（2）・2つ目（3）を見つける。本番の reopenCase は、これを db.batch に渡すだけ。
// 時刻は REOPEN_NOW に固定する。データは架空（testuser_casereq_・testuser_case150_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cases } from "../../db/schema";
import {
  MISSING_CASE_ID,
  cleanupCaseTestData,
  joinedAt,
  seedCase,
  type SeededCase,
} from "../../test/case-fixtures";
import {
  addCaseMembers,
  caseCloseAudits,
  caseCloseNotifications,
  caseCloseSnapshot,
  caseRowOf,
  recipientsOf,
} from "../../test/case-close-fixtures";
import {
  activeParticipantIdsOf,
  insertBulkUsersFast,
  insertPastCaseNotification,
  participantAudits,
} from "../../test/case-reopen-fixtures";
import {
  parseDetail,
  participantIdsOf,
} from "../../test/case-participant-fixtures";
import {
  casereqTraceId,
  setUserActive,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import {
  CaseStateChangedError,
  buildReopenStatements,
  runWriteBatch,
  withCases,
  type CaseReopenWriteInput,
} from "./case.repository";
import { withDatabase, type Database } from "./database";

const REOPEN_NOW = "2026-11-19T02:00:00.000Z";

let w: CaseWorld;
/**
 * 終了中・deptS 担当：memberS1（操作者）・memberD1・memberS2・ownerD（deptD のオーナー。この案件では自動参加でない）・
 * admin（自動参加の全体管理者）・ownerS（自動参加の担当部署のオーナー）・inactive（退職者の行）。noDept・ownerH は参加していない
 */
let room: SeededCase;
/** 終了中・deptD 担当：memberS2・memberD1（変わらないことを確かめる別の案件） */
let other: SeededCase;

const sorted = (ids: readonly string[]) => [...ids].sort();

const recipientsFor = (caseId: string, actorId: string) =>
  withCases(env, (r) => r.listCaseNotifyRecipients(caseId, actorId));

/** 読んだ時点の材料から、選び直しの入力を作る（宛先＝R から外す人を除き、足す人を加える。計画 6.2） */
async function inputFor(change: {
  caseId?: string;
  actorId?: string;
  addUserIds?: string[];
  removeUserIds?: string[];
  version?: number;
}): Promise<CaseReopenWriteInput> {
  const caseId = change.caseId ?? room.id;
  const actorId = change.actorId ?? w.memberS1.id;
  const addUserIds = change.addUserIds ?? [];
  const removeUserIds = change.removeUserIds ?? [];
  const readRecipientIds = await recipientsFor(caseId, actorId);
  return {
    caseId,
    actorId,
    version: change.version ?? 1,
    participantIds: await activeParticipantIdsOf(room.roomId),
    addUserIds,
    removeUserIds,
    readRecipientIds,
    recipientIds: sorted([
      ...readRecipientIds.filter((id) => !removeUserIds.includes(id)),
      ...addUserIds,
    ]),
    traceId: casereqTraceId(),
  };
}

const reopen = (input: CaseReopenWriteInput) =>
  withCases(env, (r) => r.reopenCase(input));

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(REOPEN_NOW));
  w = await setupCaseWorld();
  room = await seedCase({
    n: 1611,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]150選び直し",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    status: "closed",
    members: [
      { userId: w.memberS1.id, joinedAt: joinedAt(1) },
      { userId: w.memberD1.id, joinedAt: joinedAt(2) },
      { userId: w.memberS2.id, joinedAt: joinedAt(3) },
      { userId: w.ownerD.id, joinedAt: joinedAt(4) },
      { userId: w.admin.id, joinedAt: joinedAt(5) },
      { userId: w.ownerS.id, joinedAt: joinedAt(6) },
      { userId: w.inactive.id, joinedAt: joinedAt(7) },
    ],
  });
  other = await seedCase({
    n: 1612,
    clientId: w.clientB.id,
    code: "QZB",
    title: "[UNIT_TEST]150別の案件",
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
  vi.useRealTimers();
  await cleanupCaseTestData();
});

describe("#150 150-B 最初の判定の材料（findReopenFacts）", () => {
  it("#150 Q1: いまの有効な参加者は、参加の行があり有効な社員だけ（無効な人の行は候補に入らない）。追加・除外の対象の有効性・行の有無・役割を返す", async () => {
    const facts = await withCases(env, (r) =>
      r.findReopenFacts({
        caseId: room.id,
        actorId: w.memberS1.id,
        addUserIds: [w.noDept.id, w.inactive.id],
        removeUserIds: [w.admin.id, w.memberD1.id],
      }),
    );
    expect(facts).not.toBeNull();
    expect(facts?.status).toBe("closed");
    expect(facts?.version).toBe(1);
    expect(facts?.actorIsParticipant).toBe(true);
    expect(sorted(facts?.activeParticipantIds ?? [])).toEqual(
      sorted([
        w.memberS1.id,
        w.memberD1.id,
        w.memberS2.id,
        w.ownerD.id,
        w.admin.id,
        w.ownerS.id,
      ]),
    );
    const byId = new Map((facts?.targets ?? []).map((t) => [t.userId, t]));
    expect(byId.get(w.noDept.id)).toMatchObject({
      isActive: true,
      hasMembershipRow: false,
    });
    expect(byId.get(w.inactive.id)).toMatchObject({
      isActive: false,
      hasMembershipRow: true,
    });
    expect(byId.get(w.admin.id)).toMatchObject({
      isActive: true,
      hasMembershipRow: true,
      isGlobalAdmin: true,
    });
    expect(byId.get(w.memberD1.id)).toMatchObject({
      isGlobalAdmin: false,
      hasMembershipRow: true,
    });
  });

  it("#150 6.2: 案件がなければ null", async () => {
    expect(
      await withCases(env, (r) =>
        r.findReopenFacts({
          caseId: MISSING_CASE_ID,
          actorId: w.memberS1.id,
          addUserIds: [],
          removeUserIds: [],
        }),
      ),
    ).toBeNull();
  });
});

describe("#150 150-B 成功（5-1 AC-16・AC-13、3-3 AC-2）", () => {
  it("#150 AC-16・AC-13: 2人を外し2人を足すと、状態・版・参加の行・監査・通知がそろい、監査の対象は実際の参加者の差分と一致する", async () => {
    const beforeRows = await participantIdsOf(room.roomId);
    const input = await inputFor({
      addUserIds: [w.noDept.id, w.ownerH.id],
      removeUserIds: [w.memberD1.id, w.ownerD.id],
    });
    await reopen(input);
    const afterRows = await participantIdsOf(room.roomId);

    expect(await caseRowOf(room.id)).toEqual({
      status: "active",
      version: 2,
      updated_at: REOPEN_NOW,
    });
    // 無効な人の行は消えない（Q1）。シードの人数から手で書いた期待
    expect(afterRows).toEqual(
      sorted([
        w.memberS1.id,
        w.memberS2.id,
        w.admin.id,
        w.ownerS.id,
        w.inactive.id,
        w.noDept.id,
        w.ownerH.id,
      ]),
    );
    const added = afterRows.filter((id) => !beforeRows.includes(id));
    const removed = beforeRows.filter((id) => !afterRows.includes(id));
    expect(sorted(added)).toEqual(sorted([w.noDept.id, w.ownerH.id]));
    expect(sorted(removed)).toEqual(sorted([w.memberD1.id, w.ownerD.id]));

    const people = await participantAudits();
    const pairs = people.map((row) => {
      const detail = parseDetail(row.detail) as { userId: string };
      return `${row.action}:${detail.userId}`;
    });
    expect(sorted(pairs)).toEqual(
      sorted([
        ...added.map((id) => `case.participant.add:${id}`),
        ...removed.map((id) => `case.participant.remove:${id}`),
      ]),
    );
    expect(new Set(pairs).size).toBe(pairs.length);
    for (const row of people) {
      expect(row).toMatchObject({
        actor_id: w.memberS1.id,
        target_type: "case",
        target_id: room.id,
        result: "success",
      });
      const detail = parseDetail(row.detail) as Record<string, unknown>;
      expect(detail.caseId).toBe(room.id);
      expect(detail.viaReopen).toBe(true);
      if (row.action === "case.participant.remove") {
        expect(detail.self).toBe(false);
        expect(Object.keys(detail).sort()).toEqual(
          ["caseId", "self", "userId", "viaReopen"].sort(),
        );
      } else {
        expect(Object.keys(detail).sort()).toEqual(
          ["caseId", "userId", "viaReopen"].sort(),
        );
      }
    }

    const audits = await caseCloseAudits();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_id: w.memberS1.id,
      action: "case.reopen",
      target_id: room.id,
      result: "success",
    });
    // 宛先：選び直しの後の有効な参加者（memberS1・memberS2・admin・ownerS・noDept・ownerH）から本人を除く 5 人
    expect(parseDetail(audits[0]?.detail ?? null)).toEqual({
      caseId: room.id,
      notifiedCount: 5,
      addedCount: 2,
      removedCount: 2,
    });
    expect(await caseCloseNotifications()).toEqual(
      sorted([
        w.memberS2.id,
        w.admin.id,
        w.ownerS.id,
        w.noDept.id,
        w.ownerH.id,
      ]).map((userId) => ({
        user_id: userId,
        kind: "case.reopened",
        room_id: null,
        message_id: null,
        target_id: room.id,
      })),
    );
    // 別の案件は変わらない
    expect(await participantIdsOf(other.roomId)).toEqual(
      sorted([w.memberS2.id, w.memberD1.id]),
    );
    expect((await caseRowOf(other.id)).status).toBe("closed");
  });

  it("#150 Q7: 選び直しなし（空の配列）でも同じ経路で、参加の行は変わらず、人ごとの監査はなく、addedCount・removedCount は 0", async () => {
    const before = await caseCloseSnapshot();
    await reopen(await inputFor({}));
    expect((await caseCloseSnapshot()).members).toEqual(before.members);
    expect(await participantAudits()).toEqual([]);
    expect(parseDetail((await caseCloseAudits())[0]?.detail ?? null)).toEqual({
      caseId: room.id,
      notifiedCount: 5,
      addedCount: 0,
      removedCount: 0,
    });
  });

  it("#150 重大4: 同じ案件・種類・時刻の過去の通知があっても、再開できる（今回の分の通知が足される）", async () => {
    await insertPastCaseNotification({
      id: "01JTESTCASE150BPN000000001",
      userId: w.memberS2.id,
      kind: "case.reopened",
      caseId: room.id,
      createdAt: REOPEN_NOW,
    });
    await reopen(await inputFor({ removeUserIds: [w.memberD1.id] }));
    expect(await recipientsOf("case.reopened")).toEqual(
      sorted([
        w.memberS2.id,
        w.memberS2.id,
        w.ownerD.id,
        w.admin.id,
        w.ownerS.id,
      ]),
    );
  });
});

describe("#150 150-B 前提（計画 6.4）：崩れていたら何も残さない", () => {
  type Case = { name: string; input: () => Promise<CaseReopenWriteInput> };
  // 表には関数だけを書く（beforeEach で代入する変数は、呼ばれた時点で読む）
  const CASES: Case[] = [
    {
      name: "案件が進行中",
      input: async () => {
        const input = await inputFor({ removeUserIds: [w.memberD1.id] });
        await env.DB.prepare("UPDATE cases SET status = 'active' WHERE id = ?")
          .bind(room.id)
          .run();
        return input;
      },
    },
    {
      name: "版が読んだ値と違う",
      input: () => inputFor({ removeUserIds: [w.memberD1.id], version: 2 }),
    },
    {
      name: "操作者が参加者でない（参加していない社員）",
      input: () => inputFor({ actorId: w.noDept.id }),
    },
    {
      name: "操作者が無効（参加の行は残る）",
      input: async () => {
        const input = await inputFor({ addUserIds: [w.noDept.id] });
        await setUserActive(w.memberS1.id, false);
        return input;
      },
    },
    {
      name: "有効な参加者の集合が、画面で見たものと違う（読んだ後に参加者が無効化された）",
      input: async () => {
        const input = await inputFor({ addUserIds: [w.noDept.id] });
        await setUserActive(w.memberS2.id, false);
        return {
          ...input,
          readRecipientIds: await recipientsFor(room.id, w.memberS1.id),
        };
      },
    },
    {
      name: "有効な参加者の集合が、画面で見たものより1人多い（participantIds だけが古い）",
      input: async () => {
        const input = await inputFor({});
        return {
          ...input,
          participantIds: input.participantIds.filter(
            (id) => id !== w.memberS2.id,
          ),
        };
      },
    },
    {
      name: "宛先が読んだ値と違う（readRecipientIds だけが古い）",
      input: async () => {
        const input = await inputFor({});
        return {
          ...input,
          readRecipientIds: input.readRecipientIds.filter(
            (id) => id !== w.memberS2.id,
          ),
        };
      },
    },
    {
      name: "本人を外す",
      input: () => inputFor({ removeUserIds: [w.memberS1.id] }),
    },
    {
      name: "自動参加の全体管理者を外す",
      input: () => inputFor({ removeUserIds: [w.admin.id] }),
    },
    {
      name: "自動参加の担当部署のオーナーを外す",
      input: () => inputFor({ removeUserIds: [w.ownerS.id] }),
    },
    {
      name: "外す人に参加の行がない",
      input: () => inputFor({ removeUserIds: [w.noDept.id] }),
    },
    {
      name: "追加の人が無効",
      input: async () => {
        const input = await inputFor({ addUserIds: [w.noDept.id] });
        await setUserActive(w.noDept.id, false);
        return input;
      },
    },
    {
      name: "追加の人が無効で、参加の行が残っている",
      input: () => inputFor({ addUserIds: [w.inactive.id] }),
    },
    {
      name: "追加の人に、すでに参加の行がある",
      input: () => inputFor({ addUserIds: [w.memberS2.id] }),
    },
    {
      name: "案件がない",
      input: () => inputFor({ caseId: MISSING_CASE_ID }),
    },
  ];

  it.each(CASES)(
    "#150 6.4: $name → CaseStateChangedError で、状態・版・参加・監査・通知のどれも変わらない",
    async ({ input }) => {
      const value = await input();
      const before = await caseCloseSnapshot();
      await expect(reopen(value)).rejects.toBeInstanceOf(CaseStateChangedError);
      expect(await caseCloseSnapshot()).toEqual(before);
    },
  );
});

// ---- 計画 6.3.1：文を差し替えて、各変更の直後の件数の確認を試す ----

type Statements = Awaited<ReturnType<typeof buildReopenStatements>>;
type Item = Statements[number];

function sqlOf(item: unknown): string {
  const query = item as {
    toSQL?: () => { sql: string };
    getQuery?: () => { sql: string };
  };
  if (typeof query.toSQL === "function") return query.toSQL().sql;
  if (typeof query.getQuery === "function") return query.getQuery().sql;
  return "";
}

/** 計画 6.3 の文を、SQL の形で見つける（見つからなければ、契約と違うので止める） */
function indexOf(
  statements: readonly Item[],
  pattern: RegExp,
  nth = 0,
): number {
  const found = statements
    .map((item, index) => ({ index, text: sqlOf(item) }))
    .filter(({ text }) => pattern.test(text));
  const hit = found[nth];
  if (hit === undefined)
    throw new Error(
      `計画 6.3 の文（${String(pattern)} の ${nth + 1} つ目）が buildReopenStatements にありません`,
    );
  return hit.index;
}

const DELETE_MEMBERS = /^\s*delete\s+from\s+"?channel_members"?/i;
const INSERT_MEMBERS = /^\s*insert\s+into\s+"?channel_members"?/i;
const INSERT_NOTIFICATIONS = /^\s*insert\s+into\s+"?notifications"?/i;
const INSERT_AUDITS = /^\s*insert\s+into\s+"?audit_logs"?/i;
const UPDATE_CASE_RETURNING = /^\s*update\s+"?cases"?[\s\S]*returning/i;

async function runStatements(db: Database, statements: Item[]) {
  await runWriteBatch(() =>
    db.batch(statements as unknown as Parameters<Database["batch"]>[0]),
  );
}

/** 0 行の書き込み（何も変えない文。直後の件数の確認が 0 を見る） */
const noop = (db: Database) =>
  db
    .update(cases)
    .set({ version: sql`${cases.version}` })
    .where(sql`0`);

/** 差し替えの例で使う、2人を外し1人を足す入力 */
const baseChange = () => ({
  addUserIds: [w.noDept.id],
  removeUserIds: [w.memberD1.id, w.ownerD.id],
});

describe("#150 150-B 計画 6.3.1 各変更の直後の件数の確認（文を差し替えて、わざと崩す）", () => {
  it("#150 6.3.1: 差し替えない文の列は、そのまま db.batch に渡すと成り立つ（差し替えの仕組みの確認）", async () => {
    const input = await inputFor(baseChange());
    await withDatabase(env, async (db) => {
      await runStatements(db, [...(await buildReopenStatements(db, input))]);
    });
    expect((await caseRowOf(room.id)).status).toBe("active");
    expect(await participantIdsOf(room.roomId)).not.toContain(w.memberD1.id);
  });

  type Swap = {
    name: string;
    swap: (
      db: Database,
      statements: Item[],
      input: CaseReopenWriteInput,
    ) => Promise<void>;
  };
  const SWAPS: Swap[] = [
    {
      name: "余分な削除（指定していない memberS2 まで消す）",
      swap: async (db, statements, input) => {
        const wider = await buildReopenStatements(db, {
          ...input,
          removeUserIds: [...input.removeUserIds, w.memberS2.id],
        });
        statements[indexOf(statements, DELETE_MEMBERS)] = wider[
          indexOf(wider, DELETE_MEMBERS)
        ] as Item;
      },
    },
    {
      name: "削除が足りない（外す2人のうち1人だけ消す）",
      swap: async (db, statements, input) => {
        const narrow = await buildReopenStatements(db, {
          ...input,
          removeUserIds: input.removeUserIds.slice(0, 1),
        });
        statements[indexOf(statements, DELETE_MEMBERS)] = narrow[
          indexOf(narrow, DELETE_MEMBERS)
        ] as Item;
      },
    },
    {
      name: "余分な追加（指定していない ownerH まで足す）",
      swap: async (db, statements, input) => {
        const wider = await buildReopenStatements(db, {
          ...input,
          addUserIds: [...input.addUserIds, w.ownerH.id],
        });
        statements[indexOf(statements, INSERT_MEMBERS)] = wider[
          indexOf(wider, INSERT_MEMBERS)
        ] as Item;
      },
    },
    {
      name: "追加が 0 行",
      swap: async (db, statements) => {
        statements[indexOf(statements, INSERT_MEMBERS)] = noop(db) as Item;
      },
    },
    {
      name: "案件の更新が 0 行（別の ID を更新する）",
      swap: async (db, statements) => {
        statements[indexOf(statements, UPDATE_CASE_RETURNING)] = db
          .update(cases)
          .set({ status: "active" })
          .where(eq(cases.id, MISSING_CASE_ID))
          .returning({ id: cases.id }) as unknown as Item;
      },
    },
    {
      name: "再開の監査 case.reopen が 0 行",
      swap: async (db, statements) => {
        statements[indexOf(statements, INSERT_AUDITS, 0)] = noop(db) as Item;
      },
    },
    {
      name: "人ごとの監査が 0 行",
      swap: async (db, statements) => {
        statements[indexOf(statements, INSERT_AUDITS, 1)] = noop(db) as Item;
      },
    },
    {
      name: "通知が1件足りない（宛先を1人減らした文）",
      swap: async (db, statements, input) => {
        const fewer = await buildReopenStatements(db, {
          ...input,
          recipientIds: input.recipientIds.slice(1),
        });
        statements[indexOf(statements, INSERT_NOTIFICATIONS)] = fewer[
          indexOf(fewer, INSERT_NOTIFICATIONS)
        ] as Item;
      },
    },
    {
      name: "通知の件数は同じだが、今回の通知の ID と宛先の組と違う（別に組み立てた文）",
      swap: async (db, statements, input) => {
        const another = await buildReopenStatements(db, input);
        statements[indexOf(statements, INSERT_NOTIFICATIONS)] = another[
          indexOf(another, INSERT_NOTIFICATIONS)
        ] as Item;
      },
    },
    {
      name: "末尾の不変条件：参加の行を全部消し、直後の件数の確認を何もしない文にする",
      swap: async (db, statements, input) => {
        // 計画 6.3 の順で、4a は 4 の直後、5a は 5 の直後にある
        const deleteAt = indexOf(statements, DELETE_MEMBERS);
        const insertAt = indexOf(statements, INSERT_MEMBERS);
        const passThrough = () =>
          db
            .update(cases)
            .set({ version: sql`${cases.version}` })
            .where(eq(cases.id, room.id)) as Item;
        const everyone = await buildReopenStatements(db, {
          ...input,
          removeUserIds: await participantIdsOf(room.roomId),
        });
        statements[deleteAt] = everyone[
          indexOf(everyone, DELETE_MEMBERS)
        ] as Item;
        statements[deleteAt + 1] = passThrough();
        // 追加の人が残ると末尾の「有効な参加者が1人以上」が通るため、追加も 0 行にし、その直後の確認も素通りにする
        statements[insertAt] = noop(db) as Item;
        statements[insertAt + 1] = passThrough();
      },
    },
  ];

  it.each(SWAPS)(
    "#150 6.3.1: $name → CaseStateChangedError で、状態・版・参加・監査・通知が全部前のまま",
    async ({ swap }) => {
      const input = await inputFor(baseChange());
      const before = await caseCloseSnapshot();
      await withDatabase(env, async (db) => {
        const statements = [...(await buildReopenStatements(db, input))];
        await swap(db, statements, input);
        await expect(runStatements(db, statements)).rejects.toBeInstanceOf(
          CaseStateChangedError,
        );
      });
      expect(await caseCloseSnapshot()).toEqual(before);
    },
  );
});

describe("#150 150-B D1 の上限（1文 100 パラメータ・batch の文の数）", () => {
  it("#150 D1 の上限: 有効な参加者 500 人・追加 100 人・除外 100 人の再開が1回で成り立つ（通知 499 件・人ごとの監査 200 件）", async () => {
    const bulk = await insertBulkUsersFast(599, w.deptD.id);
    const big = await seedCase({
      n: 1615,
      clientId: w.clientA.id,
      code: "QZA",
      title: "[UNIT_TEST]150選び直しの大人数",
      createdBy: w.memberS1.id,
      departmentIds: [w.deptD.id],
      status: "closed",
      members: [{ userId: w.memberS1.id, joinedAt: joinedAt(1) }],
    });
    const members = bulk.slice(0, 499);
    const removeUserIds = members.slice(0, 100);
    const addUserIds = bulk.slice(499, 599);
    await addCaseMembers(big.roomId, members, joinedAt(2));
    expect(await activeParticipantIdsOf(big.roomId)).toHaveLength(500);
    const readRecipientIds = await recipientsFor(big.id, w.memberS1.id);
    const recipientIds = sorted([
      ...readRecipientIds.filter((id) => !removeUserIds.includes(id)),
      ...addUserIds,
    ]);
    await reopen({
      caseId: big.id,
      actorId: w.memberS1.id,
      version: 1,
      participantIds: await activeParticipantIdsOf(big.roomId),
      addUserIds,
      removeUserIds,
      readRecipientIds,
      recipientIds,
      traceId: casereqTraceId(),
    });
    expect(await caseRowOf(big.id)).toMatchObject({
      status: "active",
      version: 2,
    });
    expect(await activeParticipantIdsOf(big.roomId)).toHaveLength(500);
    expect(await recipientsOf("case.reopened")).toHaveLength(499);
    expect(await participantAudits()).toHaveLength(200);
    expect(parseDetail((await caseCloseAudits())[0]?.detail ?? null)).toEqual({
      caseId: big.id,
      notifiedCount: 499,
      addedCount: 100,
      removedCount: 100,
    });
  });
});
