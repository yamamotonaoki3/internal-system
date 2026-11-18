// #294：閲覧の資格の条件が、外側の表の列を参照しているか（副問い合わせの中の表の同じ名前の列に取られていないか）を、D1 で確かめる。
// drizzle は1つの表だけを読む文で、選択項目の sql に直接埋め込んだ列を表の名前なし（"room_id" 等）で書き出す。
// その名前の列を副問い合わせの中の表も持つと、内側の列として解釈され、相関の条件が常に真になる。
// 期待は、部品の規則（channel-member.sql：参加の行があり利用者が有効／room-visibility.sql：部屋を見てよい）と、docs/design/cases.md の「有効な参加者」から決める。
// 準備：部屋 A（案件専用チャンネル。非公開。参加者は memberS1・memberS2）と部屋 B（通常の非公開チャンネル。参加者は memberD1・memberS1）。
//   X＝memberD1：B の有効な参加者だが、A の参加者ではない。逆向き Y＝memberS2：A の有効な参加者だが、B の参加者ではない。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cases } from "../../db/schema";
import { insertAttachmentRow } from "../../test/attachment-fixtures";
import {
  cleanupCaseTestData,
  joinedAt,
  seedCase,
  type SeededCase,
} from "../../test/case-fixtures";
import {
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import { insertChannel, insertMember } from "../../test/department-fixtures";
import { createUlidFactory } from "../lib/ulid";
import { withAttachments } from "./attachment.repository";
import { withCases } from "./case.repository";
import { activeChannelMember } from "./channel-member.sql";
import { withChannels } from "./channel.repository";
import { withDatabase } from "./database";
import { withMessages } from "./message.repository";
import { createNotificationRepository } from "./notification.repository";
import { roomViewableBy } from "./room-visibility.sql";
import { listThreadRows } from "./thread-list.sql";
import { listUnreadTargetRows } from "./unread-targets.sql";

/** 同じ ms には必ず同じ ID を返す */
function fixedIdAt(ms: number): string {
  return createUlidFactory({
    now: () => ms,
    random: (length) => new Uint8Array(length),
  })();
}

const AT = "2026-11-17T03:00:00.000Z";
const BEFORE_ALL = fixedIdAt(1_864_000_000_000);
const ROOT_A = fixedIdAt(1_864_000_001_000);
const REPLY_A = fixedIdAt(1_864_000_002_000);
const ATTACHMENT_A = fixedIdAt(1_864_000_003_000);
const ROOM_B = fixedIdAt(1_864_000_004_000);
const NOTIFICATION_A = fixedIdAt(1_864_000_005_000);
const ROOT_B = fixedIdAt(1_864_000_006_000);
const DM_ROOM = fixedIdAt(1_864_000_007_000);
const ARCHIVED_ROOM = fixedIdAt(1_864_000_008_000);
const NOTIFICATION_RESTORED = fixedIdAt(1_864_000_009_000);
const DEFINITIONS = { test_room_kind: { containsRoomContent: true } } as const;

let w: CaseWorld;
let roomA: SeededCase;

async function insertMessageRow(
  id: string,
  roomId: string,
  senderId: string,
  parentId: string | null,
) {
  await env.DB.prepare(
    `INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at, parent_message_id)
     VALUES (?, ?, ?, 'テスト太郎', ?, ?, ?)`,
  )
    .bind(id, roomId, senderId, `[UNIT_TEST]非公開の本文${id}`, AT, parentId)
    .run();
}

beforeEach(async () => {
  w = await setupCaseWorld();
  roomA = await seedCase({
    n: 34,
    clientId: w.clientA.id,
    code: "QZB",
    title: "[UNIT_TEST]列の参照の確認",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    members: [
      { userId: w.memberS1.id, joinedAt: joinedAt(1) },
      { userId: w.memberS2.id, joinedAt: joinedAt(2) },
    ],
  });
  await insertMessageRow(ROOT_A, roomA.roomId, w.memberS1.id, null);
  await insertMessageRow(REPLY_A, roomA.roomId, w.memberS2.id, ROOT_A);
  await insertAttachmentRow({
    id: ATTACHMENT_A,
    roomId: roomA.roomId,
    uploaderId: w.memberS2.id,
    messageId: ROOT_A,
    createdAt: AT,
  });
  await insertChannel({
    id: ROOM_B,
    name: "casereq列の参照の確認",
    purpose: "normal",
    departmentId: w.deptD.id,
    visibility: "private",
  });
  await insertMember(ROOM_B, w.memberD1.id);
  await insertMember(ROOM_B, w.memberS1.id);
  await insertMessageRow(ROOT_B, ROOM_B, w.memberD1.id, null);
  // X（memberD1）宛ての、部屋 A の内容を含む種類の通知（宛先の列だけでは見えてはいけない）
  await env.DB.prepare(
    `INSERT INTO notifications (id, user_id, kind, room_id, message_id, target_id, created_at, read_at)
     VALUES (?, ?, 'test_room_kind', ?, ?, NULL, ?, NULL)`,
  )
    .bind(NOTIFICATION_A, w.memberD1.id, roomA.roomId, ROOT_A, AT)
    .run();
});

afterEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM notifications WHERE id IN (?, ?)").bind(
      NOTIFICATION_A,
      NOTIFICATION_RESTORED,
    ),
    env.DB.prepare("DELETE FROM messages WHERE room_id = ?").bind(ROOM_B),
    env.DB.prepare(
      "DELETE FROM channel_members WHERE channel_id IN (?, ?)",
    ).bind(ROOM_B, ARCHIVED_ROOM),
    env.DB.prepare("DELETE FROM channels WHERE room_id IN (?, ?)").bind(
      ROOM_B,
      ARCHIVED_ROOM,
    ),
    env.DB.prepare("DELETE FROM conversations WHERE room_id = ?").bind(DM_ROOM),
    env.DB.prepare("DELETE FROM rooms WHERE id IN (?, ?, ?)").bind(
      ROOM_B,
      ARCHIVED_ROOM,
      DM_ROOM,
    ),
  ]);
  await cleanupCaseTestData();
});

