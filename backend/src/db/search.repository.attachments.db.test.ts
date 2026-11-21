// #155（155-B）R-1〜R-6：添付ファイル名の検索の Repository（search.repository.ts の searchMessages）。
// 期待は、Issue #155 の AC-1〜AC-4（見られるメッセージの添付の名前だけが出る。権限のない部屋の添付の名前が出ない）、利用者の決定 B-3（名前は記号を除かない）・
//   B-4（メッセージの結果と同じ一覧に、印〔matchedIn〕と一致した名前〔matchedAttachments〕。本文と名前が両方一致しても1件）、
//   計画（155-B）4章（一致した対応の行 → 行ごとに適格〔kind=message は d.ref_id = m.id、kind=attachment は a.id = d.ref_id AND a.message_id = m.id
//   AND a.room_id = m.room_id、共通の m.room_id = d.room_id・未削除・roomViewableBy・DM／案件の権限〕→ 適格な行だけでメッセージ単位に集約 → 並び・カーソル・LIMIT）、
//   R1-2（不整合な索引を混ぜても、名前・matchedIn・ページの全体が変わらない）、R1-3（条件ごとの外す事例）、R1-7（全角・半角の差を固定）から決める。実装から写さない。
// 存在の隠し方の確かめ方：見えない添付だけにある語の結果と、どこにもない語の結果が、同じ値（items も nextCursor も）であること。
//
// 契約（実装前の仮置き。実装の担当へ）：searchMessages の戻り値の各行に、次の2項目を足す（既存の項目は変えない）。
//   matchedIn: ("body" | "attachment")[]   … 1つ以上。並びは body → attachment の固定の順。重複しない
//   matchedAttachments: { id: string; name: string }[]   … 一致した添付だけ（一致しない添付は入れない）。添付の ID の昇順。name はいまの original_name。
//     本文だけの一致なら []
//   excerpt：本文が一致していれば今のとおり。名前だけの一致なら、記号を除いた本文の先頭（120 コードポイント。buildExcerpt の一致なしの動き）
// 準備：部署 deptS の利用者 V（memberS1。閲覧者）・O（memberS2）・D1（memberD1）。部屋ごとに、本文の語と添付の名前の語を区別できる形で1件ずつ入れる。
//   名前と本文は互いに含まない（名前には「添付」「名」、本文には「本文」の字を使う）。データは架空（testuser_casereq_・[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupCaseTestData,
  joinedAt,
  removeCaseMember,
  seedCase,
} from "../../test/case-fixtures";
import {
  setUserActive,
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import { insertDm } from "../../test/dm-fixtures";
import {
  TEST_TAG,
  insertChannel,
  insertMember,
} from "../../test/department-fixtures";
import {
  cleanupRelatedReadsRooms,
  fixedIdAt,
  insertAttachmentRow,
} from "../../test/related-reads-fixtures";
import {
  buildSearchIndex,
  cleanupSearchIndex,
  insertAttachmentIndexRow,
} from "../../test/search-fixtures";
import { decodeCursor } from "../lib/cursor";
import { withSearch } from "./search.repository";

const BASE_MS = 1_882_000_000_000;
const rid = (n: number) => fixedIdAt(BASE_MS + n);

type RoomKey =
  | "pubJoined"
  | "pubOther"
  | "privJoined"
  | "privOther"
  | "archived"
  | "dmMine"
  | "dmOthers"
  | "caseJoined"
  | "caseOther"
  | "caseClosed";

/** 部屋ごとの記号（互いに部分一致しない1文字） */
const MARK: Record<RoomKey, string> = {
  pubJoined: "甲",
  pubOther: "乙",
  privJoined: "丙",
  privOther: "丁",
  archived: "戊",
  dmMine: "己",
  dmOthers: "庚",
  caseJoined: "壬",
  caseOther: "癸",
  caseClosed: "子",
};
/** 部屋ごとの名前の2文字の語（instr の経路。互いに重ならず、本文にも無い） */
const PAIR: Record<RoomKey, string> = {
  pubJoined: "鶴亀",
  pubOther: "梅桃",
  privJoined: "桜楓",
  privOther: "柿栗",
  archived: "鷺鴨",
  dmMine: "鯛鮪",
  dmOthers: "鮭鱒",
  caseJoined: "蓮菊",
  caseOther: "蘭葵",
  caseClosed: "椿萩",
};
/** すべての部屋の添付の名前に共通の語（本文には無い） */
const COMMON_NAME = "横断添付名";
const COMMON_NAME_PAIR = "断添";
const nameOf = (key: RoomKey) =>
  `${MARK[key]}室添付名${PAIR[key]}${COMMON_NAME}.txt`;
const uniqueName = (key: RoomKey) => `${MARK[key]}室添付名`;
const bodyOf = (key: RoomKey) => `${MARK[key]}室の本文です`;

const VISIBLE: readonly RoomKey[] = [
  "pubJoined",
  "pubOther",
  "privJoined",
  "dmMine",
  "caseJoined",
  "caseClosed",
];
const HIDDEN: readonly RoomKey[] = [
  "privOther",
  "archived",
  "dmOthers",
  "caseOther",
];
/** 作成日時の順（古い順）。見えない部屋を間と、いちばん古い位置に混ぜる */
const ORDER: readonly RoomKey[] = [
  "caseOther",
  "pubJoined",
  "privOther",
  "pubOther",
  "archived",
  "privJoined",
  "dmOthers",
  "dmMine",
  "caseJoined",
  "caseClosed",
];

let w: CaseWorld;
let V: string;
let O: string;
let roomOf: Record<RoomKey, string>;
let messageOf: Record<RoomKey, string>;
let attachmentOf: Record<RoomKey, string>;
let msgSeq = 0;

function nextMessage(): { id: string; at: string } {
  msgSeq += 1;
  const ms = BASE_MS + 100_000 + msgSeq * 1_000;
  return { id: fixedIdAt(ms), at: new Date(ms).toISOString() };
}

/** メッセージを直接入れ、名前ごとに投稿済みの添付を結ぶ（索引は buildSearchIndex で作る） */
async function seedMessage(seed: {
  roomId: string;
  text: string;
  names?: readonly string[];
  senderId?: string;
  at?: string;
  parentId?: string | null;
  deleted?: boolean;
}): Promise<{ id: string; at: string; attachments: string[] }> {
  const next = nextMessage();
  const at = seed.at ?? next.at;
  const senderId = seed.senderId ?? V;
  await env.DB.prepare(
    `INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at, deleted_at, deleted_by, parent_message_id)
     VALUES (?, ?, ?, 'テスト太郎', ?, ?, ?, ?, ?)`,
  )
    .bind(
      next.id,
      seed.roomId,
      senderId,
      `${TEST_TAG}${seed.text}`,
      at,
      seed.deleted === true ? at : null,
      seed.deleted === true ? senderId : null,
      seed.parentId ?? null,
    )
    .run();
  const attachments: string[] = [];
  for (const name of seed.names ?? [])
    attachments.push(
      await insertAttachmentRow({
        roomId: seed.roomId,
        uploaderId: senderId,
        messageId: next.id,
        threadParentId: seed.parentId ?? null,
        originalName: name,
      }),
    );
  return { id: next.id, at, attachments };
}

type SearchOptions = {
  limit?: number;
  cursor?: string | null;
  roomId?: string;
  createdFrom?: string;
  createdBefore?: string;
  includeDirect?: boolean;
  includeCase?: boolean;
};

async function search(term: string, viewer = V, options: SearchOptions = {}) {
  return withSearch(env, (repo) =>
    repo.searchMessages(viewer, {
      term,
      limit: options.limit ?? 50,
      includeDirect: options.includeDirect ?? true,
      includeCase: options.includeCase ?? true,
      ...(options.cursor == null
        ? {}
        : { cursor: decodeCursor(options.cursor) }),
      ...(options.roomId === undefined ? {} : { roomId: options.roomId }),
      ...(options.createdFrom === undefined
        ? {}
        : { createdFrom: options.createdFrom }),
      ...(options.createdBefore === undefined
        ? {}
        : { createdBefore: options.createdBefore }),
    }),
  );
}

async function ids(term: string, viewer = V, options: SearchOptions = {}) {
  return (await search(term, viewer, options)).items.map((i) => i.messageId);
}

async function allPages(term: string, limit: number, viewer = V) {
  const pages: string[][] = [];
  let cursor: string | null = null;
  for (let round = 0; round < 50; round += 1) {
    const page = await search(term, viewer, { limit, cursor });
    pages.push(page.items.map((i) => i.messageId));
    if (page.nextCursor === null) return pages;
    cursor = page.nextCursor;
  }
  throw new Error("ページが終わりません");
}

const sorted = (values: readonly string[]) => [...values].sort();
const messagesIn = (keys: readonly RoomKey[]) => keys.map((k) => messageOf[k]);
const EMPTY = { items: [], nextCursor: null };

beforeEach(async () => {
  msgSeq = 0;
  w = await setupCaseWorld();
  V = w.memberS1.id;
  O = w.memberS2.id;
  const D1 = w.memberD1.id;
  const channel = (
    id: string,
    name: string,
    visibility: "public" | "private",
    archived = false,
  ) =>
    insertChannel({
      id,
      name: `${TEST_TAG}search-att-${name}`,
      purpose: "normal",
      departmentId: w.deptS.id,
      visibility,
      archived,
    });
  await channel(rid(1), "pub-joined", "public");
  await channel(rid(2), "pub-other", "public");
  await channel(rid(3), "priv-joined", "private");
  await channel(rid(4), "priv-other", "private");
  await channel(rid(5), "archived", "public", true);
  for (const room of [rid(1), rid(3), rid(5)]) await insertMember(room, V);
  for (const room of [rid(1), rid(2), rid(4)]) await insertMember(room, O);
  const dmMine = await insertDm(V, O, { roomId: rid(7) });
  const dmOthers = await insertDm(O, D1, { roomId: rid(8) });
  const members = [
    { userId: V, joinedAt: joinedAt(1) },
    { userId: O, joinedAt: joinedAt(2) },
  ];
  const caseJoined = await seedCase({
    n: 1571,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]添付検索の参加案件",
    createdBy: V,
    departmentIds: [w.deptS.id],
    members,
  });
  const caseOther = await seedCase({
    n: 1572,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]添付検索の非参加案件",
    createdBy: O,
    departmentIds: [w.deptS.id],
    members: [{ userId: O, joinedAt: joinedAt(2) }],
  });
  const caseClosed = await seedCase({
    n: 1573,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]添付検索の終了案件",
    createdBy: V,
    departmentIds: [w.deptS.id],
    members,
    status: "closed",
  });
  roomOf = {
    pubJoined: rid(1),
    pubOther: rid(2),
    privJoined: rid(3),
    privOther: rid(4),
    archived: rid(5),
    dmMine,
    dmOthers,
    caseJoined: caseJoined.roomId,
    caseOther: caseOther.roomId,
    caseClosed: caseClosed.roomId,
  };
  const messages: [RoomKey, string][] = [];
  const attachments: [RoomKey, string][] = [];
  for (const key of ORDER) {
    const sender =
      key === "dmOthers" ||
      key === "caseOther" ||
      key === "privOther" ||
      key === "pubOther"
        ? O
        : V;
    const seeded = await seedMessage({
      roomId: roomOf[key],
      senderId: sender,
      text: bodyOf(key),
      names: [nameOf(key)],
    });
    messages.push([key, seeded.id]);
    attachments.push([key, seeded.attachments[0] as string]);
  }
  messageOf = Object.fromEntries(messages) as Record<RoomKey, string>;
  attachmentOf = Object.fromEntries(attachments) as Record<RoomKey, string>;
});

