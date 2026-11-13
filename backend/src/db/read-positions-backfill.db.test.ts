// #237（C-169 (6)。計画 改訂2 A・改訂3・改訂4-4・4-6）：本番に出した直後に既存の利用者の部屋が「99+」にならないよう、
// migration 0018 の適用の直後・デプロイの前に流す、既読位置の初期合わせの SQL を、実際のマイグレーション済み D1 で確かめる。
// 本番への適用はこのテストの範囲外（利用者の承認のもとで利用者が行う）。
// 契約（実装前の前提）：
// - SQL は backend/db/scripts/backfill-read-positions.sql の 1 ファイル。`--` で始まる行（コメント）を除くと、INSERT 1 文だけ
// - 対象：チャンネルの参加者（channel_members の全行。アーカイブ済みのチャンネルも含む）と、DM の当事者（conversation_members）の、利用者×部屋。
//   値はその時点の部屋の最新のメッセージ ID（MAX(messages.id)）。メッセージのない部屋には行を作らない。
//   未参加の公開チャンネル・他人の DM には作らない。
// - べき等：ON CONFLICT(user_id, room_id) DO NOTHING。既にある既読位置は変えない。何度流しても同じ結果
// データは架空（testuser_rpbf_・[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import backfillSql from "../../db/scripts/backfill-read-positions.sql?raw";
import { apiRequest, insertReadyUser } from "../../test/api-request";
import {
  DEPT_NOW,
  insertChannel,
  insertMember,
} from "../../test/department-fixtures";
import { cleanupDmScenario, insertDm } from "../../test/dm-fixtures";
import {
  insertMessagesAt,
  insertReadPosition,
  readPositionRows,
  setArchived,
  totalReadPositions,
} from "../../test/read-position-fixtures";
import {
  TEST_TAG,
  insertDepartment,
  insertUser,
} from "../../test/role-fixtures";

const AFTER_JOIN_MS = Date.parse(DEPT_NOW) + 60_000;

let deptId: string;
let alice: string;
let bob: string;
let carol: string;

async function runBackfill() {
  const statement = backfillSql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .trim();
  expect(statement.length).toBeGreaterThan(0);
  // 1 ファイル 1 文（末尾の ; を除いて、途中に文の区切りがない）
  expect(statement.replace(/;\s*$/, "")).not.toContain(";");
  await env.DB.prepare(statement).run();
}

const rowKeys = async () =>
  (await readPositionRows()).map(
    (row) => `${row.user_id}:${row.room_id}:${row.last_read_message_id}`,
  );

const channel = (
  label: string,
  options: { visibility?: "public" | "private" } = {},
) =>
  insertChannel({
    name: `${TEST_TAG}初期合わせ${label}`,
    purpose: "normal",
    departmentId: deptId,
    ...options,
  });

beforeEach(async () => {
  deptId = await insertDepartment("初期合わせ");
  alice = await insertUser("testuser_rpbf_alice", deptId);
  bob = await insertUser("testuser_rpbf_bob", deptId);
  carol = await insertUser("testuser_rpbf_carol", deptId);
});

afterEach(async () => {
  await cleanupDmScenario();
});

