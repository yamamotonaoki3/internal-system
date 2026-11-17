// #147（147-C-1）書き込みの6経路：チャンネルの参加の行を資格に使う書き込みの条件を「有効な参加者」（activeChannelMember）にする。
// 147-C-2 の後の状態（無効化しても参加の行が残る。C-142(1)）を先取りして、参加の行を残したまま操作者を無効にし、
// 本物の条件付きの書き込み（隔離 D1）が0行で、メッセージ・メンション・通知・添付の結び付け・リアクション・既読位置・監査が何も残らないことを確かめる。
// これは「事前の判定 → 無効化（参加の行は残す）→ 書き込み」の順を固定したもの（Service の判定は通った後に、書き込みの SQL だけが最後の守りになる）。
// 対として、同じ準備の有効な参加者は書き込める（期待は計画 147-C-1 のテストケースと決定記録 C-182・C-142(1)）。
// 部屋は案件専用チャンネル（非公開・部署なし）。データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupCaseTestData,
  joinedAt,
  seedCase,
  type SeededCase,
} from "../../test/case-fixtures";
import {
  casereqTraceId,
  setUserActive,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import { insertAttachmentRow } from "../../test/attachment-fixtures";
import { createUlidFactory } from "../lib/ulid";
import { withMessages } from "./message.repository";
import { withDatabase } from "./database";
import { advanceReadPosition } from "./read-position-advance.sql";
import { advanceThreadReadPosition } from "./thread-read-advance.sql";

/** 同じ ms には必ず同じ ID を返す（乱数の部分を 0 に固定する）。ms が大きいほど大きい */
function fixedIdAt(ms: number): string {
  return createUlidFactory({
    now: () => ms,
    random: (length) => new Uint8Array(length),
  })();
}

const AT = "2026-11-17T03:00:00.000Z";
const ROOT_ID = fixedIdAt(1_860_000_001_000); // 他の人（memberS2）の投稿
const OWN_ID = fixedIdAt(1_860_000_002_000); // 操作者（memberS1）の投稿
const REPLY_ID = fixedIdAt(1_860_000_003_000); // ROOT への既存の返信（memberS2）
const NEW_MESSAGE_ID = fixedIdAt(1_860_000_010_000);
const NEW_REPLY_ID = fixedIdAt(1_860_000_011_000);
const PENDING_ATTACHMENT_ID = fixedIdAt(1_860_000_020_000);
const PENDING_REPLY_ATTACHMENT_ID = fixedIdAt(1_860_000_021_000);
const REACTION = { kind: "emoji", value: "👍" } as const;
const EXISTING_REACTION = { kind: "emoji", value: "🎉" } as const;

let w: CaseWorld;
let room: SeededCase;

async function insertMessageRow(
  id: string,
  senderId: string,
  parentId: string | null,
) {
  await env.DB.prepare(
    `INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at, parent_message_id)
     VALUES (?, ?, ?, 'テスト太郎', ?, ?, ?)`,
  )
    .bind(id, room.roomId, senderId, `[UNIT_TEST]本文${id}`, AT, parentId)
    .run();
}

/** 未投稿の添付の行（R2 には置かない。結び付けの SQL だけを確かめる） */
async function insertPendingAttachment(
  id: string,
  threadParentId: string | null,
) {
  await insertAttachmentRow({
    id,
    roomId: room.roomId,
    uploaderId: w.memberS1.id,
    threadParentId,
    createdAt: AT,
  });
}

/** 部屋の書き込みの結果をまとめて読む（何も残らないことの確認用） */
async function snapshot() {
  const one = async (query: string, ...binds: unknown[]) =>
    (
      await env.DB.prepare(query)
        .bind(...binds)
        .first<{ v: string | number | null }>()
    )?.v ?? null;
  return {
    messages: await one(
      "SELECT COUNT(*) AS v FROM messages WHERE room_id = ?",
      room.roomId,
    ),
    ownBody: await one("SELECT body AS v FROM messages WHERE id = ?", OWN_ID),
    ownDeletedAt: await one(
      "SELECT deleted_at AS v FROM messages WHERE id = ?",
      OWN_ID,
    ),
    mentions: await one(
      "SELECT COUNT(*) AS v FROM message_mentions WHERE message_id IN (SELECT id FROM messages WHERE room_id = ?)",
      room.roomId,
    ),
    notifications: await one(
      "SELECT COUNT(*) AS v FROM notifications WHERE room_id = ?",
      room.roomId,
    ),
    boundAttachments: await one(
      "SELECT COUNT(*) AS v FROM message_attachments WHERE room_id = ? AND message_id IS NOT NULL",
      room.roomId,
    ),
    reactions: await one(
      "SELECT COUNT(*) AS v FROM message_reactions WHERE message_id IN (SELECT id FROM messages WHERE room_id = ?)",
      room.roomId,
    ),
    readPositions: await one(
      "SELECT COUNT(*) AS v FROM read_positions WHERE room_id = ?",
      room.roomId,
    ),
    threadReadPositions: await one(
      "SELECT COUNT(*) AS v FROM thread_read_positions WHERE parent_message_id = ?",
      ROOT_ID,
    ),
    audits: await one(
      "SELECT COUNT(*) AS v FROM audit_logs WHERE target_type = 'message' AND target_id IN (?, ?)",
      OWN_ID,
      ROOT_ID,
    ),
  };
}

type WriteCase = {
  name: string;
  /** 変更した行数（1 か 0） */
  run: (actorId: string) => Promise<number>;
};

// 表には関数だけを書く（beforeEach で代入する変数は、呼ばれた時点で読む）
const WRITES: WriteCase[] = [
  {
    name: "投稿（メンション・添付の結び付けを含む。message.repository の insertIfOrdered）",
    run: (actorId) =>
      withMessages(env, (repository) =>
        repository.insertIfOrdered({
          id: NEW_MESSAGE_ID,
          roomId: room.roomId,
          senderId: actorId,
          senderDisplayName: "テスト太郎",
          body: "@テスト太郎 [UNIT_TEST]新しい投稿",
          mentions: [{ userId: w.memberS2.id, start: 0, end: 6 }],
          attachmentIds: [PENDING_ATTACHMENT_ID],
        }),
      ),
  },
  {
    name: "返信（reply-insert.sql の insertReplyIfOrdered）",
    run: (actorId) =>
      withMessages(env, (repository) =>
        repository.insertReplyIfOrdered({
          id: NEW_REPLY_ID,
          roomId: room.roomId,
          parentMessageId: ROOT_ID,
          senderId: actorId,
          senderDisplayName: "テスト太郎",
          body: "@テスト太郎 [UNIT_TEST]新しい返信",
          createdAt: AT,
          mentions: [{ userId: w.memberS2.id, start: 0, end: 6 }],
          attachmentIds: [PENDING_REPLY_ATTACHMENT_ID],
        }),
      ),
  },
  {
    name: "投稿の編集（message-modify.sql の modifiable）",
    run: (actorId) =>
      withMessages(env, (repository) =>
        repository.updateBodyIfModifiable({
          messageId: OWN_ID,
          userId: actorId,
          body: "@テスト太郎 [UNIT_TEST]編集後",
          editedAt: AT,
          roomId: room.roomId,
          mentions: [{ userId: w.memberS2.id, start: 0, end: 6 }],
        }),
      ),
  },
  {
    name: "投稿の削除（message-modify.sql の modifiable。監査を含む）",
    run: (actorId) =>
      withMessages(env, (repository) =>
        repository.deleteIfModifiable({
          messageId: OWN_ID,
          userId: actorId,
          roomId: room.roomId,
          deletedAt: AT,
          traceId: casereqTraceId(),
        }),
      ),
  },
  {
    name: "リアクションの追加（message-reactions.sql の reactable）",
    run: async (actorId) =>
      (
        await withMessages(env, (repository) =>
          repository.addReactionIfReactable({
            messageId: ROOT_ID,
            userId: actorId,
            ...REACTION,
          }),
        )
      ).changes,
  },
  {
    name: "リアクションの取り消し（message-reactions.sql の reactable）",
    run: async (actorId) =>
      (
        await withMessages(env, (repository) =>
          repository.removeReactionIfReactable({
            messageId: ROOT_ID,
            userId: actorId,
            ...EXISTING_REACTION,
          }),
        )
      ).changes,
  },
  {
    name: "既読位置の前進（read-position-advance.sql）",
    run: (actorId) =>
      withDatabase(env, (db) =>
        advanceReadPosition(db, {
          userId: actorId,
          roomId: room.roomId,
          messageId: OWN_ID,
          now: AT,
        }),
      ),
  },
  {
    name: "スレッドの既読位置の前進（thread-read-advance.sql）",
    run: (actorId) =>
      withDatabase(env, (db) =>
        advanceThreadReadPosition(db, {
          userId: actorId,
          parentMessageId: ROOT_ID,
          lastReadMessageId: REPLY_ID,
          now: AT,
        }),
      ),
  },
];

beforeEach(async () => {
  w = await setupCaseWorld();
  room = await seedCase({
    n: 31,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]有効な参加者の書き込み",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    members: [
      { userId: w.memberS1.id, joinedAt: joinedAt(1) },
      { userId: w.memberS2.id, joinedAt: joinedAt(2) },
    ],
  });
  await insertMessageRow(ROOT_ID, w.memberS2.id, null);
  await insertMessageRow(OWN_ID, w.memberS1.id, null);
  await insertMessageRow(REPLY_ID, w.memberS2.id, ROOT_ID);
  await insertPendingAttachment(PENDING_ATTACHMENT_ID, null);
  await insertPendingAttachment(PENDING_REPLY_ATTACHMENT_ID, ROOT_ID);
  await env.DB.prepare(
    "INSERT INTO message_reactions (message_id, user_id, kind, value, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(
      ROOT_ID,
      w.memberS1.id,
      EXISTING_REACTION.kind,
      EXISTING_REACTION.value,
      AT,
    )
    .run();
});

