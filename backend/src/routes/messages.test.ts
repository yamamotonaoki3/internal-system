// #201 AC-1〜AC-6: メッセージの一覧・投稿（EP-1-01・EP-1-02 の一部）を、実際のアプリ入口（index.ts の app）と隔離 D1 で確かめる。
// 判定の順（この順を変えない）：①見えるか（404）→ ②参加者か（403）→ ③お知らせ専用なら権限（403）→ 本文の形の検証（Controller が先に 422）。
// 応答の形の前提（実装前。引き継ぎに明記）：
//   一覧（after なし） 200 { items: [{ id, roomId, author: { id, displayName }, body, createdAt }]（新しい順）, nextCursor }
//   一覧（after あり） 200 { items: [...]（ID昇順。after は含まない）, hasMore }
//   投稿               201 { id, roomId, createdAt }
// 方針：振る舞い（ステータス・code・行の有無・順序・件数）で確かめる。エラーの文言は見ない。判定表の網羅は rules の単体にあり、ここは代表だけ。
// データは架空のもの（testuser_msg_、[UNIT_TEST]、@example.com）。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiRequest, insertReadyUser } from "../../test/api-request";
import { companyGeneralRoomId } from "../../test/company-general-fixtures";
import {
  TEST_TAG,
  insertChannel,
  insertDepartmentWithChannels,
  insertMember,
  makeGlobalAdmin,
  makeOwner,
  type SeededDepartment,
} from "../../test/department-fixtures";
import {
  ZERO_ID,
  cleanupMessageScenario,
  insertConversationRoom,
  insertMessage,
  insertMessages,
  messageCount,
  messageIds,
  ulidAt,
} from "../../test/message-fixtures";
import { testId } from "../../test/role-fixtures";

type Item = {
  id: string;
  roomId: string;
  author: { id: string; displayName: string };
  body: string;
  createdAt: string;
};
type Page = { items: Item[]; nextCursor?: string | null; hasMore?: boolean };
type User = { userId: string; token: string };

let deptA: SeededDepartment;
let deptB: SeededDepartment;
let member: User;
let stranger: User;
let ownerA: User;
let ownerB: User;
let admin: User;
let logLines: string[];

const messagesPath = (roomId: string) => `/api/rooms/${roomId}/messages`;
const get = (roomId: string, query = "", token: string | null = member.token) =>
  apiRequest("GET", `${messagesPath(roomId)}${query}`, { token });
const post = (
  roomId: string,
  body: unknown,
  token: string | null = member.token,
  origin?: string,
) =>
  apiRequest("POST", messagesPath(roomId), {
    token,
    body,
    ...(origin === undefined ? {} : { origin }),
  });
const send = (
  roomId: string,
  text: string,
  token: string | null = member.token,
) => post(roomId, { body: text }, token);

async function pageOf(roomId: string, query = "", token = member.token) {
  const response = await get(roomId, query, token);
  expect(response.status).toBe(200);
  return (await response.json()) as Page;
}

/** 拒否の監査（logger.audit）の行 */
const auditLines = () =>
  logLines
    .filter((line) => line.startsWith("{"))
    .map(
      (line) =>
        JSON.parse(line) as {
          body?: string;
          attributes?: Record<string, unknown>;
        },
    )
    .filter(
      (line) =>
        line.attributes?.log_type === "audit" &&
        line.body === "perm.announcement.post",
    );

beforeEach(async () => {
  logLines = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    logLines.push(String(line));
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  deptA = await insertDepartmentWithChannels("メッセージA");
  deptB = await insertDepartmentWithChannels("メッセージB");
  member = await insertReadyUser("testuser_msg_member", deptA.id);
  stranger = await insertReadyUser("testuser_msg_stranger", deptB.id);
  ownerA = await insertReadyUser("testuser_msg_ownera", deptA.id);
  ownerB = await insertReadyUser("testuser_msg_ownerb", deptB.id);
  admin = await insertReadyUser("testuser_msg_admin", deptA.id);
  await makeOwner(ownerA.userId, deptA.id);
  await makeOwner(ownerB.userId, deptB.id);
  await makeGlobalAdmin(admin.userId);
  await insertMember(deptA.dedicatedChannelId, member.userId);
  for (const user of [member, ownerA, ownerB, admin])
    await insertMember(deptA.announcementChannelId, user.userId);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupMessageScenario();
});

