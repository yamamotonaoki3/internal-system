// #155（155-B）A-1：EP-4-01 GET /api/search/messages の、添付ファイル名の一致（結合テスト。実際のアプリ入口 → Route → Service → Repository → 隔離 D1）。
// 期待は、利用者の決定 B-4（メッセージの結果と同じ一覧に、印と一致したファイル名）、計画（155-B）5章（入力は変えない。応答の各行に matchedIn・matchedAttachments を足す。
//   既存の項目は変えない）、Issue AC-4（権限のない部屋の添付の名前は、応答の本体の違いからも分からない）、Skill security（検索語・ファイル名をログに出さない）から決める。
// 契約（実装前の仮置き。実装の担当へ）：応答 200 の items の各行に
//   matchedIn: ("body" | "attachment")[]（1つ以上。body → attachment の順）
//   matchedAttachments: { id: string; name: string }[]（一致した添付だけ。添付の ID の昇順。本文だけの一致なら []）
// データは架空（testuser_casereq_・[UNIT_TEST]）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest } from "../../test/api-request";
import {
  STORED_EMPTY_BODY,
  cleanupAttachmentOnlyLeftovers,
} from "../../test/attachment-only-fixtures";
import { cleanupCaseTestData } from "../../test/case-fixtures";
import {
  setupCaseWorld,
  type CaseWorld,
} from "../../test/case-request-fixtures";
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
} from "../../test/search-fixtures";

const BASE_MS = 1_883_000_000_000;
const ROOM = fixedIdAt(BASE_MS);
const SECRET_ROOM = fixedIdAt(BASE_MS + 1);

let w: CaseWorld;
let V: { id: string; token: string };
let seq = 0;
let logLines: string[] = [];
let errorLines: string[] = [];

type Item = {
  messageId: string;
  excerpt: string;
  matchedIn: string[];
  matchedAttachments: { id: string; name: string }[];
};
type Page = { items: Item[]; nextCursor: string | null };

async function seed(options: {
  text: string;
  names?: string[];
  roomId?: string;
  senderId?: string;
}): Promise<{ id: string; attachments: string[] }> {
  seq += 1;
  const ms = BASE_MS + 10_000 + seq * 1_000;
  const id = fixedIdAt(ms);
  const roomId = options.roomId ?? ROOM;
  const senderId = options.senderId ?? V.id;
  await env.DB.prepare(
    `INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at)
     VALUES (?, ?, ?, 'テスト太郎', ?, ?)`,
  )
    .bind(
      id,
      roomId,
      senderId,
      `${TEST_TAG}${options.text}`,
      new Date(ms).toISOString(),
    )
    .run();
  const attachments: string[] = [];
  for (const name of options.names ?? [])
    attachments.push(
      await insertAttachmentRow({
        roomId,
        uploaderId: senderId,
        messageId: id,
        originalName: name,
      }),
    );
  return { id, attachments };
}

const searchPath = (query: Record<string, string>) =>
  `/api/search/messages?${new URLSearchParams(query).toString()}`;

async function ok(query: Record<string, string>) {
  const response = await apiRequest("GET", searchPath(query), {
    token: V.token,
  });
  expect(response.status, JSON.stringify(query)).toBe(200);
  return (await response.json()) as Page;
}

beforeEach(async () => {
  seq = 0;
  logLines = [];
  errorLines = [];
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
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    record(...args);
    errorLines.push(args.map(String).join(" "));
  });
  w = await setupCaseWorld();
  V = w.memberS1;
  await insertChannel({
    id: ROOM,
    name: `${TEST_TAG}search-att-api`,
    purpose: "normal",
    departmentId: w.deptS.id,
    visibility: "public",
  });
  await insertMember(ROOM, V.id);
  await insertChannel({
    id: SECRET_ROOM,
    name: `${TEST_TAG}search-att-api-secret`,
    purpose: "normal",
    departmentId: w.deptS.id,
    visibility: "private",
  });
  await insertMember(SECRET_ROOM, w.memberS2.id);
});

afterEach(async () => {
  vi.restoreAllMocks();
  try {
    await cleanupAttachmentOnlyLeftovers();
    await cleanupSearchIndex();
  } finally {
    await cleanupRelatedReadsRooms([ROOM, SECRET_ROOM]);
    await cleanupCaseTestData();
  }
});

