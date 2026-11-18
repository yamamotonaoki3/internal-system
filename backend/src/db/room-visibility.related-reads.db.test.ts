// #297：メッセージの付随情報（メンション・リアクション・添付）と未読の集計の読み取りにも、その時点の閲覧の資格を入れる（DB の層）。
// 期待は、受け入れ条件と docs/design/cases.md の「設計の方針」・C-182(10)（中身を読む SQL は roomViewableBy の規則＝
// 「閲覧者が有効で、未アーカイブのチャンネルの公開か参加中の非公開、または DM の当事者」）から決める。実装から写さない。
// AC-1：資格のない閲覧者（無効・参加の解除・未参加・アーカイブ後・DM の当事者でない・無効な当事者）に、その部屋の付随の情報を返さない。未読は数えない。
// AC-2：有効な閲覧者（参加者・公開チャンネルの未参加者・DM の当事者）に返す結果は変わらない（対の例）。文の数も変わらない。
// 相関（#294）：見てよい部屋と見てよくない部屋のメッセージを混ぜて渡しても、見てよくない部屋の分だけが除かれる。
// 準備：部屋 A・B（案件専用の非公開チャンネル。参加者は V＝memberS1 と O＝memberS2）、部屋 P（公開チャンネル。D1＝memberD1 は未参加）、
//   DM（V と O）。viewer V が主役。データは架空（testuser_casereq_・[UNIT_TEST]・@example.com）。
import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../db/schema";
import {
  cleanupCaseTestData,
  joinedAt,
  removeCaseMember,
  seedCase,
  setDisplayName,
  type SeededCase,
} from "../../test/case-fixtures";
import {
  setUserActive,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import { insertDm } from "../../test/dm-fixtures";
import { TEST_TAG, insertChannel } from "../../test/department-fixtures";
import {
  ZERO,
  cleanupRelatedReadsRooms,
  fixedIdAt,
  insertAttachmentRow,
  insertMentionRow,
  insertMessageRow,
  insertReactionRow,
  reactionIsoAt,
} from "../../test/related-reads-fixtures";
import { setArchived } from "../../test/read-position-fixtures";
import { loadMessageAttachments } from "./attachment.repository";
import { withDatabase } from "./database";
import { loadMessageMentions } from "./message-mentions.sql";
import { loadMessageReactions } from "./message-reactions.sql";
import { listThreadRows } from "./thread-list.sql";
import { listThreadUnreadCounts } from "./thread-unread-counts.sql";
import { listUnreadCountRows } from "./unread-counts.sql";

const id = (n: number) => fixedIdAt(1_866_000_000_000 + n * 1_000);

const ROOM_P = id(1);
// 部屋 A（V の未読は MA1・MA2・MA3 の3件。MA4 は V の投稿、MAD は削除済み、返信は数えない）
const MA1 = id(10);
const MA2 = id(11);
const MA3 = id(12);
const MA4 = id(13);
const MAD = id(14);
const RA1 = id(15);
const RA2 = id(16);
const RA3 = id(17);
const RAD = id(18);
const RA4 = id(19);
const ATT_A1 = id(20);
const ATT_A2 = id(21);
// 部屋 B（V の未読は MB1・MB2 の2件）
const MB1 = id(30);
const MB2 = id(31);
const MB3 = id(32);
const RB1 = id(33);
const RB2 = id(34);
const ATT_B = id(35);
// 公開チャンネル P
const MP1 = id(40);
const MP2 = id(41);
const ATT_P = id(42);
// DM
const MD1 = id(50);
const MD2 = id(51);
const MD3 = id(52);
const RD1 = id(53);
const ATT_D = id(54);

const NAME_V = "テスト参加者A";
const NAME_O = "テスト参加者B";
const NAME_D1 = "テスト参加者C";
const FILE_A1 = "[UNIT_TEST]資料A1.txt";
const FILE_A2 = "[UNIT_TEST]資料A2.txt";
const FILE_B = "[UNIT_TEST]資料B.txt";
const FILE_P = "[UNIT_TEST]資料P.txt";
const FILE_D = "[UNIT_TEST]資料D.txt";

let w: CaseWorld;
let roomA: SeededCase;
let roomB: SeededCase;
let roomDm: string;
let V: string;
let O: string;
let D1: string;

async function attach(
  attachmentId: string,
  roomId: string,
  messageId: string,
  name: string,
  size: number,
) {
  await insertAttachmentRow({
    id: attachmentId,
    roomId,
    uploaderId: O,
    messageId,
    originalName: name,
    contentType: "text/plain; charset=utf-8",
    sizeBytes: size,
    createdAt: "2026-11-17T03:00:00.000Z",
  });
}

beforeEach(async () => {
  w = await setupCaseWorld();
  V = w.memberS1.id;
  O = w.memberS2.id;
  D1 = w.memberD1.id;
  await setDisplayName(V, NAME_V);
  await setDisplayName(O, NAME_O);
  await setDisplayName(D1, NAME_D1);
  const members = [
    { userId: V, joinedAt: joinedAt(1) },
    { userId: O, joinedAt: joinedAt(2) },
  ];
  roomA = await seedCase({
    n: 40,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]付随の読み取りA",
    createdBy: V,
    departmentIds: [w.deptS.id],
    members,
  });
  roomB = await seedCase({
    n: 41,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]付随の読み取りB",
    createdBy: V,
    departmentIds: [w.deptS.id],
    members,
  });
  await insertChannel({
    id: ROOM_P,
    name: `${TEST_TAG}related-public`,
    purpose: "normal",
    departmentId: w.deptS.id,
    visibility: "public",
  });
  roomDm = await insertDm(V, O, { roomId: id(2) });

  const A = roomA.roomId;
  const B = roomB.roomId;
  // 部屋 A
  await insertMessageRow({ id: MA1, roomId: A, senderId: O });
  await insertMessageRow({ id: MA2, roomId: A, senderId: O });
  await insertMessageRow({ id: MA3, roomId: A, senderId: O });
  await insertMessageRow({ id: MA4, roomId: A, senderId: V });
  await insertMessageRow({ id: MAD, roomId: A, senderId: O, deleted: true });
  await insertMessageRow({ id: RA1, roomId: A, senderId: O, parentId: MA1 });
  await insertMessageRow({ id: RA2, roomId: A, senderId: O, parentId: MA1 });
  await insertMessageRow({ id: RA3, roomId: A, senderId: V, parentId: MA1 });
  await insertMessageRow({
    id: RAD,
    roomId: A,
    senderId: O,
    parentId: MA1,
    deleted: true,
  });
  await insertMessageRow({ id: RA4, roomId: A, senderId: O, parentId: MA4 });
  await insertMentionRow(MA1, V, 0, 3);
  await insertReactionRow({
    messageId: MA1,
    userId: O,
    kind: "emoji",
    value: "👍",
    createdAt: reactionIsoAt(1),
  });
  await insertReactionRow({
    messageId: MA1,
    userId: V,
    kind: "emoji",
    value: "👍",
    createdAt: reactionIsoAt(2),
  });
  await insertReactionRow({
    messageId: MA1,
    userId: O,
    kind: "emoji",
    value: "🎉",
    createdAt: reactionIsoAt(3),
  });
  await attach(ATT_A1, A, MA1, FILE_A1, 123);
  await attach(ATT_A2, A, MA1, FILE_A2, 456);
  // 部屋 B
  await insertMessageRow({ id: MB1, roomId: B, senderId: O });
  await insertMessageRow({ id: MB2, roomId: B, senderId: O });
  await insertMessageRow({ id: MB3, roomId: B, senderId: V });
  await insertMessageRow({ id: RB1, roomId: B, senderId: O, parentId: MB1 });
  await insertMessageRow({ id: RB2, roomId: B, senderId: V, parentId: MB1 });
  await insertMentionRow(MB1, V, 0, 3);
  await insertReactionRow({
    messageId: MB1,
    userId: O,
    kind: "emoji",
    value: "🚀",
    createdAt: reactionIsoAt(4),
  });
  await attach(ATT_B, B, MB1, FILE_B, 77);
  // 公開チャンネル P（D1 は参加していない）
  await insertMessageRow({ id: MP1, roomId: ROOM_P, senderId: O });
  await insertMessageRow({ id: MP2, roomId: ROOM_P, senderId: O });
  await insertMentionRow(MP1, D1, 0, 3);
  await insertReactionRow({
    messageId: MP1,
    userId: O,
    kind: "emoji",
    value: "🔥",
    createdAt: reactionIsoAt(5),
  });
  await insertReactionRow({
    messageId: MP1,
    userId: D1,
    kind: "emoji",
    value: "🔥",
    createdAt: reactionIsoAt(6),
  });
  await attach(ATT_P, ROOM_P, MP1, FILE_P, 88);
  // DM（V と O）
  await insertMessageRow({ id: MD1, roomId: roomDm, senderId: O });
  await insertMessageRow({ id: MD2, roomId: roomDm, senderId: O });
  await insertMessageRow({ id: MD3, roomId: roomDm, senderId: V });
  await insertMessageRow({
    id: RD1,
    roomId: roomDm,
    senderId: O,
    parentId: MD3,
  });
  await insertMentionRow(MD1, V, 0, 3);
  await insertReactionRow({
    messageId: MD1,
    userId: O,
    kind: "emoji",
    value: "💬",
    createdAt: reactionIsoAt(7),
  });
  await attach(ATT_D, roomDm, MD1, FILE_D, 99);
});

