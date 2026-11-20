// #155（155-A）EP-4-01 GET /api/search/messages（結合テスト。実際のアプリ入口 → Route → Service → Repository → 隔離 D1）。
// 計画 7章：A-1（401・422）・A-3（見えない roomId は0件で 200）・A-4（検索語がログに出ない）・A-5（削除の確定の後の検索に出ない）・
//   D-12（期間：JST の日付で両端を含む。from だけ・to だけ・部屋との併用・MATCH と instr の両方）・D-16（抜粋：記号をまたぐ一致・英字の大小文字）、
//   応答の形（計画 4.4）。403（perm.search.message がない）は、固定ロールがすべて持つため search.service.test.ts で確かめる。
// 期待は、api-draft の EP-4-01・V-34（1〜100文字、前後の空白を除く、UTF-16 で数える。shared/search-rules.ts）、計画 4.4（入力・応答・エラー）、
//   利用者の決定 D-7（429 は作らない）から決める。
//
// 契約（実装前の仮置き。実装の担当へ）：
//   クエリ：q（必須）・roomId（任意。ULID）・from／to（任意。YYYY-MM-DD。JST の日付で両端を含む。from > to・存在しない日付は 422）・
//     limit（任意。既定20・1〜50）・cursor（任意。不正は 422）。422 の fields には、誤った項目の名前を入れる。
//   応答 200：{ items: [{ messageId, parentMessageId（返信なら親の ID、そうでなければ null）, roomId, roomKind（"channel" | "direct" | "case"）,
//     roomName（チャンネルはチャンネル名。DM は相手の表示名）, author: { id, displayName }, excerpt（記号を除いた本文の、一致を含む部分）, createdAt }],
//     nextCursor（string | null） }。総件数の項目は持たない。
// データは架空（testuser_casereq_・[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import {
  cleanupCaseTestData,
  joinedAt,
  seedCase,
} from "../../test/case-fixtures";
import {
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
import { insertDm } from "../../test/dm-fixtures";
import {
  deleteMessage,
  editMessage,
  setReauthenticated,
} from "../../test/message-modify-fixtures";
import {
  TEST_TAG,
  insertChannel,
  insertMember,
} from "../../test/department-fixtures";
import {
  cleanupRelatedReadsRooms,
  fixedIdAt,
} from "../../test/related-reads-fixtures";
import {
  buildSearchIndex,
  cleanupSearchIndex,
} from "../../test/search-fixtures";

const BASE_MS = 1_878_000_000_000;
const ROOM = fixedIdAt(BASE_MS);
const SECRET_ROOM = fixedIdAt(BASE_MS + 1);
const CHANNEL_NAME = `${TEST_TAG}search-api`;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

let w: CaseWorld;
let V: { id: string; token: string };
let seq = 0;
let logLines: string[] = [];

type Item = {
  messageId: string;
  parentMessageId: string | null;
  roomId: string;
  roomKind: string;
  roomName: string;
  author: { id: string; displayName: string };
  excerpt: string;
  createdAt: string;
};
type Page = { items: Item[]; nextCursor: string | null };

async function insertRow(seed: {
  roomId?: string;
  senderId?: string;
  text: string;
  at?: string;
  parentId?: string;
}): Promise<string> {
  seq += 1;
  const ms = BASE_MS + 10_000 + seq * 1_000;
  const id = fixedIdAt(ms);
  await env.DB.prepare(
    `INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at, parent_message_id)
     VALUES (?, ?, ?, 'テスト太郎', ?, ?, ?)`,
  )
    .bind(
      id,
      seed.roomId ?? ROOM,
      seed.senderId ?? V.id,
      `${TEST_TAG}${seed.text}`,
      seed.at ?? new Date(ms).toISOString(),
      seed.parentId ?? null,
    )
    .run();
  return id;
}

const searchPath = (query: Record<string, string>) =>
  `/api/search/messages?${new URLSearchParams(query).toString()}`;

function get(query: Record<string, string>, token: string | null = V.token) {
  return apiRequest("GET", searchPath(query), { token });
}

async function ok(query: Record<string, string>, token = V.token) {
  const response = await get(query, token);
  expect(response.status, JSON.stringify(query)).toBe(200);
  return (await response.json()) as Page;
}

async function idsOf(query: Record<string, string>) {
  return (await ok(query)).items.map((i) => i.messageId);
}

async function expect422(query: Record<string, string>, field: string) {
  const response = await get(query);
  expect(response.status, JSON.stringify(query)).toBe(422);
  const body = (await response.json()) as { code: string; fields: string[] };
  expect(body.code).toBe("VALIDATION_ERROR");
  expect(body.fields, JSON.stringify(query)).toContain(field);
}

beforeEach(async () => {
  seq = 0;
  logLines = [];
  const record = (...args: unknown[]) => {
    logLines.push(
      args
        .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
        .join(" "),
    );
  };
  vi.spyOn(console, "log").mockImplementation(record);
  vi.spyOn(console, "info").mockImplementation(record);
  vi.spyOn(console, "warn").mockImplementation(record);
  vi.spyOn(console, "error").mockImplementation(record);
  w = await setupCaseWorld();
  V = w.memberS1;
  await insertChannel({
    id: ROOM,
    name: CHANNEL_NAME,
    purpose: "normal",
    departmentId: w.deptS.id,
    visibility: "public",
  });
  await insertMember(ROOM, V.id);
  await insertChannel({
    id: SECRET_ROOM,
    name: `${TEST_TAG}search-api-secret`,
    purpose: "normal",
    departmentId: w.deptS.id,
    visibility: "private",
  });
  await insertMember(SECRET_ROOM, w.memberS2.id);
});

afterEach(async () => {
  vi.restoreAllMocks();
  try {
    await cleanupSearchIndex();
  } finally {
    await cleanupRelatedReadsRooms([ROOM, SECRET_ROOM]);
    await cleanupCaseTestData();
  }
});

describe("#155 AC-4 A-1 認証と入力の検証", () => {
  it("#155 AC-4 A-1: ログインしていなければ 401 UNAUTHENTICATED", async () => {
    const response = await get({ q: "見積書" }, null);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("#155 AC-3 A-1: q の欠落・空・空白だけ（全角を含む）は 422（fields に q）", async () => {
    await expect422({}, "q");
    await expect422({ q: "" }, "q");
    await expect422({ q: "   " }, "q");
    await expect422({ q: "　　" }, "q");
  });

  it("#155 AC-3 A-1: q は前後の空白を除いて UTF-16 で100単位まで。101単位は 422、100文字・前後の空白つきの100文字・𠮷×50（100単位）は 200、𠮷×51（102単位）は 422", async () => {
    await ok({ q: "あ".repeat(100) });
    await ok({ q: ` ${"あ".repeat(100)} ` });
    await ok({ q: "𠮷".repeat(50) });
    await expect422({ q: "あ".repeat(101) }, "q");
    await expect422({ q: "𠮷".repeat(51) }, "q");
    await ok({ q: "a" });
  });

  it("#155 AC-3 A-1: limit は1〜50（既定20）。0・51・数でない値は 422", async () => {
    await ok({ q: "見積書", limit: "1" });
    await ok({ q: "見積書", limit: "50" });
    await expect422({ q: "見積書", limit: "0" }, "limit");
    await expect422({ q: "見積書", limit: "51" }, "limit");
    await expect422({ q: "見積書", limit: "abc" }, "limit");
  });

  it("#155 AC-3 A-1: 壊れた cursor は 422", async () => {
    await expect422({ q: "見積書", cursor: "@@@" }, "cursor");
    await expect422({ q: "見積書", cursor: "eyJ2IjoxfQ" }, "cursor");
  });

  it("#155 AC-3 A-1: from・to は YYYY-MM-DD の存在する日付だけ。形の違い・存在しない日付・from > to は 422", async () => {
    await ok({ q: "見積書", from: "2026-11-10", to: "2026-11-10" });
    await expect422({ q: "見積書", from: "2026/11/10" }, "from");
    await expect422({ q: "見積書", from: "2026-02-30" }, "from");
    await expect422({ q: "見積書", to: "2026-13-01" }, "to");
    await expect422({ q: "見積書", to: "20261110" }, "to");
    const response = await get({
      q: "見積書",
      from: "2026-11-11",
      to: "2026-11-10",
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as { fields: string[] };
    expect(body.fields.some((f) => f === "from" || f === "to")).toBe(true);
  });

  it("#155 AC-4 A-1: roomId が ULID の形でなければ 422", async () => {
    await expect422({ q: "見積書", roomId: "not-a-room" }, "roomId");
  });
});

describe("#155 AC-1 応答の形", () => {
  it("#155 AC-1: 項目は messageId・parentMessageId・roomId・roomKind・roomName・author・excerpt・createdAt。総件数は返さない", async () => {
    const parent = await insertRow({ text: "応答形の親投稿です" });
    const child = await insertRow({
      text: "応答形の返信です",
      parentId: parent,
      senderId: w.memberS2.id,
    });
    await buildSearchIndex();
    const page = await ok({ q: "応答形の" });
    expect(Object.keys(page).sort()).toEqual(["items", "nextCursor"]);
    expect(page.nextCursor).toBeNull();
    const byId = new Map(page.items.map((i) => [i.messageId, i]));
    expect(byId.get(parent)).toMatchObject({
      messageId: parent,
      parentMessageId: null,
      roomId: ROOM,
      roomKind: "channel",
      roomName: CHANNEL_NAME,
      author: { id: V.id },
    });
    expect(byId.get(child)).toMatchObject({
      messageId: child,
      parentMessageId: parent,
      roomId: ROOM,
      author: { id: w.memberS2.id },
    });
    for (const item of page.items) {
      expect(item.createdAt).toMatch(ISO);
      expect(typeof item.author.displayName).toBe("string");
      expect(item.excerpt).toContain("応答形の");
    }
    // 新しい順（返信のほうが新しい）
    expect(page.items.map((i) => i.messageId)).toEqual([child, parent]);
  });

  it("#155 AC-1: DM は roomKind direct・roomName は相手の表示名、案件の部屋は roomKind case", async () => {
    const dm = await insertDm(V.id, w.memberS2.id, {
      roomId: fixedIdAt(BASE_MS + 2),
    });
    await env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ?")
      .bind("テスト相手乙", w.memberS2.id)
      .run();
    const room = await seedCase({
      n: 1561,
      clientId: w.clientA.id,
      code: "QZA",
      title: "[UNIT_TEST]検索APIの案件",
      createdBy: V.id,
      departmentIds: [w.deptS.id],
      members: [{ userId: V.id, joinedAt: joinedAt(1) }],
    });
    const dmMessage = await insertRow({ roomId: dm, text: "種類確認のDM本文" });
    const caseMessage = await insertRow({
      roomId: room.roomId,
      text: "種類確認の案件本文",
    });
    try {
      await buildSearchIndex();
      const page = await ok({ q: "種類確認の" });
      const byId = new Map(page.items.map((i) => [i.messageId, i]));
      expect(byId.get(dmMessage)).toMatchObject({
        roomKind: "direct",
        roomId: dm,
        roomName: "テスト相手乙",
      });
      expect(byId.get(caseMessage)).toMatchObject({
        roomKind: "case",
        roomId: room.roomId,
      });
    } finally {
      await cleanupSearchIndex();
      await cleanupRelatedReadsRooms([dm]);
    }
  });
});

describe("#155 AC-4 A-3 見えない部屋の指定", () => {
  it("#155 AC-4 A-3: 見えない部屋（未参加の非公開）を roomId に指定しても 200 で0件。存在しない部屋と同じ応答", async () => {
    await insertRow({
      roomId: SECRET_ROOM,
      senderId: w.memberS2.id,
      text: "秘密室だけの語句",
    });
    await buildSearchIndex();
    const hidden = await ok({ q: "秘密室だけの語句", roomId: SECRET_ROOM });
    const missing = await ok({
      q: "秘密室だけの語句",
      roomId: fixedIdAt(BASE_MS + 77),
    });
    expect(hidden).toEqual({ items: [], nextCursor: null });
    expect(hidden).toEqual(missing);
    expect(await ok({ q: "秘密室だけの語句" })).toEqual({
      items: [],
      nextCursor: null,
    });
  });
});

describe("#155 AC-4 A-4 検索語をログに出さない", () => {
  it("#155 AC-4 A-4: 成功・422 のどちらでも、検索語がログ（console）に出ない", async () => {
    const term = "秘匿検索語ゼータ";
    await insertRow({ text: `${term}を含む本文` });
    await buildSearchIndex();
    logLines = [];
    await ok({ q: term });
    await expect422({ q: `${term}${"あ".repeat(100)}` }, "q");
    await ok({ q: term, from: "2026-11-01" });
    const joined = logLines.join("\n");
    expect(joined).not.toContain(term);
    expect(joined).not.toContain(encodeURIComponent(term));
  });
});

describe("#155 AC-1 A-5 削除との並び", () => {
  it("#155 AC-1 A-5: 検索と削除を同時に送っても、削除の確定の後の検索には出ない", async () => {
    const id = await insertRow({ text: "同時削除の対象文" });
    await buildSearchIndex();
    // 削除の API（EP-1-04）は再認証を求めるため、直前に再認証した状態にする
    await setReauthenticated(V.token, 0);
    const [during, removed] = await Promise.all([
      ok({ q: "同時削除の対象" }),
      deleteMessage(id, V.token),
    ]);
    expect(removed.status).toBeGreaterThanOrEqual(200);
    expect(removed.status).toBeLessThan(300);
    expect(
      (
        await env.DB.prepare("SELECT deleted_at FROM messages WHERE id = ?")
          .bind(id)
          .first<{ deleted_at: string | null }>()
      )?.deleted_at,
    ).not.toBeNull();
    expect(during.items.length).toBeLessThanOrEqual(1);
    expect(await ok({ q: "同時削除の対象" })).toEqual({
      items: [],
      nextCursor: null,
    });
    expect(await ok({ q: "同時" })).toEqual({ items: [], nextCursor: null });
  });
});

describe("#155 AC-3 D-12 期間（JST の日付・両端を含む）と部屋の絞り込み", () => {
  // JST の 2026-11-10 は、UTC の 2026-11-09T15:00:00.000Z 〜 2026-11-10T14:59:59.999Z
  const AT = {
    beforeDay: "2026-11-09T14:59:59.999Z", // JST 11-09 23:59:59.999
    dayStart: "2026-11-09T15:00:00.000Z", // JST 11-10 00:00:00
    dayEnd: "2026-11-10T14:59:59.000Z", // JST 11-10 23:59:59
    nextDay: "2026-11-10T15:00:00.000Z", // JST 11-11 00:00:00
  } as const;

  async function seedDays(word: string, roomId = ROOM) {
    const out: Record<keyof typeof AT, string> = {
      beforeDay: "",
      dayStart: "",
      dayEnd: "",
      nextDay: "",
    };
    for (const key of Object.keys(AT) as (keyof typeof AT)[])
      out[key] = await insertRow({
        roomId,
        text: `${word}${key}`,
        at: AT[key],
      });
    return out;
  }

  it("#155 AC-3 D-12: from=to=その日なら、その日の 00:00 と 23:59:59 の両方が入り、前日・翌日は入らない（MATCH・instr の両方）", async () => {
    const days = await seedDays("期間検索語");
    await buildSearchIndex();
    for (const q of ["期間検索語", "期間"]) {
      expect(
        (await idsOf({ q, from: "2026-11-10", to: "2026-11-10" })).sort(),
      ).toEqual([days.dayStart, days.dayEnd].sort());
    }
  });

  it("#155 AC-3 D-12: from だけ・to だけ（MATCH・instr の両方）", async () => {
    const days = await seedDays("期間検索語");
    await buildSearchIndex();
    for (const q of ["期間検索語", "期間"]) {
      expect((await idsOf({ q, from: "2026-11-10" })).sort()).toEqual(
        [days.dayStart, days.dayEnd, days.nextDay].sort(),
      );
      expect((await idsOf({ q, to: "2026-11-10" })).sort()).toEqual(
        [days.beforeDay, days.dayStart, days.dayEnd].sort(),
      );
    }
  });

  it("#155 AC-3 D-12: 部屋と期間の併用（ほかの部屋の同じ日の行は入らない。MATCH・instr の両方）", async () => {
    const OTHER = fixedIdAt(BASE_MS + 3);
    await insertChannel({
      id: OTHER,
      name: `${TEST_TAG}search-api-other`,
      purpose: "normal",
      departmentId: w.deptS.id,
      visibility: "public",
    });
    try {
      const days = await seedDays("期間検索語");
      await seedDays("期間検索語", OTHER);
      await buildSearchIndex();
      for (const q of ["期間検索語", "期間"])
        expect(
          (
            await idsOf({
              q,
              roomId: ROOM,
              from: "2026-11-10",
              to: "2026-11-10",
            })
          ).sort(),
        ).toEqual([days.dayStart, days.dayEnd].sort());
    } finally {
      await cleanupSearchIndex();
      await cleanupRelatedReadsRooms([OTHER]);
    }
  });
});

describe("#155 AC-3 D-16 抜粋", () => {
  it("#155 AC-3 D-16: 記号をまたぐ一致（申**請**手続 を「申請手続」で）が抜粋に出て、抜粋は記号を除いた文", async () => {
    await insertRow({ text: "前置きの申**請**手続の説明" });
    await buildSearchIndex();
    const [item] = (await ok({ q: "申請手続" })).items;
    expect(item?.excerpt).toContain("申請手続");
    expect(item?.excerpt).not.toContain("**");
  });

  it("#155 AC-3 D-16: 英字の大文字・小文字が違っても、一致した部分が抜粋に出る（3文字以上・1〜2文字）", async () => {
    await insertRow({
      text: `${"前".repeat(300)}INVOICE番号${"後".repeat(300)}`,
    });
    await buildSearchIndex();
    const [long] = (await ok({ q: "invoice" })).items;
    expect(long?.excerpt).toContain("INVOICE");
    const [short] = (await ok({ q: "in" })).items;
    expect(short?.excerpt).toContain("IN");
  });

  it("#155 AC-3 D-16: 抜粋は、いまの本文から作る（索引の後に編集されたら、新しい本文の抜粋）", async () => {
    const id = await insertRow({ text: "抜粋旧本文の語句" });
    await buildSearchIndex();
    const edited = await editMessage(
      id,
      { body: `${TEST_TAG}抜粋新本文の語句` },
      V.token,
    );
    expect(edited.status).toBe(200);
    const [item] = (await ok({ q: "の語句" })).items;
    expect(item?.excerpt).toContain("抜粋新本文");
    expect(item?.excerpt).not.toContain("抜粋旧本文");
  });
});

describe("#155 AC-3 ページ（API）", () => {
  it("#155 AC-3: limit を超えると nextCursor を返し、それで続きが取れる（重複なし）", async () => {
    const all: string[] = [];
    for (let i = 0; i < 5; i += 1)
      all.push(await insertRow({ text: `頁送り語句${i}` }));
    await buildSearchIndex();
    const first = await ok({ q: "頁送り語句", limit: "2" });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const collected = first.items.map((i) => i.messageId);
    let cursor = first.nextCursor;
    while (cursor !== null) {
      const page = await ok({ q: "頁送り語句", limit: "2", cursor });
      collected.push(...page.items.map((i) => i.messageId));
      cursor = page.nextCursor;
    }
    expect(collected).toEqual([...all].reverse());
  });
});
