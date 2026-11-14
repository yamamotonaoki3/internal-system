// #137 AC-1（計画レビュー1・2回目 改訂1の5・改訂2の2）: 共通のテストデータの削除（backend/db/seeds/cleanup.sql）が、返信（自己参照の親子）と
// thread_read_positions（利用者・親メッセージへの外部キー）を、外部キー違反にならない順で消し、対象外のデータを残すことを確かめる。
// 方法：cleanup.sql を読み込み、コメント行を除いて文ごとに分け、1つの batch（同じ接続・トランザクション）で隔離 D1 に流す（既存に同じ方法のテストはない）。SELECT の結果の列を名前で確かめる。
// （D1 は一時テーブル CREATE TEMP TABLE を許さないため、removed_foreign_replies は、削除の前に数える SELECT で出す形になる。）
// 契約（実装者へ。改訂2の2）：削除の基準は「削除する予定のメッセージの集合」（テストの利用者が送ったもの・テストの部屋のもの。既存の条件と同じ）。
//   ① その集合のメッセージを親とする返信は、送った人がテストの利用者でなくても削除の集合に含める。テストの利用者以外の返信を消した件数は、最後の SELECT の removed_foreign_replies に出す（黙って消さない）
//   ② 集合のメッセージを親とする thread_read_positions（読んだ人がテストの利用者でなくても）と、テストの利用者の thread_read_positions を、メッセージより先に消す
//   ③ 返信を先に、親を後に消す。残数の SELECT に remaining_thread_read_positions を足す（すべての remaining_* が 0）。
// 失敗の確認：いまの cleanup.sql では、テストの利用者の親に対象外の利用者が返信しているため、メッセージの削除が外部キーで失敗する（Red）。
// データは架空（testuser_cleanup_、outsider_cleanup_＝テストの識別子に当たらない利用者、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import cleanupSql from "../../db/seeds/cleanup.sql?raw";
import { insertChannel, insertMember } from "../../test/department-fixtures";
import { insertMessage } from "../../test/message-fixtures";
import { insertDepartment, insertUser, testId } from "../../test/role-fixtures";
import {
  TEST_TAG,
  cleanupThreadScenario,
  idAt,
  insertThreadReadPosition,
  isoAt,
  parentRow,
  threadReadPositionOf,
} from "../../test/thread-fixtures";

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

/**
 * 1つの batch で流し、SELECT の結果の行をまとめて1つの行にして返す（残数の SELECT が最後にあり、removed_foreign_replies は
 * 削除より前の SELECT で出してもよい。列の名前で見る）。外部キー違反などで失敗したら、batch 全体が失敗する（投げる）
 */
async function runCleanup(): Promise<Row> {
  const statements = statementsOf(cleanupSql).map((text) =>
    env.DB.prepare(text),
  );
  const results = await env.DB.batch(statements);
  const merged: Row = {};
  for (const result of results)
    for (const row of result.results) Object.assign(merged, row);
  if (!("removed_foreign_replies" in merged))
    throw new Error("removed_foreign_replies の列が SELECT の結果にありません");
  if (!("remaining_thread_read_positions" in merged))
    throw new Error(
      "remaining_thread_read_positions の列が SELECT の結果にありません",
    );
  return merged;
}

const OUTSIDER_DEPT = testId("OUTDEPT");
const OUTSIDER_ROOM = testId("OUTROOM");
const OUTSIDER_USER = testId("OUTUSER");
let testUser: string;
const outsider = OUTSIDER_USER;