afterEach(async () => {
  try {
    await cleanupSearchIndex();
  } finally {
    await cleanupRelatedReadsRooms([
      rid(1),
      rid(2),
      rid(3),
      rid(4),
      rid(5),
      roomOf.dmMine,
      roomOf.dmOthers,
    ]);
    await cleanupCaseTestData();
  }
});

describe("#155 AC-1 AC-3 155-B R-1 ファイル名の一致", () => {
  it("#155 AC-3 R-1: 部屋の固有の名前（3文字以上・MATCH）と2文字（instr）で、その部屋のメッセージ1件だけが出る", async () => {
    await buildSearchIndex();
    for (const key of VISIBLE) {
      expect({ key, ids: await ids(uniqueName(key)) }).toEqual({
        key,
        ids: [messageOf[key]],
      });
      expect({ key, ids: await ids(PAIR[key]) }).toEqual({
        key,
        ids: [messageOf[key]],
      });
    }
  });

  it("#155 AC-3 R-1: 拡張子だけ（pdf・.pdf・xlsx）・アンダースコア・アスタリスク・パーセント・二重引用符を含む名前を、その記号を含む語で引ける（記号を除かない。B-3）", async () => {
    const room = roomOf.pubJoined;
    const pdf = await seedMessage({
      roomId: room,
      text: "拡張子の確認の本文一",
      names: ["R1見積明細.pdf"],
    });
    const xlsx = await seedMessage({
      roomId: room,
      text: "拡張子の確認の本文二",
      names: ["R1集計.xlsx"],
    });
    const underscore = await seedMessage({
      roomId: room,
      text: "記号の確認の本文一",
      names: ["R1_下線_名.txt"],
    });
    const asterisk = await seedMessage({
      roomId: room,
      text: "記号の確認の本文二",
      names: ["R1*星印*名.txt"],
    });
    const percent = await seedMessage({
      roomId: room,
      text: "記号の確認の本文三",
      names: ["R1%百分率%名.txt"],
    });
    const quote = await seedMessage({
      roomId: room,
      text: "記号の確認の本文四",
      names: ['R1"引用"名.txt'],
    });
    await buildSearchIndex();
    expect(await ids("pdf")).toEqual([pdf.id]);
    expect(await ids(".pdf")).toEqual([pdf.id]);
    expect(await ids("xlsx")).toEqual([xlsx.id]);
    expect(await ids("_下線_")).toEqual([underscore.id]);
    expect(await ids("_下")).toEqual([underscore.id]);
    expect(await ids("*星印*")).toEqual([asterisk.id]);
    expect(await ids("*星")).toEqual([asterisk.id]);
    expect(await ids("%百分率%")).toEqual([percent.id]);
    expect(await ids("%百")).toEqual([percent.id]);
    expect(await ids('"引用"')).toEqual([quote.id]);
    expect(await ids('"引')).toEqual([quote.id]);
    // 記号の無い語（記号の前後をつなげた語）では引けない（記号を除いていない）
    expect(await ids("R1下線")).toEqual([]);
  });

  it("#155 AC-3 R-1: 英字の大文字・小文字を区別しない（3文字以上・2文字）", async () => {
    const report = await seedMessage({
      roomId: roomOf.pubJoined,
      text: "英字の名前の本文",
      names: ["REPORT_Qz.TXT"],
    });
    await buildSearchIndex();
    expect(await ids("report_qz")).toEqual([report.id]);
    expect(await ids("Report_QZ.txt")).toEqual([report.id]);
    expect(await ids("qZ")).toEqual([report.id]);
  });

  it("#155 AC-3 R-1 R1-7: 全角と半角は別の文字（正規化しない。本文と同じ既知の差を、添付の名前でも固定する）", async () => {
    const wide = await seedMessage({
      roomId: roomOf.pubJoined,
      text: "全角の名前の本文",
      names: ["ＷＸＹ全角資料.txt"],
    });
    await buildSearchIndex();
    expect(await ids("ＷＸＹ全角")).toEqual([wide.id]);
    expect(await ids("WXY全角")).toEqual([]);
    expect(await ids("ＷＸ")).toEqual([wide.id]);
    expect(await ids("WX")).toEqual([]);
  });
});

