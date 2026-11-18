// #148（148-A）5-2 AC-1・5-1 AC-11：案件専用チャンネル（案件の部屋）の書き込みの SQL に「案件が進行中」の条件（case-room.sql.ts の caseRoomOpen）が
// 入っていることを、マイグレーション済みの隔離 D1 で確かめる。
// この層で確かめるもの（計画 148-A のテストケースの「DB」の行）：
//   caseRoomOpen の真偽（案件でない部屋は真・進行中の案件の部屋は真・終了の案件の部屋は偽）
//   投稿・返信・編集・削除・リアクションの追加・取り消しの書き込みが、終了の案件の部屋では0行（行が残らない）、進行中は1行。通常のチャンネル・DM は変わらない
//   相関の確認（#294）：①その部屋の参加者でないが、ほかの部屋の有効な参加者である人は、どの経路も0行・読みも0件
//                      ②ほかの案件は進行中だが、その案件は終了している場合、その部屋への書き込みは0行（ほかの案件の部屋は1行）
//   参加の行が残った無効の利用者は、案件の部屋に書き込めない（147-C-1 の「有効な参加者」の判定）
// 判定の順・応答コード（404／403／409）は Service・結合のテストで確かめ、ここでは重ねない。
// 契約（実装前の仮置き。計画 148-A「共通の SQL の部品」）：backend/src/db/case-room.sql.ts
//   caseRoomOpen(roomId: SQLWrapper): SQL … NOT EXISTS (SELECT 1 FROM cases k WHERE k.channel_id = <room> AND k.status <> 'active')
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupCaseRoomWorld,
  insertCaseWorldDm,
  messageCountIn,
  seedRoomMessage,
  seedRoomReply,
  setupCaseRoomWorld,
  type CaseRoomWorld,
} from "../../test/case-room-fixtures";
import { reactionRows } from "../../test/reaction-fixtures";
import { messageRow } from "../../test/message-modify-fixtures";
import { idAt, isoAt } from "../../test/thread-fixtures";
import { caseRoomOpen } from "./case-room.sql";
import { withDatabase } from "./database";
import { withMessages } from "./message.repository";

let cw: CaseRoomWorld;
let seq = 0;

/** 部屋の既存のメッセージより後ろの ID（n は 500 から増やす） */
const nextN = () => {
  seq += 1;
  return 500 + seq;
};

async function openOf(roomId: string): Promise<boolean> {
  return withDatabase(env, async (db) => {
    const row = await db.get<{ ok: number }>(
      sql`SELECT CASE WHEN ${caseRoomOpen(sql`r.id`)} THEN 1 ELSE 0 END AS ok FROM rooms r WHERE r.id = ${roomId}`,
    );
    return row.ok === 1;
  });
}

const post = (roomId: string, senderId: string) => {
  const n = nextN();
  return withMessages(env, (r) =>
    r.insertIfOrdered({
      id: idAt(n),
      roomId,
      senderId,
      senderDisplayName: "テスト太郎",
      body: `[UNIT_TEST]148投稿${n}`,
      createdAt: isoAt(n),
    }),
  );
};

const reply = (roomId: string, parentMessageId: string, senderId: string) => {
  const n = nextN();
  return withMessages(env, (r) =>
    r.insertReplyIfOrdered({
      id: idAt(n),
      roomId,
      parentMessageId,
      senderId,
      senderDisplayName: "テスト太郎",
      body: `[UNIT_TEST]148返信${n}`,
      createdAt: isoAt(n),
    }),
  );
};

const edit = (roomId: string, messageId: string, userId: string) =>
  withMessages(env, (r) =>
    r.updateBodyIfModifiable({
      messageId,
      userId,
      roomId,
      body: "[UNIT_TEST]148編集後",
      editedAt: "2026-11-18T00:00:00.000Z",
    }),
  );

const remove = (roomId: string, messageId: string, userId: string) =>
  withMessages(env, (r) =>
    r.deleteIfModifiable({
      messageId,
      userId,
      roomId,
      deletedAt: "2026-11-18T00:00:00.000Z",
      traceId: "unit-148-case-room",
    }),
  );

