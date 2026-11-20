// #155（155-A）メッセージの検索の Repository（DB の層）：見える範囲（AC-4・4-1 AC-1・AC-2）・一致の規則（4-1 AC-3）・ページ。
// 計画 7章：D-1（3文字以上）・D-2（1〜2文字・正規化しない）・D-3（構文の文字）・D-4（記号を除いた本文）・D-8（見える範囲・権限の条件）・
//   D-9（既存どおり出すもの）・D-10（資格を失った直後）・D-11（見えない一致が、件数・次の有無に影響しない）・D-15（同じ時刻・ページの間の編集）。
// 期待は、要件（4-1 AC-1〜3、api-draft EP-4-01：参加していない非公開・当事者でない DM・参加者でない案件専用チャンネルは、全体管理者・オーナーも含めない。
//   アーカイブしたチャンネルは検索の結果に出ない〔04-search.md 2026-10-30 の注記〕）、計画 4.3（roomViewableBy と同じ規則・includeDirect／includeCase を
//   LIMIT より前に・元の行の再確認 m.deleted_at IS NULL・総件数を返さない）・4.4（並びは messages.created_at DESC, messages.id DESC。カーソルはメッセージの ID）、
//   利用者の決定 D-3（1〜2文字は instr）・D-6（空白を含む語は1つの句）から決める。
// 存在の隠し方の確かめ方：見えない部屋だけにある語で検索した結果と、どこにもない語で検索した結果が、同じ値（items も nextCursor も）であること。
//
// 契約（実装前の仮置き。実装の担当へ）：
//   backend/src/db/search.repository.ts
//     createSearchRepository(db: Database) / withSearch(env, run)
//     searchMessages(viewerId: string, options: {
//       term: string;            // 前後の空白を除いた検索語（Service が検証済み）
//       limit: number;
//       cursor?: CursorPayload;  // lib/cursor.ts（decodeCursor で戻せる nextCursor）
//       roomId?: string;
//       includeDirect: boolean;  // perm.dm.message.view を持つか
//       includeCase: boolean;    // perm.case.view を持つか
//       // 期間の引数の形は実装に任せる（期間は routes/search.test.ts で API から確かめる）
//     }): Promise<{ items: { messageId: string }[]; nextCursor: string | null }>   ← items の項目は API の応答と同じ形（ここでは messageId だけを見る）
// 準備：部署 deptS の利用者 V（memberS1。閲覧者）・O（memberS2）・D1（memberD1）。部屋ごとに、区別できる固有の語（「甲室の固有語」など、先頭の1文字が違う）と、
//   全部の部屋に共通の語（「横断共通語句」・2文字「横断」）を1件ずつ入れる。データは架空（testuser_casereq_・[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupCaseTestData,
  joinedAt,
  removeCaseMember,
  seedCase,
} from "../../test/case-fixtures";
import {
  setDepartmentActive,
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
  removeMember,
  setArchived,
  setVisibility,
} from "../../test/read-position-fixtures";
import {
  cleanupRelatedReadsRooms,
  fixedIdAt,
} from "../../test/related-reads-fixtures";
import {
  buildSearchIndex,
  cleanupSearchIndex,
} from "../../test/search-fixtures";
import { decodeCursor } from "../lib/cursor";
import { withMessages } from "./message.repository";
import { withSearch } from "./search.repository";

const BASE_MS = 1_874_000_000_000;
const rid = (n: number) => fixedIdAt(BASE_MS + n);

const ROOM = {
  pubJoined: rid(1),
  pubOther: rid(2),
  privJoined: rid(3),
  privOther: rid(4),
  archived: rid(5),
  inactiveDept: rid(6),
} as const;

type RoomKey =
  | "pubJoined"
  | "pubOther"
  | "privJoined"
  | "privOther"
  | "archived"
  | "dmMine"
  | "dmOthers"
  | "dmRetired"
  | "caseJoined"
  | "caseOther"
  | "caseClosed"
  | "inactiveDept";

