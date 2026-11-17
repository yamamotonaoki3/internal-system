// #156（0-6 AC-2・AC-3）: 監査ログの一覧の読み取り（名前の解決・選ぶ列・絞り込み・カーソルでのページ送り）を、マイグレーション済みの D1 で確かめる。
// 期待する結果は要件（docs/requirements/00-foundation.md 0-6・screens.md S-25・decision-register.md C-76）と計画（#156）から決める：
//   新しい順（occurred_at の降順、同じ値なら id の降順）。期間は「日本時間（JST）の日付」で、from はその日の 00:00 JST 以降、to はその日の終わりまで。
//   ページは limit 件。続きがあるときだけ nextCursor を返し、続きで重複も抜けもない（ADR-0006）。
// 契約（実装者へ。実装前の仮置き。backend/src/db/audit-log.repository.ts に足す）：
//   withAuditLogReader(env, (reader) => ...)・createAuditLogReader(db)
//   reader.search({ viewer: { userId, sessionId, traceId }, now: Date, filter: { from?, to?, actorId?, action?, targetType?, targetId?, result? },
//                   cursor?: CursorPayload（decodeCursor の結果）, limit: number })
//     → { items: AuditLogRow[]; nextCursor: string | null }
//   1回の search が、閲覧の記録（audit_log.view）の書き込みと一覧の SELECT を、同じ db.batch で行う（AC-6 は audit-log.repository.view.db.test.ts）。
//   AuditLogRow（SELECT する列は、これだけ。legal_name・email・login_id・trace_id は選ばない）：
//     { id, occurredAt, action, result, actorId, actorName, actorIsActive, targetType, targetId, targetName, targetIsActive, detail }
//     actorName・actorIsActive：操作者の users の行があるときの display_name・is_active。行がない・actorId が null なら null。
//     targetName・targetIsActive：targetType が user の users の display_name・is_active。department・client・channel は名前（channel は rooms と同じ room_id で引く）。
//       行がない・解決しない種類（message・channel_request・source など）・種類と ID が合わない場合は null。DM の部屋は channels の行がないため null（名前を作らない）。
//     detail は JSON の文字列のまま（取り出しは Service の toAuditLogItem）。
// データは架空（testuser_156l_・[UNIT_TEST]）。閲覧する人（viewer）は一覧の対象の操作者とは別の人にして、自分の閲覧の記録が結果に混ざらないようにする。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AUDIT_TRACE_PREFIX,
  auditId,
  cleanupAuditLogTestData,
  cleanupClients,
  insertAuditLog,
  insertClient,
  remainingAuditTestRows,
  type AuditSeed,
} from "../../test/audit-log-fixtures";
import { insertSession } from "../../test/auth-fixtures";
import { insertChannel } from "../../test/department-fixtures";
import {
  cleanupMessageScenario,
  insertDirectRoom,
  insertMessage,
} from "../../test/message-fixtures";
import {
  insertAssignment,
  insertDepartment,
  insertUser,
} from "../../test/role-fixtures";
import { decodeCursor } from "../lib/cursor";
import { ROLE_IDS } from "../lib/permissions";
import { withAuditLogReader } from "./audit-log.repository";

type Filter = {
  from?: string;
  to?: string;
  actorId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  result?: "success" | "failure";
};

let deptId: string;
let viewer: string;
let sessionId: string;
let actorA: string;
let actorB: string;
let inactiveActor: string;
let targetUser: string;

async function search(
  options: { filter?: Filter; cursor?: string; limit?: number } = {},
) {
  return withAuditLogReader(env, (reader) =>
    reader.search({
      viewer: {
        userId: viewer,
        sessionId,
        traceId: `${AUDIT_TRACE_PREFIX}viewer`,
      },
      now: new Date(),
      filter: options.filter ?? {},
      cursor:
        options.cursor === undefined ? undefined : decodeCursor(options.cursor),
      limit: options.limit ?? 20,
    }),
  );
}