afterEach(async () => {
  await env.DB.prepare(
    "DELETE FROM audit_logs WHERE target_type = 'message' AND target_id IN (?, ?)",
  )
    .bind(OWN_ID, ROOT_ID)
    .run();
  await cleanupCaseTestData();
});

describe("#147 147-C-1 書き込みの6経路：参加の行が残った無効な社員は書き込めない（D1）", () => {
  it("#147 147-C-1 前提: 表の経路が8件（6経路。編集・削除、追加・取り消しを分けて数える）あり、空振りしない", () => {
    expect(WRITES.length).toBe(8);
  });

  it.each(WRITES)(
    "#147 147-C-1 有効な参加者（対）: $name は書き込める",
    async ({ run }) => {
      expect(await run(w.memberS1.id)).toBe(1);
    },
  );

  it.each(WRITES)(
    "#147 147-C-1 C-142(1): 参加の行を残したまま無効にした操作者の $name は0行で、行・メンション・通知・添付の結び付け・監査が何も残らない",
    async ({ run }) => {
      await setUserActive(w.memberS1.id, false);
      // 参加の行が実際に残っていること（147-C-2 の後の状態。空振りしないこと）
      const member = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM channel_members WHERE channel_id = ? AND user_id = ?",
      )
        .bind(room.roomId, w.memberS1.id)
        .first<{ n: number }>();
      expect(member?.n).toBe(1);
      const before = await snapshot();
      expect(await run(w.memberS1.id)).toBe(0);
      expect(await snapshot()).toEqual(before);
    },
  );

  it("#147 147-C-1: 参加していない有効な社員（別部署の memberD1）は、どの経路でも書き込めない（既存の条件の確認）", async () => {
    const before = await snapshot();
    for (const { run } of WRITES) expect(await run(w.memberD1.id)).toBe(0);
    expect(await snapshot()).toEqual(before);
  });
});
