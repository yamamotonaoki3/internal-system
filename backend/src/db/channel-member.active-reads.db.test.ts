// #147（147-C-1）読み取りの7経路：チャンネルの参加の行を閲覧の資格に使う読み取りの条件を「有効な参加者」（activeChannelMember と同じ条件）にする。
// 147-C-2 の後の状態（無効化しても参加の行が残る。C-142(1)）を先取りして、参加の行を残したまま閲覧者を無効にし、
// 非公開の部屋が「参加中」として扱われないこと（本文・添付・部屋の内容を含む通知が見えないこと）を、Repository・SQL の結果で確かめる。
// 対として、同じ準備の有効な参加者には見える。参加していない有効な社員にも見えない（既存の条件の確認）。
// 期待は計画 147-C-1 のテストケース（findForViewer の joinedAt が NULL、list の joined が偽、スレッドの一覧・未読の対象・通知の一覧に出ない、添付の配信の判定が偽）と C-182・C-142(1)。
// 部屋：案件専用チャンネル（非公開・部署なし）と、チャンネル一覧の確認用の通常の非公開チャンネル（案件専用チャンネルは一覧から除外済みのため）。
// データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { insertAttachmentRow } from "../../test/attachment-fixtures";
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
import { insertChannel, insertMember } from "../../test/department-fixtures";
import { createUlidFactory } from "../lib/ulid";
import { withAttachments } from "./attachment.repository";
import { withChannels } from "./channel.repository";
import { withDatabase } from "./database";
import { withMessages } from "./message.repository";
import { createNotificationRepository } from "./notification.repository";
import { listThreadRows } from "./thread-list.sql";
import { listUnreadTargetRows } from "./unread-targets.sql";

/** 同じ ms には必ず同じ ID を返す（乱数の部分を 0 に固定する） */
function fixedIdAt(ms: number): string {
  return createUlidFactory({
    now: () => ms,
    random: (length) => new Uint8Array(length),
  })();
}

const AT = "2026-11-17T03:00:00.000Z";
const ROOT_ID = fixedIdAt(1_861_000_001_000); // 閲覧者（memberS1）が親の投稿者のスレッド
const REPLY_ID = fixedIdAt(1_861_000_002_000);
const ATTACHMENT_ID = fixedIdAt(1_861_000_003_000);
const PRIVATE_CHANNEL_ID = fixedIdAt(1_861_000_004_000);
const NOTIFICATION_ID = fixedIdAt(1_861_000_005_000);
// 部屋の内容を含む種類だけを差し替えで定義する（本番の定義元にテスト用の種類を足さない。notification.room-visibility.db.test.ts と同じ方法）
const DEFINITIONS = { test_room_kind: { containsRoomContent: true } } as const;

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
    .bind(
      id,
      room.roomId,
      senderId,
      `[UNIT_TEST]非公開の本文${id}`,
      AT,
      parentId,
    )
    .run();
}

/** 閲覧者から見た、各経路の結果（見える＝true） */
type ReadCase = { name: string; sees: (viewerId: string) => Promise<boolean> };