/** 部屋 A について、閲覧者から見た各経路の結果（見える・参加中＝true） */
type Probe = { name: string; sees: (viewerId: string) => Promise<boolean> };

const READS_A: Probe[] = [
  {
    name: "案件の詳細（case.repository の findDetailExtras）",
    sees: async (viewerId) =>
      (await withCases(env, (r) =>
        r.findDetailExtras({ caseId: roomA.id, actorId: viewerId }),
      )) !== "not_visible",
  },
  {
    name: "案件の概要の isParticipant（findSummary）",
    sees: async (viewerId) =>
      (
        await withCases(env, (r) =>
          r.findSummary({ actorId: viewerId, caseId: roomA.id }),
        )
      )?.isParticipant === true,
  },
  {
    name: "案件の概要の participantCount（findSummary。参加者か管理の資格がなければ null）",
    sees: async (viewerId) =>
      (
        await withCases(env, (r) =>
          r.findSummary({ actorId: viewerId, caseId: roomA.id }),
        )
      )?.participantCount != null,
  },
  {
    name: "案件の一覧の joined の絞り込み（list）",
    sees: async (viewerId) =>
      (
        await withCases(env, (r) =>
          r.list({
            actorId: viewerId,
            scope: "joined",
            status: "active",
            limit: 100,
          }),
        )
      ).items.some((i) => i.id === roomA.id),
  },
  {
    name: "チャンネルの詳細の joinedAt（channel.repository の findForViewer）",
    sees: async (viewerId) =>
      ((await withChannels(env, (r) => r.findForViewer(roomA.roomId, viewerId)))
        ?.joinedAt ?? null) !== null,
  },
  {
    name: "管理の判定の isMember（findForManage）",
    sees: async (viewerId) =>
      (await withChannels(env, (r) => r.findForManage(roomA.roomId, viewerId)))
        ?.isMember === true,
  },
  {
    name: "メッセージの一覧（最新。listLatest）",
    sees: async (viewerId) =>
      (
        await withMessages(env, (r) =>
          r.listLatest(roomA.roomId, 50, undefined, viewerId),
        )
      ).items.length > 0,
  },
  {
    name: "メッセージの一覧（続き。listAfter）",
    sees: async (viewerId) =>
      (
        await withMessages(env, (r) =>
          r.listAfter(roomA.roomId, BEFORE_ALL, 50, viewerId),
        )
      ).items.length > 0,
  },
  {
    name: "1件の取得（findItem。roomViewableBy(messages.roomId)）",
    sees: async (viewerId) =>
      (await withMessages(env, (r) => r.findItem(ROOT_A, viewerId))) !== null,
  },
  {
    name: "返信の取得（最新。listRepliesLatest）",
    sees: async (viewerId) =>
      (
        await withMessages(env, (r) =>
          r.listRepliesLatest(ROOT_A, 50, undefined, viewerId),
        )
      ).items.length > 0,
  },
  {
    name: "返信の取得（続き。listRepliesAfter）",
    sees: async (viewerId) =>
      (
        await withMessages(env, (r) =>
          r.listRepliesAfter(ROOT_A, BEFORE_ALL, 50, viewerId),
        )
      ).items.length > 0,
  },
  {
    name: "添付の配信（attachment.repository の findVisible）",
    sees: async (viewerId) =>
      (await withAttachments(env, (r) =>
        r.findVisible(ATTACHMENT_A, viewerId),
      )) !== null,
  },
  {
    name: "未読の対象（unread-targets.sql）",
    sees: async (viewerId) =>
      (
        await withDatabase(env, (db) =>
          listUnreadTargetRows(db, viewerId, { limit: 100, includeCase: true }),
        )
      ).some((row) => row.room_id === roomA.roomId),
  },
];