describe("#201 AC-1 閲覧と投稿の認可", () => {
  it.each(["公開", "参加中の非公開"])(
    "#201 AC-1: 参加者は%sチャンネルに投稿でき（201）、直後の取得に出る",
    async (kind) => {
      const roomId =
        kind === "公開"
          ? deptA.dedicatedChannelId
          : await insertChannel({
              name: `${TEST_TAG}参加中の非公開`,
              purpose: "normal",
              departmentId: deptA.id,
              visibility: "private",
            });
      if (kind !== "公開") await insertMember(roomId, member.userId);
      const response = await send(roomId, "[UNIT_TEST]こんにちは");
      expect(response.status).toBe(201);
      const created = (await response.json()) as {
        id: string;
        roomId: string;
        createdAt: string;
      };
      expect(created.roomId).toBe(roomId);
      const items = (await pageOf(roomId)).items;
      expect(items.map((i) => i.id)).toEqual([created.id]);
      expect(items[0]?.body).toBe("[UNIT_TEST]こんにちは");
    },
  );

  it("#201 AC-1: 未参加の公開チャンネルは、読めて（200）、投稿はできない（403 FORBIDDEN。行は増えない）", async () => {
    const existing = await insertMessage({
      roomId: deptA.dedicatedChannelId,
      senderId: member.userId,
    });
    expect(
      (await pageOf(deptA.dedicatedChannelId, "", stranger.token)).items.map(
        (i) => i.id,
      ),
    ).toEqual([existing]);
    const response = await send(
      deptA.dedicatedChannelId,
      "[UNIT_TEST]書けない",
      stranger.token,
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "FORBIDDEN" });
    expect(await messageIds(deptA.dedicatedChannelId)).toEqual([existing]);
  });

  it.each(["private", "archived", "missing", "conversation"] as const)(
    "#201 AC-1: 見えない部屋（%s）は、取得も投稿も404 NOT_FOUNDで区別がつかず、行は増えない",
    async (kind) => {
      const roomId = {
        private: () =>
          insertChannel({
            name: `${TEST_TAG}隠れた非公開`,
            purpose: "normal",
            departmentId: deptA.id,
            visibility: "private",
          }),
        archived: async () => {
          const id = await insertChannel({
            name: `${TEST_TAG}アーカイブ済み`,
            purpose: "normal",
            departmentId: deptA.id,
            archived: true,
          });
          await insertMember(id, member.userId);
          return id;
        },
        missing: async () => testId("NOROOM"),
        conversation: () => insertConversationRoom(),
      }[kind]();
      const id = await roomId;
      const read = await get(id);
      const write = await send(id, "[UNIT_TEST]書けない");
      expect(read.status).toBe(404);
      expect(write.status).toBe(404);
      expect(await read.json()).toMatchObject({ code: "NOT_FOUND" });
      expect(await write.json()).toMatchObject({ code: "NOT_FOUND" });
      expect(await messageCount(id)).toBe(0);
    },
  );

  it("#201 AC-1（認可）: 未認証は取得も投稿も401で、行は増えない", async () => {
    expect((await get(deptA.dedicatedChannelId, "", null)).status).toBe(401);
    expect((await send(deptA.dedicatedChannelId, "x", null)).status).toBe(401);
    expect(await messageCount(deptA.dedicatedChannelId)).toBe(0);
  });

  it("#201 AC-1（認可）: 許可されていない Origin からの投稿は403 FORBIDDEN_ORIGINで、行は増えない", async () => {
    const response = await post(
      deptA.dedicatedChannelId,
      { body: "[UNIT_TEST]x" },
      member.token,
      "https://origin.invalid",
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "FORBIDDEN_ORIGIN" });
    expect(await messageCount(deptA.dedicatedChannelId)).toBe(0);
  });

  it("#201 AC-1（判定の順）: お知らせ専用に未参加の全体管理者は、権限があっても403（参加者であることが先）", async () => {
    // beforeEach で全体管理者（admin）が既にいる。そのお知らせ専用への参加だけを外して「未参加の全体管理者」にする
    await env.DB.prepare(
      "DELETE FROM channel_members WHERE channel_id = ? AND user_id = ?",
    )
      .bind(deptA.announcementChannelId, admin.userId)
      .run();
    const response = await send(
      deptA.announcementChannelId,
      "[UNIT_TEST]x",
      admin.token,
    );
    expect(response.status).toBe(403);
    expect(await messageCount(deptA.announcementChannelId)).toBe(0);
  });
});

