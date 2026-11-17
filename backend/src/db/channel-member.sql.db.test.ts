// #147（147-A）レビュー2回目：「有効な参加者」の共通の部品 activeChannelMember（backend/src/db/channel-member.sql.ts）を、マイグレーション済みの D1 で確かめる。
// 「保持する参加の記録」（channel_members の行。退職者の表示・参加者数に使う。C-142(1)）と「いまの閲覧の資格」（この部品）を分ける。
// 契約（実装前の仮置き。計画 147-A の API の箇条）：
//   activeChannelMember(roomId: SQL, userId: string | SQL): SQL
//   = EXISTS (SELECT 1 FROM channel_members cm JOIN users u ON u.id = cm.user_id AND u.is_active = 1
//             WHERE cm.channel_id = 部屋 AND cm.user_id = 利用者)
// 部屋・利用者は SQL の式でも渡せる（一覧の行ごとの判定で cases.channel_id を渡すため）。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupCaseTestData,
  joinedAt,
  seedCase,
  type SeededCase,
} from "../../test/case-fixtures";
import {
  setUserActive,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import { activeChannelMember } from "./channel-member.sql";
import { withDatabase } from "./database";

let w: CaseWorld;
let target: SeededCase;

/** 部品の真偽を 1／0 で読む（部屋は値のパラメータ、利用者は文字列で渡す） */
async function check(roomId: string, userId: string): Promise<number> {
  return withDatabase(env, async (db) => {
    const row = await db.get<{ ok: number }>(
      sql`SELECT CASE WHEN ${activeChannelMember(sql`${roomId}`, userId)} THEN 1 ELSE 0 END AS ok`,
    );
    return row.ok;
  });
}

/** 部屋・利用者を SQL の式（外側の表の列）で渡す形：案件の行ごとに判定する一覧の使い方 */
async function checkByColumn(caseId: string, userId: string): Promise<number> {
  return withDatabase(env, async (db) => {
    const row = await db.get<{ ok: number }>(
      sql`SELECT CASE WHEN ${activeChannelMember(sql`c.channel_id`, sql`${userId}`)} THEN 1 ELSE 0 END AS ok
          FROM cases c WHERE c.id = ${caseId}`,
    );
    return row.ok;
  });
}

beforeEach(async () => {
  w = await setupCaseWorld();
  target = await seedCase({
    n: 1,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]有効な参加者の確認",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    members: [
      { userId: w.memberS1.id, joinedAt: joinedAt(1) },
      // 無効な社員の参加の行（C-142(1) で残す記録）
      { userId: w.inactive.id, joinedAt: joinedAt(2) },
    ],
  });
});

afterEach(async () => {
  await cleanupCaseTestData();
});

describe("#147 147-A レビュー2回目 activeChannelMember（D1）", () => {
  it("#147 有効な参加者: 参加の行があり有効な社員は真", async () => {
    expect(await check(target.roomId, w.memberS1.id)).toBe(1);
  });

  it("#147 有効な参加者（C-142(1)）: 参加の行が残っていても、無効な社員は偽", async () => {
    // 行が実際に残っていること（空振りしないこと）を先に確かめる
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM channel_members WHERE channel_id = ? AND user_id = ?",
    )
      .bind(target.roomId, w.inactive.id)
      .first<{ n: number }>();
    expect(row?.n).toBe(1);
    expect(await check(target.roomId, w.inactive.id)).toBe(0);
  });

  it("#147 有効な参加者: 参加していない有効な社員は偽（全体管理者・オーナーでも同じ）", async () => {
    expect(await check(target.roomId, w.memberS2.id)).toBe(0);
    expect(await check(target.roomId, w.admin.id)).toBe(0);
    expect(await check(target.roomId, w.ownerS.id)).toBe(0);
  });

  it("#147 有効な参加者: 参加していた社員を無効にすると偽になり、有効に戻すと真に戻る（行は変えない）", async () => {
    await setUserActive(w.memberS1.id, false);
    expect(await check(target.roomId, w.memberS1.id)).toBe(0);
    await setUserActive(w.memberS1.id, true);
    expect(await check(target.roomId, w.memberS1.id)).toBe(1);
  });

  it("#147 有効な参加者: 部屋を外側の表の列（cases.channel_id）で渡しても、同じ判定になる", async () => {
    expect(await checkByColumn(target.id, w.memberS1.id)).toBe(1);
    expect(await checkByColumn(target.id, w.inactive.id)).toBe(0);
    expect(await checkByColumn(target.id, w.memberS2.id)).toBe(0);
  });

  it("#147 有効な参加者: 別の部屋の参加の行では真にならない", async () => {
    const other = await seedCase({
      n: 2,
      clientId: w.clientA.id,
      code: "QZA",
      title: "[UNIT_TEST]別の案件",
      createdBy: w.memberS2.id,
      departmentIds: [w.deptS.id],
      members: [{ userId: w.memberS2.id, joinedAt: joinedAt(1) }],
    });
    expect(await check(other.roomId, w.memberS1.id)).toBe(0);
    expect(await check(target.roomId, w.memberS2.id)).toBe(0);
  });
});