/** 部屋ごとの固有の語の先頭の1文字（互いに部分一致しない） */
const MARK: Record<RoomKey, string> = {
  pubJoined: "甲",
  pubOther: "乙",
  privJoined: "丙",
  privOther: "丁",
  archived: "戊",
  dmMine: "己",
  dmOthers: "庚",
  dmRetired: "辛",
  caseJoined: "壬",
  caseOther: "癸",
  caseClosed: "子",
  inactiveDept: "丑",
};
/** 部屋ごとの固有の2文字の語（instr の経路。互いに重ならない） */
const PAIR: Record<RoomKey, string> = {
  pubJoined: "鶴亀",
  pubOther: "梅桃",
  privJoined: "桜楓",
  privOther: "柿栗",
  archived: "鷺鴨",
  dmMine: "鯛鮪",
  dmOthers: "鮭鱒",
  dmRetired: "鰯鯖",
  caseJoined: "蓮菊",
  caseOther: "蘭葵",
  caseClosed: "椿萩",
  inactiveDept: "杉檜",
};
const COMMON = "横断共通語句";
const COMMON_PAIR = "横断";
const uniqueWord = (key: RoomKey) => `${MARK[key]}室の固有語`;

const VISIBLE: readonly RoomKey[] = [
  "pubJoined",
  "pubOther",
  "privJoined",
  "dmMine",
  "dmRetired",
  "caseJoined",
  "caseClosed",
  "inactiveDept",
];
const HIDDEN: readonly RoomKey[] = [
  "privOther",
  "archived",
  "dmOthers",
  "caseOther",
];
/** 作成日時の順（古い順）。見えない部屋を、見える部屋の間と、いちばん古い位置に混ぜる */
const ORDER: readonly RoomKey[] = [
  "caseOther",
  "pubJoined",
  "privOther",
  "pubOther",
  "archived",
  "privJoined",
  "dmOthers",
  "dmMine",
  "dmRetired",
  "caseJoined",
  "caseClosed",
  "inactiveDept",
];

let w: CaseWorld;
let V: string;
let roomOf: Record<RoomKey, string>;
let messageOf: Record<RoomKey, string>;
let msgSeq = 0;

function nextMessage(): { id: string; at: string } {
  msgSeq += 1;
  const ms = BASE_MS + 100_000 + msgSeq * 1_000;
  return { id: fixedIdAt(ms), at: new Date(ms).toISOString() };
}