afterEach(async () => {
  await cleanupRelatedReadsRooms([ROOM_P, roomDm]);
  await cleanupCaseTestData();
});

/** 付随の3つの読み取り（閲覧者を必須の引数として渡す形。#297 の計画 6節） */
async function readAll(ids: string[], viewerId: string) {
  return withDatabase(env, async (db) => ({
    mentions: await loadMessageMentions(db, ids, viewerId),
    reactions: await loadMessageReactions(db, ids, viewerId),
    attachments: await loadMessageAttachments(db, ids, viewerId),
  }));
}

const sizes = (r: Awaited<ReturnType<typeof readAll>>) => ({
  mentions: r.mentions.size,
  reactions: r.reactions.size,
  attachments: r.attachments.size,
});

const NONE = { mentions: 0, reactions: 0, attachments: 0 };

describe("#297 AC-1 資格のない閲覧者に、付随の3つの読み取りは何も返さない（T-1）", () => {
  type Lost = {
    name: string;
    messageId: () => string;
    viewer: () => string;
    apply: () => Promise<void>;
  };
  const LOST: Lost[] = [
    {
      name: "参加の行を残したまま無効にした人（非公開チャンネル）",
      messageId: () => MA1,
      viewer: () => V,
      apply: () => setUserActive(V, false),
    },
    {
      name: "参加の行を消した（解除した）人（非公開チャンネル）",
      messageId: () => MA1,
      viewer: () => V,
      apply: () => removeCaseMember(roomA.roomId, V),
    },
    {
      name: "参加していない有効な人（非公開チャンネル）",
      messageId: () => MA1,
      viewer: () => D1,
      apply: async () => {},
    },
    {
      name: "チャンネルをアーカイブした後の参加者",
      messageId: () => MA1,
      viewer: () => V,
      apply: () => setArchived(roomA.roomId, true),
    },
    {
      name: "DM の当事者でない人",
      messageId: () => MD1,
      viewer: () => D1,
      apply: async () => {},
    },
    {
      name: "無効にした DM の当事者",
      messageId: () => MD1,
      viewer: () => V,
      apply: () => setUserActive(V, false),
    },
  ];

  it.each(LOST)(
    "#297 AC-1: $name には、メンション・リアクション・添付が空（失う前の V には3つとも返る）",
    async ({ messageId, viewer, apply }) => {
      const before = await readAll([messageId()], V);
      expect(sizes(before)).toEqual({
        mentions: 1,
        reactions: 1,
        attachments: 1,
      });
      await apply();
      expect(sizes(await readAll([messageId()], viewer()))).toEqual(NONE);
    },
  );
});