describe("#155 AC-1 155-B A-1 応答の項目（matchedIn・matchedAttachments）", () => {
  it("#155 AC-1 A-1: 名前だけ・本文だけ・両方の一致が、それぞれ1行ずつで、matchedIn と matchedAttachments が付く。console.error は出ない", async () => {
    const nameOnly = await seed({
      text: "名前だけの行の本文",
      names: ["A1共通語の見積.pdf", "A1無関係の別紙.txt"],
    });
    const bodyOnly = await seed({
      text: "A1共通語を含む本文",
      names: ["A1無関係の資料.txt"],
    });
    const both = await seed({
      text: "A1共通語を含む両方の本文",
      names: ["A1共通語の請求.xlsx"],
    });
    await buildSearchIndex();
    const page = await ok({ q: "A1共通語" });
    expect(page.nextCursor).toBeNull();
    const byId = new Map(page.items.map((i) => [i.messageId, i]));
    expect(page.items).toHaveLength(3);
    expect(byId.get(nameOnly.id)).toMatchObject({
      matchedIn: ["attachment"],
      matchedAttachments: [
        { id: nameOnly.attachments[0], name: "A1共通語の見積.pdf" },
      ],
    });
    expect(byId.get(bodyOnly.id)).toMatchObject({
      matchedIn: ["body"],
      matchedAttachments: [],
    });
    expect(byId.get(both.id)).toMatchObject({
      matchedIn: ["body", "attachment"],
      matchedAttachments: [
        { id: both.attachments[0], name: "A1共通語の請求.xlsx" },
      ],
    });
    expect(errorLines).toEqual([]);
  });

  it("#155 AC-4 A-1: 見えない部屋の添付の名前で探した応答は、存在しない語で探した応答と本体まで同じ（部屋の指定あり・なし）", async () => {
    await seed({
      roomId: SECRET_ROOM,
      senderId: w.memberS2.id,
      text: "秘密室の本文です",
      names: ["A1秘密添付名.txt"],
    });
    await buildSearchIndex();
    const missingBody = async (query: Record<string, string>) => {
      const response = await apiRequest("GET", searchPath(query), {
        token: V.token,
      });
      return { status: response.status, body: await response.text() };
    };
    // 対照：参加者（memberS2）には出る（語が索引に入っていること）
    const member = await apiRequest("GET", searchPath({ q: "A1秘密添付名" }), {
      token: w.memberS2.token,
    });
    expect(((await member.json()) as Page).items).toHaveLength(1);
    expect(await missingBody({ q: "A1秘密添付名" })).toEqual(
      await missingBody({ q: "A1存在しない名" }),
    );
    expect(
      await missingBody({ q: "A1秘密添付名", roomId: SECRET_ROOM }),
    ).toEqual(
      await missingBody({
        q: "A1存在しない名",
        roomId: fixedIdAt(BASE_MS + 77),
      }),
    );
    expect(await missingBody({ q: "秘密添" })).toEqual(
      await missingBody({ q: "無在名" }),
    );
  });

  it("#155 AC-4 A-1: 成功・422 のどちらでも、検索語とファイル名がログ（console）に出ない", async () => {
    const fileName = "A1秘匿ファイル名ゼータ.pdf";
    await seed({ text: "ログの確認の本文", names: [fileName] });
    await buildSearchIndex();
    logLines = [];
    const found = await ok({ q: "A1秘匿ファイル名" });
    expect(found.items).toHaveLength(1);
    const invalid = await apiRequest(
      "GET",
      searchPath({ q: `A1秘匿ファイル名${"あ".repeat(100)}` }),
      { token: V.token },
    );
    expect(invalid.status).toBe(422);
    const joined = logLines.join("\n");
    expect(joined).not.toContain("A1秘匿ファイル名");
    expect(joined).not.toContain(fileName);
    expect(errorLines).toEqual([]);
  });
});

// ---- #270（270-B）AC-9：本文のない投稿（本文が目印）の検索の応答（計画 2.2 の 6・2.8）----
// 根拠：計画 AC-9（本文の検索のどの語でも目印で一致しない。添付のファイル名では一致し、結果の抜粋は空文字。matchedIn に attachment。空白だけの語は 422 のまま）・
//   利用者の決定1（API は本文なしを空文字で返す）。目印は test/attachment-only-fixtures.ts の値。シードの後に reindexMessages で登録し直す（buildSearchIndex）。
describe("#270 AC-9 本文のない投稿の検索", () => {
  async function seedBodyless(names: string[]) {
    seq += 1;
    const ms = BASE_MS + 10_000 + seq * 1_000;
    const id = fixedIdAt(ms);
    await env.DB.prepare(
      `INSERT INTO messages (id, room_id, sender_id, sender_display_name, body, created_at)
       VALUES (?, ?, ?, 'テスト太郎', ?, ?)`,
    )
      .bind(id, ROOM, V.id, STORED_EMPTY_BODY, new Date(ms).toISOString())
      .run();
    const attachments: string[] = [];
    for (const name of names)
      attachments.push(
        await insertAttachmentRow({
          roomId: ROOM,
          uploaderId: V.id,
          messageId: id,
          originalName: name,
        }),
      );
    return { id, attachments };
  }

  it("#270 AC-9: ファイル名の語で一致し、excerpt は空文字、matchedIn は attachment だけ", async () => {
    const seeded = await seedBodyless(["N270本文なしの見積.pdf"]);
    await buildSearchIndex();
    const page = await ok({ q: "N270本文なし" });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      messageId: seeded.id,
      excerpt: "",
      matchedIn: ["attachment"],
      matchedAttachments: [
        { id: seeded.attachments[0], name: "N270本文なしの見積.pdf" },
      ],
    });
    expect(JSON.stringify(page)).not.toContain(`"excerpt":" "`);
  });

  it.each([
    ["1文字の語", "Z"],
    ["2文字の語", "ZQ"],
    ["3文字以上の語", "ZQX270"],
  ])(
    "#270 AC-9: %s では、本文のない投稿は本文で一致しない（ファイル名にもない語）",
    async (_label, q) => {
      const seeded = await seedBodyless(["N270別名の資料.txt"]);
      await buildSearchIndex();
      const page = await ok({ q });
      expect(page.items.map((item) => item.messageId)).not.toContain(seeded.id);
    },
  );

  it("#270 AC-9: 半角の空白だけの語は、これまでどおり 422（目印に一致させる入口がない）", async () => {
    await seedBodyless(["N270空白の確認.txt"]);
    await buildSearchIndex();
    const response = await apiRequest("GET", searchPath({ q: " " }), {
      token: V.token,
    });
    expect(response.status).toBe(422);
  });
});