describe("#155 AC-1 B-4 155-B R-2 メッセージ単位のまとめ（印と一致した名前）", () => {
  it("#155 AC-1 R-2: 名前だけの一致は matchedIn が attachment だけ、matchedAttachments は一致した添付、抜粋は本文の先頭（120 コードポイント）", async () => {
    const long = `${"長文の本文".repeat(40)}`;
    const seeded = await seedMessage({
      roomId: roomOf.pubJoined,
      text: long,
      names: ["R2名前一致資料.txt", "R2関係ない別紙.txt"],
    });
    await buildSearchIndex();
    const { items } = await search("R2名前一致");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      messageId: seeded.id,
      matchedIn: ["attachment"],
      matchedAttachments: [
        { id: seeded.attachments[0], name: "R2名前一致資料.txt" },
      ],
    });
    const fullBody = `${TEST_TAG}${long}`;
    expect(items[0]?.excerpt).toBe([...fullBody].slice(0, 120).join(""));
  });

  it("#155 AC-1 R-2: 本文と名前の両方が一致しても1件で、matchedIn は body と attachment の2つ（この順）", async () => {
    const seeded = await seedMessage({
      roomId: roomOf.pubJoined,
      text: "両方一致語の本文です",
      names: ["両方一致語の添付.txt"],
    });
    await buildSearchIndex();
    for (const term of ["両方一致語", "両方"]) {
      const { items } = await search(term);
      expect({ term, items }).toMatchObject({
        term,
        items: [
          {
            messageId: seeded.id,
            matchedIn: ["body", "attachment"],
            matchedAttachments: [
              { id: seeded.attachments[0], name: "両方一致語の添付.txt" },
            ],
          },
        ],
      });
      expect(items).toHaveLength(1);
    }
  });

  it("#155 AC-1 R-2: 2つの添付が一致すると1件で、matchedAttachments は2件（添付の ID の昇順）", async () => {
    const seeded = await seedMessage({
      roomId: roomOf.pubJoined,
      text: "二つの添付の本文です",
      names: ["R2重複名の第一.txt", "R2重複名の第二.txt", "R2別件.txt"],
    });
    await buildSearchIndex();
    const { items } = await search("R2重複名");
    expect(items).toHaveLength(1);
    const [first, second] = seeded.attachments;
    const expected = [
      { id: first as string, name: "R2重複名の第一.txt" },
      { id: second as string, name: "R2重複名の第二.txt" },
    ].sort((a, b) => (a.id < b.id ? -1 : 1));
    expect(items[0]?.matchedIn).toEqual(["attachment"]);
    expect(items[0]?.matchedAttachments).toEqual(expected);
  });

  it("#155 AC-1 R-2: 本文だけの一致は matchedIn が body だけで、一致しない添付があっても matchedAttachments は空", async () => {
    await buildSearchIndex();
    const { items } = await search(bodyOf("pubJoined"));
    expect(items).toEqual([
      expect.objectContaining({
        messageId: messageOf.pubJoined,
        matchedIn: ["body"],
        matchedAttachments: [],
      }),
    ]);
  });

  it("#155 AC-1 R-2 R1-2: 正常な添付1つと不整合な索引（別の部屋・未投稿・別のメッセージに結ぶ添付）を混ぜても、名前・matchedIn・ページの全体が変わらない。不整合な索引だけが一致するメッセージは出ない", async () => {
    const term = "R2混在語";
    const target = await seedMessage({
      roomId: roomOf.pubJoined,
      text: "混在の確認の本文です",
      names: [`${term}の正常.txt`],
    });
    const neighbor = await seedMessage({
      roomId: roomOf.pubJoined,
      text: "混在の隣の本文です",
      names: ["隣の無関係な名.txt"],
    });
    const onlyBad = await seedMessage({
      roomId: roomOf.pubJoined,
      text: "不整合だけの本文です",
    });
    await buildSearchIndex();
    const before = await search(term, V, { limit: 1 });
    expect(before.items.map((i) => i.messageId)).toEqual([target.id]);

    // 別の部屋の添付（a.room_id ≠ m.room_id）を target に結ぶ索引
    const otherRoom = await insertAttachmentRow({
      roomId: roomOf.pubOther,
      uploaderId: V,
      messageId: target.id,
      originalName: `${term}の別部屋.txt`,
    });
    // 未投稿の添付を target に結ぶ索引
    const pendingOne = await insertAttachmentRow({
      roomId: roomOf.pubJoined,
      uploaderId: V,
      messageId: null,
      originalName: `${term}の未投稿.txt`,
    });
    // 隣のメッセージの添付を target に結ぶ索引
    const neighborOwn = await insertAttachmentRow({
      roomId: roomOf.pubJoined,
      uploaderId: V,
      messageId: neighbor.id,
      originalName: `${term}の隣.txt`,
    });
    // 不整合な索引だけが一致するメッセージ（onlyBad に、隣の添付を結ぶ）
    const neighborOwn2 = await insertAttachmentRow({
      roomId: roomOf.pubJoined,
      uploaderId: V,
      messageId: neighbor.id,
      originalName: `${term}の隣二.txt`,
    });
    for (const [attachmentId, messageId, name] of [
      [otherRoom, target.id, `${term}の別部屋.txt`],
      [pendingOne, target.id, `${term}の未投稿.txt`],
      [neighborOwn, target.id, `${term}の隣.txt`],
      [neighborOwn2, onlyBad.id, `${term}の隣二.txt`],
    ] as const)
      await insertAttachmentIndexRow({
        attachmentId,
        roomId: roomOf.pubJoined,
        messageId,
        createdAt: messageId === target.id ? target.at : onlyBad.at,
        sourceBody: name,
      });

    const after = await search(term, V, { limit: 1 });
    expect(after).toEqual(before);
    expect(after.items[0]).toMatchObject({
      matchedIn: ["attachment"],
      matchedAttachments: [
        { id: target.attachments[0], name: `${term}の正常.txt` },
      ],
    });
    expect(after.nextCursor).toBeNull();
    expect(await ids(term)).toEqual([target.id]);
    expect(await ids(`${term}の隣二`)).toEqual([]);
  });
});