describe("#294 AC-1 ほかの部屋の有効な参加者（A の参加者ではない）に、部屋 A が参加中・見えるとして扱われない（D1）", () => {
  it("#294 AC-1 前提: X は B の有効な参加者で、A の参加の行がない（空振りしない）", async () => {
    const rows = await env.DB.prepare(
      "SELECT channel_id FROM channel_members WHERE user_id = ? AND channel_id IN (?, ?)",
    )
      .bind(w.memberD1.id, roomA.roomId, ROOM_B)
      .all<{ channel_id: string }>();
    expect(rows.results.map((r) => r.channel_id)).toEqual([ROOM_B]);
  });

  it.each(READS_A)(
    "#294 AC-1 有効な参加者（対。memberS1）: $name で見える・参加中",
    async ({ sees }) => {
      expect(await sees(w.memberS1.id)).toBe(true);
    },
  );

  it.each(READS_A)(
    "#294 AC-1: ほかの部屋（B）の有効な参加者 X には、$name で見えない・参加中でない",
    async ({ sees }) => {
      expect(await sees(w.memberD1.id)).toBe(false);
    },
  );

  it("#294 AC-1: 案件の概要の canManage は、ほかの部屋の参加者であることで真にならない", async () => {
    const item = await withCases(env, (r) =>
      r.findSummary({ actorId: w.memberD1.id, caseId: roomA.id }),
    );
    expect(item?.canManage).toBe(false);
  });

  it("#294 AC-1: スレッドの一覧に、A のスレッドが出ない（X は A の親に返信した記録を持たない人として。対は memberS1）", async () => {
    const ids = async (viewerId: string) =>
      (
        await withDatabase(env, (db) =>
          listThreadRows(db, viewerId, {
            limit: 100,
            includeDirect: false,
            includeCase: true,
          }),
        )
      ).map((row) => row.id);
    expect(await ids(w.memberS1.id)).toContain(ROOT_A);
    expect(await ids(w.memberD1.id)).not.toContain(ROOT_A);
  });

  it("#294 AC-1: X 宛ての A の内容を含む通知は、通知の一覧に出ない（宛先の列だけで見えない）", async () => {
    const page = await withDatabase(env, (db) =>
      createNotificationRepository(db, {
        definitions: DEFINITIONS,
      }).listForRecipient(w.memberD1.id, { limit: 100 }),
    );
    expect(page.items.some((i) => i.id === NOTIFICATION_A)).toBe(false);
  });

  it("#294 AC-1: 参加者数・参加者の一覧は、ほかの部屋だけの参加者 X が読むと返らない（件数 0・一覧が空）。対の memberS1 には2人が返る", async () => {
    const read = (viewerId: string) =>
      withChannels(env, async (r) => ({
        count: await r.countMembers(roomA.roomId, viewerId),
        members: (await r.listMembers(roomA.roomId, 100, viewerId))
          .map((m) => m.id)
          .sort(),
      }));
    expect(await read(w.memberS1.id)).toEqual({
      count: 2,
      members: [w.memberS1.id, w.memberS2.id].sort(),
    });
    expect(await read(w.memberD1.id)).toEqual({ count: 0, members: [] });
  });

  it("#294 AC-1: X は A に投稿できない（insertIfOrdered が 0 件）。対の memberS1 は 1 件", async () => {
    const post = (id: string, senderId: string) =>
      withMessages(env, (r) =>
        r.insertIfOrdered({
          id,
          roomId: roomA.roomId,
          senderId,
          senderDisplayName: "テスト太郎",
          body: "[UNIT_TEST]書き込みの確認",
          mentions: [],
        }),
      );
    expect(await post(fixedIdAt(1_864_000_100_000), w.memberD1.id)).toBe(0);
    expect(await post(fixedIdAt(1_864_000_101_000), w.memberS1.id)).toBe(1);
  });
});