const idsOf = (page: { items: { id: string }[] }) =>
  page.items.map((item) => item.id);

/** 操作者 A の行を入れる（既定は成功の account.create） */
function seedRow(
  n: number,
  occurredAt: string,
  extra: Partial<AuditSeed> = {},
) {
  return insertAuditLog({
    id: auditId(n),
    occurredAt,
    actorId: actorA,
    action: "account.create",
    targetType: "user",
    targetId: targetUser,
    ...extra,
  });
}

beforeEach(async () => {
  deptId = await insertDepartment("156一覧");
  viewer = await insertUser("testuser_156l_viewer", deptId);
  actorA = await insertUser("testuser_156l_actora", deptId);
  actorB = await insertUser("testuser_156l_actorb", deptId);
  inactiveActor = await insertUser("testuser_156l_inactive", deptId, {
    isActive: false,
  });
  targetUser = await insertUser("testuser_156l_target", deptId);
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ?").bind(
      "testuser_156l_表示A",
      actorA,
    ),
    env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ?").bind(
      "testuser_156l_表示B",
      actorB,
    ),
    env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ?").bind(
      "testuser_156l_表示無効",
      inactiveActor,
    ),
    env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ?").bind(
      "testuser_156l_表示対象",
      targetUser,
    ),
  ]);
  await insertAssignment(viewer, ROLE_IDS.globalAdmin, "company", null);
  sessionId = (
    await insertSession(viewer, { createdAt: new Date().toISOString() })
  ).id;
});

afterEach(async () => {
  await cleanupClients();
  await cleanupAuditLogTestData();
  await cleanupMessageScenario();
  // 後始末の後、このテストの監査ログが 0 件であること（識別子だけで消せている）
  expect(await remainingAuditTestRows()).toBe(0);
});