describe("#201 AC-2 本文の検証", () => {
  it.each([
    ["1文字", 201, "a"],
    ["4,000文字", 201, "a".repeat(4000)],
    ["0文字", 422, ""],
    ["4,001文字", 422, "a".repeat(4001)],
    ["空白と改行だけ", 422, " \n  "],
  ])("#201 AC-2: 本文が%sのとき %i", async (_label, status, text) => {
    const response = await send(deptA.dedicatedChannelId, text);
    expect(response.status).toBe(status);
    if (status === 422) {
      const body = (await response.json()) as {
        code: string;
        fields: string[];
      };
      expect(body.code).toBe("VALIDATION_ERROR");
      expect(body.fields).toContain("body");
    }
    expect(await messageCount(deptA.dedicatedChannelId)).toBe(
      status === 201 ? 1 : 0,
    );
  });

  it.each([
    ["body がない", {}],
    ["body が文字列でない", { body: 123 }],
    ["余分な項目（attachmentIds）", { body: "x", attachmentIds: [] }],
    ["投稿者を指定する項目（senderId）", { body: "x", senderId: "someone" }],
  ])("#201 AC-2: %s は422で、行は増えない", async (_label, payload) => {
    const response = await post(deptA.dedicatedChannelId, payload);
    expect(response.status).toBe(422);
    expect(await messageCount(deptA.dedicatedChannelId)).toBe(0);
  });

  it("#201 AC-2: SQLの特殊文字や前後の空白を含む本文は、そのまま保存され、そのまま返る", async () => {
    const text = " ' ; -- OR 1=1 --\n<b>x</b> ";
    expect((await send(deptA.dedicatedChannelId, text)).status).toBe(201);
    expect((await pageOf(deptA.dedicatedChannelId)).items[0]?.body).toBe(text);
  });
});

describe("#201 AC-3 最後のID以降の取得", () => {
  it("#201 AC-3: after は境界を含まず、ID昇順で返す。最後のIDを渡すと0件", async () => {
    const ids = await insertMessages(
      deptA.dedicatedChannelId,
      member.userId,
      5,
    );
    const page = await pageOf(deptA.dedicatedChannelId, `?after=${ids[1]}`);
    expect(page.items.map((i) => i.id)).toEqual(ids.slice(2));
    expect(page.hasMore).toBe(false);
    const empty = await pageOf(deptA.dedicatedChannelId, `?after=${ids[4]}`);
    expect(empty.items).toEqual([]);
    expect(empty.hasMore).toBe(false);
  });

  it("#201 AC-3: limit を超える件数は hasMore を辿ると、全件を重複なく1回ずつ、順に得られる。別の部屋のメッセージは混ざらない", async () => {
    const ids = await insertMessages(
      deptA.dedicatedChannelId,
      member.userId,
      7,
    );
    await insertMessages(deptA.announcementChannelId, member.userId, 3);
    const seen: string[] = [];
    let after = ZERO_ID;
    let rounds = 0;
    for (;;) {
      const page = await pageOf(
        deptA.dedicatedChannelId,
        `?after=${after}&limit=3`,
      );
      rounds += 1;
      seen.push(...page.items.map((i) => i.id));
      if (!page.hasMore) break;
      after = page.items.at(-1)?.id ?? after;
    }
    expect(seen).toEqual(ids);
    expect(rounds).toBe(3);
  });

  it("#201 AC-3: ちょうど limit 件のとき hasMore は偽。limit を省くと既定の100件で、超えると hasMore が真", async () => {
    const ids = await insertMessages(
      deptA.dedicatedChannelId,
      member.userId,
      100,
    );
    const exact = await pageOf(
      deptA.dedicatedChannelId,
      `?after=${ZERO_ID}&limit=100`,
    );
    expect(exact.items).toHaveLength(100);
    expect(exact.hasMore).toBe(false);
    await insertMessage({
      roomId: deptA.dedicatedChannelId,
      senderId: member.userId,
      id: ulidAt(1_800_000_000_000 + 100),
    });
    const byDefault = await pageOf(
      deptA.dedicatedChannelId,
      `?after=${ZERO_ID}`,
    );
    expect(byDefault.items.map((i) => i.id)).toEqual(ids.slice(0, 100));
    expect(byDefault.hasMore).toBe(true);
  });

  it("#201 AC-3: after なしは新しい順に50件と nextCursor を返し、cursor で次の古い側を続けて取れる", async () => {
    const ids = await insertMessages(
      deptA.dedicatedChannelId,
      member.userId,
      55,
    );
    const first = await pageOf(deptA.dedicatedChannelId);
    expect(first.items.map((i) => i.id)).toEqual(ids.slice(5).reverse());
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await pageOf(
      deptA.dedicatedChannelId,
      `?cursor=${first.nextCursor}`,
    );
    expect(second.items.map((i) => i.id)).toEqual(ids.slice(0, 5).reverse());
    expect(second.nextCursor ?? null).toBeNull();
  });

  it.each([
    ["after と cursor の同時指定", `?after=${ZERO_ID}&cursor=abc`],
    ["壊れた after", "?after=broken"],
    ["limit=0", `?after=${ZERO_ID}&limit=0`],
    ["limit=101", `?after=${ZERO_ID}&limit=101`],
  ])("#201 AC-3: %s は422", async (_label, query) => {
    const response = await get(deptA.dedicatedChannelId, query);
    expect(response.status).toBe(422);
  });

  it("#201 AC-3: 壊れた after の422は fields に after を含む", async () => {
    const response = await get(deptA.dedicatedChannelId, "?after=broken");
    expect(((await response.json()) as { fields: string[] }).fields).toContain(
      "after",
    );
  });

  it("#201 AC-3（取りこぼし防止）: 部屋の最大IDより小さいIDしか作れない状況でも、投稿は成功し、新しいIDは既存の最大より大きいので after=旧最大 で必ず取れる", async () => {
    // 別のWorkerが進んだ時計で作ったIDがすでにある状況（現在の時刻で作るIDはそれより小さい）
    const future = ulidAt(4_400_000_000_000);
    await insertMessage({
      roomId: deptA.dedicatedChannelId,
      senderId: member.userId,
      id: future,
    });
    const response = await send(
      deptA.dedicatedChannelId,
      "[UNIT_TEST]遅れた時計",
    );
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string };
    expect(created.id > future).toBe(true);
    const after = await pageOf(deptA.dedicatedChannelId, `?after=${future}`);
    expect(after.items.map((i) => i.id)).toEqual([created.id]);
  });

  it("#201 AC-3: 続けて投稿すると、IDは厳密に増え、最初の投稿のID以降の取得で2件目以降が全部取れる", async () => {
    const ids: string[] = [];
    for (const text of ["一", "二", "三"]) {
      const response = await send(deptA.dedicatedChannelId, text);
      expect(response.status).toBe(201);
      ids.push(((await response.json()) as { id: string }).id);
    }
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(3);
    const page = await pageOf(deptA.dedicatedChannelId, `?after=${ids[0]}`);
    expect(page.items.map((i) => i.id)).toEqual(ids.slice(1));
  });

  it("#201 AC-3: 同じ部屋に10件を同時に投稿すると、全件が201で、IDは重複なく厳密に増え、取りこぼしがない", async () => {
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        send(deptA.dedicatedChannelId, `[UNIT_TEST]同時${i}`),
      ),
    );
    expect(responses.map((r) => r.status)).toEqual(Array(10).fill(201));
    const page = await pageOf(
      deptA.dedicatedChannelId,
      `?after=${ZERO_ID}&limit=100`,
    );
    const ids = page.items.map((i) => i.id);
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
    expect([...ids].sort()).toEqual(ids);
    expect(page.items.map((i) => i.body).sort()).toEqual(
      Array.from({ length: 10 }, (_, i) => `[UNIT_TEST]同時${i}`).sort(),
    );
  });
});

