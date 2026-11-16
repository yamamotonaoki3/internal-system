// #138 AC-1（計画「DB・cleanup」）: 共通のテストデータの削除（backend/db/seeds/cleanup.sql）が、リアクション（message_reactions。利用者・メッセージへの外部キー）を、
// メッセージ・利用者より先に、外部キー違反にならない順で消し、対象外のデータを残し、残数の SELECT に remaining_message_reactions（0）を出すことを確かめる。
// 方法は cleanup-sql.thread.db.test.ts と同じ（cleanup.sql をコメント行を除いて文ごとに分け、1つの batch で隔離 D1 に流す）。
// 契約（実装者へ）：削除の基準は「削除する予定のメッセージの集合」（テストの利用者が送ったもの・テストの部署のチャンネルの部屋のもの・テストの利用者が当事者の DM の部屋のもの。既存の条件と同じ）。
//   ① テストの利用者が付けたリアクション（付けた先が対象外の利用者の投稿でも）を消す
//   ② 削除する集合のメッセージに付いたリアクションを、付けた人がテストの利用者でなくても消す（親・対象外の利用者の返信のどちらも）
//   ③ 対象外の利用者が対象外のメッセージに付けたリアクションは残す
//   ④ 最後の残数の SELECT に remaining_message_reactions を足す（上の ①② の対象が残っていれば 0 でない）
// 失敗の確認：いまの cleanup.sql にはリアクションの削除がなく、表もないため、実行できない（Red）。
// データは架空（testuser_cleanuprx_、outsider_cleanuprx_＝テストの識別子に当たらない利用者、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import cleanupSql from "../../db/seeds/cleanup.sql?raw";
import { insertChannel, insertMember } from "../../test/department-fixtures";
import { insertMessage } from "../../test/message-fixtures";
import {
  TEST_TAG,
  cleanupReactionScenario,
  insertReactionRow,
  reactionIsoAt,
  reactionRows,
} from "../../test/reaction-fixtures";
import { insertDepartment, insertUser, testId } from "../../test/role-fixtures";
import { idAt, isoAt } from "../../test/thread-fixtures";

type Row = Record<string, number>;

/** cleanup.sql をコメント行を除いて文ごとに分ける */
function statementsOf(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*\n/)
    .map((text) => text.trim().replace(/;$/, ""))
    .filter((text) => text.length > 0);
}

/** 1つの batch で流し、SELECT の結果の行をまとめて1つの行にして返す。外部キー違反などで失敗したら batch 全体が失敗する（投げる） */
async function runCleanup(): Promise<Row> {
  const statements = statementsOf(cleanupSql).map((text) =>
    env.DB.prepare(text),
  );
  const results = await env.DB.batch(statements);
  const merged: Row = {};
  for (const result of results)
    for (const row of result.results) Object.assign(merged, row);
  if (!("remaining_message_reactions" in merged))
    throw new Error(
      "remaining_message_reactions の列が SELECT の結果にありません",
    );
  return merged;
}

const OUTSIDER_DEPT = testId("OUTDEPT");
const OUTSIDER_ROOM = testId("OUTROOM");
const OUTSIDER_USER = testId("OUTUSER");
let testUser: string;
const outsider = OUTSIDER_USER;

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  // テストの識別子（[UNIT_TEST]・testuser_）に当たらない部署・利用者・チャンネル（cleanup.sql が消してはいけないもの）
  await env.DB.prepare(
    "INSERT INTO departments (id, name, name_normalized, is_active, created_at) VALUES (?, ?, ?, 1, ?)",
  )
    .bind(
      OUTSIDER_DEPT,
      "対象外の部署",
      "対象外の部署",
      "2026-11-09T00:00:00.000Z",
    )
    .run();
  await insertUser("outsider_cleanuprx_001", OUTSIDER_DEPT, {
    id: OUTSIDER_USER,
  });
  await insertChannel({
    name: "対象外のチャンネル",
    purpose: "normal",
    departmentId: OUTSIDER_DEPT,
    id: OUTSIDER_ROOM,
  });
  const testDept = await insertDepartment("cleanuprx用");
  testUser = await insertUser("testuser_cleanuprx_001", testDept);
  await insertMember(OUTSIDER_ROOM, testUser);
  await insertMember(OUTSIDER_ROOM, outsider);
});