async function exists(table: string, column: string, value: string) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`,
  )
    .bind(value)
    .first<{ n: number }>();
  return (row?.n ?? 0) > 0;
}

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
  await insertUser("outsider_cleanup_001", OUTSIDER_DEPT, {
    id: OUTSIDER_USER,
  });
  await insertChannel({
    name: "対象外のチャンネル",
    purpose: "normal",
    departmentId: OUTSIDER_DEPT,
    id: OUTSIDER_ROOM,
  });
  const testDept = await insertDepartment("cleanup用");
  testUser = await insertUser("testuser_cleanup_001", testDept);
  await insertMember(OUTSIDER_ROOM, testUser);
  await insertMember(OUTSIDER_ROOM, outsider);
});

afterEach(async () => {
  vi.restoreAllMocks();
  // 対象外のデータを、外部キーの順に自分で消す（cleanup.sql が残すべきものを残した後の後始末）。
  // 既読位置の表がない（Red）ときも、残りの後始末は必ず行う（次のテストが前のデータで失敗しないように）
  try {
    // 対象外の利用者の既読と、この部屋の親（テストの利用者の親を含む）を指す既読の両方（メッセージより先に消す）
    await env.DB.prepare(
      "DELETE FROM thread_read_positions WHERE user_id = ?1 OR parent_message_id IN (SELECT id FROM messages WHERE room_id = ?2)",
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
      await cleanupThreadScenario();
    }
  }
});

describe("#137 AC-1（改訂2の2）cleanup.sql が返信と thread_read_positions を外部キー違反なく消す", () => {
  it("#137 AC-1: 通常の部屋のテストの利用者の親に、対象外の利用者が返信し・既読にしていても、削除が完了し（外部キー違反にならない）、removed_foreign_replies が1、対象外のデータは残る", async () => {
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
    // テストの利用者自身の返信（テストの集合に含まれる）
    const ownReply = idAt(3);
    await insertMessage({
      roomId: OUTSIDER_ROOM,
      senderId: testUser,
      id: ownReply,
      body: `${TEST_TAG}テストの返信`,
      createdAt: isoAt(3),
      parentMessageId: parent,
    });
    await insertThreadReadPosition(outsider, parent, foreignReply);
    await insertThreadReadPosition(testUser, parent, ownReply);
    // 対象外の利用者の通常の投稿・スレッド（残るもの）
    const outsiderMessage = idAt(10);
    await insertMessage({
      roomId: OUTSIDER_ROOM,
      senderId: outsider,
      id: outsiderMessage,
      body: "対象外の投稿",
      createdAt: isoAt(10),
    });
    const outsiderParent = idAt(11);
    const outsiderParentReply = idAt(12);
    await insertMessage({
      roomId: OUTSIDER_ROOM,
      senderId: outsider,
      id: outsiderParent,
      body: "対象外の親",
      createdAt: isoAt(11),
    });
    await insertMessage({
      roomId: OUTSIDER_ROOM,
      senderId: outsider,
      id: outsiderParentReply,
      body: "対象外の返信",
      createdAt: isoAt(12),
      parentMessageId: outsiderParent,
    });
    await insertThreadReadPosition(
      outsider,
      outsiderParent,
      outsiderParentReply,
    );

    const counts = await runCleanup();

    expect(counts.removed_foreign_replies).toBe(1);
    expect(counts.remaining_thread_read_positions).toBe(0);
    for (const [name, value] of Object.entries(counts))
      if (name.startsWith("remaining_")) expect(value, name).toBe(0);
    // 消えたもの
    expect(await parentRow(parent)).toBeNull();
    expect(await parentRow(foreignReply)).toBeNull();
    expect(await parentRow(ownReply)).toBeNull();
    expect(await threadReadPositionOf(outsider, parent)).toBeNull();
    expect(await threadReadPositionOf(testUser, parent)).toBeNull();
    expect(await exists("users", "id", testUser)).toBe(false);
    // 残るもの（対象外の利用者・部署・部屋・メッセージ・スレッドと、その既読位置）
    expect(await exists("users", "id", outsider)).toBe(true);
    expect(await exists("departments", "id", OUTSIDER_DEPT)).toBe(true);
    expect(await exists("channels", "room_id", OUTSIDER_ROOM)).toBe(true);
    expect((await parentRow(outsiderMessage))?.body).toBe("対象外の投稿");
    expect((await parentRow(outsiderParent))?.body).toBe("対象外の親");
    expect((await parentRow(outsiderParentReply))?.parent_message_id).toBe(
      outsiderParent,
    );
    expect(await threadReadPositionOf(outsider, outsiderParent)).toBe(
      outsiderParentReply,
    );
  });

  it("#137 AC-1: テストの利用者の親・返信とテストの利用者の既読だけがあるとき（対象外の関与なし）は、removed_foreign_replies が0で、すべて消える", async () => {
    const parent = idAt(1);
    const reply = idAt(2);
    await insertMessage({
      roomId: OUTSIDER_ROOM,
      senderId: testUser,
      id: parent,
      body: `${TEST_TAG}親`,
      createdAt: isoAt(1),
    });
    await insertMessage({
      roomId: OUTSIDER_ROOM,
      senderId: testUser,
      id: reply,
      body: `${TEST_TAG}返信`,
      createdAt: isoAt(2),
      parentMessageId: parent,
    });
    await insertThreadReadPosition(testUser, parent, reply);
    const counts = await runCleanup();
    expect(counts.removed_foreign_replies).toBe(0);
    expect(counts.remaining_thread_read_positions).toBe(0);
    expect(await parentRow(parent)).toBeNull();
    expect(await parentRow(reply)).toBeNull();
  });
});