describe("#201 AC-5 お知らせ専用への投稿", () => {
  it.each([
    ["自部署のオーナー", 201, () => ownerA],
    ["全体管理者", 201, () => admin],
    ["一般の参加者", 403, () => member],
    ["他部署のオーナー（参加者）", 403, () => ownerB],
  ])("#201 AC-5: %s の投稿は %i", async (_label, status, who) => {
    const response = await send(
      deptA.announcementChannelId,
      "[UNIT_TEST]お知らせ",
      who().token,
    );
    expect(response.status).toBe(status);
    expect(await messageCount(deptA.announcementChannelId)).toBe(
      status === 201 ? 1 : 0,
    );
    const denied = auditLines().filter(
      (line) => line.attributes?.reason === "forbidden",
    );
    expect(denied).toHaveLength(status === 201 ? 0 : 1);
  });

  it("#201 AC-5（仮定U-14）: 全社連絡は、参加者なら権限のない一般の社員も投稿できる。未参加は403", async () => {
    const general = await companyGeneralRoomId();
    expect(general).not.toBeNull();
    const roomId = general ?? "";
    await insertMember(roomId, member.userId);
    await insertMember(roomId, admin.userId);
    expect((await send(roomId, "[UNIT_TEST]全社へ", member.token)).status).toBe(
      201,
    );
    expect((await send(roomId, "[UNIT_TEST]全社へ2", admin.token)).status).toBe(
      201,
    );
    expect(
      (await send(roomId, "[UNIT_TEST]全社へ3", stranger.token)).status,
    ).toBe(403);
  });
});

describe("#201 AC-6 投稿時の表示名", () => {
  it("#201 AC-6: 後で表示名を変えても過去の投稿の表示名は変わらず、投稿者はセッションの利用者になる", async () => {
    expect((await send(deptA.dedicatedChannelId, "[UNIT_TEST]前")).status).toBe(
      201,
    );
    await env.DB.prepare("UPDATE users SET display_name = ? WHERE id = ?")
      .bind("変更後の名前", member.userId)
      .run();
    const item = (await pageOf(deptA.dedicatedChannelId)).items[0];
    expect(item?.author).toEqual({
      id: member.userId,
      displayName: "テスト太郎",
    });
  });
});