// 表には関数だけを書く（beforeEach で代入する変数は、呼ばれた時点で読む）
const READS: ReadCase[] = [
  {
    name: "チャンネルの詳細・メンバーの一覧・メッセージの一覧・返信・メンションの候補・未読の判定の元（channel.repository の findForViewer の joinedAt）",
    sees: async (viewerId) => {
      const row = await withChannels(env, (r) =>
        r.findForViewer(room.roomId, viewerId),
      );
      expect(row).not.toBeNull();
      return row?.joinedAt !== null;
    },
  },
  {
    name: "同じ関数の別名（message.repository の findRoomForViewer）",
    sees: async (viewerId) => {
      const row = await withMessages(env, (r) =>
        r.findRoomForViewer(room.roomId, viewerId),
      );
      expect(row).not.toBeNull();
      return row?.joinedAt !== null;
    },
  },
  {
    name: "チャンネルの一覧の参加中の判定・非公開の表示（channel.repository の list）",
    sees: async (viewerId) => {
      const page = await withChannels(env, (r) =>
        r.list(viewerId, { limit: 100, departmentId: w.deptS.id }),
      );
      const item = page.items.find((i) => i.roomId === PRIVATE_CHANNEL_ID);
      return item !== undefined && item.joined;
    },
  },
  {
    name: "チャンネルの一覧の「参加中だけ」の絞り込み（channel.repository の list の joined）",
    sees: async (viewerId) => {
      const page = await withChannels(env, (r) =>
        r.list(viewerId, {
          limit: 100,
          departmentId: w.deptS.id,
          joined: true,
        }),
      );
      return page.items.some((i) => i.roomId === PRIVATE_CHANNEL_ID);
    },
  },
  {
    name: "スレッドの一覧（thread-list.sql）",
    sees: async (viewerId) => {
      const rows = await withDatabase(env, (db) =>
        listThreadRows(db, viewerId, { limit: 100, includeDirect: false }),
      );
      return rows.some((row) => row.id === ROOT_ID);
    },
  },
  {
    name: "添付の配信（attachment-visibility.sql の attachmentVisible。attachment.repository の findVisible）",
    sees: async (viewerId) =>
      (await withAttachments(env, (r) =>
        r.findVisible(ATTACHMENT_ID, viewerId),
      )) !== null,
  },
  {
    name: "未読の対象・未読の数（unread-targets.sql）",
    sees: async (viewerId) => {
      const rows = await withDatabase(env, (db) =>
        listUnreadTargetRows(db, viewerId, { limit: 100 }),
      );
      return rows.some((row) => row.room_id === room.roomId);
    },
  },
  {
    name: "通知の一覧（部屋の内容を含む種類。notification.repository の viewableRoom）",
    sees: async (viewerId) => {
      const page = await withDatabase(env, (db) =>
        createNotificationRepository(db, {
          definitions: DEFINITIONS,
        }).listForRecipient(viewerId, { limit: 100 }),
      );
      return page.items.some((item) => item.id === NOTIFICATION_ID);
    },
  },
];

beforeEach(async () => {
  w = await setupCaseWorld();
  room = await seedCase({
    n: 32,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]有効な参加者の読み取り",
    createdBy: w.memberS1.id,
    departmentIds: [w.deptS.id],
    members: [
      { userId: w.memberS1.id, joinedAt: joinedAt(1) },
      { userId: w.memberS2.id, joinedAt: joinedAt(2) },
    ],
  });
  await insertMessageRow(ROOT_ID, w.memberS1.id, null);
  await insertMessageRow(REPLY_ID, w.memberS2.id, ROOT_ID);
  await insertAttachmentRow({
    id: ATTACHMENT_ID,
    roomId: room.roomId,
    uploaderId: w.memberS2.id,
    messageId: ROOT_ID,
    createdAt: AT,
  });
  await insertChannel({
    id: PRIVATE_CHANNEL_ID,
    name: "casereq非公開の確認",
    purpose: "normal",
    departmentId: w.deptS.id,
    visibility: "private",
  });
  await insertMember(PRIVATE_CHANNEL_ID, w.memberS1.id);
  // 閲覧者宛ての、部屋の内容を含む種類の通知（宛先の列は閲覧者。部屋は案件専用チャンネル）
  await env.DB.prepare(
    `INSERT INTO notifications (id, user_id, kind, room_id, message_id, target_id, created_at, read_at)
     VALUES (?, ?, 'test_room_kind', ?, ?, NULL, ?, NULL)`,
  )
    .bind(NOTIFICATION_ID, w.memberS1.id, room.roomId, ROOT_ID, AT)
    .run();
});

afterEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM notifications WHERE id = ?").bind(
      NOTIFICATION_ID,
    ),
    env.DB.prepare("DELETE FROM channel_members WHERE channel_id = ?").bind(
      PRIVATE_CHANNEL_ID,
    ),
    env.DB.prepare("DELETE FROM channels WHERE room_id = ?").bind(
      PRIVATE_CHANNEL_ID,
    ),
    env.DB.prepare("DELETE FROM rooms WHERE id = ?").bind(PRIVATE_CHANNEL_ID),
  ]);
  await cleanupCaseTestData();
});

