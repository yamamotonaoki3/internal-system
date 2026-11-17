// #146（146-B）コードレビュー1回目（軽微）：共通のテストデータの削除（backend/db/seeds/cleanup.sql）が、案件専用チャンネルのメッセージと、
// それを参照する行（添付・リアクション・メンション・スレッドの既読位置）を、外部キー違反にならない順で消し、残数が 0 になることを確かめる。
// 案件専用チャンネルは department_id が NULL のため、「テスト部署の部屋」の条件では選ばれない。
// 投稿・添付・リアクション・メンション・既読位置の主が、テストの識別子に当たらない利用者（outsider_）でも、削除が完了することを確かめる。
// 方法は cleanup-sql.case-requests.db.test.ts と同じ（cleanup.sql をコメント行を除いて文ごとに分け、1つの batch で隔離 D1 に流す）。
// 失敗の確認：案件専用チャンネルのメッセージを参照する行を消さない cleanup.sql では、メッセージの削除が外部キーで失敗する（Red）。
// データは架空（testuser_casereq_、outsider_146bcm_、[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import cleanupSql from "../../db/seeds/cleanup.sql?raw";
import { insertAttachmentRow } from "../../test/attachment-fixtures";
import {
  cleanupCaseApprovalTestData,
  insertCase,
} from "../../test/case-approval-fixtures";
import {
  cleanupCaseRequestTestData,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import { insertMember } from "../../test/department-fixtures";
import { insertMessage } from "../../test/message-fixtures";
import { insertReactionRow } from "../../test/reaction-fixtures";
import { insertUser, testId } from "../../test/role-fixtures";
import { idAt, insertThreadReadPosition } from "../../test/thread-fixtures";

const OUTSIDER_DEPT = testId("CMDEPT");
const OUTSIDER_USER = testId("CMUSER");
let w: CaseWorld;
let roomId: string;

function statementsOf(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*\n/)
    .map((text) => text.trim().replace(/;$/, ""))
    .filter((text) => text.length > 0);
}

async function count(sql: string, ...binds: string[]): Promise<number> {
  const row = await env.DB.prepare(sql)
    .bind(...binds)
    .first<{ n: number }>();
  return row?.n ?? -1;
}

beforeEach(async () => {
  w = await setupCaseWorld();
  // テストの識別子（[UNIT_TEST]・testuser_）に当たらない部署・利用者（cleanup.sql が消してはいけないもの）
  await env.DB.prepare(
    "INSERT INTO departments (id, name, name_normalized, is_active, created_at) VALUES (?, ?, ?, 1, ?)",
  )
    .bind(
      OUTSIDER_DEPT,
      "対象外の部署146cm",
      "対象外の部署146cm",
      "2026-11-17T00:00:00.000Z",
    )
    .run();
  await insertUser("outsider_146bcm_001", OUTSIDER_DEPT, {
    id: OUTSIDER_USER,
  });
  const created = await insertCase({
    clientId: w.clientA.id,
    caseNumber: "QZA-261117-0901",
    title: "[UNIT_TEST]後始末の案件",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
  });
  roomId = created.roomId;
  await insertMember(roomId, w.memberS1.id);
  await insertMember(roomId, OUTSIDER_USER);
});

afterEach(async () => {
  // 後始末が失敗しても、対象外のデータは必ず自分で消す（外部キーの順）
  try {
    await cleanupCaseApprovalTestData();
  } finally {
    try {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM channel_members WHERE user_id = ?").bind(
          OUTSIDER_USER,
        ),
        env.DB.prepare("DELETE FROM users WHERE id = ?").bind(OUTSIDER_USER),
        env.DB.prepare("DELETE FROM departments WHERE id = ?").bind(
          OUTSIDER_DEPT,
        ),
      ]);
    } finally {
      await cleanupCaseRequestTestData();
    }
  }
});

describe("#146 レビュー1回目（軽微）cleanup.sql と案件専用チャンネルのメッセージ", () => {
  it("#146 レビュー1回目: 案件専用チャンネルに、添付・リアクション・メンション・スレッドの既読位置の付いたメッセージ（主はテストの識別子に当たらない利用者）があっても、削除が完了し、残数は0", async () => {
    const parent = idAt(1);
    const outsiderPost = idAt(2);
    const reply = idAt(3);
    await insertMessage({
      id: parent,
      roomId,
      senderId: w.memberS1.id,
    });
    await insertMessage({
      id: outsiderPost,
      roomId,
      senderId: OUTSIDER_USER,
    });
    await insertMessage({
      id: reply,
      roomId,
      senderId: OUTSIDER_USER,
      parentMessageId: parent,
    });
    // 添付：投稿に結び付いたもの・スレッドの返信用のもの・未投稿のもの（部屋だけを指す）。アップロードした人は対象外の利用者
    await insertAttachmentRow({
      roomId,
      uploaderId: OUTSIDER_USER,
      messageId: outsiderPost,
    });
    await insertAttachmentRow({
      roomId,
      uploaderId: OUTSIDER_USER,
      threadParentId: parent,
      messageId: reply,
    });
    await insertAttachmentRow({ roomId, uploaderId: OUTSIDER_USER });
    // リアクション：対象外の利用者が、テストの利用者の投稿と自分の投稿に付ける
    await insertReactionRow({
      messageId: parent,
      userId: OUTSIDER_USER,
      kind: "emoji",
      value: "👍",
    });
    await insertReactionRow({
      messageId: outsiderPost,
      userId: OUTSIDER_USER,
      kind: "emoji",
      value: "👍",
    });
    // メンション：対象外の利用者の投稿の中の、対象外の利用者へのメンション
    await env.DB.prepare(
      'INSERT INTO message_mentions (message_id, user_id, "start", "end") VALUES (?, ?, 0, 3)',
    )
      .bind(outsiderPost, OUTSIDER_USER)
      .run();
    // スレッドの既読位置：対象外の利用者が、親（テストの利用者の投稿）のスレッドを読んだ
    await insertThreadReadPosition(OUTSIDER_USER, parent, reply);

    await env.DB.batch(
      statementsOf(cleanupSql).map((text) => env.DB.prepare(text)),
    );

    expect(
      await count(
        "SELECT COUNT(*) AS n FROM messages WHERE room_id = ?1",
        roomId,
      ),
    ).toBe(0);
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM message_attachments WHERE room_id = ?1",
        roomId,
      ),
    ).toBe(0);
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM message_attachments WHERE uploader_id = ?1",
        OUTSIDER_USER,
      ),
    ).toBe(0);
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM message_reactions WHERE user_id = ?1",
        OUTSIDER_USER,
      ),
    ).toBe(0);
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM message_mentions WHERE user_id = ?1",
        OUTSIDER_USER,
      ),
    ).toBe(0);
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM thread_read_positions WHERE user_id = ?1",
        OUTSIDER_USER,
      ),
    ).toBe(0);
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM channels WHERE room_id = ?1",
        roomId,
      ),
    ).toBe(0);
    expect(
      await count("SELECT COUNT(*) AS n FROM rooms WHERE id = ?1", roomId),
    ).toBe(0);
    // 対象外の利用者・部署は消さない
    expect(
      await count(
        "SELECT COUNT(*) AS n FROM users WHERE id = ?1",
        OUTSIDER_USER,
      ),
    ).toBe(1);
  });
});