async function insertRow(seed: {
  roomId: string;
  senderId: string;
  text: string;
  id?: string;
  at?: string;
  parentId?: string | null;
  deleted?: boolean;
}): Promise<string> {
  const next = nextMessage();
  const id = seed.id ?? next.id;
  const at = seed.at ?? next.at;
  await env.DB.prepare(
    `INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at, deleted_at, deleted_by, parent_message_id)
     VALUES (?, ?, ?, 'テスト太郎', ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      seed.roomId,
      seed.senderId,
      `${TEST_TAG}${seed.text}`,
      at,
      seed.deleted === true ? at : null,
      seed.deleted === true ? seed.senderId : null,
      seed.parentId ?? null,
    )
    .run();
  return id;
}

type SearchOptions = {
  limit?: number;
  cursor?: string | null;
  roomId?: string;
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
    }),
  );
}

async function ids(term: string, viewer = V, options: SearchOptions = {}) {
  return (await search(term, viewer, options)).items.map((i) => i.messageId);
}

/** 全ページを集める（limit 件ずつ） */
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

beforeEach(async () => {
  msgSeq = 0;
  w = await setupCaseWorld();
  V = w.memberS1.id;
  const O = w.memberS2.id;
  const D1 = w.memberD1.id;
  const channel = (
    id: string,
    name: string,
    visibility: "public" | "private",
    departmentId = w.deptS.id,
    archived = false,
  ) =>
    insertChannel({
      id,
      name: `${TEST_TAG}search-${name}`,
      purpose: "normal",
      departmentId,
      visibility,
      archived,
    });
  await channel(ROOM.pubJoined, "pub-joined", "public");
  await channel(ROOM.pubOther, "pub-other", "public");
  await channel(ROOM.privJoined, "priv-joined", "private");
  await channel(ROOM.privOther, "priv-other", "private");
  await channel(ROOM.archived, "archived", "public", w.deptS.id, true);
  await channel(ROOM.inactiveDept, "inactive-dept", "public", w.deptD.id);
  for (const room of [
    ROOM.pubJoined,
    ROOM.privJoined,
    ROOM.archived,
    ROOM.inactiveDept,
  ])
    await insertMember(room, V);
  await insertMember(ROOM.pubOther, O);
  await insertMember(ROOM.privOther, O);
  await setDepartmentActive(w.deptD.id, false);
  const dmMine = await insertDm(V, O, { roomId: rid(7) });
  const dmOthers = await insertDm(O, D1, { roomId: rid(8) });
  const dmRetired = await insertDm(V, w.inactive.id, { roomId: rid(9) });
  const members = [
    { userId: V, joinedAt: joinedAt(1) },
    { userId: O, joinedAt: joinedAt(2) },
  ];
  const caseJoined = await seedCase({
    n: 1551,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]検索の参加案件",
    createdBy: V,
    departmentIds: [w.deptS.id],
    members,
  });
  const caseOther = await seedCase({
    n: 1552,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]検索の非参加案件",
    createdBy: O,
    departmentIds: [w.deptS.id],
    members: [{ userId: O, joinedAt: joinedAt(2) }],
  });
  const caseClosed = await seedCase({
    n: 1553,
    clientId: w.clientA.id,
    code: "QZA",
    title: "[UNIT_TEST]検索の終了案件",
    createdBy: V,
    departmentIds: [w.deptS.id],
    members,
    status: "closed",
  });
  roomOf = {
    pubJoined: ROOM.pubJoined,
    pubOther: ROOM.pubOther,
    privJoined: ROOM.privJoined,
    privOther: ROOM.privOther,
    archived: ROOM.archived,
    inactiveDept: ROOM.inactiveDept,
    dmMine,
    dmOthers,
    dmRetired,
    caseJoined: caseJoined.roomId,
    caseOther: caseOther.roomId,
    caseClosed: caseClosed.roomId,
  };
  const entries: [RoomKey, string][] = [];
  for (const key of ORDER) {
    const sender = key === "dmOthers" || key === "caseOther" ? O : V;
    entries.push([
      key,
      await insertRow({
        roomId: roomOf[key],
        senderId: sender,
        text: `${uniqueWord(key)}と${PAIR[key]}と${COMMON}`,
      }),
    ]);
  }
  messageOf = Object.fromEntries(entries) as Record<RoomKey, string>;
});

afterEach(async () => {
  try {
    await cleanupSearchIndex();
  } finally {
    await cleanupRelatedReadsRooms([
      ...Object.values(ROOM),
      roomOf.dmMine,
      roomOf.dmOthers,
      roomOf.dmRetired,
    ]);
    await cleanupCaseTestData();
  }
});

describe("#155 AC-4 4-1 AC-1・AC-2 D-8 見える範囲", () => {
  it("#155 AC-4 D-8: 共通の語（3文字以上・MATCH）で、見える部屋のメッセージだけが出る（未参加の公開・参加中の非公開・当事者の DM・参加中の案件・終了した案件を含む）", async () => {
    await buildSearchIndex();
    expect(sorted(await ids(COMMON))).toEqual(sorted(messagesIn(VISIBLE)));
  });

  it("#155 AC-4 D-8: 共通の2文字の語（instr）でも、同じく見える部屋だけ", async () => {
    await buildSearchIndex();
    expect(sorted(await ids(COMMON_PAIR))).toEqual(sorted(messagesIn(VISIBLE)));
  });

  it("#155 AC-4 D-8: 見える部屋の固有の語（3文字以上・2文字）は、その部屋のメッセージ1件だけ", async () => {
    await buildSearchIndex();
    for (const key of VISIBLE) {
      expect({ key, ids: await ids(uniqueWord(key)) }).toEqual({
        key,
        ids: [messageOf[key]],
      });
      expect({ key, ids: await ids(PAIR[key]) }).toEqual({
        key,
        ids: [messageOf[key]],
      });
    }
  });

  it("#155 AC-4 D-8: 見えない部屋（未参加の非公開・アーカイブ・他人の DM・非参加の案件）だけにある語の結果は、どこにもない語の結果と同じ（items も nextCursor も）", async () => {
    await buildSearchIndex();
    const none3 = await search("存在しない語句です");
    const none2 = await search("ゑゐ");
    expect(none3).toEqual({ items: [], nextCursor: null });
    expect(none2).toEqual({ items: [], nextCursor: null });
    for (const key of HIDDEN) {
      expect({ key, result: await search(uniqueWord(key)) }).toEqual({
        key,
        result: none3,
      });
      expect({ key, result: await search(PAIR[key]) }).toEqual({
        key,
        result: none2,
      });
      expect({
        key,
        result: await search(uniqueWord(key), V, { limit: 1 }),
      }).toEqual({ key, result: none3 });
    }
  });

  it("#155 AC-4 D-8: 全体管理者でも、参加していない非公開・当事者でない DM・参加していない案件の部屋は出ない（公開チャンネルだけ）", async () => {
    await buildSearchIndex();
    expect(sorted(await ids(COMMON, w.admin.id))).toEqual(
      sorted(messagesIn(["pubJoined", "pubOther", "inactiveDept"])),
    );
  });

  it("#155 AC-4 D-8: perm.dm.message.view がない（includeDirect=false）と DM だけが除かれ、ほかは出る", async () => {
    await buildSearchIndex();
    expect(sorted(await ids(COMMON, V, { includeDirect: false }))).toEqual(
      sorted(
        messagesIn(VISIBLE.filter((k) => k !== "dmMine" && k !== "dmRetired")),
      ),
    );
    expect(
      await ids(uniqueWord("dmMine"), V, { includeDirect: false }),
    ).toEqual([]);
  });

  it("#155 AC-4 D-8: perm.case.view がない（includeCase=false）と案件の部屋だけが除かれ、ほかは出る", async () => {
    await buildSearchIndex();
    expect(sorted(await ids(COMMON, V, { includeCase: false }))).toEqual(
      sorted(
        messagesIn(
          VISIBLE.filter((k) => k !== "caseJoined" && k !== "caseClosed"),
        ),
      ),
    );
    expect(
      await ids(uniqueWord("caseJoined"), V, { includeCase: false }),
    ).toEqual([]);
  });

  it("#155 AC-4 D-8: 閲覧者が無効なら、何も出ない（3文字以上・2文字）", async () => {
    await buildSearchIndex();
    await setUserActive(V, false);
    expect(await search(COMMON)).toEqual({ items: [], nextCursor: null });
    expect(await search(COMMON_PAIR)).toEqual({ items: [], nextCursor: null });
  });

  it("#155 AC-4 D-8: アーカイブを戻すと、その部屋のメッセージが再び出る（索引を変えずに、その時点の資格で判定）", async () => {
    await buildSearchIndex();
    expect(await ids(uniqueWord("archived"))).toEqual([]);
    await setArchived(ROOM.archived, false);
    expect(await ids(uniqueWord("archived"))).toEqual([messageOf.archived]);
  });

  it("#155 AC-4 D-8: 部屋の絞り込み：見える部屋はその部屋だけ、見えない部屋・権限のない種類の部屋は0件（存在を示さない）", async () => {
    await buildSearchIndex();
    expect(await ids(COMMON, V, { roomId: roomOf.pubOther })).toEqual([
      messageOf.pubOther,
    ]);
    expect(await ids(COMMON_PAIR, V, { roomId: roomOf.pubOther })).toEqual([
      messageOf.pubOther,
    ]);
    for (const key of HIDDEN)
      expect({
        key,
        result: await search(COMMON, V, { roomId: roomOf[key] }),
      }).toEqual({ key, result: { items: [], nextCursor: null } });
    expect(
      await ids(COMMON, V, { roomId: roomOf.caseJoined, includeCase: false }),
    ).toEqual([]);
    expect(
      await ids(COMMON, V, { roomId: roomOf.dmMine, includeDirect: false }),
    ).toEqual([]);
  });
});

describe("#155 AC-4 D-9 既存の読み取りと同じく出すもの", () => {
  it("#155 AC-4 D-9: 削除済みの親への未削除の返信・退職した投稿者のメッセージ・退職した相手との DM・無効な部署のチャンネルは出る。削除済みは出ない", async () => {
    const parent = await insertRow({
      roomId: ROOM.pubJoined,
      senderId: V,
      text: "寅親の削除済の本文",
      deleted: true,
    });
    const child = await insertRow({
      roomId: ROOM.pubJoined,
      senderId: w.memberS2.id,
      text: "卯返信の生存本文",
      parentId: parent,
    });
    const retired = await insertRow({
      roomId: ROOM.pubJoined,
      senderId: w.inactive.id,
      text: "辰退職者の投稿本文",
    });
    await buildSearchIndex();
    expect(await ids("卯返信の生存")).toEqual([child]);
    expect(await ids("寅親の削除済")).toEqual([]);
    expect(await ids("辰退職者の投稿")).toEqual([retired]);
    expect(await ids(uniqueWord("dmRetired"))).toEqual([messageOf.dmRetired]);
    expect(await ids(uniqueWord("inactiveDept"))).toEqual([
      messageOf.inactiveDept,
    ]);
  });

  it("#155 AC-4 D-9: 索引が遅れて写しが残っていても、元の行が削除済みなら出さない（元の行の再確認）", async () => {
    const stale = await insertRow({
      roomId: ROOM.pubJoined,
      senderId: V,
      text: "巳索引遅れの本文",
    });
    await buildSearchIndex();
    await env.DB.prepare(
      "UPDATE messages SET deleted_at = ?, deleted_by = ? WHERE id = ?",
    )
      .bind(new Date().toISOString(), V, stale)
      .run();
    expect(await search("巳索引遅れ")).toEqual({ items: [], nextCursor: null });
    expect(await search("巳索")).toEqual({ items: [], nextCursor: null });
  });
});

describe("#155 AC-4 D-10 資格を失った直後の次の検索", () => {
  it("#155 AC-4 D-10: 案件から外れる・非公開から離脱・公開から非公開へ・アーカイブ、のそれぞれの直後に出ない（索引はそのまま）", async () => {
    await buildSearchIndex();
    expect(await ids(uniqueWord("caseJoined"))).toEqual([messageOf.caseJoined]);
    await removeCaseMember(roomOf.caseJoined, V);
    expect(await ids(uniqueWord("caseJoined"))).toEqual([]);
    expect(await ids(PAIR.caseJoined)).toEqual([]);

    expect(await ids(uniqueWord("privJoined"))).toEqual([messageOf.privJoined]);
    await removeMember(ROOM.privJoined, V);
    expect(await ids(uniqueWord("privJoined"))).toEqual([]);

    expect(await ids(uniqueWord("pubOther"))).toEqual([messageOf.pubOther]);
    await setVisibility(ROOM.pubOther, "private");
    expect(await ids(uniqueWord("pubOther"))).toEqual([]);

    expect(await ids(uniqueWord("pubJoined"))).toEqual([messageOf.pubJoined]);
    await setArchived(ROOM.pubJoined, true);
    expect(await ids(uniqueWord("pubJoined"))).toEqual([]);
  });
});

describe("#155 AC-4 D-11 ページ（見えない一致が、件数と次の有無に影響しない）", () => {
  it("#155 AC-4 D-11: 並びは作成日時の新しい順。見えない一致を間と最後に混ぜても、limit 件と次の有無は見える行だけで決まる", async () => {
    await buildSearchIndex();
    const visibleNewestFirst = [...ORDER]
      .reverse()
      .filter((k) => VISIBLE.includes(k))
      .map((k) => messageOf[k]);
    expect(visibleNewestFirst).toHaveLength(8);

    const first = await search(COMMON, V, { limit: 4 });
    expect(first.items.map((i) => i.messageId)).toEqual(
      visibleNewestFirst.slice(0, 4),
    );
    expect(first.nextCursor).not.toBeNull();
    const second = await search(COMMON, V, {
      limit: 4,
      cursor: first.nextCursor,
    });
    expect(second.items.map((i) => i.messageId)).toEqual(
      visibleNewestFirst.slice(4),
    );
    // 最後の見える行の後ろに、見えない行（いちばん古い）が残っていても、次のページはない
    expect(second.nextCursor).toBeNull();

    const exact = await search(COMMON, V, { limit: 8 });
    expect(exact.items).toHaveLength(8);
    expect(exact.nextCursor).toBeNull();

    const instr = await search(COMMON_PAIR, V, { limit: 8 });
    expect(instr.items.map((i) => i.messageId)).toEqual(visibleNewestFirst);
    expect(instr.nextCursor).toBeNull();
  });

  it("#155 AC-4 D-11: 応答に総件数の項目を持たない（items と nextCursor だけ）", async () => {
    await buildSearchIndex();
    expect(Object.keys(await search(COMMON)).sort()).toEqual([
      "items",
      "nextCursor",
    ]);
  });
});

describe("#155 AC-3 D-15 並びとカーソル（同じ時刻・ページの間の編集）", () => {
  it("#155 AC-3 D-15: 同じ作成日時の5件を2件ずつ読み、間に1件を編集・再登録しても、重複・抜けがなく、メッセージの ID の降順", async () => {
    const at = new Date(BASE_MS + 900_000).toISOString();
    const same: string[] = [];
    for (let i = 0; i < 5; i += 1)
      same.push(
        await insertRow({
          roomId: ROOM.pubJoined,
          senderId: V,
          text: `同時刻の語句${i}`,
          id: fixedIdAt(BASE_MS + 900_000 + i),
          at,
        }),
      );
    await buildSearchIndex();
    const first = await search("同時刻の語句", V, { limit: 2 });
    const collected = first.items.map((i) => i.messageId);
    // ページの間に、まだ読んでいない行を編集し（索引の写しを作り直す）、登録の処理もやり直す
    const target = [...same].sort().reverse()[3] ?? "";
    expect(
      await withMessages(env, (repo) =>
        repo.updateBodyIfModifiable({
          messageId: target,
          userId: V,
          body: `${TEST_TAG}同時刻の語句・改`,
          editedAt: new Date().toISOString(),
        }),
      ),
    ).toBe(1);
    await buildSearchIndex();
    let cursor = first.nextCursor;
    while (cursor !== null) {
      const page = await search("同時刻の語句", V, { limit: 2, cursor });
      collected.push(...page.items.map((i) => i.messageId));
      cursor = page.nextCursor;
    }
    expect(collected).toEqual([...same].sort().reverse());
  });

  it("#155 AC-3 D-15: 全ページを集めると、見える行がちょうど1回ずつ出る（limit 1・3）", async () => {
    await buildSearchIndex();
    for (const limit of [1, 3]) {
      const flat = (await allPages(COMMON, limit)).flat();
      expect(new Set(flat).size).toBe(flat.length);
      expect(sorted(flat)).toEqual(sorted(messagesIn(VISIBLE)));
    }
  });
});

describe("#155 AC-3 D-1 3文字以上の語（MATCH）", () => {
  it("#155 AC-3 D-1: ひらがな・カタカナ・漢字・英数字・混在の3文字以上で、含む行だけが出る。英字の大文字・小文字を区別しない", async () => {
    const room = ROOM.pubJoined;
    const hira = await insertRow({
      roomId: room,
      senderId: V,
      text: "ひらがなのぶんしょう",
    });
    const kata = await insertRow({
      roomId: room,
      senderId: V,
      text: "カタカナノテキスト",
    });
    const kanji = await insertRow({
      roomId: room,
      senderId: V,
      text: "漢字熟語検索",
    });
    const alnum = await insertRow({
      roomId: room,
      senderId: V,
      text: "Release v2Beta build",
    });
    const mixed = await insertRow({
      roomId: room,
      senderId: V,
      text: "案件QZ9の資料",
    });
    await buildSearchIndex();
    expect(await ids("ぶんしょう")).toEqual([hira]);
    expect(await ids("テキスト")).toEqual([kata]);
    expect(await ids("熟語検")).toEqual([kanji]);
    expect(await ids("V2BETA")).toEqual([alnum]);
    expect(await ids("v2beta")).toEqual([alnum]);
    expect(await ids("QZ9の資")).toEqual([mixed]);
    expect(await ids("qz9の資")).toEqual([mixed]);
  });

  it("#155 AC-3 D-1: ちょうど3文字・100文字の語", async () => {
    const three = await insertRow({
      roomId: ROOM.pubJoined,
      senderId: V,
      text: "粟稗黍の備蓄",
    });
    const long = await insertRow({
      roomId: ROOM.pubJoined,
      senderId: V,
      text: `前置き${"ほ".repeat(100)}後書き`,
    });
    await buildSearchIndex();
    expect(await ids("粟稗黍")).toEqual([three]);
    expect(await ids("ほ".repeat(100))).toEqual([long]);
  });

  it("#155 AC-3 D-1 D-6: 空白を含む語は、空白も含めたひとつながりの語（語の順が違う・間に別の語がある行は出ない）", async () => {
    const exact = await insertRow({
      roomId: ROOM.pubJoined,
      senderId: V,
      text: "月次 報告 会議",
    });
    await insertRow({
      roomId: ROOM.pubJoined,
      senderId: V,
      text: "報告 月次 会議",
    });
    await insertRow({
      roomId: ROOM.pubJoined,
      senderId: V,
      text: "月次の報告",
    });
    await buildSearchIndex();
    expect(await ids("月次 報告")).toEqual([exact]);
  });
});

describe("#155 AC-3 D-2 1〜2文字の語（instr）・正規化しない", () => {
  it("#155 AC-3 D-2 D-3: 1文字・2文字（日本語）で、含む行だけが出る", async () => {
    const one = await insertRow({
      roomId: ROOM.pubJoined,
      senderId: V,
      text: "燕が来た",
    });
    const two = await insertRow({
      roomId: ROOM.pubJoined,
      senderId: V,
      text: "雀鷹を見た",
    });
    await buildSearchIndex();
    expect(await ids("燕")).toEqual([one]);
    expect(await ids("雀鷹")).toEqual([two]);
  });

  it("#155 AC-3 D-2: 2文字の英字は、ASCII の大文字・小文字を区別しない", async () => {
    const id = await insertRow({
      roomId: ROOM.pubJoined,
      senderId: V,
      text: "記号Qxの件",
    });
    await buildSearchIndex();
    expect(await ids("qX")).toEqual([id]);
    expect(await ids("QX")).toEqual([id]);
  });

  it("#155 AC-3 D-2: サロゲートペアの1文字（コードポイントで1）で引ける", async () => {
    const id = await insertRow({
      roomId: ROOM.pubJoined,
      senderId: V,
      text: "𩸽の干物",
    });
    await buildSearchIndex();
    expect(await ids("𩸽")).toEqual([id]);
  });

  it("#155 AC-3 D-2: 結合文字は正規化しない（か＋結合の濁点の本文は、合成済みの「が」では引けず、同じ並びなら引ける）", async () => {
    const id = await insertRow({
      roomId: ROOM.pubJoined,
      senderId: V,
      text: "がらす",
    });
    await buildSearchIndex();
    expect(await ids("が")).toEqual([]);
    expect(await ids("が")).toEqual([id]);
  });

  it("#155 AC-3 D-2: 全角と半角は別の文字（正規化しない）", async () => {
    const id = await insertRow({
      roomId: ROOM.pubJoined,
      senderId: V,
      text: "ＷＸＹ商会",
    });
    await buildSearchIndex();
    expect(await ids("WXY商会")).toEqual([]);
    expect(await ids("ＷＸＹ商会")).toEqual([id]);
    expect(await ids("ＷＸ")).toEqual([id]);
    expect(await ids("WX")).toEqual([]);
  });

  it("#155 AC-3 D-2: 1〜2文字（instr）では、ASCII 以外の大文字・小文字を区別する（lower() は ASCII だけ。設計書に書く差）", async () => {
    const id = await insertRow({
      roomId: ROOM.pubJoined,
      senderId: V,
      text: "Äpfel",
    });
    await buildSearchIndex();
    expect(await ids("Ä")).toEqual([id]);
    expect(await ids("ä")).toEqual([]);
  });
});

describe("#155 AC-3 D-3 構文の文字を、文字として部分一致で扱う（エラーにしない）", () => {
  it('#155 AC-3 D-3: " * ^ ( ) : - AND OR NOT NEAR % _ \\ を含む語（3文字以上・1〜2文字）で、その行だけが出る', async () => {
    const room = ROOM.pubJoined;
    const add = (text: string) =>
      insertRow({ roomId: room, senderId: V, text });
    const quote = await add('記号"引用"です');
    const star = await add("計算5*3結果");
    const caret = await add("値x^2乗");
    const paren = await add("注記(括弧内)終");
    const colon = await add("設定key:val終");
    const hyphen = await add("区間a-b間");
    const and = await add("this AND that");
    const or = await add("p OR q");
    const not = await add("NOT here");
    const near = await add("x NEAR y");
    const percent = await add("100%達成");
    const underscore = await add("番号a_9z");
    const backslash = await add("dir\\sub");
    await buildSearchIndex();
    const cases: [string, string][] = [
      ['"引用"', quote],
      ['"', quote],
      ["5*3", star],
      ["*", star],
      ["x^2", caret],
      ["^", caret],
      ["(括弧内)", paren],
      ["(", paren],
      [")", paren],
      ["y:v", colon],
      [":", colon],
      ["a-b", hyphen],
      ["-", hyphen],
      ["s AND t", and],
      ["p OR q", or],
      ["NOT h", not],
      ["x NEAR y", near],
      ["0%達", percent],
      ["%", percent],
      ["a_9z", underscore],
      ["_9", underscore],
      ["r\\s", backslash],
      ["\\", backslash],
    ];
    for (const [term, expected] of cases)
      expect({ term, ids: await ids(term) }).toEqual({
        term,
        ids: [expected],
      });
  });

  it("#155 AC-3 D-3: 構文の語だけ・含まれない構文の語は、エラーにならず0件", async () => {
    await buildSearchIndex();
    for (const term of ["AND", "OR NOT", "NEAR(", "zzz*", '"""', "^^^", "%%"])
      expect({ term, result: await search(term) }).toEqual({
        term,
        result: { items: [], nextCursor: null },
      });
  });
});

describe("#155 AC-3 D-4 記号を除いた本文で引ける", () => {
  it("#155 AC-3 D-4: 申**請**手続 は「申請手続」で引け、「**請」「請**」では引けない", async () => {
    const id = await insertRow({
      roomId: ROOM.pubJoined,
      senderId: V,
      text: "申**請**手続の件",
    });
    await buildSearchIndex();
    expect(await ids("申請手続")).toEqual([id]);
    expect(await ids("**請")).toEqual([]);
    expect(await ids("請**")).toEqual([]);
  });

  it("#155 AC-3 D-4 D-2: リンクの表示の文字と URL の両方で引け、括弧では引けない。file_name の _ は残る", async () => {
    const link = await insertRow({
      roomId: ROOM.pubJoined,
      senderId: V,
      text: "[資料室](https://example.com/rooms)を参照",
    });
    const ident = await insertRow({
      roomId: ROOM.pubJoined,
      senderId: V,
      text: "列 file_name を追加",
    });
    await buildSearchIndex();
    expect(await ids("資料室")).toEqual([link]);
    expect(await ids("example.com/rooms")).toEqual([link]);
    expect(await ids("](")).toEqual([]);
    expect(await ids("file_name")).toEqual([ident]);
  });
});