describe("#155 AC-1 AC-4 155-B R-7 名前の書き換えと同期（統括の決定：写しの名前といまの名前が食い違う添付は出さない）", () => {
  it("#155 AC-4 R-7: 名前だけを DB で書き換えると、同期の前は古い名前・新しい名前のどちらでもその添付は出ず、ほかの正常な添付・本文の一致は変わらない。同期の後は新しい名前で出て、古い名前では出ない", async () => {
    const mixed = await seedMessage({
      roomId: roomOf.pubJoined,
      text: "R7旧称語を含む本文です",
      names: ["R7旧称語の改名対象.txt", "R7旧称語の正常.txt"],
    });
    const only = await seedMessage({
      roomId: roomOf.pubJoined,
      text: "改名だけの本文です",
      names: ["R7単独旧名の資料.txt"],
    });
    await buildSearchIndex();
    // 先に「ある」を確かめる
    expect(await ids("R7単独旧名")).toEqual([only.id]);
    const [renamed, normal] = mixed.attachments;
    await env.DB.batch([
      env.DB.prepare(
        "UPDATE message_attachments SET original_name = ? WHERE id = ?",
      ).bind("R7新称語の改名後.txt", renamed),
      env.DB.prepare(
        "UPDATE message_attachments SET original_name = ? WHERE id = ?",
      ).bind("R7単独新名の資料.txt", only.attachments[0]),
    ]);
    // 同期の前：改名した添付は一致したファイル名に出ない。同じメッセージの正常な添付・本文の一致は出る
    const before = await search("R7旧称語");
    expect(before.items).toHaveLength(1);
    expect(before.items[0]).toMatchObject({
      messageId: mixed.id,
      matchedIn: ["body", "attachment"],
      matchedAttachments: [{ id: normal, name: "R7旧称語の正常.txt" }],
    });
    // その添付だけが一致していたメッセージは、行ごと出ない
    expect(await search("R7単独旧名")).toEqual(EMPTY);
    expect(await search("R7単独旧")).toEqual(EMPTY);
    // 新しい名前でも、同期の前は出ない
    expect(await search("R7単独新名")).toEqual(EMPTY);
    expect(await search("R7新称語")).toEqual(EMPTY);

    // 同期（再登録）の後
    await buildSearchIndex();
    expect(await ids("R7単独新名")).toEqual([only.id]);
    expect(await search("R7単独旧名")).toEqual(EMPTY);
    expect((await search("R7新称語")).items).toEqual([
      expect.objectContaining({
        messageId: mixed.id,
        matchedIn: ["attachment"],
        matchedAttachments: [{ id: renamed, name: "R7新称語の改名後.txt" }],
      }),
    ]);
    expect((await search("R7旧称語")).items[0]?.matchedAttachments).toEqual([
      { id: normal, name: "R7旧称語の正常.txt" },
    ]);
  });

  it("#155 AC-1 R-7: すべての結果の行で「matchedIn が attachment を含む ⇔ matchedAttachments が1件以上」、matchedIn は1つ以上で重複しない", async () => {
    await seedMessage({
      roomId: roomOf.pubJoined,
      text: "R7整合語の本文です",
      names: ["R7整合語の添付.txt"],
    });
    await seedMessage({
      roomId: roomOf.pubJoined,
      text: "R7整合語だけの本文です",
      names: ["無関係の名.txt"],
    });
    await seedMessage({
      roomId: roomOf.pubJoined,
      text: "名前だけの本文です",
      names: ["R7整合語の名前だけ.txt"],
    });
    await buildSearchIndex();
    for (const term of ["R7整合語", "整合", COMMON_NAME, "本文"]) {
      const { items } = await search(term);
      expect({ term, n: items.length > 0 }).toEqual({ term, n: true });
      for (const item of items) {
        const label = `${term} ${item.messageId}`;
        expect(item.matchedIn.length, label).toBeGreaterThan(0);
        expect(new Set(item.matchedIn).size, label).toBe(item.matchedIn.length);
        expect(item.matchedIn.includes("attachment"), label).toBe(
          item.matchedAttachments.length > 0,
        );
      }
    }
  });
});