describe("#297 AC-2 有効な閲覧者には、いまと同じ値を返す（T-2。期待値は準備のデータから手で書く）", () => {
  const user = (userId: string, displayName: string) => ({
    id: userId,
    displayName,
    isActive: true,
  });

  it("#297 AC-2: 非公開チャンネルの有効な参加者 V に、メンション・リアクション（数・付けた人・reactedByMe）・添付（ID の昇順）が返る", async () => {
    const r = await readAll([MA1], V);
    expect(r.mentions.get(MA1)).toEqual([{ userId: V, start: 0, end: 3 }]);
    expect(r.reactions.get(MA1)).toEqual([
      {
        kind: "emoji",
        value: "👍",
        count: 2,
        reactedByMe: true,
        users: [user(O, NAME_O), user(V, NAME_V)],
      },
      {
        kind: "emoji",
        value: "🎉",
        count: 1,
        reactedByMe: false,
        users: [user(O, NAME_O)],
      },
    ]);
    expect(r.attachments.get(MA1)).toEqual([
      {
        id: ATT_A1,
        name: FILE_A1,
        kind: "document",
        contentType: "text/plain; charset=utf-8",
        size: 123,
      },
      {
        id: ATT_A2,
        name: FILE_A2,
        kind: "document",
        contentType: "text/plain; charset=utf-8",
        size: 456,
      },
    ]);
  });

  it("#297 AC-2: 公開チャンネルの未参加の有効な人 D1 にも、同じ形で返る（reactedByMe は D1 自身の分）", async () => {
    const r = await readAll([MP1], D1);
    expect(r.mentions.get(MP1)).toEqual([{ userId: D1, start: 0, end: 3 }]);
    expect(r.reactions.get(MP1)).toEqual([
      {
        kind: "emoji",
        value: "🔥",
        count: 2,
        reactedByMe: true,
        users: [user(O, NAME_O), user(D1, NAME_D1)],
      },
    ]);
    expect(r.attachments.get(MP1)).toEqual([
      {
        id: ATT_P,
        name: FILE_P,
        kind: "document",
        contentType: "text/plain; charset=utf-8",
        size: 88,
      },
    ]);
  });

  it("#297 AC-2: DM の有効な当事者 V に、同じ形で返る", async () => {
    const r = await readAll([MD1], V);
    expect(r.mentions.get(MD1)).toEqual([{ userId: V, start: 0, end: 3 }]);
    expect(r.reactions.get(MD1)).toEqual([
      {
        kind: "emoji",
        value: "💬",
        count: 1,
        reactedByMe: false,
        users: [user(O, NAME_O)],
      },
    ]);
    expect(r.attachments.get(MD1)).toEqual([
      {
        id: ATT_D,
        name: FILE_D,
        kind: "document",
        contentType: "text/plain; charset=utf-8",
        size: 99,
      },
    ]);
  });
});