describe("#237 C-169 (6) 既読位置の初期合わせ（backfill-read-positions.sql）", () => {
  it("#237 AC-1: 空の DB（テストの利用者・メッセージなし）でも失敗せず、行を作らない", async () => {
    const before = await totalReadPositions();
    await runBackfill();
    expect(await totalReadPositions()).toBe(before);
    expect(await readPositionRows()).toEqual([]);
  });

  it("#237 AC-1: 参加中のチャンネル・当事者の DM ごと、利用者ごとに1行でき、値はその部屋の最新のメッセージ ID", async () => {
    const shared = await channel("共有");
    await insertMember(shared, alice);
    await insertMember(shared, bob);
    const sharedIds = await insertMessagesAt(shared, carol, AFTER_JOIN_MS, 5);
    const aliceOnly = await channel("アリスだけ", { visibility: "private" });
    await insertMember(aliceOnly, alice);
    const aliceOnlyIds = await insertMessagesAt(
      aliceOnly,
      alice,
      AFTER_JOIN_MS,
      3,
    );
    const dm = await insertDm(alice, bob);
    const dmIds = await insertMessagesAt(dm, bob, AFTER_JOIN_MS, 2);

    await runBackfill();

    const expected = [
      `${alice}:${shared}:${sharedIds.at(-1)}`,
      `${bob}:${shared}:${sharedIds.at(-1)}`,
      `${alice}:${aliceOnly}:${aliceOnlyIds.at(-1)}`,
      `${alice}:${dm}:${dmIds.at(-1)}`,
      `${bob}:${dm}:${dmIds.at(-1)}`,
    ].sort();
    expect((await rowKeys()).sort()).toEqual(expected);
  });

  it("#237 AC-1（改訂4-4）: アーカイブ済みのチャンネルの参加者にも、最新の ID で行ができる（戻したときに「99+」にしない）", async () => {
    const archived = await channel("アーカイブ済み");
    await insertMember(archived, alice);
    const ids = await insertMessagesAt(archived, bob, AFTER_JOIN_MS, 4);
    await setArchived(archived, true);
    await runBackfill();
    expect(await rowKeys()).toEqual([`${alice}:${archived}:${ids.at(-1)}`]);
  });

  it("#237 AC-1: メッセージのない部屋・未参加の公開チャンネル・他人の DM には行を作らない", async () => {
    const empty = await channel("メッセージなし");
    await insertMember(empty, alice);
    const unjoined = await channel("未参加の公開");
    await insertMember(unjoined, bob);
    await insertMessagesAt(unjoined, bob, AFTER_JOIN_MS, 2);
    const othersDm = await insertDm(bob, carol);
    await insertMessagesAt(othersDm, bob, AFTER_JOIN_MS, 2);
    await runBackfill();
    const rows = await readPositionRows();
    expect(rows.filter((row) => row.user_id === alice)).toEqual([]);
    expect(rows.filter((row) => row.room_id === empty)).toEqual([]);
    // bob は未参加の公開チャンネルの参加者、bob・carol は DM の当事者なので、その分だけはできる
    expect(rows.map((row) => `${row.user_id}:${row.room_id}`).sort()).toEqual(
      [
        `${bob}:${unjoined}`,
        `${bob}:${othersDm}`,
        `${carol}:${othersDm}`,
      ].sort(),
    );
  });

  it("#237 AC-1: 2回流しても行数・値は変わらない（べき等）。既にある既読位置は変えない", async () => {
    const roomId = await channel("べき等");
    await insertMember(roomId, alice);
    await insertMember(roomId, bob);
    const ids = await insertMessagesAt(roomId, carol, AFTER_JOIN_MS, 6);
    // bob は既に途中まで読んでいる（初期合わせで最新に上書きしない）
    await insertReadPosition(bob, roomId, ids[1] ?? "");
    await runBackfill();
    const first = await rowKeys();
    expect(first.sort()).toEqual(
      [`${alice}:${roomId}:${ids.at(-1)}`, `${bob}:${roomId}:${ids[1]}`].sort(),
    );
    const totalAfterFirst = await totalReadPositions();
    await runBackfill();
    expect((await rowKeys()).sort()).toEqual(first.sort());
    expect(await totalReadPositions()).toBe(totalAfterFirst);
  });

  it("#237 AC-1: 流した直後は GET /api/me/unread が空になり、その後の投稿から数える", async () => {
    const viewer = await insertReadyUser("testuser_rpbf_viewer", deptId);
    const roomId = await channel("流した直後");
    await insertMember(roomId, viewer.userId);
    await insertMessagesAt(roomId, bob, AFTER_JOIN_MS, 120);
    const dm = await insertDm(viewer.userId, bob);
    await insertMessagesAt(dm, bob, AFTER_JOIN_MS, 3);

    const before = await apiRequest("GET", "/api/me/unread?limit=100", {
      token: viewer.token,
    });
    expect(before.status).toBe(200);
    expect(((await before.json()) as { items: unknown[] }).items).toHaveLength(
      2,
    );

    await runBackfill();
    const after = await apiRequest("GET", "/api/me/unread?limit=100", {
      token: viewer.token,
    });
    expect(await after.json()).toEqual({ items: [], nextCursor: null });

    await insertMessagesAt(roomId, bob, AFTER_JOIN_MS + 1_000_000, 1);
    const later = await apiRequest("GET", "/api/me/unread?limit=100", {
      token: viewer.token,
    });
    expect(await later.json()).toEqual({
      items: [{ roomId, count: 1 }],
      nextCursor: null,
    });
  });
});
