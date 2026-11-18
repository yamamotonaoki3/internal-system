// #147（147-C-2）決定 Q5・5-1 AC-7（C-133・C-134）：既存の案件に、自動参加の人を補う、べき等な SQL（migration にしない。project-rules 既定の方針1）。
// backend/db/scripts/backfill-case-auto-participants.sql を、テスト用の D1 に対して実行し、次を確かめる（期待は計画 147-C-2「既存の案件の補完」）。
//   - 有効な全体管理者を、すべての案件（進行中・終了とも）に入れる
//   - 各案件の担当部署（case_departments）の有効なオーナーを、その案件に入れる。担当部署でない部署のオーナーは入れない
//   - 無効な社員は入れない。すでに参加している行は増やさず、joined_at も変えない
//   - 何回実行しても結果が同じ。案件専用でないチャンネルには触れない
// 本番への適用は機能の完了条件に含めない（別に利用者の承認を得る）。
// 契約（実装前の仮置き）：ファイルは `--` で始まる行がコメント。文は `;` で区切る（1文でも複数文でもよい）。
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
  setUserActive,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import { membersOf } from "../../test/department-fixtures";

// ファイルがまだない（実装前）ときも、ほかのテストを読み込めるように glob で読む
const scripts = import.meta.glob<string>(
  "../../db/scripts/backfill-case-auto-participants.sql",
  { query: "?raw", import: "default", eager: true },
);

function statements(): string[] {
  const sources = Object.values(scripts);
  expect(sources, "backfill-case-auto-participants.sql").toHaveLength(1);
  const body = (sources[0] ?? "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  const list = body
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  expect(list.length).toBeGreaterThan(0);
  return list;
}

async function runBackfill() {
  await env.DB.batch(statements().map((s) => env.DB.prepare(s)));
}

let w: CaseWorld;
let caseSeq = 0;

async function caseOf(
  departmentIds: string[],
  memberIds: string[],
  status: "active" | "closed" = "active",
): Promise<SeededCase> {
  caseSeq += 1;
  return seedCase({
    n: 300 + caseSeq,
    clientId: w.clientA.id,
    code: "QZA",
    title: `[UNIT_TEST]147C2補完${caseSeq}`,
    createdBy: memberIds[0] ?? w.memberS1.id,
    departmentIds,
    status,
    members: memberIds.map((userId, i) => ({ userId, joinedAt: joinedAt(i) })),
  });
}

/** テストの利用者の参加の行のすべて（joined_at を含む。べき等の確認用） */
async function memberSnapshot() {
  const { results } = await env.DB.prepare(
    `SELECT channel_id, user_id, joined_at FROM channel_members
     WHERE user_id IN (SELECT id FROM users WHERE login_id LIKE 'testuser!_%' ESCAPE '!')
     ORDER BY channel_id, user_id`,
  ).all<{ channel_id: string; user_id: string; joined_at: string }>();
  return results;
}

async function allMemberCount() {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM channel_members",
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

describe("#147 147-C-2 Q5: 既存の案件の自動参加の補完（backend/db/scripts/backfill-case-auto-participants.sql）", () => {
  it("#147 Q5: 有効な全体管理者は、進行中・終了のすべての案件に入る", async () => {
    const active = await caseOf([w.deptS.id], [w.memberS1.id]);
    const closed = await caseOf([w.deptD.id], [w.memberD1.id], "closed");
    await runBackfill();
    expect(await participantIdsOf(active.roomId)).toContain(w.admin.id);
    expect(await participantIdsOf(closed.roomId)).toContain(w.admin.id);
  });

  it("#147 Q5: 担当部署の有効なオーナーは、その案件にだけ入る（担当部署でない部署のオーナーは入らない）", async () => {
    const sOnly = await caseOf([w.deptS.id], [w.memberS1.id]);
    const both = await caseOf([w.deptS.id, w.deptD.id], [w.memberS1.id]);
    const dClosed = await caseOf([w.deptD.id], [w.memberD1.id], "closed");
    await runBackfill();
    expect(await participantIdsOf(sOnly.roomId)).toEqual(
      [w.memberS1.id, w.admin.id, w.ownerS.id].sort(),
    );
    expect(await participantIdsOf(both.roomId)).toEqual(
      [w.memberS1.id, w.admin.id, w.ownerS.id, w.ownerD.id].sort(),
    );
    expect(await participantIdsOf(dClosed.roomId)).toEqual(
      [w.memberD1.id, w.admin.id, w.ownerD.id].sort(),
    );
    // deptH のオーナーは、deptH が担当の案件がないので、どこにも入らない
    for (const room of [sOnly, both, dClosed])
      expect(await participantIdsOf(room.roomId)).not.toContain(w.ownerH.id);
  });

  it("#147 Q5: 無効な社員は入らない（無効なオーナー・無効な全体管理者）", async () => {
    const room = await caseOf([w.deptS.id], [w.memberS1.id]);
    await setUserActive(w.ownerS.id, false);
    await setUserActive(w.admin.id, false);
    await runBackfill();
    expect(await participantIdsOf(room.roomId)).toEqual([w.memberS1.id]);
  });

  it("#147 Q5: すでに参加している行は増えず、joined_at も変わらない。2回実行しても結果が同じ", async () => {
    await caseOf([w.deptS.id], [w.ownerS.id, w.admin.id]);
    await caseOf([w.deptD.id], [w.memberD1.id]);
    const untouched = await memberSnapshot();
    await runBackfill();
    const first = await memberSnapshot();
    // すでにあった行は、そのまま残る
    expect(first).toEqual(expect.arrayContaining(untouched));
    await runBackfill();
    expect(await memberSnapshot()).toEqual(first);
  });

  it("#147 Q5: 案件専用でないチャンネル（部署の専用・全社連絡など）の参加には触れない。増えるのは足りない案件の行の数だけ", async () => {
    const room = await caseOf([w.deptS.id], [w.memberS1.id]);
    const deptChannels = {
      dedicated: await membersOf(w.deptD.dedicatedChannelId),
      announcement: await membersOf(w.deptD.announcementChannelId),
    };
    const total = await allMemberCount();
    await runBackfill();
    // 足りない行は admin と ownerS の2行
    expect(await allMemberCount()).toBe(total + 2);
    expect(await participantIdsOf(room.roomId)).toEqual(
      [w.memberS1.id, w.admin.id, w.ownerS.id].sort(),
    );
    expect({
      dedicated: await membersOf(w.deptD.dedicatedChannelId),
      announcement: await membersOf(w.deptD.announcementChannelId),
    }).toEqual(deptChannels);
  });

  it("#147 Q5・D1 の上限: 101件の案件でも、1回の実行で全部に入る", async () => {
    const rooms: SeededCase[] = [];
    for (let i = 0; i < 101; i += 1)
      rooms.push(await caseOf([w.deptS.id], [w.memberS1.id]));
    await runBackfill();
    for (const room of rooms)
      expect(await participantIdsOf(room.roomId)).toEqual(
        [w.memberS1.id, w.admin.id, w.ownerS.id].sort(),
      );
  });
});