describe("#297 AC-1 相関（T-3）：見てよい部屋 B と見てよくない部屋 A のメッセージを混ぜて渡すと、B の分だけが返る", () => {
  const MIXED = [
    {
      name: "A の参加を解除した V",
      lose: () => removeCaseMember(roomA.roomId, V),
    },
    {
      name: "A をアーカイブした後の V",
      lose: () => setArchived(roomA.roomId, true),
    },
  ];

  it.each(MIXED)(
    "#297 AC-1: $name が A・B の ID を混ぜて渡すと、3つとも B の分だけが Map に入る（A の分は入らない）",
    async ({ lose }) => {
      const expected = await readAll([MB1], V);
      expect(sizes(expected)).toEqual({
        mentions: 1,
        reactions: 1,
        attachments: 1,
      });
      await lose();
      const r = await readAll([MA1, MB1], V);
      expect([...r.mentions.keys()]).toEqual([MB1]);
      expect([...r.reactions.keys()]).toEqual([MB1]);
      expect([...r.attachments.keys()]).toEqual([MB1]);
      // B の値は、混ぜない場合と同じ（AC-2）
      expect(r.mentions.get(MB1)).toEqual(expected.mentions.get(MB1));
      expect(r.reactions.get(MB1)).toEqual(expected.reactions.get(MB1));
      expect(r.attachments.get(MB1)).toEqual(expected.attachments.get(MB1));
    },
  );
});