const react = async (messageId: string, userId: string) =>
  (
    await withMessages(env, (r) =>
      r.addReactionIfReactable({
        messageId,
        userId,
        kind: "emoji",
        value: "👍",
      }),
    )
  ).changes;

const unreact = async (messageId: string, userId: string) =>
  (
    await withMessages(env, (r) =>
      r.removeReactionIfReactable({
        messageId,
        userId,
        kind: "emoji",
        value: "👍",
      }),
    )
  ).changes;

/** 5経路（投稿・返信・編集・削除・リアクションの追加と取り消し）を、その人で試した変更の行数 */
async function writesBy(roomId: string, userId: string) {
  // 本人の投稿（編集・削除の対象）と、リアクションの対象・取り消しの対象を、条件を通さずに入れておく
  const own = await seedRoomMessage(roomId, userId, nextN());
  const forDelete = await seedRoomMessage(roomId, userId, nextN());
  const target = await seedRoomMessage(roomId, userId, nextN());
  await env.DB.prepare(
    "INSERT INTO message_reactions (message_id, kind, value, user_id, created_at) VALUES (?, 'emoji', '🎉', ?, ?)",
  )
    .bind(target, userId, isoAt(1))
    .run();
  const before = await messageCountIn(roomId);
  const posted = await post(roomId, userId);
  const replied = await reply(roomId, own, userId);
  const edited = await edit(roomId, own, userId);
  const deleted = await remove(roomId, forDelete, userId);
  const reacted = await react(target, userId);
  const unreacted = await withMessages(env, (r) =>
    r.removeReactionIfReactable({
      messageId: target,
      userId,
      kind: "emoji",
      value: "🎉",
    }),
  );
  return {
    posted,
    replied,
    edited,
    deleted,
    reacted,
    unreacted: unreacted.changes,
    added: (await messageCountIn(roomId)) - before,
    ownBody: (await messageRow(own))?.body,
    deletedAt: (await messageRow(forDelete))?.deleted_at ?? null,
    reactionValues: (await reactionRows(target)).map((row) => row.value),
  };
}

const NONE = {
  posted: 0,
  replied: 0,
  edited: 0,
  deleted: 0,
  reacted: 0,
  unreacted: 0,
  added: 0,
  ownBody: expect.stringContaining("148投稿") as unknown,
  deletedAt: null,
  reactionValues: ["🎉"],
};

const ALL = {
  posted: 1,
  replied: 1,
  edited: 1,
  deleted: 1,
  reacted: 1,
  unreacted: 1,
  added: 2,
  ownBody: "[UNIT_TEST]148編集後",
  deletedAt: "2026-11-18T00:00:00.000Z",
  reactionValues: ["👍"],
};

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  cw = await setupCaseRoomWorld();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupCaseRoomWorld();
});

describe("#148 5-2 AC-1・5-1 AC-11 caseRoomOpen（SQL の部品の真偽）", () => {
  it("#148 5-1 AC-11: 案件でない部屋（通常のチャンネル・DM）は真", async () => {
    const dm = await insertCaseWorldDm(cw.w.memberS1.id, cw.w.memberD1.id);
    expect(await openOf(cw.normal)).toBe(true);
    expect(await openOf(dm)).toBe(true);
  });

  it("#148 5-1 AC-11: 進行中の案件の部屋は真、終了の案件の部屋は偽", async () => {
    expect(await openOf(cw.open.roomId)).toBe(true);
    expect(await openOf(cw.other.roomId)).toBe(true);
    expect(await openOf(cw.closed.roomId)).toBe(false);
  });
});