describe("#156 0-6 AC-2: 一覧の行の形と名前の解決（D1）", () => {
  it("#156 0-6 AC-2・AC-5: 行は決めた列だけを持ち、本名・メール・社員ID・trace_id を持たない", async () => {
    await seedRow(1, "2031-03-04T01:00:00.000Z", {
      detail: JSON.stringify({ reason: "locked" }),
    });
    const page = await search({ filter: { actorId: actorA } });
    expect(page.items).toHaveLength(1);
    const row = page.items[0] as unknown as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual(
      [
        "id",
        "occurredAt",
        "action",
        "result",
        "actorId",
        "actorName",
        "actorIsActive",
        "targetType",
        "targetId",
        "targetName",
        "targetIsActive",
        "detail",
      ].sort(),
    );
    const text = JSON.stringify(page);
    expect(text).not.toContain("@example.com");
    expect(text).not.toContain("testuser_156l_actora"); // 社員ID（login_id）
    expect(text).not.toContain("v1:"); // 本名の暗号文
    expect(text).not.toContain(AUDIT_TRACE_PREFIX);
  });

  it("#156 0-6 AC-2: 操作者は有効な社員なら表示名と有効、無効な社員なら表示名と無効、行がなければ名前なし、不明（null）なら ID も名前もなし", async () => {
    const missingActor = "01JTEST156M1SS1NG000000001";
    await seedRow(1, "2031-03-04T01:00:00.000Z", { actorId: actorA });
    await seedRow(2, "2031-03-04T01:00:01.000Z", { actorId: inactiveActor });
    await seedRow(3, "2031-03-04T01:00:02.000Z", { actorId: missingActor });
    await seedRow(4, "2031-03-04T01:00:03.000Z", {
      actorId: null,
      action: "auth.login",
      result: "failure",
      targetType: "user",
      targetId: null,
    });
    const page = await search({
      filter: {
        from: "2031-03-04",
        to: "2031-03-04",
        targetType: "user",
        targetId: targetUser,
      },
    });
    // targetId を指定した行だけ（4 は targetId が null のため入らない）
    expect(idsOf(page)).toEqual([auditId(3), auditId(2), auditId(1)]);
    const byId = new Map(page.items.map((item) => [item.id, item]));
    expect(byId.get(auditId(1))).toMatchObject({
      actorId: actorA,
      actorName: "testuser_156l_表示A",
      actorIsActive: true,
    });
    expect(byId.get(auditId(2))).toMatchObject({
      actorId: inactiveActor,
      actorName: "testuser_156l_表示無効",
      actorIsActive: false,
    });
    expect(byId.get(auditId(3))).toMatchObject({
      actorId: missingActor,
      actorName: null,
      actorIsActive: null,
    });
    const unknownActor = await search({
      filter: { action: "auth.login", from: "2031-03-04", to: "2031-03-04" },
    });
    expect(unknownActor.items.find((i) => i.id === auditId(4))).toMatchObject({
      actorId: null,
      actorName: null,
      actorIsActive: null,
    });
  });

  it("#156 0-6 AC-2: 対象が社員なら表示名と有効・無効を、部署・取引先・チャンネルなら名前を出す", async () => {
    const clientId = "01JTEST156C11ENT0000000001";
    await insertClient(clientId, "T156", "[UNIT_TEST]156取引先");
    const channelId = await insertChannel({
      name: "[UNIT_TEST]156チャンネル",
      purpose: "normal",
      departmentId: deptId,
      visibility: "private",
    });
    await seedRow(1, "2031-03-04T01:00:00.000Z");
    await seedRow(2, "2031-03-04T01:00:01.000Z", {
      action: "department.rename",
      targetType: "department",
      targetId: deptId,
    });
    await seedRow(3, "2031-03-04T01:00:02.000Z", {
      action: "client.rename",
      targetType: "client",
      targetId: clientId,
    });
    await seedRow(4, "2031-03-04T01:00:03.000Z", {
      action: "channel.join",
      targetType: "channel",
      targetId: channelId,
    });
    const inactiveTargetRow = await seedRow(5, "2031-03-04T01:00:04.000Z", {
      action: "account.deactivate",
      targetId: inactiveActor,
    });
    const page = await search({ filter: { actorId: actorA } });
    const byId = new Map(page.items.map((item) => [item.id, item]));
    expect(byId.get(auditId(1))).toMatchObject({
      targetType: "user",
      targetId: targetUser,
      targetName: "testuser_156l_表示対象",
      targetIsActive: true,
    });
    expect(byId.get(auditId(2))).toMatchObject({
      targetName: "[UNIT_TEST]156一覧",
    });
    expect(byId.get(auditId(3))).toMatchObject({
      targetName: "[UNIT_TEST]156取引先",
    });
    expect(byId.get(auditId(4))).toMatchObject({
      targetName: "[UNIT_TEST]156チャンネル",
    });
    expect(byId.get(inactiveTargetRow)).toMatchObject({
      targetName: "testuser_156l_表示無効",
      targetIsActive: false,
    });
  });

  it("#156 0-6 AC-2: 対象の行がない・解決しない種類・種類と ID が合わない場合は、名前なし（ID も画面に出さない前提で null）", async () => {
    await seedRow(1, "2031-03-04T01:00:00.000Z", {
      action: "department.rename",
      targetType: "department",
      targetId: "01JTEST156M1SS1NG000000002",
    });
    // 種類が department なのに、ID が社員のもの（種類を無視して結合していないこと）
    await seedRow(2, "2031-03-04T01:00:01.000Z", {
      action: "department.rename",
      targetType: "department",
      targetId: targetUser,
    });
    await seedRow(3, "2031-03-04T01:00:02.000Z", {
      action: "channel_request.create",
      targetType: "channel_request",
      targetId: targetUser,
    });
    await seedRow(4, "2031-03-04T01:00:03.000Z", {
      action: "auth.rate_limited",
      targetType: "source",
      targetId: null,
    });
    const page = await search({ filter: { actorId: actorA } });
    expect(page.items).toHaveLength(4);
    for (const item of page.items) expect(item.targetName).toBeNull();
    expect(page.items.map((i) => i.targetIsActive)).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  it("#156 0-6 AC-2: DM の部屋（channels の行がない部屋）を対象にした行は名前を作らない。メッセージを対象にした行は本文を読まない", async () => {
    const dmRoom = await insertDirectRoom();
    const channelId = await insertChannel({
      name: "[UNIT_TEST]156本文の部屋",
      purpose: "normal",
      departmentId: deptId,
    });
    const secretBody = "[UNIT_TEST]156読んではいけない本文";
    const messageId = await insertMessage({
      roomId: channelId,
      senderId: targetUser,
      body: secretBody,
      id: "01JTEST156MESSAGE000000001",
    });
    await seedRow(1, "2031-03-04T01:00:00.000Z", {
      action: "channel.join",
      targetType: "channel",
      targetId: dmRoom,
    });
    await seedRow(2, "2031-03-04T01:00:01.000Z", {
      action: "message.delete",
      targetType: "message",
      targetId: messageId,
      detail: JSON.stringify({ roomId: dmRoom }),
    });
    const page = await search({ filter: { actorId: actorA } });
    expect(page.items).toHaveLength(2);
    for (const item of page.items) expect(item.targetName).toBeNull();
    expect(JSON.stringify(page)).not.toContain(secretBody);
  });
});

describe("#156 0-6 AC-3: 並びと絞り込み（D1）", () => {
  it("#156 0-6 AC-3: 新しい順に返し、同じ時刻の行は id の降順（occurred_at が同じ3件と、id は大きいが時刻が古い1件を含む）", async () => {
    const same = "2031-03-04T01:00:00.000Z";
    await seedRow(1, same);
    await seedRow(3, same);
    await seedRow(2, same);
    await seedRow(9, "2031-03-04T00:00:00.000Z"); // id は最大だが、時刻は一番古い
    await seedRow(4, "2031-03-04T02:00:00.000Z");
    const page = await search({ filter: { actorId: actorA } });
    expect(idsOf(page)).toEqual([
      auditId(4),
      auditId(3),
      auditId(2),
      auditId(1),
      auditId(9),
    ]);
    expect(page.nextCursor).toBeNull();
  });

  it("#156 0-6 AC-3: 操作者で絞り込むと、その人の行だけを返す", async () => {
    await seedRow(1, "2031-03-04T01:00:00.000Z", { actorId: actorA });
    await seedRow(2, "2031-03-04T01:00:01.000Z", { actorId: actorB });
    expect(idsOf(await search({ filter: { actorId: actorB } }))).toEqual([
      auditId(2),
    ]);
    expect(
      idsOf(
        await search({ filter: { actorId: "01JTEST156N0B0DY0000000001" } }),
      ),
    ).toEqual([]);
  });

  it("#156 0-6 AC-3: 操作の種類で絞り込むと、その操作の行だけを返す", async () => {
    await seedRow(1, "2031-03-04T01:00:00.000Z", { action: "account.create" });
    await seedRow(2, "2031-03-04T01:00:01.000Z", {
      action: "account.deactivate",
    });
    await seedRow(3, "2031-03-04T01:00:02.000Z", { action: "account.create" });
    expect(
      idsOf(
        await search({
          filter: { actorId: actorA, action: "account.create" },
        }),
      ),
    ).toEqual([auditId(3), auditId(1)]);
  });

  it("#156 0-6 AC-3: 結果で絞り込むと、成功だけ・失敗だけを返す", async () => {
    await seedRow(1, "2031-03-04T01:00:00.000Z", { result: "success" });
    await seedRow(2, "2031-03-04T01:00:01.000Z", { result: "failure" });
    expect(
      idsOf(await search({ filter: { actorId: actorA, result: "failure" } })),
    ).toEqual([auditId(2)]);
    expect(
      idsOf(await search({ filter: { actorId: actorA, result: "success" } })),
    ).toEqual([auditId(1)]);
  });

  it("#156 0-6 AC-3: 対象（種類と ID の組）で絞り込むと、その対象の行だけを返す。同じ ID でも種類が違う行は返さない", async () => {
    await seedRow(1, "2031-03-04T01:00:00.000Z", {
      targetType: "user",
      targetId: targetUser,
    });
    await seedRow(2, "2031-03-04T01:00:01.000Z", {
      targetType: "user",
      targetId: actorB,
    });
    await seedRow(3, "2031-03-04T01:00:02.000Z", {
      action: "department.rename",
      targetType: "department",
      targetId: targetUser,
    });
    expect(
      idsOf(
        await search({
          filter: { actorId: actorA, targetType: "user", targetId: targetUser },
        }),
      ),
    ).toEqual([auditId(1)]);
  });

  it("#156 0-6 AC-3: 期間は日本時間の日付で、from はその日の 00:00 JST 以降、to はその日の終わりまで。UTC の 14:59:59.999 は同じ日、15:00:00.000 は翌日", async () => {
    await seedRow(1, "2026-11-16T14:59:59.999Z"); // JST 11-16 23:59:59.999
    await seedRow(2, "2026-11-16T15:00:00.000Z"); // JST 11-17 00:00:00.000
    await seedRow(3, "2026-11-15T14:59:59.999Z"); // JST 11-15 23:59:59.999
    await seedRow(4, "2026-11-15T15:00:00.000Z"); // JST 11-16 00:00:00.000
    const scoped = (filter: Filter) =>
      search({ filter: { actorId: actorA, ...filter } }).then(idsOf);
    expect(await scoped({ from: "2026-11-16", to: "2026-11-16" })).toEqual([
      auditId(1),
      auditId(4),
    ]);
    expect(await scoped({ from: "2026-11-17", to: "2026-11-17" })).toEqual([
      auditId(2),
    ]);
    expect(await scoped({ from: "2026-11-16" })).toEqual([
      auditId(2),
      auditId(1),
      auditId(4),
    ]);
    expect(await scoped({ to: "2026-11-16" })).toEqual([
      auditId(1),
      auditId(4),
      auditId(3),
    ]);
    // 日付をまたぐ範囲：11-15 から 11-16 まで
    expect(await scoped({ from: "2026-11-15", to: "2026-11-16" })).toEqual([
      auditId(1),
      auditId(4),
      auditId(3),
    ]);
  });

  it("#156 0-6 AC-3: 絞り込みを組み合わせると、すべてに当たる行だけを返す（期間・操作者・操作・結果）", async () => {
    await seedRow(1, "2031-03-04T01:00:00.000Z", {
      action: "account.deactivate",
      result: "success",
    });
    await seedRow(2, "2031-03-04T01:00:01.000Z", {
      action: "account.deactivate",
      result: "failure",
    });
    await seedRow(3, "2031-03-04T01:00:02.000Z", {
      action: "account.create",
      result: "failure",
    });
    await seedRow(4, "2031-03-04T01:00:03.000Z", {
      action: "account.deactivate",
      result: "failure",
      actorId: actorB,
    });
    await seedRow(5, "2031-03-10T01:00:00.000Z", {
      action: "account.deactivate",
      result: "failure",
    });
    expect(
      idsOf(
        await search({
          filter: {
            from: "2031-03-04",
            to: "2031-03-04",
            actorId: actorA,
            action: "account.deactivate",
            result: "failure",
          },
        }),
      ),
    ).toEqual([auditId(2)]);
  });
});

describe("#156 0-6 AC-3: カーソルでのページ送り（D1）", () => {
  /** 45件（時刻は3つの束で、束の中は同じ時刻）と、id は大きいが時刻が一番古い1件 */
  async function seedMany() {
    const seeds: { id: string; occurredAt: string }[] = [];
    for (let n = 1; n <= 45; n += 1) {
      const bucket = Math.floor((n - 1) / 15);
      seeds.push({
        id: auditId(n),
        occurredAt: `2031-03-04T0${bucket + 1}:00:00.000Z`,
      });
    }
    seeds.push({ id: auditId(99), occurredAt: "2031-03-04T00:00:00.000Z" });
    for (const seed of seeds)
      await seedRow(Number(seed.id.slice(13)), seed.occurredAt);
    return seeds;
  }

  /** 期待する並び：仕様（新しい順・同じ時刻は id の降順）から、テスト側で独立に作る */
  const expectedOrder = (seeds: { id: string; occurredAt: string }[]) =>
    [...seeds]
      .sort((a, b) =>
        a.occurredAt === b.occurredAt
          ? b.id.localeCompare(a.id)
          : b.occurredAt.localeCompare(a.occurredAt),
      )
      .map((s) => s.id);

  it("#156 0-6 AC-3: 20件ずつ読むと、続きがあるときだけ nextCursor が付き、全ページをつなぐと重複も抜けもなく期待の順になる", async () => {
    const seeds = await seedMany();
    const filter = { actorId: actorA };
    const first = await search({ filter });
    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).not.toBeNull();
    const second = await search({
      filter,
      cursor: first.nextCursor ?? "",
    });
    expect(second.items).toHaveLength(20);
    expect(second.nextCursor).not.toBeNull();
    const third = await search({
      filter,
      cursor: second.nextCursor ?? "",
    });
    expect(third.items).toHaveLength(6);
    expect(third.nextCursor).toBeNull();
    const all = [...first.items, ...second.items, ...third.items].map(
      (i) => i.id,
    );
    expect(new Set(all).size).toBe(46);
    expect(all).toEqual(expectedOrder(seeds));
  });

  it("#156 0-6 AC-3: 件数がちょうど limit のときは nextCursor を返さない。limit より1件多いときは返し、続きは1件", async () => {
    for (let n = 1; n <= 3; n += 1)
      await seedRow(n, `2031-03-04T0${n}:00:00.000Z`);
    const exact = await search({ filter: { actorId: actorA }, limit: 3 });
    expect(exact.items).toHaveLength(3);
    expect(exact.nextCursor).toBeNull();
    const shorter = await search({ filter: { actorId: actorA }, limit: 2 });
    expect(idsOf(shorter)).toEqual([auditId(3), auditId(2)]);
    expect(shorter.nextCursor).not.toBeNull();
    const rest = await search({
      filter: { actorId: actorA },
      limit: 2,
      cursor: shorter.nextCursor ?? "",
    });
    expect(idsOf(rest)).toEqual([auditId(1)]);
    expect(rest.nextCursor).toBeNull();
  });

  it("#156 0-6 AC-3: 絞り込みに当たる行がなければ、空の一覧で nextCursor なし", async () => {
    await seedRow(1, "2031-03-04T01:00:00.000Z");
    const page = await search({
      filter: { actorId: actorA, result: "failure" },
    });
    expect(page).toEqual({ items: [], nextCursor: null });
  });

  it("#156 0-6 AC-3: ページ送りの途中で、新しい行が書かれても、読んだ行の重複も抜けも起きない（新しい行は先頭側に入る）", async () => {
    for (let n = 1; n <= 5; n += 1)
      await seedRow(n, `2031-03-04T0${n}:00:00.000Z`);
    const first = await search({ filter: { actorId: actorA }, limit: 2 });
    expect(idsOf(first)).toEqual([auditId(5), auditId(4)]);
    await seedRow(6, "2031-03-04T09:00:00.000Z"); // 続きを読む前に、新しい行が入る
    const second = await search({
      filter: { actorId: actorA },
      limit: 2,
      cursor: first.nextCursor ?? "",
    });
    expect(idsOf(second)).toEqual([auditId(3), auditId(2)]);
  });
});