describe("#155 AC-2 AC-4 155-B R-3 見える範囲（条件ごとに、その条件だけを満たさない添付と、満たす対照の添付）", () => {
  it("#155 AC-4 R-3 roomViewableBy: 共通の名前の語（MATCH・instr）で、見える部屋の添付のメッセージだけが出る（未参加の公開・終了した案件の参加者を含む）", async () => {
    await buildSearchIndex();
    expect(sorted(await ids(COMMON_NAME))).toEqual(sorted(messagesIn(VISIBLE)));
    expect(sorted(await ids(COMMON_NAME_PAIR))).toEqual(
      sorted(messagesIn(VISIBLE)),
    );
  });

  it("#155 AC-4 R-3 roomViewableBy: 見えない部屋（未参加の非公開・アーカイブ・当事者でない DM・非参加の案件）の添付だけにある語の結果は、どこにもない語の結果と同じ", async () => {
    await buildSearchIndex();
    const missing = await search("どこにも無い添付名");
    expect(missing).toEqual(EMPTY);
    for (const key of HIDDEN) {
      // 対照：その部屋の参加者（O）には出る（語が索引に入っていること）
      expect({ key, ids: await ids(uniqueName(key), O) }).toEqual({
        key,
        ids: key === "archived" ? [] : [messageOf[key]],
      });
      expect({ key, page: await search(uniqueName(key)) }).toEqual({
        key,
        page: missing,
      });
      expect({ key, page: await search(PAIR[key]) }).toEqual({
        key,
        page: missing,
      });
      // 部屋の絞り込みで見えない部屋を指定しても、存在しない部屋と同じ
      expect(await search(uniqueName(key), V, { roomId: roomOf[key] })).toEqual(
        await search(uniqueName(key), V, { roomId: rid(99) }),
      );
    }
  });

  it("#155 AC-4 R-3 roomViewableBy: 閲覧者が無効なら、添付の名前でも何も出ない（対照：有効なら出る）", async () => {
    await buildSearchIndex();
    expect(await ids(uniqueName("pubJoined"))).toEqual([messageOf.pubJoined]);
    await setUserActive(V, false);
    expect(await search(COMMON_NAME)).toEqual(EMPTY);
    expect(await search(COMMON_NAME_PAIR)).toEqual(EMPTY);
  });

  it("#155 AC-4 R-3 directRoomListable: perm.dm.message.view がない（includeDirect=false）と DM の添付だけが除かれ、ほかは出る", async () => {
    await buildSearchIndex();
    expect(sorted(await ids(COMMON_NAME, V, { includeDirect: false }))).toEqual(
      sorted(messagesIn(VISIBLE.filter((k) => k !== "dmMine"))),
    );
    expect(
      await search(uniqueName("dmMine"), V, { includeDirect: false }),
    ).toEqual(EMPTY);
    expect(await ids(uniqueName("dmMine"))).toEqual([messageOf.dmMine]);
  });

  it("#155 AC-4 R-3 caseRoomListable: perm.case.view がない（includeCase=false）と案件の部屋の添付だけが除かれ、ほかは出る", async () => {
    await buildSearchIndex();
    expect(sorted(await ids(COMMON_NAME, V, { includeCase: false }))).toEqual(
      sorted(
        messagesIn(
          VISIBLE.filter((k) => k !== "caseJoined" && k !== "caseClosed"),
        ),
      ),
    );
    expect(
      await search(uniqueName("caseJoined"), V, { includeCase: false }),
    ).toEqual(EMPTY);
  });

  it("#155 AC-4 R-3 m.deleted_at IS NULL: 削除済みのメッセージの添付は、索引が遅れて写しが残っていても出ない（対照：未削除の同じ語の添付は出る）", async () => {
    const alive = await seedMessage({
      roomId: roomOf.pubJoined,
      text: "削除の対照の本文です",
      names: ["R3削除語の対照.txt"],
    });
    const late = await seedMessage({
      roomId: roomOf.pubJoined,
      text: "削除の対象の本文です",
      names: ["R3削除語の対象.txt"],
    });
    await buildSearchIndex();
    expect(sorted(await ids("R3削除語"))).toEqual(sorted([alive.id, late.id]));
    await env.DB.prepare(
      "UPDATE messages SET deleted_at = ?, deleted_by = ? WHERE id = ?",
    )
      .bind(new Date().toISOString(), V, late.id)
      .run();
    expect(await ids("R3削除語")).toEqual([alive.id]);
    expect(await search("R3削除語の対象")).toEqual(EMPTY);
  });

  it("#155 AC-4 R-3 a.message_id = m.id: 索引の message_id と、添付の結び付きが違う行は出ない（対照：結び付きの合う行は出る）", async () => {
    const control = await seedMessage({
      roomId: roomOf.pubJoined,
      text: "結び付きの対照の本文",
      names: ["R3結付語の対照.txt"],
    });
    const shown = await seedMessage({
      roomId: roomOf.pubJoined,
      text: "結び付きの表示側の本文",
    });
    const owner = await seedMessage({
      roomId: roomOf.pubJoined,
      text: "結び付きの持ち主の本文",
    });
    await buildSearchIndex();
    const attachment = await insertAttachmentRow({
      roomId: roomOf.pubJoined,
      uploaderId: V,
      messageId: owner.id,
      originalName: "R3結付語の対象.txt",
    });
    await insertAttachmentIndexRow({
      attachmentId: attachment,
      roomId: roomOf.pubJoined,
      messageId: shown.id,
      createdAt: shown.at,
      sourceBody: "R3結付語の対象.txt",
    });
    expect(await ids("R3結付語")).toEqual([control.id]);
    expect(await search("R3結付語の対象")).toEqual(EMPTY);
  });

  it("#155 AC-4 R-3 a.room_id = m.room_id: 添付の部屋がメッセージの部屋と違う（索引の部屋はメッセージの部屋）行は出ない（対照は出る）", async () => {
    const control = await seedMessage({
      roomId: roomOf.pubJoined,
      text: "添付部屋の対照の本文",
      names: ["R3添部語の対照.txt"],
    });
    const message = await seedMessage({
      roomId: roomOf.pubJoined,
      text: "添付部屋の対象の本文",
    });
    await buildSearchIndex();
    // 添付の部屋は、閲覧者が見てよい別の部屋（見える範囲ではなく、等式だけが分ける）
    const attachment = await insertAttachmentRow({
      roomId: roomOf.pubOther,
      uploaderId: V,
      messageId: message.id,
      originalName: "R3添部語の対象.txt",
    });
    await insertAttachmentIndexRow({
      attachmentId: attachment,
      roomId: roomOf.pubJoined,
      messageId: message.id,
      createdAt: message.at,
      sourceBody: "R3添部語の対象.txt",
    });
    expect(await ids("R3添部語")).toEqual([control.id]);
    expect(await search("R3添部語の対象")).toEqual(EMPTY);
    for (const roomId of [roomOf.pubJoined, roomOf.pubOther])
      expect(await search("R3添部語の対象", V, { roomId })).toEqual(EMPTY);
  });

  it("#155 AC-4 R-3 m.room_id = d.room_id: 索引の部屋がメッセージの部屋と違う（添付の部屋はメッセージの部屋）行は、どちらの部屋の絞り込みでも出ない（対照は出る）", async () => {
    const control = await seedMessage({
      roomId: roomOf.pubJoined,
      text: "索引部屋の対照の本文",
      names: ["R3索部語の対照.txt"],
    });
    const message = await seedMessage({
      roomId: roomOf.pubJoined,
      text: "索引部屋の対象の本文",
    });
    await buildSearchIndex();
    const attachment = await insertAttachmentRow({
      roomId: roomOf.pubJoined,
      uploaderId: V,
      messageId: message.id,
      originalName: "R3索部語の対象.txt",
    });
    await insertAttachmentIndexRow({
      attachmentId: attachment,
      roomId: roomOf.pubOther,
      messageId: message.id,
      createdAt: message.at,
      sourceBody: "R3索部語の対象.txt",
    });
    expect(await ids("R3索部語")).toEqual([control.id]);
    expect(await search("R3索部語の対象")).toEqual(EMPTY);
    for (const roomId of [roomOf.pubJoined, roomOf.pubOther])
      expect(await search("R3索部語の対象", V, { roomId })).toEqual(EMPTY);
  });

  it("#155 AC-4 R-3 a.id = d.ref_id: 添付の行を消した後に残った索引の行は出ない（対照は出る）", async () => {
    const control = await seedMessage({
      roomId: roomOf.pubJoined,
      text: "消えた添付の対照の本文",
      names: ["R3消添語の対照.txt"],
    });
    const gone = await seedMessage({
      roomId: roomOf.pubJoined,
      text: "消えた添付の対象の本文",
      names: ["R3消添語の対象.txt"],
    });
    await buildSearchIndex();
    expect(sorted(await ids("R3消添語"))).toEqual(
      sorted([control.id, gone.id]),
    );
    await env.DB.prepare("DELETE FROM message_attachments WHERE id = ?")
      .bind(gone.attachments[0])
      .run();
    expect(await ids("R3消添語")).toEqual([control.id]);
    expect(await search("R3消添語の対象")).toEqual(EMPTY);
  });

  it("#155 AC-4 R-3 種類の取り違え（kind=message の行の ref_id に実在する添付の ID）: 出ない（対照は出る）", async () => {
    const control = await seedMessage({
      roomId: roomOf.pubJoined,
      text: "取り違え一の対照の本文",
      names: ["R3取違一語の対照.txt"],
    });
    const holder = await seedMessage({
      roomId: roomOf.pubJoined,
      text: "取り違え一の持ち主の本文",
      names: ["無関係の持ち主の名.txt"],
    });
    await buildSearchIndex();
    await insertAttachmentIndexRow({
      kind: "message",
      attachmentId: holder.attachments[0] as string,
      roomId: roomOf.pubJoined,
      messageId: holder.id,
      createdAt: holder.at,
      sourceBody: "R3取違一語の対象",
    });
    expect(await ids("R3取違一語")).toEqual([control.id]);
    expect(await search("R3取違一語の対象")).toEqual(EMPTY);
  });

  it("#155 AC-4 R-3 種類の取り違え（kind=attachment の行の ref_id に実在するメッセージの ID）: 出ない（対照は出る）", async () => {
    const control = await seedMessage({
      roomId: roomOf.pubJoined,
      text: "取り違え二の対照の本文",
      names: ["R3取違二語の対照.txt"],
    });
    const message = await seedMessage({
      roomId: roomOf.pubJoined,
      text: "取り違え二の対象の本文",
    });
    await buildSearchIndex();
    await insertAttachmentIndexRow({
      attachmentId: message.id,
      roomId: roomOf.pubJoined,
      messageId: message.id,
      createdAt: message.at,
      sourceBody: "R3取違二語の対象.txt",
    });
    expect(await ids("R3取違二語")).toEqual([control.id]);
    expect(await search("R3取違二語の対象")).toEqual(EMPTY);
  });

  it("#155 AC-4 R-3 未投稿: 未投稿の添付は、索引を直接入れても出ない（対照は出る）", async () => {
    const control = await seedMessage({
      roomId: roomOf.pubJoined,
      text: "未投稿の対照の本文",
      names: ["R3未投語の対照.txt"],
    });
    const message = await seedMessage({
      roomId: roomOf.pubJoined,
      text: "未投稿の対象の本文",
    });
    await buildSearchIndex();
    const pendingId = await insertAttachmentRow({
      roomId: roomOf.pubJoined,
      uploaderId: V,
      messageId: null,
      originalName: "R3未投語の対象.txt",
    });
    await insertAttachmentIndexRow({
      attachmentId: pendingId,
      roomId: roomOf.pubJoined,
      messageId: message.id,
      createdAt: message.at,
      sourceBody: "R3未投語の対象.txt",
    });
    expect(await ids("R3未投語")).toEqual([control.id]);
    expect(await search("R3未投語の対象")).toEqual(EMPTY);
  });

  it("#155 AC-2 AC-4 R-3 既存どおり出すもの：削除済みの親への未削除の返信の添付・案件の部屋の参加者限定の添付（参加者には出る）", async () => {
    const parent = await seedMessage({
      roomId: roomOf.pubJoined,
      text: "削除済みの親の本文",
      names: ["R3出す語の親.txt"],
      deleted: true,
    });
    const child = await seedMessage({
      roomId: roomOf.pubJoined,
      text: "未削除の返信の本文",
      names: ["R3出す語の返信.txt"],
      parentId: parent.id,
    });
    const caseMessage = await seedMessage({
      roomId: roomOf.caseJoined,
      text: "案件の限定の本文",
      names: ["R3出す語の限定.txt"],
    });
    await env.DB.prepare(
      "UPDATE message_attachments SET publication_visibility = 'participants_only' WHERE id = ?",
    )
      .bind(caseMessage.attachments[0])
      .run();
    await buildSearchIndex();
    expect(sorted(await ids("R3出す語"))).toEqual(
      sorted([child.id, caseMessage.id]),
    );
    // 非参加者（D1）には、案件の限定の添付は出ない
    expect(await ids("R3出す語の限定", w.memberD1.id)).toEqual([]);
  });
});