describe("#148 5-2 AC-1・5-1 AC-11 書き込みの5経路の SQL の条件（最後の砦）", () => {
  it("#148 5-2 AC-1: 進行中の案件の部屋では、有効な参加者の投稿・返信・編集・削除・リアクションの追加と取り消しが、それぞれ1行", async () => {
    expect(await writesBy(cw.open.roomId, cw.w.memberS1.id)).toEqual(ALL);
  });

  it("#148 5-1 AC-11: 終了の案件の部屋では、有効な参加者でも5経路とも0行で、行が残らない・変わらない", async () => {
    expect(await writesBy(cw.closed.roomId, cw.w.memberS1.id)).toEqual(NONE);
  });

  it("#148 退行なし: 案件でない通常のチャンネルでは、参加者の5経路が1行（終了の案件があっても変わらない）", async () => {
    expect(await writesBy(cw.normal, cw.w.memberD1.id)).toEqual(ALL);
  });

  it("#148 退行なし: DM の当事者は、5経路が1行", async () => {
    const dm = await insertCaseWorldDm(cw.w.memberS1.id, cw.w.memberD1.id);
    expect(await writesBy(dm, cw.w.memberS1.id)).toEqual(ALL);
  });

  it("#148 5-2 AC-1・147-C-1: 参加の行が残った無効の利用者は、進行中の案件の部屋でも5経路とも0行", async () => {
    expect(await writesBy(cw.open.roomId, cw.w.inactive.id)).toEqual(NONE);
  });

  it("#148 5-1 AC-11: 進行中の案件を終了に変えると、同じ参加者の書き込みが0行になる（案件の状態を毎回読む）", async () => {
    expect(await post(cw.open.roomId, cw.w.memberS1.id)).toBe(1);
    await env.DB.prepare("UPDATE cases SET status = 'closed' WHERE id = ?")
      .bind(cw.open.id)
      .run();
    expect(await post(cw.open.roomId, cw.w.memberS1.id)).toBe(0);
  });
});

describe("#148 相関の確認（#294：相関の条件が常に真・常に偽になっていないこと）", () => {
  it("#148 #294 ①: その部屋の参加者でないが、ほかの案件の部屋の有効な参加者である人は、5経路とも0行で、1件の読みも null", async () => {
    // memberS2 は other の参加者で、open の参加者ではない。open に本人の投稿が残っている状態（外された後）を作る
    expect(await writesBy(cw.open.roomId, cw.w.memberS2.id)).toEqual(NONE);
    const leftover = await seedRoomMessage(
      cw.open.roomId,
      cw.w.memberS1.id,
      nextN(),
    );
    expect(
      await withMessages(env, (r) => r.findItem(leftover, cw.w.memberS2.id)),
    ).toBeNull();
    // 比べる相手：自分の部屋（other）には書ける
    expect(await post(cw.other.roomId, cw.w.memberS2.id)).toBe(1);
  });

  it("#148 #294 ②: ほかの案件は進行中だが、その案件は終了している場合、その部屋への5経路は0行で、ほかの案件の部屋は1行", async () => {
    // closed と other の両方に参加している人を作る（memberS2 を closed にも入れる）
    await env.DB.prepare(
      "INSERT INTO channel_members (channel_id, user_id, joined_at) VALUES (?, ?, ?)",
    )
      .bind(cw.closed.roomId, cw.w.memberS2.id, isoAt(1))
      .run();
    expect(await writesBy(cw.closed.roomId, cw.w.memberS2.id)).toEqual(NONE);
    expect(await writesBy(cw.other.roomId, cw.w.memberS2.id)).toEqual(ALL);
  });

  it("#148 #294 ②': 終了の案件があっても、進行中の別の案件の部屋への返信・リアクションは1行（終了の行で、ほかの部屋まで止めない）", async () => {
    const parent = await seedRoomMessage(
      cw.open.roomId,
      cw.w.memberD1.id,
      nextN(),
    );
    const reply1 = await seedRoomReply(
      cw.open.roomId,
      parent,
      cw.w.memberD1.id,
      nextN(),
    );
    expect(await reply(cw.open.roomId, parent, cw.w.memberS1.id)).toBe(1);
    expect(await react(reply1, cw.w.memberS1.id)).toBe(1);
    expect(await unreact(reply1, cw.w.memberS1.id)).toBe(1);
  });
});