describe("#297 AC-1・AC-2 部屋の未読（listUnreadCountRows。T-4）", () => {
  const targets = () => [
    { roomId: roomA.roomId, lower: ZERO },
    { roomId: roomB.roomId, lower: ZERO },
    { roomId: roomDm, lower: ZERO },
  ];
  const count = (viewerId: string, list = targets()) =>
    withDatabase(env, (db) => listUnreadCountRows(db, viewerId, list));

  it("#297 AC-2（対）: 有効な V の未読は、自分の投稿・削除済み・返信を数えず A=3・B=2・DM=2", async () => {
    expect(await count(V)).toEqual([
      { roomId: roomA.roomId, count: 3 },
      { roomId: roomB.roomId, count: 2 },
      { roomId: roomDm, count: 2 },
    ]);
  });

  it("#297 AC-1・AC-2: A の参加を解除した V には A が返らず、B・DM の数は変わらない", async () => {
    await removeCaseMember(roomA.roomId, V);
    expect(await count(V)).toEqual([
      { roomId: roomB.roomId, count: 2 },
      { roomId: roomDm, count: 2 },
    ]);
  });

  it("#297 AC-1・AC-2: A をアーカイブした後の V には A が返らず、B・DM の数は変わらない", async () => {
    await setArchived(roomA.roomId, true);
    expect(await count(V)).toEqual([
      { roomId: roomB.roomId, count: 2 },
      { roomId: roomDm, count: 2 },
    ]);
  });

  it("#297 AC-1: 無効にした V には、A・B・DM のどれも返らない（空）。対：別の有効な参加者 O の数は変わらない", async () => {
    const forO = [
      { roomId: roomA.roomId, count: 1 },
      { roomId: roomB.roomId, count: 1 },
      { roomId: roomDm, count: 1 },
    ];
    expect(await count(O)).toEqual(forO);
    await setUserActive(V, false);
    expect(await count(V)).toEqual([]);
    expect(await count(O)).toEqual(forO);
  });

  it("#297 AC-2: 公開チャンネル P は、未参加の有効な D1 でも数が返る（P=2）", async () => {
    expect(await count(D1, [{ roomId: ROOM_P, lower: ZERO }])).toEqual([
      { roomId: ROOM_P, count: 2 },
    ]);
  });
});

describe("#297 AC-1・AC-2 スレッドの未読（listThreadUnreadCounts。T-6）", () => {
  const targets = () => [
    { parentId: MA1, lower: ZERO },
    { parentId: MB1, lower: ZERO },
  ];
  const count = async (viewerId: string) =>
    Object.fromEntries(
      await withDatabase(env, (db) =>
        listThreadUnreadCounts(db, viewerId, targets()),
      ),
    );

  it("#297 AC-2（対）: 有効な V の未読は、自分の返信・削除済みを数えず MA1=2・MB1=1", async () => {
    expect(await count(V)).toEqual({ [MA1]: 2, [MB1]: 1 });
  });

  it("#297 AC-1・AC-2: A の参加を解除した V は A のスレッドが 0（行は残る）。B は変わらない", async () => {
    await removeCaseMember(roomA.roomId, V);
    expect(await count(V)).toEqual({ [MA1]: 0, [MB1]: 1 });
  });

  it("#297 AC-1・AC-2: A をアーカイブした後の V は A のスレッドが 0（行は残る）。B は変わらない", async () => {
    await setArchived(roomA.roomId, true);
    expect(await count(V)).toEqual({ [MA1]: 0, [MB1]: 1 });
  });

  it("#297 AC-1: 無効にした V は、A・B のスレッドとも 0（行は残る）", async () => {
    await setUserActive(V, false);
    expect(await count(V)).toEqual({ [MA1]: 0, [MB1]: 0 });
  });
});