describe("#155 AC-4 155-B R-4 ページ（見えない添付の一致が、件数・次の有無・カーソルに影響しない）", () => {
  it("#155 AC-4 R-4: 並びは作成日時の新しい順。見えない添付の一致を間と最後に混ぜても、limit 件と次の有無は見える行だけで決まる", async () => {
    await buildSearchIndex();
    const visibleNewestFirst = [...ORDER]
      .reverse()
      .filter((k) => VISIBLE.includes(k))
      .map((k) => messageOf[k]);
    const first = await search(COMMON_NAME, V, { limit: 3 });
    expect(first.items.map((i) => i.messageId)).toEqual(
      visibleNewestFirst.slice(0, 3),
    );
    expect(first.nextCursor).not.toBeNull();
    const second = await search(COMMON_NAME, V, {
      limit: 3,
      cursor: first.nextCursor,
    });
    expect(second.items.map((i) => i.messageId)).toEqual(
      visibleNewestFirst.slice(3),
    );
    expect(second.nextCursor).toBeNull();
    const exact = await search(COMMON_NAME_PAIR, V, { limit: 6 });
    expect(exact.items.map((i) => i.messageId)).toEqual(visibleNewestFirst);
    expect(exact.nextCursor).toBeNull();
  });

  it("#155 AC-3 R-4: 同じ作成日時の行・本文と名前の両方が一致する行・2つの添付が一致する行が、ページの境目で重複・欠落しない（limit 1・2・3）", async () => {
    const at = new Date(BASE_MS + 900_000).toISOString();
    const expected: string[] = [];
    const shapes: { text: string; names: string[] }[] = [
      { text: "頁境界語の本文一", names: ["頁境界語の添付一.txt"] },
      {
        text: "無関係の本文二",
        names: ["頁境界語の添付二.txt", "頁境界語の添付三.txt"],
      },
      { text: "頁境界語の本文三", names: [] },
      { text: "無関係の本文四", names: ["頁境界語の添付四.txt"] },
      {
        text: "頁境界語の本文五",
        names: ["頁境界語の添付五.txt", "無関係の名.txt"],
      },
    ];
    for (const shape of shapes)
      expected.push(
        (
          await seedMessage({
            roomId: roomOf.pubJoined,
            text: shape.text,
            names: shape.names,
            at,
          })
        ).id,
      );
    // 見えない部屋の同じ時刻の一致も混ぜる
    await seedMessage({
      roomId: roomOf.privOther,
      senderId: O,
      text: "見えない頁境界語の本文",
      names: ["頁境界語の見えない添付.txt"],
      at,
    });
    await buildSearchIndex();
    const newestFirst = [...expected].sort().reverse();
    for (const limit of [1, 2, 3]) {
      const pages = await allPages("頁境界語", limit);
      expect({ limit, all: pages.flat() }).toEqual({ limit, all: newestFirst });
    }
  });
});