describe("#147 147-C-1 読み取りの7経路：参加の行が残った無効な社員には、非公開の部屋が参加中として扱われない（D1）", () => {
  it("#147 147-C-1 前提: 表の経路が8件（7経路。findForViewer の別名を分けて数える）あり、空振りしない", () => {
    expect(READS.length).toBe(8);
  });

  it.each(READS)(
    "#147 147-C-1 有効な参加者（対）: $name で見える",
    async ({ sees }) => {
      expect(await sees(w.memberS1.id)).toBe(true);
    },
  );

  it.each(READS)(
    "#147 147-C-1 C-142(1): 参加の行を残したまま無効にした閲覧者には、$name で見えない",
    async ({ sees }) => {
      await setUserActive(w.memberS1.id, false);
      // 参加の行が実際に残っていること（147-C-2 の後の状態。空振りしないこと）
      const member = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM channel_members WHERE user_id = ? AND channel_id IN (?, ?)",
      )
        .bind(w.memberS1.id, room.roomId, PRIVATE_CHANNEL_ID)
        .first<{ n: number }>();
      expect(member?.n).toBe(2);
      expect(await sees(w.memberS1.id)).toBe(false);
    },
  );

  it.each(READS)(
    "#147 147-C-1: 参加していない有効な社員（別部署の memberD1）には、$name で見えない（既存の条件の確認）",
    async ({ sees }) => {
      // スレッドの一覧・通知は、本人の投稿・本人宛ての行が前提のため、参加していない人では対象の行がない（見えないことは同じ）
      expect(await sees(w.memberD1.id)).toBe(false);
    },
  );
});

describe("#147 147-C-1 参加者の数え方・宛先・候補から、無効な社員（参加の行あり）が除かれる（既存の条件の確認）", () => {
  it("#147 147-C-1: チャンネルの参加者の数・一覧（countMembers・listMembers）に、参加の行が残った無効な社員を含めない", async () => {
    await setUserActive(w.memberS2.id, false);
    const { count, members } = await withChannels(env, async (r) => ({
      count: await r.countMembers(room.roomId),
      members: await r.listMembers(room.roomId, 100),
    }));
    expect(count).toBe(1);
    expect(members.map((m) => m.id)).toEqual([w.memberS1.id]);
  });

  it("#147 147-C-1: アーカイブ・復元の通知の宛先（listNotifyRecipients）に、参加の行が残った無効な社員を含めない", async () => {
    await setUserActive(w.memberS2.id, false);
    const recipients = await withChannels(env, (r) =>
      r.listNotifyRecipients(room.roomId, w.ownerS.id),
    );
    expect(recipients).toEqual([w.memberS1.id]);
  });

  it("#147 147-C-1: メンションの候補（会社の名簿。listMentionCandidates）に、参加の行が残った無効な社員を含めない", async () => {
    // 候補は部屋の参加者ではなく、有効な社員の名簿から出す（部屋の資格は findForViewer で判定する）
    const ids = async () =>
      (
        await withMessages(env, (r) =>
          r.listMentionCandidates({ departmentId: w.deptS.id, limit: 100 }),
        )
      ).items.map((item) => item.id);
    expect(await ids()).toContain(w.memberS2.id);
    await setUserActive(w.memberS2.id, false);
    expect(await ids()).not.toContain(w.memberS2.id);
  });

  it("#147 147-C-1: メンションの通知の宛先（eligibleMentionRecipient）に、参加の行が残った無効な社員を含めない", async () => {
    await setUserActive(w.memberS2.id, false);
    const inserted = await withMessages(env, (r) =>
      r.insertIfOrdered({
        id: fixedIdAt(1_861_000_100_000),
        roomId: room.roomId,
        senderId: w.memberS1.id,
        senderDisplayName: "テスト太郎",
        body: "@テスト太郎 [UNIT_TEST]宛先の確認",
        mentions: [{ userId: w.memberS2.id, start: 0, end: 6 }],
      }),
    );
    // 投稿そのものは成り立つ（空振りしないこと）
    expect(inserted).toBe(1);
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND kind = 'message.mentioned'",
    )
      .bind(w.memberS2.id)
      .first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});

describe("#147 147-C-1 管理の判定の元（channel.repository の findForManage の isMember）", () => {
  const isMember = async (userId: string) => {
    const row = await withChannels(env, (r) =>
      r.findForManage(PRIVATE_CHANNEL_ID, userId),
    );
    expect(row).not.toBeNull();
    return row?.isMember;
  };

  it("#147 147-C-1 有効な参加者（対）: isMember は真", async () => {
    expect(await isMember(w.memberS1.id)).toBe(true);
  });

  it("#147 147-C-1 C-142(1): 参加の行を残したまま無効にした人は、isMember が偽", async () => {
    await setUserActive(w.memberS1.id, false);
    expect(await isMember(w.memberS1.id)).toBe(false);
  });

  it("#147 147-C-1: 参加していない有効な社員（memberD1）は、isMember が偽", async () => {
    expect(await isMember(w.memberD1.id)).toBe(false);
  });
});