afterEach(async () => {
  vi.restoreAllMocks();
  // 対象外のデータを、外部キーの順に自分で消す（cleanup.sql が残すべきものを残した後の後始末）。表がまだない（Red）ときも、残りの後始末は必ず行う
  try {
    await env.DB.prepare(
      "DELETE FROM message_reactions WHERE user_id = ?1 OR message_id IN (SELECT id FROM messages WHERE room_id = ?2)",
    )
      .bind(outsider, OUTSIDER_ROOM)
      .run();
  } finally {
    try {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM messages WHERE room_id = ?").bind(
          OUTSIDER_ROOM,
        ),
        env.DB.prepare("DELETE FROM channel_members WHERE channel_id = ?").bind(
          OUTSIDER_ROOM,
        ),
        env.DB.prepare("DELETE FROM channels WHERE room_id = ?").bind(
          OUTSIDER_ROOM,
        ),
        env.DB.prepare("DELETE FROM rooms WHERE id = ?").bind(OUTSIDER_ROOM),
        env.DB.prepare("DELETE FROM users WHERE id = ?").bind(outsider),
        env.DB.prepare("DELETE FROM departments WHERE id = ?").bind(
          OUTSIDER_DEPT,
        ),
      ]);
    } finally {
      await cleanupReactionScenario();
    }
  }
});

describe("#138 AC-1（計画 cleanup）cleanup.sql が message_reactions を外部キー違反なく消す", () => {
  it("#138 AC-1: テストの利用者の投稿・対象外の利用者の返信に、対象外の利用者がリアクションしていても、削除が完了し（外部キー違反にならない）、残数は0。対象外の投稿へのリアクションは残る", async () => {
    const parent = idAt(1);
    const foreignReply = idAt(2);
    await insertMessage({
      roomId: OUTSIDER_ROOM,
      senderId: testUser,
      id: parent,
      body: `${TEST_TAG}テストの親`,
      createdAt: isoAt(1),
    });
    await insertMessage({
      roomId: OUTSIDER_ROOM,
      senderId: outsider,
      id: foreignReply,
      body: "対象外の利用者の返信",
      createdAt: isoAt(2),
      parentMessageId: parent,
    });
    const outsiderMessage = idAt(10);
    await insertMessage({
      roomId: OUTSIDER_ROOM,
      senderId: outsider,
      id: outsiderMessage,
      body: "対象外の投稿",
      createdAt: isoAt(10),
    });
    // 消えるもの：① テストの利用者が付けたもの（対象外の投稿へのものも）② 消えるメッセージに、対象外の利用者が付けたもの
    await insertReactionRow({
      messageId: parent,
      userId: testUser,
      kind: "emoji",
      value: "👍",
      createdAt: reactionIsoAt(1),
    });
    await insertReactionRow({
      messageId: parent,
      userId: outsider,
      kind: "emoji",
      value: "👍",
      createdAt: reactionIsoAt(2),
    });
    await insertReactionRow({
      messageId: foreignReply,
      userId: outsider,
      kind: "stamp",
      value: "ok",
      createdAt: reactionIsoAt(3),
    });
    await insertReactionRow({
      messageId: outsiderMessage,
      userId: testUser,
      kind: "emoji",
      value: "👏",
      createdAt: reactionIsoAt(4),
    });
    // 残るもの：対象外の利用者が、対象外の投稿に付けたもの
    await insertReactionRow({
      messageId: outsiderMessage,
      userId: outsider,
      kind: "emoji",
      value: "🎉",
      createdAt: reactionIsoAt(5),
    });

    const counts = await runCleanup();

    expect(counts.remaining_message_reactions).toBe(0);
    for (const [name, value] of Object.entries(counts))
      if (name.startsWith("remaining_")) expect(value, name).toBe(0);
    expect(await reactionRows(parent)).toEqual([]);
    expect(await reactionRows(foreignReply)).toEqual([]);
    expect(
      (await reactionRows(outsiderMessage)).map((row) => [
        row.user_id,
        row.value,
      ]),
    ).toEqual([[outsider, "🎉"]]);
    const user = await env.DB.prepare("SELECT id FROM users WHERE id = ?")
      .bind(testUser)
      .first();
    expect(user).toBeNull();
  });

  it("#138 AC-1: リアクションがまったくないときも、削除は完了し、remaining_message_reactions は0", async () => {
    const counts = await runCleanup();
    expect(counts.remaining_message_reactions).toBe(0);
  });
});