describe("#155 AC-3 155-B R-5 部屋・期間（添付の行はメッセージの作成日時で決まる）", () => {
  it("#155 AC-3 R-5: アップロードと日をまたぐ添付でも、期間はメッセージの作成日時で判定する（MATCH・instr）", async () => {
    const messageAt = "2029-08-10T12:00:00.000Z";
    const seeded = await seedMessage({
      roomId: roomOf.pubJoined,
      text: "期間の確認の本文",
      at: messageAt,
    });
    await insertAttachmentRow({
      roomId: roomOf.pubJoined,
      uploaderId: V,
      messageId: seeded.id,
      originalName: "R5期間語の添付鴎鴫.txt",
      createdAt: "2029-08-09T12:00:00.000Z",
    });
    await buildSearchIndex();
    for (const term of ["R5期間語", "鴎鴫"]) {
      expect(
        await ids(term, V, {
          createdFrom: "2029-08-10T00:00:00.000Z",
          createdBefore: "2029-08-11T00:00:00.000Z",
        }),
      ).toEqual([seeded.id]);
      expect(
        await ids(term, V, {
          createdFrom: "2029-08-09T00:00:00.000Z",
          createdBefore: "2029-08-10T00:00:00.000Z",
        }),
      ).toEqual([]);
      expect(await ids(term, V, { roomId: roomOf.pubJoined })).toEqual([
        seeded.id,
      ]);
      expect(await ids(term, V, { roomId: roomOf.pubOther })).toEqual([]);
    }
  });
});