describe("#297 AC-1（利用者の決定）スレッドの一覧の DM の条件に、閲覧者が有効であることを足す（listThreadRows。T-6c）", () => {
  const ids = async (viewerId: string) =>
    (
      await withDatabase(env, (db) =>
        listThreadRows(db, viewerId, { limit: 100, includeDirect: true }),
      )
    ).map((row) => row.id);

  it("#297 AC-2（対）: 有効な V には、DM のスレッド（MD3）もチャンネルのスレッド（MA4）も返る", async () => {
    const result = await ids(V);
    expect(result).toContain(MD3);
    expect(result).toContain(MA4);
  });

  it("#297 AC-1: 無効にした V には、DM のスレッドの親（MD3）が返らない。チャンネルのスレッドも既存どおり返らない", async () => {
    await setUserActive(V, false);
    expect(await ids(V)).toEqual([]);
  });

  it("#297 AC-2: V を無効にしても、有効な当事者 O の DM のスレッドは返る", async () => {
    await setUserActive(V, false);
    expect(await ids(O)).toContain(MD3);
  });
});

describe("#297 補助（T-5・T-6b）書き出された SQL と文の数", () => {
  /** prepare された文を記録する（先例：message-reactions.db.test.ts の文の数） */
  function recorded() {
    const queries: string[] = [];
    const wrapped = new Proxy(env.DB, {
      get(target, prop) {
        if (prop === "prepare")
          return (query: string) => {
            queries.push(query);
            return target.prepare(query);
          };
        const value: unknown = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    return { queries, db: drizzle(wrapped, { schema }) };
  }

  it("#297 T-5: 付随の3つの SQL に、外側の列が表の名前つき（リアクションは r.message_id）で、メッセージの部屋の資格の条件の中に出る", async () => {
    const { queries, db } = recorded();
    await loadMessageMentions(db, [MA1], V);
    await loadMessageReactions(db, [MA1], V);
    await loadMessageAttachments(db, [MA1], V);
    expect(queries).toHaveLength(3);
    const [mentions, reactions, attachments] = queries;
    expect(mentions).toMatch(/vmsg\.id\s*=\s*"message_mentions"\."message_id"/);
    expect(reactions).toMatch(/vmsg\.id\s*=\s*r\.message_id/);
    expect(attachments).toMatch(
      /vmsg\.id\s*=\s*"message_attachments"\."message_id"/,
    );
  });

  const MANY = () => Array.from({ length: 30 }, (_, i) => id(100 + i));

  it.each([
    {
      name: "メンション",
      run: (db: ReturnType<typeof recorded>["db"], ids: string[]) =>
        loadMessageMentions(db, ids, V),
    },
    {
      name: "リアクション",
      run: (db: ReturnType<typeof recorded>["db"], ids: string[]) =>
        loadMessageReactions(db, ids, V),
    },
    {
      name: "添付",
      run: (db: ReturnType<typeof recorded>["db"], ids: string[]) =>
        loadMessageAttachments(db, ids, V),
    },
    {
      name: "部屋の未読",
      run: (db: ReturnType<typeof recorded>["db"], ids: string[]) =>
        listUnreadCountRows(
          db,
          V,
          ids.map((roomId) => ({ roomId, lower: ZERO })),
        ),
    },
    {
      name: "スレッドの未読",
      run: (db: ReturnType<typeof recorded>["db"], ids: string[]) =>
        listThreadUnreadCounts(
          db,
          V,
          ids.map((parentId) => ({ parentId, lower: ZERO })),
        ),
    },
  ])(
    "#297 AC-2（T-6b）: $name は、ID が 1件でも 30件でも1文のまま",
    async ({ run }) => {
      const one = recorded();
      await run(one.db, [MA1]);
      expect(one.queries).toHaveLength(1);
      const many = recorded();
      await run(many.db, MANY());
      expect(many.queries).toHaveLength(1);
    },
  );
});