describe("#294 AC-2 逆向き：A の有効な参加者で B の参加者ではない人（memberS2）に、B が見えない（D1）", () => {
  it("#294 AC-2: B の詳細の joinedAt・1件の取得・メッセージの一覧で見えない。対の memberD1 には見える", async () => {
    const probe = async (viewerId: string) => ({
      joined:
        ((await withChannels(env, (r) => r.findForViewer(ROOM_B, viewerId)))
          ?.joinedAt ?? null) !== null,
      item:
        (await withMessages(env, (r) => r.findItem(ROOT_B, viewerId))) !== null,
      list:
        (
          await withMessages(env, (r) =>
            r.listLatest(ROOM_B, 50, undefined, viewerId),
          )
        ).items.length > 0,
    });
    expect(await probe(w.memberD1.id)).toEqual({
      joined: true,
      item: true,
      list: true,
    });
    expect(await probe(w.memberS2.id)).toEqual({
      joined: false,
      item: false,
      list: false,
    });
  });
});

describe("#294 AC-3 実際の SQL：部品に drizzle の列を渡したとき、外側の表の名前つきで書き出される", () => {
  const db = drizzle(env.DB);

  it("#294 AC-3: 1つの表だけを読む文の選択項目に入れた activeChannelMember（findDetailExtras と同じ形）", () => {
    const visible = activeChannelMember(sql`${cases.channelId}`, "X");
    const text = db
      .select({ visible: sql<number>`CASE WHEN ${visible} THEN 1 ELSE 0 END` })
      .from(cases)
      .toSQL().sql;
    expect(text).toContain('cm.channel_id = "cases"."channel_id"');
  });

  it("#294 AC-3: 1つの表だけを読む文の条件に入れた roomViewableBy（findItem と同じ形）", () => {
    const text = db
      .select({ id: cases.id })
      .from(cases)
      .where(roomViewableBy(cases.channelId, "X"))
      .toSQL().sql;
    expect(text).toContain('vc.room_id = "cases"."channel_id"');
    expect(text).toContain('vv.conversation_id = "cases"."channel_id"');
  });
});

describe("#294 AC-4 同じ型（選択項目の副問い合わせに列を直接埋め込み、1つの表だけを読む文）の箇所", () => {
  it("#294 AC-4: チャンネルの添付は、ほかに DM の部屋があっても isDirect が偽（attachment.repository の findVisible）", async () => {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO rooms (id, kind, created_at) VALUES (?, 'direct', ?)",
      ).bind(DM_ROOM, AT),
      env.DB.prepare(
        "INSERT INTO conversations (room_id, direct_key, created_at) VALUES (?, ?, ?)",
      ).bind(DM_ROOM, `[UNIT_TEST]${DM_ROOM}`, AT),
    ]);
    const found = await withAttachments(env, (r) =>
      r.findVisible(ATTACHMENT_A, w.memberS1.id),
    );
    expect(found).not.toBeNull();
    expect(found?.isDirect).toBe(false);
  });

  it("#294 AC-4: アーカイブされていないチャンネルの通知は、ほかのチャンネルがアーカイブ中でも roomArchived が偽（notification.repository の archiveStatesFor）", async () => {
    await insertChannel({
      id: ARCHIVED_ROOM,
      name: "casereqアーカイブ中の別のチャンネル",
      purpose: "normal",
      departmentId: w.deptD.id,
      archived: true,
    });
    await env.DB.prepare(
      `INSERT INTO notifications (id, user_id, kind, room_id, message_id, target_id, created_at, read_at)
       VALUES (?, ?, 'channel.restored', ?, NULL, NULL, ?, NULL)`,
    )
      .bind(NOTIFICATION_RESTORED, w.memberD1.id, ROOM_B, AT)
      .run();
    const states = await withDatabase(env, (db) =>
      createNotificationRepository(db).archiveStatesFor(w.memberD1.id, [
        NOTIFICATION_RESTORED,
      ]),
    );
    expect(states.get(NOTIFICATION_RESTORED)?.roomArchived).toBe(false);
  });
});