describe("#155 AC-4 155-B R-6 途中で資格を失う", () => {
  it("#155 AC-4 R-6: 1ページ目の後に案件から外れると、1ページ目の取り直し・2ページ目のどちらにも、その案件の添付の名前が出ない", async () => {
    await buildSearchIndex();
    const first = await search(COMMON_NAME, V, { limit: 2 });
    // 新しい順の先頭2件は終了した案件・参加中の案件
    expect(first.items.map((i) => i.messageId)).toEqual([
      messageOf.caseClosed,
      messageOf.caseJoined,
    ]);
    expect(first.items[1]?.matchedAttachments).toEqual([
      { id: attachmentOf.caseJoined, name: nameOf("caseJoined") },
    ]);
    await removeCaseMember(roomOf.caseJoined, V);
    const again = await search(COMMON_NAME, V, { limit: 2 });
    const second = await search(COMMON_NAME, V, {
      limit: 50,
      cursor: first.nextCursor,
    });
    const names = [...again.items, ...second.items].flatMap((i) =>
      i.matchedAttachments.map((a) => a.name),
    );
    expect(names).not.toContain(nameOf("caseJoined"));
    expect(names).toContain(nameOf("caseClosed"));
    expect(
      [...again.items, ...second.items].map((i) => i.messageId),
    ).not.toContain(messageOf.caseJoined);
  });
});
